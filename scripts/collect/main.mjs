// scripts/collect/main.mjs — 采集器业务主流程（被 index.mjs 动态 import）
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import './connectors/index.mjs';
import { get } from './connectors/registry.mjs';
import { normalizeItem } from './normalize.mjs';
import { classifyItem, loadKeywordRules } from './classify.mjs';
import { loadExcludeRules, evaluateItem, blockedChannels } from './exclude.mjs';
import { copyToPublicData, refreshLatestLink } from './write.mjs';
import { todayLocal, nowIso } from './lib/time.mjs';
import { appendEvents, makeEvent } from './append-events.mjs';
import { projectSnapshot } from './project-snapshot.mjs';
import { makeRunId } from './lib/run-id.mjs';
import { writeReport } from './report.mjs';
import { checkUrls, persistSourceHealth } from './url-health.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

function loadJson(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));
}

export function parseArgs() {
  const args = process.argv.slice(2);
  const out = { once: false, dryRun: false, only: null, out: null, skipHealth: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--once') out.once = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-health') out.skipHealth = true;
    else if (a === '--only') out.only = args[++i];
    else if (a === '--out') out.out = args[++i];
  }
  return out;
}

export async function main() {
  const opts = parseArgs();
  console.log(`[collect] start  dryRun=${opts.dryRun}  only=${opts.only ?? 'ALL'}  out=${opts.out ?? 'tmp/deploy'}`);

  const sources = loadJson('config/sources.json');
  const siteConfig = loadJson('config/site-config.json');
  const excludes = loadExcludeRules(resolve(ROOT, 'config/exclusions.json'));
  const channelMap = new Map(sources.channels.map((c) => [c.id, c]));
  const blockedChans = blockedChannels(excludes);
  const ruleMap = loadKeywordRules(resolve(ROOT, 'config/keyword-rules.json'));
  const channelWeights = collectChannelWeights(sources.channels, siteConfig);

  let dueSources = sources.sources.filter((s) => s.enabled && !blockedChans.has(s.channelId));
  if (opts.only) dueSources = dueSources.filter((s) => s.id === opts.only);
  if (dueSources.length === 0) {
    console.log('[collect] 无 enabled 源（--only 过滤后为空）');
    return;
  }

  const concurrency = siteConfig.network?.concurrency ?? 6;
  const startedAt = Date.now();

  const runId = makeRunId('r');
  const date = todayLocal();
  const fetchedAt = nowIso();

  const results = await runPool(dueSources, concurrency, async (source) => {
    return collectOne(source, channelMap, ruleMap, excludes);
  });

  // 统计
  let ok = 0;
  let err = 0;
  const items = [];
  for (const r of results) {
    if (r.error) err += 1;
    else ok += 1;
    if (r.items) for (const it of r.items) items.push(it);
  }
  console.log(`[collect] summary  ok=${ok}  err=${err}  items=${items.length}  runId=${runId}`);

  if (opts.dryRun) {
    console.log(`[collect] dry-run  items=${items.length}`);
    console.log(JSON.stringify(items.slice(0, 3), null, 2));
    return;
  }

  // ============== ingestRound ==============
  const outRoot = resolve(opts.out ?? join(ROOT, 'tmp', 'deploy'));
  const todayDir = join(outRoot, 'today');
  const eventPath = join(todayDir, `events-${date}.ndjson`);

  // 1) 追加事件流（O(1) appendFile）
  if (items.length > 0) {
    const events = items.map((it) => makeEvent({ item: it, runId, fetchedAt }));
    await appendEvents(eventPath, events);
  }

  // 2) 折叠 + dedup + 写快照 + 写 latest.json
  //    T-P3-fix：把 runPool 的真实逐源结果（results）传下去，使
  //    stats.sourceTotal/sourceOk/sourceFailed 与 stats.sourceHealth[] 反映真实
  //    采集健康度，而不是硬编码（此前 sourceFailed 恒为 0 → 页面1 失败黄条不可达）。
  const proj = await projectSnapshot({
    roundRoot: outRoot,
    date,
    channelWeights,
    commit: 'local',
    fetchResults: results,
  });
  console.log(`[collect] wrote ${proj.snapshotPath}  items=${proj.itemCount}  merged=${proj.mergedCount}`);

  // 2.5) 报告生成（T-P2-05）
  // reportPath 声明在 try 外：报告成功时要把它一起经 dev bridge 复制到 public。
  let reportPath = null;
  try {
    const snap = JSON.parse(await readFile(proj.snapshotPath, 'utf8'));
    // 透传 siteConfig 的 5 维度权重 + 半衰期，使 `analysis.weights` / `analysis.halfLifeHours`
    // 真正生效（此前只传 channelWeights，导致 config 权重成为 dead config）。
    // 链路：main → writeReport → buildReport → analyzeSnapshot（缺省回落 DEFAULT_WEIGHTS）。
    const rpt = writeReport(outRoot, snap, {
      channelWeights,
      weights: siteConfig?.analysis?.weights,
      halfLifeHours: siteConfig?.analysis?.halfLifeHours,
    });
    reportPath = rpt.path;
    console.log(`[collect] wrote ${rpt.path}  hotList=${rpt.report.hotList.length}  keywords=${rpt.report.keywords.length}`);
  } catch (e) {
    console.warn(`[collect] report step skipped: ${e.message}`);
  }

  // 2.6) URL 健康检查 + lastStatus 持久化（T-P2-08 最后 1 公里）
  //      ARCH §12：本步失败不阻断主流程（warn-not-throw）
  if (opts.skipHealth) {
    console.log('[collect] health skipped (--skip-health)');
  } else {
    try {
      const health = await runSourceHealthCheck({
        sources,
        dueSources,
        sourcesJsonPath: resolve(ROOT, 'config/sources.json'),
        concurrency,
      });
      console.log(
        `[collect] health  checked=${health.checked}  mutated=${health.persisted.mutated}  ${JSON.stringify(health.stats)}`,
      );
    } catch (e) {
      console.warn(`[collect] health step skipped: ${e.message}`);
    }
  }

  // 3) dev bridge: 复制到 public/data/today/（P1 行为兼容）
  //    报告与快照同一轮产出，必须一起复制；否则本地 today/ 会出现
  //    「snapshot 已是新一轮、report 还是旧一轮」的口径漂移（report.totalItems ≠ snapshot.items）。
  try {
    const publicDir = join(ROOT, 'public');
    copyToPublicData(proj.snapshotPath, publicDir);
    // report 缺失 / 复制失败不得影响 snapshot 复制（warn-not-throw，单独 try）
    let reportCopied = false;
    if (reportPath) {
      try {
        copyToPublicData(reportPath, publicDir);
        reportCopied = true;
      } catch (e) {
        console.warn(`[collect] dev-bridge report skipped: ${e.message}`);
      }
    }
    refreshLatestLink(publicDir, date);
    console.log(
      `[collect] dev-bridge refreshed -> public/data/today/snapshot-${date}.json`
        + (reportCopied ? ` + report-${date}.json` : ''),
    );
  } catch (e) {
    console.warn(`[collect] dev-bridge skipped: ${e.message}`);
  }

  const elapsed = Date.now() - startedAt;
  console.log(`[collect] done in ${elapsed}ms`);

  // 退出码
  if (err === 0) process.exit(0);
  else if (ok === 0) process.exit(1);
  else process.exit(2);
}

/**
 * 源级 URL 健康检查 + lastStatus 回写 config/sources.json（ARCH §15）
 *
 * 闭环 P1 裁决 C → P2-A 裁决 C → P2-B QA 裁决 B-1（挂了三轮的旧账）：
 * 此前 persistSourceHealth 只有定义与单测、生产零调用方，跑 collect:once
 * 时 sources.json 的 lastStatus 一个字都不会写。
 *
 * 要点：
 * - 只检查**本轮实际采集**的源（dueSources），不检查 disabled / 被排除的源
 * - prevStatuses 取自 sources[].lastStatus，保证两轮防抖动能跨轮生效
 *   （pendingDead 必须能持久化，否则永远到不了 dead）
 * - 并发受 ARCH §15.1 约束（≤4，同域串行 1s）
 *
 * @param {Object} p
 * @param {{channels:Array, sources:Array}} p.sources     完整配置对象（用于 prevStatuses + 写回）
 * @param {Array<{url?:string}>} p.dueSources             本轮采集的源
 * @param {string} p.sourcesJsonPath                      config/sources.json 绝对路径
 * @param {number} [p.concurrency=6]                      采集并发（健康检查内部收敛到 ≤4）
 * @returns {Promise<{checked:number, stats:Object, persisted:{mutated:boolean}}>}
 */
export async function runSourceHealthCheck({ sources, dueSources, sourcesJsonPath, concurrency = 6 }) {
  const urls = [...new Set((dueSources ?? []).map((s) => s.url).filter(Boolean))];
  if (urls.length === 0) {
    return { checked: 0, stats: null, persisted: { mutated: false } };
  }

  // 上一轮状态：供状态机做两轮防抖动
  // 注意缺省值必须是 'unknown' 而不是省掉——transition() 内部 prev ?? 'ok'，
  // 若缺省则网络故障（cur=unknown）会被错误地写回 'ok'（假绿）。
  const prevStatuses = {};
  for (const s of sources?.sources ?? []) {
    if (s?.url) prevStatuses[s.url] = s.lastStatus ?? 'unknown';
  }

  const res = await checkUrls(urls, {
    concurrency: Math.min(concurrency, 4), // ARCH §15.1 硬约束：健康检查并发 ≤ 4
    perHostIntervalMs: 1000, // 同域串行 1s 间隔
    prevStatuses,
  });

  const persisted = await persistSourceHealth(sourcesJsonPath, sources.sources, res.records);
  return { checked: res.records.length, stats: res.stats, persisted };
}

/**
 * 从 channels[] + siteConfig 派生 {channelId: weight}
 * siteConfig 没声明则取 channel.weight（默认 0.5）
 */
function collectChannelWeights(channels, siteConfig) {
  const out = {};
  for (const c of channels) {
    const w = siteConfig?.analysis?.channelWeights?.[c.id] ?? c.weight ?? 0.5;
    out[c.id] = clamp01(w);
  }
  return out;
}

function clamp01(x) {
  if (typeof x !== 'number' || Number.isNaN(x)) return 0.5;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * 简单并发池
 */
async function runPool(items, concurrency, worker) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = idx;
      idx += 1;
      if (i >= items.length) break;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 采集单个 source 的完整流程（含归一化 + 分类 + 排除）
 * 失败隔离：单源失败不阻断整体（allSettled 语义）
 *
 * 返回结构（T-P3-fix：显式补 `ok`，供 projectSnapshot 汇总逐源健康度）：
 *   成功 → { sourceId, channelId, channelName, ok:true, items, rawItemCount, httpStatus, hitCount }
 *   失败 → { sourceId, channelId, channelName, ok:false, error }
 */
async function collectOne(source, channelMap, ruleMap, excludes) {
  const channel = channelMap.get(source.channelId);
  if (!channel) {
    return { sourceId: source.id, channelId: source.channelId, channelName: '(missing)', ok: false, error: new Error(`channel ${source.channelId} not found`) };
  }
  let rawItems;
  let httpStatus = 0;
  try {
    const connector = get(source.type); // unknown type → throws
    const res = await connector.run(source);
    rawItems = res.items ?? [];
    httpStatus = res.httpStatus ?? 0;
  } catch (err) {
    return {
      sourceId: source.id,
      channelId: source.channelId,
      channelName: channel.name,
      ok: false,
      error: err,
    };
  }

  const out = [];
  let hitCount = 0;
  for (const raw of rawItems) {
    const item = normalizeItem(raw, source, channel);
    item.category = classifyItem(item, ruleMap);
    const ev = evaluateItem(item, excludes);
    if (ev.excluded) {
      hitCount += 1;
      continue;
    }
    out.push(item);
  }
  return {
    sourceId: source.id,
    channelId: source.channelId,
    channelName: channel.name,
    ok: true,
    items: out,
    rawItemCount: rawItems.length,
    httpStatus,
    hitCount,
  };
}

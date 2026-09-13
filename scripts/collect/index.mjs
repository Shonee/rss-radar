#!/usr/bin/env node
/**
 * 采集器编排入口（P2 完整版：ARCHITECTURE §3.7 / §6.7）
 *
 * 流程（ARCH §6.7 ingestRound）：
 *   loadConfig → dueSources → pool(concurrent=6)
 *   → connector.run → normalizeItem → classifyItem → exclude.evaluate
 *   → ingestRound（append-events + project-snapshot）
 *
 * 用法：
 *   node scripts/collect/index.mjs --once
 *   node scripts/collect/index.mjs --only <source-id>
 *   node scripts/collect/index.mjs --only <source-id> --dry-run
 *   node scripts/collect/index.mjs --help
 *
 * 行为：
 *   --only 过滤 source.id
 *   --dry-run 仅打印归一化后的 Item[]，不写盘
 *   --out <dir> 自定义输出根目录（默认 tmp/deploy，P1 行为兼容）
 *   全部 enabled 源全跑；任意源失败不阻断整体（allSettled 语义）
 *   退出码：0=全部 ok；1=全部失败；2=部分失败
 */
import { readFileSync } from 'node:fs';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

function loadJson(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { once: false, dryRun: false, only: null, out: null };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--once') out.once = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--only') out.only = args[++i];
    else if (a === '--out') out.out = args[++i];
    else if (a === '--help' || a === '-h') {
      console.log([
        '用法：node scripts/collect/index.mjs [options]',
        '',
        '选项：',
        '  --once               跑一次全部 enabled 源（默认也是 --once 行为）',
        '  --only <source-id>   只跑指定 source.id',
        '  --dry-run            仅打印 Item[]，不写盘',
        '  --out <dir>          输出根目录（默认 tmp/deploy）',
        '  --help, -h           显示帮助',
      ].join('\n'));
      process.exit(0);
    }
  }
  return out;
}

async function main() {
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
  const proj = await projectSnapshot({
    roundRoot: outRoot,
    date,
    channelWeights,
    commit: 'local',
  });
  console.log(`[collect] wrote ${proj.snapshotPath}  items=${proj.itemCount}  merged=${proj.mergedCount}`);

  // 3) dev bridge: 复制到 public/data/today/（P1 行为兼容）
  try {
    const publicDir = join(ROOT, 'public');
    copyToPublicData(proj.snapshotPath, publicDir);
    refreshLatestLink(publicDir, date);
    console.log(`[collect] dev-bridge refreshed -> public/data/today/snapshot-${date}.json`);
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
 */
async function collectOne(source, channelMap, ruleMap, excludes) {
  const channel = channelMap.get(source.channelId);
  if (!channel) {
    return { sourceId: source.id, channelId: source.channelId, channelName: '(missing)', error: new Error(`channel ${source.channelId} not found`) };
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
    items: out,
    rawItemCount: rawItems.length,
    httpStatus,
    hitCount,
  };
}

main().catch((err) => {
  console.error('[collect] fatal:', err);
  process.exit(2);
});

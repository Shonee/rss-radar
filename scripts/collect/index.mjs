#!/usr/bin/env node
/**
 * 采集器编排入口（P1 简化版）
 * ARCHITECTURE §3.7 / §6.7
 *
 * 单源快照（不实现事件流 NDJSON + 折叠，留 T-P2-03）：
 *   loadConfig → dueSources → pool(concurrent=6) → connector.run → normalize → classify → exclude → write
 *
 * 用法：
 *   node scripts/collect/index.mjs --once
 *   node scripts/collect/index.mjs --only <source-id>
 *   node scripts/collect/index.mjs --only <source-id> --dry-run
 *   node scripts/collect/index.mjs
 *
 * 行为：
 *   --only 过滤 source.id
 *   --dry-run 仅打印归一化后的 Item[]，不写盘
 *   全部 enabled 源全跑；任意源失败不阻断整体（allSettled 语义）
 *   退出码：0=全部 ok；1=全部失败；2=部分失败
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import './connectors/index.mjs';
import { get } from './connectors/registry.mjs';
import { normalizeItem } from './normalize.mjs';
import { classifyItem, loadKeywordRules } from './classify.mjs';
import { loadExcludeRules, evaluateItem, blockedChannels } from './exclude.mjs';
import { writeJsonCompact, copyToPublicData, refreshLatestLink } from './write.mjs';
import { todayLocal, nowIso, windowStartUtc } from './lib/time.mjs';
import { sha256 } from './lib/hash.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

function loadJson(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { once: false, dryRun: false, only: null };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--once') out.once = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--only') out.only = args[++i];
    else if (a === '--help' || a === '-h') {
      console.log('用法：node scripts/collect/index.mjs [--once] [--dry-run] [--only <source-id>]');
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs();
  console.log(`[collect] start  dryRun=${opts.dryRun}  only=${opts.only ?? 'ALL'}`);

  const sources = loadJson('config/sources.json');
  const siteConfig = loadJson('config/site-config.json');
  const excludes = loadExcludeRules(resolve(ROOT, 'config/exclusions.json'));
  const channelMap = new Map(sources.channels.map((c) => [c.id, c]));
  const blockedChans = blockedChannels(excludes);
  const ruleMap = loadKeywordRules(resolve(ROOT, 'config/keyword-rules.json'));

  let dueSources = sources.sources.filter((s) => s.enabled && !blockedChans.has(s.channelId));
  if (opts.only) dueSources = dueSources.filter((s) => s.id === opts.only);
  if (dueSources.length === 0) {
    console.log('[collect] 无 enabled 源（--only 过滤后为空）');
    return;
  }

  const concurrency = siteConfig.network?.concurrency ?? 6;
  const results = await runPool(dueSources, concurrency, async (source) => {
    return collectOne(source, channelMap, ruleMap, excludes);
  });

  // 统计
  let ok = 0;
  let err = 0;
  for (const r of results) {
    if (r.error) err += 1;
    else ok += 1;
  }
  console.log(`[collect] summary  ok=${ok}  err=${err}  total=${results.length}`);

  // 聚合 items + 写盘
  const items = [];
  let itemsBefore = 0;
  for (const r of results) {
    if (r.error) continue;
    itemsBefore += r.rawItemCount ?? 0;
    for (const it of r.items ?? []) items.push(it);
  }
  const itemsAfterDedup = items; // P1 不做去重；T-P2-02 升级 L1~L5

  const date = todayLocal();
  const stats = {
    sourceTotal: results.length,
    sourceOk: ok,
    sourceFailed: err,
    itemsBeforeDedup: itemsBefore,
    itemsAfterDedup: itemsAfterDedup.length,
    mergedCount: 0,
    durationMs: 0, // 后续接 Date.now()
    sources: results.map((r) => ({
      channelId: r.channelId,
      channelName: r.channelName,
      ok: !r.error,
      itemCount: r.items?.length ?? 0,
      error: r.error?.message?.slice(0, 200),
    })),
  };

  const snapshot = {
    schemaVersion: '1.0',
    date,
    timezone: 'Asia/Shanghai',
    generatedAt: nowIso(),
    stats,
    items: itemsAfterDedup,
  };

  if (opts.dryRun) {
    console.log(`[collect] dry-run  items=${itemsAfterDedup.length}`);
    console.log(JSON.stringify(itemsAfterDedup.slice(0, 3), null, 2));
    return;
  }

  // 写 tmp/（P1 不进 deploy 分支）
  const tmpDir = join(ROOT, 'tmp', 'today');
  const filename = `snapshot-${date}.json`;
  const outPath = join(tmpDir, filename);
  writeJsonCompact(outPath, snapshot);
  console.log(`[collect] wrote ${outPath}`);

  // dev bridge: 复制到 public/data/today/
  try {
    const publicDir = join(ROOT, 'public');
    copyToPublicData(outPath, publicDir);
    refreshLatestLink(publicDir, date);
    console.log(`[collect] dev-bridge refreshed -> public/data/today/${filename}`);
  } catch (e) {
    console.warn(`[collect] dev-bridge skipped: ${e.message}`);
  }

  // 退出码
  if (err === 0) process.exit(0);
  else if (ok === 0) process.exit(1);
  else process.exit(2);
}

/**
 * 简单并发池（不引入 p-limit 依赖以保持零依赖；后续 P2 可升级）
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
 * 采集单个 source 的完整流程
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

  // normalize → classify → exclude
  const out = [];
  for (const raw of rawItems) {
    const item = normalizeItem(raw, source, channel);
    item.category = classifyItem(item, ruleMap);
    const ev = evaluateItem(item, excludes);
    if (ev.excluded) {
      // P1 简化：只统计 hitCount，不写排除日志
      ev.hitReason = `${ev.hitRuleId}@${ev.hitField}:${ev.reason}`;
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
  };
}

// sha256 / windowStartUtc 占位导出（避免 lint 警告；后续 T-P2 复用）
export { sha256, windowStartUtc };

main().catch((err) => {
  console.error('[collect] fatal:', err);
  process.exit(2);
});
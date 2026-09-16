#!/usr/bin/env node
// scripts/export-channels.mjs — 把 config/sources.json 导出成**可提交、可人读、可回灌**的形态
//
// ── 为什么需要它 ─────────────────────────────────────────────────────────
//
// 主理人 2026-09-16 的需求 1 后半句是「保存渠道数据」。`config/sources.json`
// 是 SSOT，但它不适合当「保存」的落点：
//   · 它混了采集回写字段（lastFetchAt / etag / lastModified），每次采集都变
//   · 它的 channel 与 source 是分离的两张表，人读要自己 join
//   · 没有自证格式的标记，脱离本仓库后无法判断这是什么
//
// 所以导出成一份**自证格式**的快照：`rss-radar/channel-registry`，
// 一个渠道一条记录（内嵌全部 feed），人读友好，且能**原样回灌**——
// 回灌走 `import-channels.mjs --file <导出>`，识别为注册表导出后进入
// 「还原模式」：保序、按 preset 还原 id 与开关、不跑放量逻辑。
//
// ── 三条门禁（由 scripts/__tests__/export-roundtrip.test.mjs 锁住） ──────
//
//   ① 导出是 config 的**纯函数**：同 config + 同 --now ⇒ 逐字节相同
//   ② 导出 → 导入 → 再导出 ⇒ 逐字节相同（导入自己产出的导出必须是 no-op）
//   ③ 每个 feedUrl 都能在 Source.url 里找到；counts 与数组长度自洽
//
// ── 用法 ─────────────────────────────────────────────────────────────────
//
//   node scripts/export-channels.mjs                      # 落 config-exports/
//   node scripts/export-channels.mjs --opml config-exports/subs.opml
//   node scripts/export-channels.mjs --stdout             # 打到标准输出

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

import { normalizeFeedUrl } from './lib/channel-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCES_PATH = resolve(ROOT, 'config/sources.json');
const CATEGORIES_PATH = resolve(ROOT, 'config/categories.json');
const DEFAULT_OUT_DIR = resolve(ROOT, 'config-exports');

export const EXPORT_FORMAT = 'rss-radar/channel-registry';
export const EXPORT_VERSION = 1;

/** 一个渠道的「主 feed」＝ 它第一条 source（导出里单列 `feedUrl`，供简单消费方读取） */
function primarySource(sources) {
  return sources.length > 0 ? sources[0] : null;
}

/**
 * 构建导出对象。**纯函数**：给定相同的 config / now / commit，输出逐字节相同。
 *
 * 刻意不做排序 —— 保持 config 里的原始顺序。原因：回灌还原时 channel id 由
 * 创建顺序经 `freeId()` 派生，顺序一变 id 就可能变，逐字节幂等立刻失效。
 * 稳定顺序不是「顺手」的事，是正确性的前提。
 *
 * @param {Object} config config/sources.json 的内容
 * @param {{ now?: string, commit?: string, repo?: string, branch?: string }} [opts]
 * @returns {Object}
 */
export function buildExport(config, opts = {}) {
  const channels = Array.isArray(config?.channels) ? config.channels : [];
  const sources = Array.isArray(config?.sources) ? config.sources : [];

  const byChannel = new Map();
  for (const s of sources) {
    if (!s?.channelId) continue;
    if (!byChannel.has(s.channelId)) byChannel.set(s.channelId, []);
    byChannel.get(s.channelId).push(s);
  }

  const statusCount = {};
  const outChannels = channels.map((c) => {
    const feeds = byChannel.get(c.id) || [];
    const primary = primarySource(feeds);

    const rec = {
      id: c.id,
      name: c.name,
      homepage: c.homepage,
      feedUrl: primary?.url ?? '',
      category: Array.isArray(c.category) ? c.category.slice() : [],
      enabled: c.enabled !== false,
    };
    // 可选字段：**只在存在时写入**，保证「没有该字段」与「字段为 undefined」
    // 在导出里形态一致（否则 JSON.stringify 会吐出 null，回灌时变成真值）
    if (typeof c.weight === 'number') rec.weight = c.weight;
    if (Number.isInteger(c.displayLimit)) rec.displayLimit = c.displayLimit;
    if (c.icon) rec.icon = c.icon;
    if (c.language) rec.language = c.language;
    if (Array.isArray(c.tags) && c.tags.length > 0) rec.tags = c.tags.slice();
    if (c.description) rec.description = c.description;
    if (c.origin) rec.origin = c.origin;
    if (c.originRef) rec.originRef = c.originRef;
    if (c.importBatch) rec.importBatch = c.importBatch;

    // 健康摘要（人读用；逐源的 lastStatus 在 feeds[] 里，回灌时由它还原）
    const statuses = feeds.map((f) => f.lastStatus).filter(Boolean);
    for (const st of statuses) statusCount[st] = (statusCount[st] || 0) + 1;
    if (statuses.length > 0) {
      const tally = {};
      for (const st of statuses) tally[st] = (tally[st] || 0) + 1;
      rec.health = { feeds: feeds.length, ...tally };
    }

    rec.feeds = feeds.map((f) => {
      const feed = {
        id: f.id,
        url: f.url,
        type: f.type,
        enabled: f.enabled !== false,
      };
      if (f.name) feed.name = f.name;
      if (f.language) feed.language = f.language;
      if (Number.isInteger(f.interval)) feed.interval = f.interval;
      // 源级溯源独立于渠道级 —— 同一渠道的多个 feed 可能来自不同批次导入
      if (f.origin) feed.origin = f.origin;
      if (f.originRef) feed.originRef = f.originRef;
      if (f.importBatch) feed.importBatch = f.importBatch;
      // 健康状态：回灌时由这些字段还原，不还原就不可能逐字节幂等
      if (f.lastStatus) feed.lastStatus = f.lastStatus;
      if (f.lastFetchAt) feed.lastFetchAt = f.lastFetchAt;
      if (f.lastError) feed.lastError = f.lastError;
      return feed;
    });

    return rec;
  });

  const categories = [...new Set(channels.flatMap((c) => (Array.isArray(c.category) ? c.category : [])))].sort();

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: opts.now || isoNow(),
    generatedAt: config?.generatedAt || '',
    source: {
      repo: opts.repo || 'Shonee/rss-radar',
      branch: opts.branch || 'master',
      commit: opts.commit || '',
    },
    counts: {
      channels: outChannels.length,
      sources: sources.length,
      enabledChannels: outChannels.filter((c) => c.enabled).length,
      enabledSources: sources.filter((s) => s.enabled !== false).length,
      ...statusCount,
    },
    categories,
    channels: outChannels,
  };
}

/**
 * 生成 OPML 2.0。按渠道主分类分组，分组顺序follow config/categories.json 的注册顺序。
 *
 * OPML 是「渠道清单能被任何 RSS 阅读器直接吃下」的通用落点 —— 比自定义 JSON
 * 的适用范围大得多，所以它是导出的第二个（而非替代）目标。
 *
 * @param {Object} config
 * @param {{ now?: string, title?: string }} [opts]
 * @returns {string}
 */
export function toOpml(config, opts = {}) {
  const channels = Array.isArray(config?.channels) ? config.channels : [];
  const sources = Array.isArray(config?.sources) ? config.sources : [];
  const byChannel = new Map();
  for (const s of sources) {
    if (!s?.channelId) continue;
    if (!byChannel.has(s.channelId)) byChannel.set(s.channelId, []);
    byChannel.get(s.channelId).push(s);
  }

  const regOrder = readCategoryOrder();
  const groups = new Map();
  for (const c of channels) {
    const key = (Array.isArray(c.category) && c.category[0]) || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const groupKeys = [...groups.keys()].sort((a, b) => {
    const ia = regOrder.indexOf(a);
    const ib = regOrder.indexOf(b);
    if (ia === -1 && ib === -1) return a < b ? -1 : a > b ? 1 : 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const labelOf = (key) => readCategoryLabels()[key] || key;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    '    <title>rss-radar 渠道清单</title>',
    `    <dateCreated>${esc(opts.now || isoNow())}</dateCreated>`,
    `    <ownerName>Shonee/rss-radar</ownerName>`,
    '  </head>',
    '  <body>',
  ];

  for (const key of groupKeys) {
    lines.push(`    <outline text="${esc(labelOf(key))}" title="${esc(labelOf(key))}">`);
    for (const c of groups.get(key)) {
      for (const f of byChannel.get(c.id) || []) {
        const attrs = [
          `type="rss"`,
          `text="${esc(c.name)}"`,
          `title="${esc(c.name)}"`,
          `xmlUrl="${esc(f.url)}"`,
          `htmlUrl="${esc(c.homepage)}"`,
          `rssradar:id="${esc(c.id)}"`,
        ];
        if (f.enabled === false) attrs.push(`rssradar:enabled="false"`);
        if (c.origin) attrs.push(`rssradar:origin="${esc(c.origin)}"`);
        lines.push(`      <outline ${attrs.join(' ')}/>`);
      }
    }
    lines.push('    </outline>');
  }

  lines.push('  </body>', '</opml>', '');
  return lines.join('\n');
}

function readCategoryOrder() {
  try {
    const j = JSON.parse(readFileSync(CATEGORIES_PATH, 'utf8'));
    return (j.categories || []).map((c) => c.key);
  } catch {
    return [];
  }
}

function readCategoryLabels() {
  try {
    const j = JSON.parse(readFileSync(CATEGORIES_PATH, 'utf8'));
    const out = {};
    for (const c of j.categories || []) out[c.key] = c.label;
    return out;
  } catch {
    return {};
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function mainCli(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  const config = JSON.parse(await readFile(opts.config || SOURCES_PATH, 'utf8'));
  const now = opts.now || isoNow();
  const payload = buildExport(config, {
    now,
    commit: opts.commit || gitCommit(),
    repo: opts.repo,
    branch: opts.branch,
  });

  const text = JSON.stringify(payload, null, 2) + '\n';

  if (opts.stdout) {
    process.stdout.write(text);
    if (opts.opml) process.stderr.write(toOpml(config, { now }));
    return 0;
  }

  const dateTag = now.slice(0, 10).replace(/-/g, '');
  const outPath = resolve(opts.out || join(DEFAULT_OUT_DIR, `channels-${dateTag}.json`));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, text, 'utf8');

  console.log(`📦 导出 ${payload.counts.channels} 渠道 / ${payload.counts.sources} 源 → ${outPath}`);
  console.log(`   启用的渠道 ${payload.counts.enabledChannels} / 源 ${payload.counts.enabledSources}`);
  const st = Object.entries(payload.counts).filter(([k]) =>
    ['ok', 'moved', 'blocked', 'dead', 'pendingDead', 'unknown'].includes(k));
  if (st.length > 0) console.log(`   健康状态 ${st.map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (payload.source.commit) console.log(`   提交 ${payload.source.commit}`);

  if (opts.opml) {
    const opmlPath = resolve(opts.opml);
    await mkdir(dirname(opmlPath), { recursive: true });
    await writeFile(opmlPath, toOpml(config, { now }), 'utf8');
    console.log(`📄 OPML → ${opmlPath}`);
  }
  return 0;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--help': case '-h': o.help = true; break;
      case '--config': o.config = next(); break;
      case '--out': o.out = next(); break;
      case '--opml': o.opml = next(); break;
      case '--now': o.now = next(); break;
      case '--commit': o.commit = next(); break;
      case '--repo': o.repo = next(); break;
      case '--branch': o.branch = next(); break;
      case '--stdout': o.stdout = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`未知参数：${a}（--help 看用法）`);
    }
  }
  return o;
}

function printHelp() {
  console.log(`
把 config/sources.json 导出为自证格式的渠道注册表快照（可提交 / 可人读 / 可回灌）。

用法
  node scripts/export-channels.mjs [选项]

选项
  --out <path>        导出 JSON 落点（默认 config-exports/channels-<YYYYMMDD>.json）
  --opml <path>       额外导出一份 OPML（可直接喂给任意 RSS 阅读器）
  --config <path>     源配置（默认 config/sources.json）
  --now <iso>         固定导出时间（幂等断言可复现）
  --commit <sha>      覆盖记录在 source.commit 里的提交号
  --stdout            打到标准输出，不落盘（OPML 走 stderr）

回灌
  node scripts/import-channels.mjs --file config-exports/channels-<日期>.json --skip-health --write
`);
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  mainCli().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(`❌ ${err?.message || err}`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
// scripts/dev/seed-history.mjs — 本地「历史数据」种子脚本（走**真实采集管线**）
//
// 背景（T-P3-06 3.1）：项目上线初期没有真实历史数据，页面4（历史趋势与回看）无法验证。
// 本脚本用与线上**完全相同**的管线函数，模拟 N 天（默认 3）的采集 + 跨天转换，产出
// 与 deploy 分支一致的历史数据布局，供 npm run dev 本地联调页面4：
//
//   真实管线：normalizeItem → appendEvents → projectSnapshot → analyzeSnapshot
//             → writeReport → rolloverIfNewDay（月度 NDJSON + 归档快照 + history-index）
//
// 产出（默认写入 public/data/）：
//   history/history-index.json               滚动 days[]（多天）
//   history/archive-index.json               1 条「年度归档」元数据（>1 年只读态演示）
//   history/YYYY/MM/items.ndjson             月度精简行（NDJSON，一天一行一 item）
//   history/YYYY/MM/snapshot-<date>.json     按天归档快照
//   history/YYYY/MM/report-<date>.json       按天报告
//
// 幂等：每次运行先清空 staging（tmp/seed-history）与目标 history/，全部重建，
//       绝不向既有文件追加，因此「重复运行结果一致」，不产生脏数据。
//
// 用法：
//   node scripts/dev/seed-history.mjs                 # 3 天，写入 public/data/
//   node scripts/dev/seed-history.mjs --days 7        # 7 天
//   node scripts/dev/seed-history.mjs --out public/data
//   node scripts/dev/seed-history.mjs --help
//
// 参考实现：scripts/smoke/e2e-pipeline.mjs（同一套 ingest + rollover 编排）。

import { existsSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendEvents, makeEvent } from '../collect/append-events.mjs';
import { projectSnapshot } from '../collect/project-snapshot.mjs';
import { analyzeSnapshot } from '../collect/analyze.mjs';
import { writeReport } from '../collect/report.mjs';
import { rolloverIfNewDay } from '../collect/history.mjs';
import { normalizeItem } from '../collect/normalize.mjs';
import { todayLocal, nowIso } from '../collect/lib/time.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const DEFAULT_DAYS = 3;
const DEFAULT_OUT = join(ROOT, 'public', 'data');
/** staging 采集根（与线上 roundRoot 同构：<root>/today + <root>/history） */
const STAGE = join(ROOT, 'tmp', 'seed-history');

const OWNER = process.env.VITE_DATA_OWNER ?? 'Shonee';
const REPO = process.env.VITE_DATA_REPO ?? 'rss-radar';

// ---------- 渠道（对齐 config/sources.json，保证数据观感一致） ----------

const CHANNELS = [
  { id: 'ruanyifeng-blog', name: '阮一峰的网络日志', category: ['tech_blog'], homepage: 'https://www.ruanyifeng.com/blog/' },
  { id: 'ruanyifeng-weekly', name: '科技爱好者周刊', category: ['tech_blog', 'newsletter'], homepage: 'https://www.ruanyifeng.com/blog/weekly/' },
  { id: 'v2ex', name: 'V2EX', category: ['dev_community'], homepage: 'https://www.v2ex.com/' },
  { id: 'sspai', name: '少数派', category: ['tech_blog', 'dev_community'], homepage: 'https://sspai.com/' },
  { id: 'hacker-news', name: 'Hacker News', category: ['dev_community', 'news'], homepage: 'https://news.ycombinator.com/' },
  { id: 'huggingface-blog', name: 'Hugging Face Blog', category: ['ai'], homepage: 'https://huggingface.co/blog' },
  { id: 'github-blog', name: 'GitHub Blog', category: ['tech_blog', 'ai'], homepage: 'https://github.blog/' },
  { id: 'kernel-panic', name: '内核恐慌', category: ['podcast'], homepage: 'https://kernelpanic.fm/' },
];

const CHANNEL_BY_ID = new Map(CHANNELS.map((c) => [c.id, c]));

/** 渠道路由权重（用于 hotScore 的 channelWeight 维度） */
const CHANNEL_WEIGHTS = {
  'hacker-news': 0.9,
  'ruanyifeng-blog': 0.8,
  'ruanyifeng-weekly': 0.8,
  'huggingface-blog': 0.7,
  'github-blog': 0.7,
  v2ex: 0.6,
  sspai: 0.6,
  'kernel-panic': 0.5,
};

/** 话题池：同一条目在不同渠道重复出现即构成跨源重合（sourceCount ≥ 2）。 */
const TOPICS = [
  { title: '科技爱好者周刊（第 324 期）：AI 编程助手的一年', url: 'https://www.ruanyifeng.com/blog/2026/09/weekly-324.html', channelId: 'ruanyifeng-weekly', author: '阮一峰', summary: '记录每周值得分享的科技内容，本周聚焦 AI 编程助手的一年。' },
  { title: 'Smol Course: training small language models from scratch', url: 'https://huggingface.co/blog/smol-course', channelId: 'huggingface-blog', author: 'HF Team', summary: 'A hands-on course to train small language models from scratch.' },
  { title: 'Show HN: A static RSS aggregator with zero backend', url: 'https://news.ycombinator.com/item?id=42000001', channelId: 'hacker-news', summary: 'I built a fully static RSS aggregator that needs no server.' },
  { title: '我用 Obsidian 搭了一个会自己长大的知识库', url: 'https://sspai.com/post/92001', channelId: 'sspai', author: '少数派', summary: '一套可长期维护的个人知识管理方法。' },
  { title: '大家平时都用什么 RSS 阅读器？', url: 'https://www.v2ex.com/t/1020001', channelId: 'v2ex', summary: '同步、去重、全文抓取，你最看重哪一点？' },
  { title: 'GitHub Copilot code review 正式发布', url: 'https://github.blog/2026-09-10-copilot-code-review/', channelId: 'github-blog', author: 'GitHub', summary: '在 PR 里自动给出代码审查意见。' },
  { title: '内核恐慌 #58：聊聊静态站点与 CDN', url: 'https://kernelpanic.fm/58', channelId: 'kernel-panic', summary: '从 Jekyll 到边缘渲染，静态站点的十年。' },
  { title: 'TypeScript 5.7 的几个实用新特性', url: 'https://www.ruanyifeng.com/blog/2026/09/typescript-5-7.html', channelId: 'ruanyifeng-blog', author: '阮一峰', summary: '更聪明的类型收窄与更快的编译。' },
  { title: 'Fine-tuning Llama for Chinese summarization', url: 'https://huggingface.co/blog/llama-zh-summarize', channelId: 'huggingface-blog', author: 'HF Team', summary: 'A practical recipe for Chinese summarization.' },
  { title: 'SQLite is not a toy database', url: 'https://news.ycombinator.com/item?id=42000042', channelId: 'hacker-news', summary: 'Why SQLite scales far beyond most people expect.' },
  { title: '2026 年值得关注的 10 款效率工具', url: 'https://sspai.com/post/92042', channelId: 'sspai', author: '少数派', summary: '从笔记到自动化，一次看全。' },
  { title: '自建 RSSHub 的正确姿势', url: 'https://www.v2ex.com/t/1020042', channelId: 'v2ex', summary: '部署、缓存与反爬的取舍。' },
  { title: '2026 开源趋势报告：小模型与本地优先', url: 'https://github.blog/2026-09-11-open-source-trends/', channelId: 'github-blog', author: 'GitHub', summary: '本地优先与小型模型的崛起。' },
  { title: '科技爱好者周刊（第 325 期）：把工具做窄', url: 'https://www.ruanyifeng.com/blog/2026/09/weekly-325.html', channelId: 'ruanyifeng-weekly', author: '阮一峰', summary: '把工具做窄，把场景做深。' },
];

// ---------- 工具 ----------

function sourceOf(channel) {
  return {
    id: `${channel.id}-rss`,
    channelId: channel.id,
    name: channel.name,
    type: 'rss',
    url: `${channel.homepage.replace(/\/$/, '')}/feed.xml`,
  };
}

/** YYYY-MM-DD 加减天数（UTC 基准，避免时区漂移） */
function addDays(date, delta) {
  const [y, m, d] = date.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

function ymOf(date) {
  const [y, m] = date.split('-');
  return { year: y, month: m };
}

/** 生成某一天的原始条目（含 1 组跨源重合） */
function buildDayRawItems(dayIndex, date) {
  const raw = [];
  const count = 8 + dayIndex * 3; // 8 / 11 / 14 ... 条数逐日上升，趋势有形状
  const offset = (dayIndex * 3) % TOPICS.length;
  for (let i = 0; i < count; i += 1) {
    const t = TOPICS[(offset + i) % TOPICS.length];
    raw.push({
      title: t.title,
      // 逐日 URL 唯一，避免跨天被 L1/L2 误合并（去重是「当日」范围）
      url: `${t.url}?d=${date}`,
      guid: `${t.channelId}:${date}:${i}`,
      publishedAt: `${date}T0${i % 10}:15:00Z`,
      summary: t.summary,
      author: t.author,
      channelId: t.channelId,
    });
  }
  // 跨源重合：同一标题由第二个渠道也报道（→ L2 精确标题合并 → sourceCount ≥ 2）
  // ⚠ URL 必须与主条目「标准化后不同」（不同 host），否则会命中 R2 追踪参数剥离
  //   （如 from=）在同一 dedupKey 上被 L1 折叠掉，而非在 L2 合并为多源条目。
  const shared = TOPICS[(dayIndex + 2) % TOPICS.length];
  let alt = CHANNELS[(dayIndex + 3) % CHANNELS.length];
  if (alt.id === shared.channelId) alt = CHANNELS[(dayIndex + 4) % CHANNELS.length];
  const slug = shared.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 24) || 'shared';
  raw.push({
    title: shared.title,
    url: `https://${alt.id}.rss-radar.example/${date}/${slug}`,
    guid: `${alt.id}:${date}:shared`,
    publishedAt: `${date}T06:40:00Z`,
    summary: shared.summary,
    author: alt.name,
    channelId: alt.id,
  });
  return raw;
}

/** 原始条目 → 归一化 Item（走真实 normalizeItem） */
function buildDayItems(dayIndex, date) {
  return buildDayRawItems(dayIndex, date).map((r) => {
    const channel = CHANNEL_BY_ID.get(r.channelId);
    if (!channel) throw new Error(`未知渠道：${r.channelId}`);
    return normalizeItem(r, sourceOf(channel), channel);
  });
}

// ---------- 参数 ----------

export function printHelp() {
  console.log(
    [
      '用法：node scripts/dev/seed-history.mjs [options]',
      '',
      '选项：',
      `  --days <N>        模拟天数（默认 ${DEFAULT_DAYS}），结束于今天（Asia/Shanghai）`,
      '  --out <dir>       历史数据输出目录（默认 public/data，即 history 落在 public/data/history）',
      '  --help, -h        显示帮助',
      '',
      '说明：脚本走真实采集管线（appendEvents/projectSnapshot/analyzeSnapshot/writeReport/',
      '      rolloverIfNewDay），幂等覆盖，不追加脏数据。',
    ].join('\n'),
  );
}

export function parseArgs(argv = []) {
  const opts = { help: false, days: DEFAULT_DAYS, out: DEFAULT_OUT };
  const takesValue = new Set(['--days', '--out']);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq !== -1) {
      assignOpt(opts, a.slice(0, eq), a.slice(eq + 1));
      continue;
    }
    if (takesValue.has(a)) {
      assignOpt(opts, a, argv[i + 1]);
      i += 1;
    }
  }
  opts.days = Math.max(1, Math.floor(Number(opts.days) || DEFAULT_DAYS));
  return opts;
}

function assignOpt(opts, key, value) {
  if (key === '--days') opts.days = value;
  else if (key === '--out') opts.out = value;
}

// ---------- 归档索引（1 条年度归档元数据，演示 >1 年只读态） ----------

function buildArchiveIndex(nowYear) {
  const year = nowYear - 1;
  const months = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    const itemCount = 5200 + ((i * 137) % 2400);
    return {
      month: `${year}-${mm}`,
      itemCount,
      bytes: itemCount * 252,
    };
  });
  const entry = {
    year,
    releaseTag: `archive-${year}`,
    releaseUrl: `https://github.com/${OWNER}/${REPO}/releases/tag/archive-${year}`,
    generatedAt: `${nowYear}-01-01T00:05:00Z`,
    months,
  };
  return {
    schemaVersion: '1.0',
    updatedAt: nowIso(),
    days: [],
    archives: [entry],
  };
}

// ---------- 主流程 ----------

export async function seedHistory(opts) {
  const days = opts.days;
  const outDir = opts.out;
  const outHistory = join(outDir, 'history');

  const siteConfig = JSON.parse(await readFile(join(ROOT, 'config', 'site-config.json'), 'utf8'));
  const weights = siteConfig?.analysis?.weights;
  const halfLifeHours = siteConfig?.analysis?.halfLifeHours ?? 6;

  // 幂等：清空 staging 与目标 history
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(join(STAGE, 'today'), { recursive: true });
  mkdirSync(join(STAGE, 'history'), { recursive: true });
  rmSync(outHistory, { recursive: true, force: true });

  const end = todayLocal();
  const dates = [];
  for (let i = days - 1; i >= 0; i -= 1) dates.push(addDays(end, -i));

  const summary = { days: days, dates: [], items: {}, snapshots: 0, reports: 0, monthlyRows: 0 };

  for (let idx = 0; idx < dates.length; idx += 1) {
    const date = dates[idx];
    const items = buildDayItems(idx, date);
    const events = items.map((item) =>
      makeEvent({ item, runId: `seed-${date}`, fetchedAt: `${date}T02:00:00Z` }),
    );

    // 1) 追加事件流
    await appendEvents(join(STAGE, 'today', `events-${date}.ndjson`), events);

    // 2) 折叠 + 去重 → 投影快照
    const proj = await projectSnapshot({
      roundRoot: STAGE,
      date,
      channelWeights: CHANNEL_WEIGHTS,
      commit: 'seed',
    });
    summary.snapshots += 1;

    // 3) 分析 + 报告（权重与 halfLifeHours 来自 site-config，与线上口径一致）
    const snap = JSON.parse(await readFile(proj.snapshotPath, 'utf8'));
    const written = writeReport(STAGE, snap, {
      channelWeights: CHANNEL_WEIGHTS,
      weights,
      halfLifeHours,
      hotListSize: 10,
      keywordsTop: 8,
    });
    summary.reports += 1;

    // 4) 跨天转换：封口当天 → 月度 NDJSON + 归档快照 + history-index
    //    不传 snapshotByDate：rollover 从 today/snapshot-<date>.json 读「落盘快照」，
    //    与线上「次日读取磁盘快照封口」一致（也避免把分析层回写的 hotScore 混入月度行）。
    const nextDate = addDays(date, 1);
    const rl = await rolloverIfNewDay({
      roundRoot: STAGE,
      currentDate: nextDate,
      previousDate: date,
    });
    summary.monthlyRows += rl.monthlyAppended;

    // 5) 归档当天报告（rollover 只归档快照，报告需显式复制，对齐 §13.1 路径约定）
    const { year, month } = ymOf(date);
    const monthDir = join(STAGE, 'history', year, month);
    mkdirSync(monthDir, { recursive: true });
    await writeFile(
      join(monthDir, `report-${date}.json`),
      await readFile(written.path, 'utf8'),
      'utf8',
    );

    summary.dates.push(date);
    summary.items[date] = proj.itemCount;
  }

  // 6) 归档索引（1 条年度归档）
  const nowYear = Number(todayLocal().slice(0, 4));
  const archiveIndex = buildArchiveIndex(nowYear);
  await writeFile(
    join(STAGE, 'history', 'archive-index.json'),
    JSON.stringify(archiveIndex, null, 2),
    'utf8',
  );

  // 7) 原子替换目标 history/（先删后拷 → 幂等、无脏追加）
  mkdirSync(outDir, { recursive: true });
  cpSync(join(STAGE, 'history'), outHistory, { recursive: true });

  return { outHistory, summary, archiveYear: archiveIndex.archives[0].year };
}

async function mainCli() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }
  console.log(`[seed-history] days=${opts.days}  out=${opts.out}`);
  const { outHistory, summary, archiveYear } = await seedHistory(opts);

  const idxPath = join(outHistory, 'history-index.json');
  const idx = existsSync(idxPath) ? JSON.parse(await readFile(idxPath, 'utf8')) : { days: [] };
  const first = idx.days[0]?.date ?? '—';
  const last = idx.days[idx.days.length - 1]?.date ?? '—';

  console.log(`[seed-history] history-index days=${idx.days.length}  ${first} → ${last}`);
  for (const d of idx.days) {
    console.log(`  - ${d.date}: totalItems=${d.totalItems}  activeChannels=${d.activeChannels}`);
  }
  console.log(`[seed-history] snapshots=${summary.snapshots}  reports=${summary.reports}  monthlyRows=${summary.monthlyRows}  archiveYear=${archiveYear}`);
  console.log(`[seed-history] DONE → ${outHistory}`);
  return 0;
}

// ESM「直接执行」守卫（同 url-health.mjs / notify/main.mjs）：被 import 时不触发 CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  mainCli().then(
    (code) => process.exit(code),
    (err) => {
      console.error('[seed-history] fatal:', err);
      process.exit(1);
    },
  );
}

#!/usr/bin/env node
// scripts/notify/main.mjs — 通知模块 CLI 入口
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12
//
// 用法（遵循 scripts/collect/url-health.mjs 的入口守卫写法）：
//   node scripts/notify/main.mjs --dry-run --event dailyReport
//   node scripts/notify/main.mjs --event realtime --dry-run
//   node scripts/notify/main.mjs --event dailyReport --date 2026-09-12 --report <path>
//   node scripts/notify/main.mjs --help
//
// --dry-run 只构建消息并打印逐渠道判定（不真发、不写状态、不写 stats）。
// 真发时密钥仅来自 process.env[ref]（refs.* 为 GitHub Secrets 变量名，配置内无明文）。

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { buildDailyDigest, buildRealtime, dispatch } from './index.mjs';
import { DEFAULT_STATE_PATH, DEFAULT_STATS_DIR } from './lib/idempotency.mjs';

const TZ = 'Asia/Shanghai';

/** 打印用法 */
export function printHelp() {
  console.log([
    '用法：node scripts/notify/main.mjs [options]',
    '',
    '选项：',
    '  --dry-run                构建消息但「不真发」，打印消息体预览 + 逐渠道判定',
    '  --event <name>           事件类型：dailyReport（默认）| realtime',
    '  --date <YYYY-MM-DD>      日报日期（默认取 report.date / 今日 Asia/Shanghai）',
    '  --report <path>          指定 report.json（默认自动探测 public/data/today/，兜底示例文件）',
    '  --items <path>           实时事件条目来源 JSON（数组或 {items:[]}；默认取 report.hotList）',
    '  --config <path>          通知配置路径（默认 config/notify.json）',
    '  --site-config <path>     站点配置路径（默认 config/site-config.json）',
    '  --state <path>           幂等状态文件（默认 stats/notify-state.json）',
    '  --stats-dir <path>       结果记录目录（默认 stats/）',
    '  --help, -h               显示帮助',
    '',
    '示例：',
    '  node scripts/notify/main.mjs --dry-run --event dailyReport',
    '  node scripts/notify/main.mjs --event realtime --dry-run',
    '',
    '说明：--dry-run 不真发、不写状态/stats；真发时密钥只读 process.env[refs.*]。',
  ].join('\n'));
}

/**
 * 解析 CLI 参数（支持 `--k v` 与 `--k=v`）。
 * @param {string[]} argv
 * @returns {Object}
 */
export function parseArgs(argv = []) {
  const opts = {
    help: false,
    dryRun: false,
    event: 'dailyReport',
    date: undefined,
    report: undefined,
    items: undefined,
    config: 'config/notify.json',
    siteConfig: 'config/site-config.json',
    state: DEFAULT_STATE_PATH,
    statsDir: DEFAULT_STATS_DIR,
  };
  const takesValue = new Set(['--event', '--date', '--report', '--items', '--config', '--site-config', '--state', '--stats-dir']);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--dry-run') { opts.dryRun = true; continue; }
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq !== -1) {
      const k = a.slice(0, eq);
      const v = a.slice(eq + 1);
      assignOpt(opts, k, v);
      continue;
    }
    if (takesValue.has(a)) {
      assignOpt(opts, a, argv[i + 1]);
      i += 1;
    }
  }
  return opts;
}

function assignOpt(opts, key, value) {
  switch (key) {
    case '--event': opts.event = value; break;
    case '--date': opts.date = value; break;
    case '--report': opts.report = value; break;
    case '--items': opts.items = value; break;
    case '--config': opts.config = value; break;
    case '--site-config': opts.siteConfig = value; break;
    case '--state': opts.state = value; break;
    case '--stats-dir': opts.statsDir = value; break;
    default: break;
  }
}

async function loadJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    throw new Error(`无法读取${label}：${path}（${err?.message ?? String(err)}）`);
  }
}

/**
 * 探测 report.json 路径。
 * 优先级：--report → public/data/today/report-<date>.json → report.json → 示例文件。
 * @returns {Promise<{report:Object, source:string}>}
 */
export async function loadReport(opts) {
  const candidates = [];
  if (opts.report) candidates.push(opts.report);
  if (opts.date) candidates.push(`public/data/today/report-${opts.date}.json`);
  candidates.push('public/data/today/report.json');
  candidates.push('public/data/today/latest-report.json');
  candidates.push('docs/data-model/examples/report.example.json');

  for (const p of candidates) {
    if (existsSync(p)) {
      return { report: await loadJson(p, '报告文件'), source: p };
    }
  }
  throw new Error(`找不到 report.json（尝试过：${candidates.join('、')}）`);
}

/**
 * 为实时事件准备 items + trigger。
 * 优先级：--items 文件 → report.hotList → 快照 items。
 * @returns {Promise<{items:Array, trigger:Object, source:string}>}
 */
export async function loadRealtime(opts, report = {}) {
  if (opts.items) {
    const data = await loadJson(opts.items, '实时条目文件');
    const items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
    return { items, trigger: { itemId: items[0]?.id }, source: opts.items };
  }
  if (Array.isArray(report.hotList) && report.hotList.length > 0) {
    return { items: report.hotList, trigger: { itemId: report.hotList[0]?.id }, source: 'report.hotList' };
  }
  for (const snap of ['public/data/today/latest.json', 'public/data/today/snapshot.json']) {
    if (existsSync(snap)) {
      const data = await loadJson(snap, '快照文件');
      if (Array.isArray(data.items) && data.items.length > 0) {
        const items = data.items.map((it) => ({
          ...it,
          sourceCount: it.sourceCount ?? 1,
          hotScore: it.hotScore ?? 0.85,
          channelNames: it.channelNames ?? (it.channelName ? [it.channelName] : []),
        }));
        return { items, trigger: { itemId: items[0]?.id }, source: snap };
      }
    }
  }
  return { items: [], trigger: {}, source: 'none' };
}

function printOutcome(message, outcome, opts) {
  const mode = opts.dryRun ? 'DRY RUN（不真发）' : '发送';
  console.log(`[notify] ${mode}  event=${message.event}  key=${message.idempotencyKey}  tz=${TZ}`);
  console.log('='.repeat(64));
  console.log(`subject: ${message.title}`);
  console.log('-'.repeat(64));
  console.log(message.markdown);
  console.log('='.repeat(64));
  console.log('逐渠道判定：');
  for (const r of outcome.results) {
    const tag = r.ok ? 'OK  ' : (r.skipped ? 'SKIP' : 'FAIL');
    const detail = r.ok
      ? `status=${r.status ?? '-'}`
      : (r.skipped ? r.skipReason : (r.error ?? 'error'));
    console.log(`  [${tag}] ${r.channelId} (${r.channelType})  ${detail}  ${r.durationMs}ms`);
  }
  const sent = outcome.results.filter((x) => x.ok && !x.skipped).length;
  const skipped = outcome.results.filter((x) => x.skipped).length;
  const failed = outcome.results.filter((x) => !x.ok && !x.skipped).length;
  console.log(`[notify] 汇总：sent=${sent} skipped=${skipped} failed=${failed}`);
  if (outcome.stateFile) console.log(`[notify] 结果记录：${outcome.stateFile}`);
}

/**
 * CLI 主流程。
 * @param {string[]} [argv]
 * @returns {Promise<number>} exit code
 */
export async function mainCli(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  const notifyConfig = await loadJson(opts.config, '通知配置');
  const siteConfig = existsSync(opts.siteConfig) ? await loadJson(opts.siteConfig, '站点配置') : {};

  let message;
  if (opts.event === 'dailyReport') {
    const { report, source } = await loadReport(opts);
    console.log(`[notify] 报告来源：${source}`);
    message = buildDailyDigest({ report, siteConfig, date: opts.date });
  } else if (opts.event === 'realtime') {
    let report = {};
    try {
      report = (await loadReport(opts)).report;
    } catch {
      report = {};
    }
    const { items, trigger, source } = await loadRealtime(opts, report);
    console.log(`[notify] 实时条目来源：${source}（${items.length} 条）`);
    message = buildRealtime({ items, trigger });
  } else {
    console.error(`[notify] 未知 --event "${opts.event}"（应为 dailyReport | realtime）`);
    return 2;
  }

  try {
    const outcome = await dispatch({
      config: notifyConfig,
      message,
      dryRun: opts.dryRun,
      statePath: opts.state,
      statsDir: opts.statsDir,
    });
    printOutcome(message, outcome, opts);
    return 0;
  } catch (err) {
    if (err && err.outcome) {
      printOutcome(message, err.outcome, opts);
    }
    console.error(`[notify] ${err?.message ?? String(err)}`);
    return 1;
  }
}

// ESM「直接执行」守卫：被 import 时不触发 CLI（同 url-health.mjs）。
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  mainCli().then(
    (code) => process.exit(code),
    (err) => {
      console.error('[notify] fatal:', err);
      process.exit(1);
    },
  );
}

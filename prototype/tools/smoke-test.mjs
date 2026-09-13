#!/usr/bin/env node
/* =============================================================================
 * RSS Radar 原型 · 自检脚本（可复现）
 * -----------------------------------------------------------------------------
 * 运行：node prototype/tools/smoke-test.mjs                      # 数据契约 + DOM 元素存在性（默认必须验证 DOM）
 *       node prototype/tools/smoke-test.mjs --no-dom             # 仅数据契约（显式跳过 DOM，输出会显著标注）
 *       node prototype/tools/smoke-test.mjs --chrome-path <BIN>  # 指定 Chrome/Chromium 可执行文件
 *
 * 覆盖：
 *   A. 数据契约恒等关系（跨页口径一致，防数字漂移）
 *   B. 特殊数据齐备性（跨源 / 失败 / 无数据 / 停用 / 归档 / 三态回看）
 *   C. 关键字段类型（对齐 docs/data-model/examples/）
 *   D. 各页关键元素存在性（headless Chrome 渲染 DOM 后断言；默认模式下未找到/渲染失败 = 未验证）
 *   E. 响应式回归的静态护栏（日历栅格不溢出）
 *
 * 退出码：0 = 通过（含 DOM 验证；或 --no-dom 显式跳过）；1 = 存在 FAIL；
 *         2 = 默认模式下 DOM 段未能验证（未找到 Chrome / 启动失败 / 渲染失败）。
 * ========================================================================== */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const NO_DOM = process.argv.includes('--no-dom');
// --chrome-path 优先于环境变量；显式指定（或指向不存在路径以模拟）Chrome 可执行文件。
const CHROME_PATH_ARG = argValue('--chrome-path');
const CHROME_BIN = CHROME_PATH_ARG || process.env.CHROME_BIN;

let pass = 0, fail = 0, skip = 0;
const failures = [];
// DOM 段状态（P3-7：渲染失败 / 无浏览器时，默认模式不得报无条件 PASS）
let domVerified = false;    // 是否真正渲染 DOM 并完成全部断言
let domUnverifiedWhy = '';  // 未验证原因（用于汇总行）

function ok(label) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + label); }
function bad(label, detail) { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  \x1b[31m✗\x1b[0m ' + label + (detail ? '  [' + detail + ']' : '')); }
function skipped(label, why) { skip++; console.log('  \x1b[33m•\x1b[0m SKIP ' + label + (why ? ' (' + why + ')' : '')); }
function check(cond, label, detail) { cond ? ok(label) : bad(label, detail); }
function group(name) { console.log('\n' + name); }

/* =============================================================================
 * 载入 mock-data.js（在沙箱中，仅提供 window）
 * ======================================================================== */
const sandbox = { window: {}, console: { log() {} }, Math, Date, JSON, Object, Array, String, Number, Boolean };
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(ROOT, 'assets/js/mock-data.js'), 'utf8'), sandbox, { filename: 'mock-data.js' });
const M = sandbox.window.RR_MOCK;
if (!M) { console.error('无法加载 mock-data.js'); process.exit(2); }

const pad2 = (n) => (n < 10 ? '0' : '') + n;
const cnKey = (iso) => {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
};
const mainItems = M.items.filter((i) => !i.duplicateOf);
const todayItems = mainItems.filter((i) => cnKey(i.updatedAt) === M.TODAY);

/* =============================================================================
 * A. 数据契约恒等关系（P2-2 / P3-3 的回归护栏）
 * ======================================================================== */
group('A. 数据契约恒等关系（跨页口径一致）');
check(M.report.totalItems === todayItems.length,
  'report.totalItems == 当天去重后条目数 (' + M.report.totalItems + ' == ' + todayItems.length + ')');

const catSum = M.report.categoryStats.reduce((a, c) => a + c.itemCount, 0);
check(catSum === M.report.totalItems,
  'Σ categoryStats.itemCount == totalItems (' + catSum + ' == ' + M.report.totalItems + ')');

check(M.report.activeChannels === M.report.channelActivity.length,
  'report.activeChannels == channelActivity.length (' + M.report.activeChannels + ' == ' + M.report.channelActivity.length + ')');

check(M.snapshotStats.itemsAfterDedup === M.report.totalItems,
  'snapshotStats.itemsAfterDedup == report.totalItems (' + M.snapshotStats.itemsAfterDedup + ' == ' + M.report.totalItems + ')');

check(M.snapshotStats.itemsBeforeDedup >= M.snapshotStats.itemsAfterDedup,
  'snapshotStats.itemsBeforeDedup >= itemsAfterDedup');

const allRatios = M.report.categoryStats.reduce((a, c) => a + c.ratio, 0);
check(Math.abs(allRatios - 1) < 0.02, 'Σ categoryStats.ratio ≈ 1 (' + allRatios.toFixed(3) + ')');

/* =============================================================================
 * B. 特殊数据齐备性
 * ======================================================================== */
group('B. 特殊数据齐备性');
check(mainItems.length >= 40, '主条目数 >= 40 (have ' + mainItems.length + ')');
check(M.channels.length >= 8, '渠道数 >= 8 (have ' + M.channels.length + ')');
check(M.sources.length >= 10, '源数 >= 10 (have ' + M.sources.length + ')');
check(M.report.hotList.length === 10, '热点榜 == 10 条 (have ' + M.report.hotList.length + ')');
check(M.report.crossSource.length >= 3, '跨源重合榜数据 >= 3 (have ' + M.report.crossSource.length + ')');
check(M.items.some((i) => (i.sourceCount || 1) > 1) && M.items.filter((i) => (i.sourceCount || 1) > 1).length >= 3,
  '存在跨源条目(sourceCount>1) >= 3');
check(M.items.some((i) => i.isNew) && M.items.some((i) => !i.isNew), 'isNew 有 true/false 两类');
check(M.sources.some((s) => s.lastStatus === 'error'), '存在抓取失败源(lastStatus=error)');
check(M.channels.some((c) => c.enabled === false), '存在停用渠道(enabled=false)');

const cardsLimit = 10;
const maxTodayPerChannel = M.channels.reduce((mx, c) => Math.max(mx, todayItems.filter((i) => i.channelId === c.id).length), 0);
check(maxTodayPerChannel > cardsLimit,
  '存在单渠道今日条数 > 每卡片默认 ' + cardsLimit + ' 条（演示「查看全部→」，have ' + maxTodayPerChannel + '）');

const st = {}; Object.keys(M.daySnapshots).forEach((k) => { st[M.daySnapshots[k].status] = true; });
check(st.ok && st.empty && st.archived, '回看三态齐备 (有数据/无数据/已归档)');
check(Array.isArray(M.archives) && M.archives.length >= 1, '归档索引 >= 1 年');
check(M.historyIndex.days.length >= 365, '趋势天数 >= 365 (have ' + M.historyIndex.days.length + ')');
check(Object.keys(M.historyMonths).length >= 3, '月度明细 >= 3 个月 (have ' + Object.keys(M.historyMonths).length + ')');

/* =============================================================================
 * C. 关键字段类型（对齐数据模型示例）
 * ======================================================================== */
group('C. 关键字段类型');
check(M.items.every((i) => Array.isArray(i.category)), 'items[].category 均为数组');
check(M.items.every((i) => Array.isArray(i.sources) && i.sources.every((s) => typeof s === 'object')),
  'items[].sources 均为对象数组');
check(M.items.every((i) => typeof i.sourceCount === 'number'), 'items[].sourceCount 均为 number');
check(M.items.every((i) => typeof i.isNew === 'boolean'), 'items[].isNew 均为 boolean');
check(M.items.every((i) => i.hotScore === null || typeof i.hotScore === 'number'), 'items[].hotScore 为 number|null');
check(M.items.every((i) => !!M.channelById[i.channelId]), 'items[].channelId 均可解析');
check(M.channels.every((c) => (c.category || []).every((k) => !!M.catByKey[k])), 'channels[].category 均为有效分类键');

/* =============================================================================
 * D. 各页关键元素存在性（headless Chrome；无浏览器则 SKIP）
 * ======================================================================== */
group('D. 各页关键元素存在性 (headless Chrome)');

function findChrome() {
  // 显式指定 --chrome-path 时只认该路径（指向不存在路径即视为未找到，可用于模拟无 Chrome）；
  // 否则回退到环境变量与常见安装路径。
  if (CHROME_PATH_ARG) {
    return existsSync(CHROME_PATH_ARG) ? CHROME_PATH_ARG : null;
  }
  const cands = [
    CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return cands.find((p) => existsSync(p)) || null;
}

function dumpDom(chrome, file) {
  const profile = path.join(os.tmpdir(), 'rr-proto-smoke-' + process.pid);
  const res = spawnSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + profile, '--virtual-time-budget=5000',
    '--dump-dom', 'file://' + path.join(ROOT, file)
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 40000 });
  if (res.error || !res.stdout) { return null; }
  return res.stdout;
}

function count(html, re) { const m = html.match(re); return m ? m.length : 0; }

if (NO_DOM) {
  // 显式跳过：不计失败，但汇总行会显著标注「DOM 未验证（--no-dom）」。
  console.log('  \x1b[33m•\x1b[0m DOM 段：未验证（--no-dom，显式跳过）');
} else {
  const chrome = findChrome();
  if (!chrome) {
    domUnverifiedWhy = CHROME_PATH_ARG
      ? '--chrome-path 指定的文件不存在'
      : '未找到 Chrome（可用 CHROME_BIN 或 --chrome-path 指定）';
    console.log('  \x1b[31m✗\x1b[0m DOM 未验证：' + domUnverifiedWhy);
  } else {
    const pages = [
      { file: 'page1-hot-stream.html', must: [/科技爱好者周刊/, /class="item"/, /data-toggle-sources/, /聚合热榜流/],
        minCounts: [[/class="item"/g, 10]] },
      { file: 'page2-channels.html', must: [/chan-card/, /status-error/, /暂无内容/, /渠道看板/],
        minCounts: [[/chan-card/g, 8]] },
      { file: 'page3-report.html', must: [/RSS 日报/, /hot-row/, /跨源重合榜/, /<svg/],
        minCounts: [[/class="hot-row"/g, 10]] },
      { file: 'page4-history.html', must: [/series-line/, /history-index\.json/, /archive-2025/, /month-row/, /cal-day/],
        minCounts: [[/cal-day/g, 28]] }
    ];
    let rendered = 0;
    for (const p of pages) {
      const html = dumpDom(chrome, p.file);
      if (!html) {
        // 渲染失败 / 启动失败：不得静默当作通过，标记为未验证。
        domUnverifiedWhy = 'Chrome 渲染或启动失败（' + p.file + '）';
        console.log('  \x1b[31m✗\x1b[0m DOM 未验证：' + domUnverifiedWhy);
        continue;
      }
      rendered++;
      const missing = p.must.filter((re) => !re.test(html));
      check(missing.length === 0, p.file + ' 关键元素存在',
        missing.length ? '缺少 ' + missing.map(String).join(' , ') : '');
      for (const [re, n] of (p.minCounts || [])) {
        check(count(html, re) >= n, p.file + ' ' + re.source + ' 数量 >= ' + n, '实际 ' + count(html, re));
      }
    }
    if (rendered === pages.length) {
      domVerified = true;
      console.log('  \x1b[32m✓\x1b[0m DOM 段：已验证 ' + rendered + '/' + pages.length + ' 页');
    } else if (!domUnverifiedWhy) {
      domUnverifiedWhy = '部分页面渲染失败';
    }
    // 页面4 月度下钻：初始 month-body 应为未加载（data-loaded="0"），细节由交互验证
    // （<details> toggle 不冒泡的修复见 page4.js: 逐个绑定）
  }
}

/* =============================================================================
 * E. 响应式静态护栏（日历栅格不溢出，P1-1 回归）
 * ======================================================================== */
group('E. 响应式静态护栏 (P1-1)');
const pagesCss = readFileSync(path.join(ROOT, 'assets/css/pages.css'), 'utf8');
check(/\.cal-grid\s*\{[^}]*repeat\(7,\s*minmax\(0,\s*1fr\)\)/.test(pagesCss),
  '.cal-grid 使用 minmax(0, 1fr) 防溢出');
check(/\.cal-day\s*\{[^}]*aspect-ratio:\s*auto/.test(pagesCss),
  '.cal-day 不再使用固定方形(aspect-ratio:auto)');

/* =============================================================================
 * 结果
 * ======================================================================== */
console.log('\n' + '─'.repeat(56));
console.log('通过: ' + pass + '   失败: ' + fail + '   跳过: ' + skip);

// DOM 段状态行（P3-7：默认模式必须给出明确结论，不得含糊）
let domLabel;
if (NO_DOM) domLabel = '未验证（--no-dom）';
else if (domVerified) domLabel = '已验证';
else domLabel = '未验证（' + (domUnverifiedWhy || '未执行') + '）';
console.log('DOM 段: ' + domLabel);

if (fail) {
  console.log('\n失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  console.log('\x1b[31mSMOKE TEST FAIL\x1b[0m');
  process.exit(1);
}
if (domVerified) {
  console.log('\x1b[32mSMOKE TEST PASS（含 DOM）\x1b[0m');
  process.exit(0);
}
if (NO_DOM) {
  // 显式跳过 DOM：数据契约通过，但明确标注 DOM 未验证。
  console.log('\x1b[33mSMOKE TEST PASS（DOM 未验证）\x1b[0m');
  process.exit(0);
}
// 默认模式但 DOM 未能验证：条件性通过，退出码 2 以区别于干净通过（防「假绿」）。
console.log('\x1b[33mSMOKE TEST PASS（DOM 未验证）\x1b[0m');
process.exit(2);

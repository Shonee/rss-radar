#!/usr/bin/env node
/* =============================================================================
 * RSS Radar · T-P5-02 回归测试套件（headless Chrome / CDP 驱动真实运行站点）
 * -----------------------------------------------------------------------------
 * 端口/协议决策（团队已定）：真实环境跑，不允许 file://。
 *   --base-url <url> 指向本地 preview server 或 CF Pages（默认 http://127.0.0.1:4173）
 *
 * 断言覆盖 prototype smoke-test.mjs 的 5 大类（逐类移植，口径按真实数据模型校准）：
 *   A. 跨页口径恒等（同一指标在不同页面必须一致）
 *   B. 特殊数据齐备（关键数据/结构不能缺）
 *   C. 字段类型（对齐 docs/data-model 示例）
 *   D. 元素存在（沿用项目既有 data-testid）
 *   E. 响应式三档（≥1024 / 768~1023 / <768）
 *
 * 三态诚实：
 *   每条断言只允许 通过 / 失败 / 未验证。
 *   - 未真正拿到 DOM / 数据 → 标 未验证（绝不伪装成通过）
 *   - 拿到 DOM 后逻辑判据为假 → 失败
 * 退出码（三态互斥，语义不重叠）：
 *   0 = 取到 DOM 且无断言失败（少量 unverified 只作警告列出）
 *   1 = 至少一条断言失败（产品缺陷信号）     : 阻断
 *   2 = 完全没取到 DOM（Chrome 起不来 / 连不上服务 / 页面未渲染） : 假性绿防护
 *
 * 变异测试：--chrome-path /nonexistent 必须非 0 退出（找不到 Chrome → exit 2）。
 *
 * 配置校验（B10/B11/B14）走**本地模式**：直接 `fs.readFileSync` 读
 * `<repo-root>/config/sources.json`（`--repo-root` 可覆盖，默认从脚本位置向上找
 * 含 package.json 的目录）。原因：`config/` 构建期被打包进 JS，preview 无
 * `/config/` 端点，页面上下文 fetch 必然 404；harness 本身跑在仓库机器上，
 * 直接读文件才是正确路径。远程模式（--base-url 指 CF Pages）本机无仓库时该组降级未验证。
 *
 * 实现要点：用 CDP 驱动真实运行的 SPA；通过 Network 拦截外部源（raw.github /
 * jsdelivr）使其快速回退到本地 ./data/，既确定又快速（避免 8s×2 超时拖慢与抖动）。
 * 数据契约断言通过页面上下文内 fetch 同源 ./data/*.json 取得，证明运行中的站点
 * 确实提供该契约。
 * ========================================================================== */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const { WebSocket } = globalThis;

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const BASE_URL = (argValue('--base-url') || 'http://127.0.0.1:4173').replace(/\/$/, '');
const CHROME_PATH_ARG = argValue('--chrome-path');
const NO_DOM = process.argv.includes('--no-dom');

/**
 * 仓库根目录（本地模式）：用于**直接读文件系统**校验 `config/*.json`。
 *
 * 为什么不用页面上下文 fetch：`config/` 在构建期被打包进 JS，preview 不提供
 * `/config/` 静态端点 → fetch 必然 404。但 harness 本身跑在仓库所在机器上，
 * 直接 `fs.readFileSync` 才是正确的校验路径（远程模式 --base-url 指向 CF Pages 时
 * 本机若无仓库可读 → 该组断言降级为「未验证」，见 B10/B11 分支）。
 */
const REPO_ROOT = (() => {
  const explicit = argValue('--repo-root');
  if (explicit) return path.resolve(explicit);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
})();

// ---------------------------------------------------------------------------
// 结果收集（三态）
// ---------------------------------------------------------------------------
/** @type {{id:string,group:string,label:string,status:'pass'|'fail'|'unverified',evidence:string}[]} */
const results = [];
let domVerified = false;
let domWhy = '';

const c = {
  pass: (s) => `\x1b[32m${s}\x1b[0m`,
  fail: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};
function record(id, group, label, status, evidence) {
  results.push({ id, group, label, status, evidence: evidence == null ? '' : String(evidence) });
}
function rec(id, group, label, cond, evidence) {
  record(id, group, label, cond ? 'pass' : 'fail', evidence);
}
function recNum(id, group, label, actual, expected) {
  record(id, group, label, actual === expected, `${actual} (期望 ${expected})`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Chrome 发现 / 启动（CDP）
// ---------------------------------------------------------------------------
function findChrome() {
  if (CHROME_PATH_ARG) {
    return existsSync(CHROME_PATH_ARG) ? CHROME_PATH_ARG : null; // 指向不存在路径 → null（变异测试用）
  }
  const cands = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return cands.find((p) => existsSync(p)) || null;
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.listeners = {};
    this._open = null;
  }
  open() {
    if (this._open) return this._open;
    this._open = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(new Error('ws error ' + (e && e.message ? e.message : e)));
      this.ws.onmessage = (ev) => this._onmsg(ev);
    });
    return this._open;
  }
  _onmsg(ev) {
    let m;
    try { m = JSON.parse(ev.data.toString()); } catch { return; }
    if (m.id && this.pending.has(m.id)) {
      const { res, rej } = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (m.error) rej(new Error(m.error.message || JSON.stringify(m.error)));
      else res(m.result);
    }
    if (m.method && this.listeners[m.method]) this.listeners[m.method].forEach((h) => h(m.params));
  }
  on(method, cb) { (this.listeners[method] = this.listeners[method] || []).push(cb); }
  send(method, params = {}, sessionId = null) {
    return new Promise((res, rej) => {
      const id = ++this.id;
      this.pending.set(id, { res, rej });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      try { this.ws.send(JSON.stringify(msg)); } catch (e) { this.pending.delete(id); rej(e); }
    });
  }
}

async function launchChrome(bin) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-reg-'));
  // 仅当 base-url 指向本机回环时才禁用代理：本沙箱存在 HTTP(S)_PROXY 环境变量，
  // headless Chrome 会继承并据此把 127.0.0.1 误投到代理导致连接失败。
  // 对远程 CI 站点（如 CF Pages）则保留代理，以正常访问公网。
  const isLoopback = /^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\]|::1)(:|\/|$)/.test(BASE_URL);
  const proxyFlags = isLoopback
    ? ['--no-proxy-server', '--proxy-server=direct://', '--proxy-bypass-list=*']
    : [];
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-dev-shm-usage',
    ...proxyFlags,
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank',
  ];
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} rej(new Error('Chrome 启动超时（20s 未监听 DevTools）')); }, 20000);
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); res(m[1]); }
    };
    child.stderr.on('data', onData);
    child.stdout.on('data', onData);
    child.on('error', (e) => { clearTimeout(t); rej(e); });
    child.on('exit', (code) => { clearTimeout(t); if (!wsUrl) rej(new Error('Chrome 提前退出 code=' + code)); });
  });
  return { child, wsUrl, profile };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function fail(msg) { console.error(c.fail('✗ ') + msg); }

const READY = {
  p1: `(()=>{const s=document.querySelector('[data-testid="p1-statbar"]');if(!s)return false;const t=s.innerText||'';if(!t.includes('渠道'))return false;const r=document.querySelector('[data-testid="p1-result-count"]');if(!r||!/\\d/.test(r.innerText||''))return false;return !!(document.querySelector('[data-testid="p1-list"]')||document.querySelector('[data-testid="p1-goto-channels"]')||document.querySelector('[data-testid="p1-empty"]'));})()`,
  p2: `(()=>{return document.querySelectorAll('[data-testid="channel-card-name"]').length>0||!!document.querySelector('[data-testid="p2-error"]')||!!document.querySelector('[data-testid="p2-empty"]')||!!document.querySelector('[data-testid="p2-empty-all"]');})()`,
  p3: `(()=>{return !!document.querySelector('[data-testid="p3-metric-total-value"]')||!!document.querySelector('[data-testid="p3-error"]');})()`,
  p4: `(()=>{return !!document.querySelector('[data-testid="p4-trend-chart"]')||!!document.querySelector('[data-testid="p4-empty"]')||!!document.querySelector('[data-testid="p4-error"]');})()`,
  about: `(()=>!!document.querySelector('[data-testid="about-root"]'))()`,
};
const ALL_COUNTS = `(()=>{const m={};document.querySelectorAll('[data-testid]').forEach(e=>{const t=e.getAttribute('data-testid');m[t]=(m[t]||0)+1;});return m;})()`;

async function main() {
  console.log(c.dim('RSS Radar 回归套件 · base-url=' + BASE_URL + (NO_DOM ? ' --no-dom' : '')));

  const chrome = findChrome();
  if (!chrome) {
    domWhy = CHROME_PATH_ARG
      ? '--chrome-path 指定的文件不存在：' + CHROME_PATH_ARG
      : '未找到 Chrome（可用 CHROME_BIN 或 --chrome-path 指定）';
    console.error(c.fail('✗ ') + 'DOM 段未验证：' + domWhy);
    process.exit(2);
    return;
  }
  console.log(c.dim('Chrome: ' + chrome));

  let proc;
  try {
    proc = await launchChrome(chrome);
  } catch (e) {
    domWhy = 'Chrome 启动失败：' + e.message;
    console.error(c.fail('✗ ') + domWhy);
    process.exit(2);
    return;
  }

  const browser = new CDP(proc.wsUrl);
  try {
    await browser.open();
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Log.enable', {}, sessionId);
    // 拦截外部数据源（raw.github / jsdelivr），强制快速回退到本地 ./data/，确定且快速
    await browser.send('Network.enable', {}, sessionId);
    await browser.send('Network.setBlockedURLs', { urls: ['*raw.githubusercontent.com*', '*jsdelivr*'] }, sessionId);

    const exceptions = [];
    const consoleErrors = [];
    browser.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails;
      exceptions.push((d && (d.exception && d.exception.description || d.text)) || 'exception');
    });
    browser.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') {
        const txt = (p.args || []).map((a) => (a.value !== undefined ? a.value : (a.description || ''))).join(' ');
        consoleErrors.push(txt);
      }
    });

    const evalExpr = async (expr, opts = {}) => {
      const params = { expression: expr, returnByValue: true };
      if (opts.await) params.awaitPromise = true;
      const r = await browser.send('Runtime.evaluate', params, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
    };
    const safeEval = async (expr, opts = {}) => {
      try { return await evalExpr(expr, opts); } catch { return undefined; }
    };
    const goto = async (hashPath, rootTestId, timeoutMs = 20000) => {
      await browser.send('Page.navigate', { url: BASE_URL + hashPath }, sessionId);
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const ok = await safeEval(
          `!!document.querySelector('[data-testid="app-shell"]') && !!document.querySelector('[data-testid="${rootTestId}"]')`);
        if (ok) return true;
        await sleep(250);
      }
      return false;
    };
    const waitReady = async (key, timeoutMs = 20000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (await safeEval(READY[key])) return true;
        await sleep(300);
      }
      return false;
    };
    const waitForSel = async (sel, timeoutMs = 4000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (await safeEval(`!!document.querySelector('${sel}')`)) return true;
        await sleep(250);
      }
      return false;
    };
    const setVP = (w, h = 900) => browser.send('Emulation.setDeviceMetricsOverride',
      { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);

    const routes = {
      p1: { path: '/#/', root: 'p1-root' },
      p2: { path: '/#/channels', root: 'p2-root' },
      p3: { path: '/#/report', root: 'p3-root' },
      p4: { path: '/#/history', root: 'p4-root' },
      about: { path: '/#/about', root: 'about-root' },
    };

    const firstOk = await goto(routes.p1.path, routes.p1.root);
    if (!firstOk) {
      domWhy = '无法加载 ' + BASE_URL + '（站点不可达 / 应用未渲染 app-shell）';
      console.error(c.fail('✗ ') + domWhy);
      try { browser.send('Target.closeTarget', { targetId }, sessionId); } catch {}
      closeAndExit(2, proc, browser, targetId, sessionId);
      return;
    }

    const F = { pages: {}, responsive: {} };

    async function collectPage(key) {
      const r = routes[key];
      const rootOk = await goto(r.path, r.root);
      if (!rootOk) { F.pages[key] = { rendered: false, counts: {}, texts: {}, overflow: { sw: 0, cw: 0 }, columns: 0, exceptions: [], consoleErrors: [] }; return; }
      await waitReady(key);
      await sleep(200);
      const counts = (await safeEval(ALL_COUNTS)) || {};
      const ov = (await safeEval('({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})')) || { sw: 0, cw: 0 };
      const columns = (await safeEval(`(()=>{const e=document.querySelector('[data-testid="p2-board"]');if(!e)return 0;const s=getComputedStyle(e);return s.display==='grid'?s.gridTemplateColumns.split(' ').length:0;})()`)) || 0;
      const texts = {};
      if (key === 'p1') { texts.statbar = await safeEval(`document.querySelector('[data-testid="p1-statbar"]')?.innerText||''`); texts.resultCount = await safeEval(`document.querySelector('[data-testid="p1-result-count"]')?.innerText||''`); }
      if (key === 'p2') {
        texts.header = await safeEval(`document.querySelector('[data-testid="p2-header"]')?.innerText||''`);
        texts.shown = await safeEval(`document.querySelector('[data-testid="p2-shown-count"]')?.innerText||''`);
      }
      if (key === 'p3') {
        texts.total = await safeEval(`document.querySelector('[data-testid="p3-metric-total-value"]')?.innerText||''`);
        texts.ch = await safeEval(`document.querySelector('[data-testid="p3-metric-channels-value"]')?.innerText||''`);
        texts.cats = await safeEval(`document.querySelector('[data-testid="p3-metric-cats-value"]')?.innerText||''`);
        texts.meta = await safeEval(`document.querySelector('[data-testid="p3-meta"]')?.innerText||''`);
      }
      F.pages[key] = {
        rendered: true, counts, texts, overflow: ov, columns,
        exceptions: exceptions.slice(), consoleErrors: consoleErrors.slice(),
      };
    }

    // 数据抓取（页面上下文内 fetch 同源 ./data/*.json，证明运行中的站点提供该契约）
    let snap = null, report = null, sourcesCfg = null, histIndex = null;
    try {
      snap = await evalExpr(`(async()=>{const u=new URL('./data/today/latest.json',document.baseURI).href;const r=await fetch(u);if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();})()`, { await: true });
      if (snap && snap.date) {
        report = await evalExpr(`(async()=>{const u=new URL('./data/today/report-${snap.date}.json',document.baseURI).href;const r=await fetch(u);if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();})()`, { await: true });
      }
      histIndex = await evalExpr(`(async()=>{const u=new URL('./data/history/history-index.json',document.baseURI).href;const r=await fetch(u);if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();})()`, { await: true });
    } catch (e) {
      domWhy = '数据契约抓取失败：' + e.message;
    }
    // 本地模式：直接读仓库里的 config/sources.json（构建期已打包进 JS，HTTP 端点不存在）
    try {
      sourcesCfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'sources.json'), 'utf8'));
    } catch { sourcesCfg = null; }

    if (!snap) domWhy = domWhy || '未能加载 snapshot（数据未验证）';

    for (const k of Object.keys(routes)) await collectPage(k);

    // 响应式三档：375 / 800 / 1280
    for (const w of [375, 800, 1280]) {
      await setVP(w);
      F.responsive[w] = {};
      for (const k of ['p1', 'p2', 'p3', 'p4']) {
        const ok = await goto(routes[k].path, routes[k].root);
        if (k === 'p2') await waitReady('p2'); else await sleep(500);
        const ov = (await safeEval('({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})')) || { sw: 0, cw: 0 };
        const cols = (await safeEval(`(()=>{const e=document.querySelector('[data-testid="p2-board"]');if(!e)return 0;const s=getComputedStyle(e);return s.display==='grid'?s.gridTemplateColumns.split(' ').length:0;})()`)) || 0;
        F.responsive[w][k] = { rendered: ok, overflow: ov, columns: cols };
      }
    }
    try { await browser.send('Emulation.clearDeviceMetricsOverride', {}, sessionId); } catch {}

    // =========================================================================
    // 断言：A. 跨页口径恒等
    // =========================================================================
    console.log('\n' + c.warn('A. 跨页口径恒等（同一指标在不同页面必须一致）'));
    const p1 = F.pages.p1, p2 = F.pages.p2, p3 = F.pages.p3;
    const p1Statbar = p1.texts.statbar || '';
    const p2Header = p2.texts.header || '';
    const p1Today = (p1Statbar.match(/今日\s*(\d+)\s*条/) || [])[1];
    const p1Ch = (p1Statbar.match(/共\s*(\d+)\s*个渠道/) || [])[1];
    const p1Cat = (p1Statbar.match(/涉及\s*(\d+)\s*个分类/) || [])[1];
    const p2Ch = (p2Header.match(/共\s*(\d+)\s*个渠道/) || [])[1];
    const p2Shown = (p2.texts.shown || '').trim();
    const p1Result = p1.rendered ? (p1.texts.resultCount || '') : '';
    const p1Filtered = (p1Result.match(/共\s*(\d+)\s*条符合当前条件/) || [])[1];
    const p3Total = (p3.texts.total || '').trim();
    const p3Ch = (p3.texts.ch || '').trim();
    const p3Cats = (p3.texts.cats || '').trim();
    const p3Meta = p3.texts.meta || '';

    const parsed = (x) => (x === '' || x == null ? undefined : Number(x));
    const p1TodayN = parsed(p1Today), p1ChN = parsed(p1Ch), p1CatN = parsed(p1Cat);
    const p2ChN = parsed(p2Ch), p2ShownN = parsed(p2Shown), p1FilteredN = parsed(p1Filtered);
    const p3TotalN = parsed(p3Total), p3ChN = parsed(p3Ch), p3CatsN = parsed(p3Cats);

    const snapItems = snap?.items || [];
    const distinctCats = new Set();
    for (const it of snapItems) for (const cat of (it.category || [])) distinctCats.add(cat);
    const distinctCatN = distinctCats.size;
    const snapChanWithItems = Array.isArray(snap?.stats?.sources) ? snap.stats.sources.length : undefined;
    const p3MetaActive = (p3Meta.match(/(\d+)\s*个渠道/) || [])[1];
    const p3MetaTotal = (p3Meta.match(/(\d+)\s*条/) || [])[1];

    rec('A1', 'A', '页面1 状态条渠道数 == 页面2 看板渠道数',
      p1ChN !== undefined && p2ChN !== undefined && p1ChN === p2ChN, `page1=${p1ChN} page2=${p2ChN}`);
    rec('A2', 'A', '页面1 状态条「今日 N 条」== 列表「共 N 条符合当前条件」(默认 timeRange=today 筛选下二者均应为当日条目数)',
      p1TodayN !== undefined && p1FilteredN !== undefined && p1TodayN === p1FilteredN, `statbar今日=${p1TodayN} result=${p1FilteredN}`);
    rec('A3', 'A', '页面1 状态条「涉及 N 分类」== 快照条目去重分类数',
      p1CatN !== undefined && distinctCatN !== undefined && p1CatN === distinctCatN, `statbar=${p1CatN} derived=${distinctCatN}`);
    rec('A4', 'A', 'report.totalItems == snapshot.items.length',
      report && snap && report.totalItems === snapItems.length, `report=${report?.totalItems} snap=${snapItems.length}`);
    rec('A5', 'A', 'report.activeChannels == report.channelActivity.length',
      report && Array.isArray(report.channelActivity) && report.activeChannels === report.channelActivity.length, `active=${report?.activeChannels} activityLen=${report?.channelActivity?.length}`);
    rec('A6', 'A', 'report.activeChannels == snapshot.stats.sources.length（有条目渠道）',
      report && snapChanWithItems !== undefined && report.activeChannels === snapChanWithItems, `active=${report?.activeChannels} snapSources=${snapChanWithItems}`);
    rec('A7', 'A', '页面3「总条数」卡片 == report.totalItems',
      p3TotalN !== undefined && report && p3TotalN === report.totalItems, `p3=${p3TotalN} report=${report?.totalItems}`);
    rec('A8', 'A', '页面3「活跃渠道数」卡片 == report.activeChannels',
      p3ChN !== undefined && report && p3ChN === report.activeChannels, `p3=${p3ChN} report=${report?.activeChannels}`);
    rec('A9', 'A', '页面3「涉及分类数」卡片 == report.categoryStats.length',
      p3CatsN !== undefined && report && p3CatsN === (report.categoryStats || []).length, `p3=${p3CatsN} report=${(report?.categoryStats || []).length}`);
    rec('A10', 'A', '页面2 展示渠道数(p2-shown-count) == 状态条渠道数',
      p2ShownN !== undefined && p1ChN !== undefined && p2ShownN === p1ChN, `shown=${p2ShownN} statbar=${p1ChN}`);
    rec('A11', 'A', '页面3 meta「N 个渠道 / M 条」与卡片口径一致',
      p3MetaActive !== undefined && p3MetaTotal !== undefined && p3ChN !== undefined && p3TotalN !== undefined &&
      Number(p3MetaActive) === p3ChN && Number(p3MetaTotal) === p3TotalN, `meta=(${p3MetaActive}/${p3MetaTotal}) cards=(${p3ChN}/${p3TotalN})`);

    // =========================================================================
    // B. 特殊数据齐备
    // =========================================================================
    console.log('\n' + c.warn('B. 特殊数据齐备'));
    rec('B1', 'B', 'snapshot.items 为数组且 >=1 条', Array.isArray(snapItems) && snapItems.length >= 1, `items=${snapItems.length}`);
    rec('B2', 'B', 'snapshot.stats.sourceTotal 为数字且 >=1', snap?.stats && typeof snap.stats.sourceTotal === 'number' && snap.stats.sourceTotal >= 1, `sourceTotal=${snap?.stats?.sourceTotal}`);
    rec('B3', 'B', 'report.hotList 长度 == 10', report && Array.isArray(report.hotList) && report.hotList.length === 10, `hotList=${(report?.hotList || []).length}`);
    rec('B4', 'B', 'report.categoryStats 为数组且 >=1', report && Array.isArray(report.categoryStats) && report.categoryStats.length >= 1, `len=${(report?.categoryStats || []).length}`);
    rec('B5', 'B', 'report.channelActivity 长度 >=1 且 == activeChannels', report && Array.isArray(report.channelActivity) && report.channelActivity.length >= 1 && report.channelActivity.length === report.activeChannels, `len=${report?.channelActivity?.length} active=${report?.activeChannels}`);
    rec('B6', 'B', 'report.crossSource 为数组（结构齐备）', report && Array.isArray(report.crossSource), `type=${Array.isArray(report?.crossSource) ? 'array' : typeof report?.crossSource}`);
    rec('B7', 'B', 'snapshot.stats.sourceHealth 为数组且 >=1（失败黄条数据源）', snap?.stats && Array.isArray(snap.stats.sourceHealth) && snap.stats.sourceHealth.length >= 1, `len=${snap?.stats?.sourceHealth?.length}`);
    rec('B8', 'B', 'history-index.days >= 1（趋势数据存在）', histIndex && Array.isArray(histIndex.days) && histIndex.days.length >= 1, `days=${histIndex?.days?.length}`);
    rec('B9', 'B', '页面2 配置渠道数 >= 8（MVP 渠道底线）', p2ChN !== undefined && p2ChN >= 8, `configuredChannels=${p2ChN}`);
    if (sourcesCfg) {
      rec('B10', 'B', 'config sources.json 源数 >= 10（本地模式读 config/）', Array.isArray(sourcesCfg.sources) && sourcesCfg.sources.length >= 10, `sources=${sourcesCfg.sources.length}`);
      rec('B11', 'B', 'config sources.json 渠道数 >= 10（MVP 渠道底线，本地模式读 config/）', Array.isArray(sourcesCfg.channels) && sourcesCfg.channels.length >= 10, `channels=${sourcesCfg.channels.length}`);
      // 一一对应：两个数组的 channelId 必须互相覆盖，无孤儿（P4 扩容 8→11 后的回归守卫）
      const chIds = new Set((sourcesCfg.channels || []).map((x) => x.id));
      const srcChIds = new Set((sourcesCfg.sources || []).map((x) => x.channelId));
      const orphanSources = [...srcChIds].filter((x) => !chIds.has(x));
      const orphanChannels = [...chIds].filter((x) => !srcChIds.has(x));
      rec('B14', 'B', 'channels ↔ sources 的 channelId 一一对应（无孤儿）',
        orphanSources.length === 0 && orphanChannels.length === 0,
        `orphanSources=${JSON.stringify(orphanSources)} orphanChannels=${JSON.stringify(orphanChannels)}`);
    } else {
      record('B10', 'B', 'config sources.json 源数 >= 10（本地模式读 config/）', 'unverified', `本地不可读 ${path.join(REPO_ROOT, 'config', 'sources.json')}（远程模式无法校验配置）`);
      record('B11', 'B', 'config sources.json 渠道数 >= 10（本地模式读 config/）', 'unverified', `本地不可读 ${path.join(REPO_ROOT, 'config', 'sources.json')}（远程模式无法校验配置）`);
      record('B14', 'B', 'channels ↔ sources 的 channelId 一一对应（无孤儿）', 'unverified', '本地不可读 config/sources.json（远程模式无法校验配置）');
    }
    const crossItems = snapItems.filter((i) => (i.sourceCount || 1) > 1);
    rec('B12', 'B', '若条目 sourceCount>1 则 sources[] 为非空对象数组',
      crossItems.every((i) => Array.isArray(i.sources) && i.sources.length > 0 && i.sources.every((s) => typeof s === 'object')), `crossItems=${crossItems.length}`);
    // 原断言要求 `snapshot.channels` 存在 —— 那是把实现里的漂移字段当成了契约
    // （其内容其实是分类，且不在 snapshot.schema.json 白名单内）。改为守住真正的契约：
    // 顶层键必须全部落在白名单里，多一个未契约字段即失败。
    const SNAP_ALLOWED_KEYS = ['schemaVersion', 'date', 'timezone', 'generatedAt', 'stats', 'items'];
    const snapKeys = Object.keys(snap || {});
    rec('B13', 'B', 'snapshot 顶层键全部属于契约白名单',
      snapKeys.length > 0 && snapKeys.every((k) => SNAP_ALLOWED_KEYS.includes(k)),
      `keys=${snapKeys.join(',')}`);

    // =========================================================================
    // C. 字段类型
    // =========================================================================
    console.log('\n' + c.warn('C. 关键字段类型'));
    const allItems = snapItems;
    rec('C1', 'C', 'items[].category 均为数组', allItems.length > 0 && allItems.every((i) => Array.isArray(i.category)), `n=${allItems.length}`);
    rec('C2', 'C', 'items[].sourceCount 均为数字', allItems.length > 0 && allItems.every((i) => typeof i.sourceCount === 'number'), `n=${allItems.length}`);
    rec('C3', 'C', 'items[].isNew 均为布尔（若存在）', allItems.every((i) => i.isNew === undefined || typeof i.isNew === 'boolean'), `n=${allItems.length}`);
    rec('C4', 'C', 'items[].hotScore 为 number|null（若存在）', allItems.every((i) => i.hotScore === undefined || i.hotScore === null || typeof i.hotScore === 'number'), `n=${allItems.length}`);
    rec('C5', 'C', 'items[].channelId 均为非空字符串', allItems.length > 0 && allItems.every((i) => typeof i.channelId === 'string' && i.channelId.length > 0), `n=${allItems.length}`);
    rec('C6', 'C', 'items[].publishedAt/updatedAt 均为非空字符串', allItems.length > 0 && allItems.every((i) => typeof i.publishedAt === 'string' && i.publishedAt && typeof i.updatedAt === 'string' && i.updatedAt), `n=${allItems.length}`);
    const cats = report?.categoryStats || [];
    rec('C7', 'C', 'categoryStats[].ratio 均为 (0,1] 的数字', cats.length > 0 && cats.every((c2) => typeof c2.ratio === 'number' && c2.ratio > 0 && c2.ratio <= 1), `n=${cats.length}`);
    rec('C8', 'C', 'hotList[].hotScore 均为数字', (report?.hotList || []).length > 0 && report.hotList.every((h) => typeof h.hotScore === 'number'), `n=${report?.hotList?.length}`);
    const ib = snap?.stats?.itemsBeforeDedup, ia = snap?.stats?.itemsAfterDedup;
    rec('C9', 'C', 'itemsBeforeDedup >= itemsAfterDedup', typeof ib === 'number' && typeof ia === 'number' && ib >= ia, `before=${ib} after=${ia}`);
    rec('C10', 'C', 'channelActivity[].itemCount 均为数字', (report?.channelActivity || []).length > 0 && report.channelActivity.every((c2) => typeof c2.itemCount === 'number'), `n=${report?.channelActivity?.length}`);
    rec('C11', 'C', 'items[].sources 若存在则为对象数组', allItems.every((i) => !i.sources || (Array.isArray(i.sources) && i.sources.every((s) => typeof s === 'object'))), `n=${allItems.length}`);

    // =========================================================================
    // D. 元素存在（沿用既有 data-testid）
    // =========================================================================
    console.log('\n' + c.warn('D. 各页关键元素存在（data-testid）'));
    const globalIds = ['app-shell', 'app-header', 'app-nav', 'app-main', 'app-footer', 'nav-brand'];
    for (const id of globalIds) {
      const cnt = p1.counts[id] || 0;
      rec('D-' + id, 'D', `全局元素 [${id}] 存在`, p1.rendered && cnt >= 1, `count=${cnt}`);
    }
    const p1Ids = ['p1-root', 'p1-statbar', 'p1-result-count', 'p1-filter-panel'];
    for (const id of p1Ids) {
      const cnt = p1.counts[id] || 0;
      rec('D-' + id, 'D', `页面1 [${id}] 存在`, p1.rendered && cnt >= 1, `count=${cnt}`);
    }
    // 列表区渲染（容器或空态二选一，取决于当日是否有条目，不依赖数据量）
    const p1ListRegion = (p1.counts['p1-list'] || 0) + (p1.counts['p1-goto-channels'] || 0) + (p1.counts['p1-empty'] || 0);
    rec('D-p1-list-region', 'D', '页面1 列表区渲染（p1-list 或空态）', p1.rendered && p1ListRegion >= 1, `count=${p1ListRegion}`);

    const p2Ids = ['p2-root', 'p2-header', 'p2-shown-count', 'p2-open-config', 'p2-sort', 'p2-sort-updated', 'p2-sort-name'];
    for (const id of p2Ids) {
      const cnt = p2.counts[id] || 0;
      rec('D-' + id, 'D', `页面2 [${id}] 存在`, p2.rendered && cnt >= 1, `count=${cnt}`);
    }
    const p2Cards = p2.counts['channel-card-name'] || 0;
    rec('D-p2-cards', 'D', '页面2 渠道卡片 channel-card-name >=1', p2.rendered && p2Cards >= 1, `count=${p2Cards}`);

    const p3Ids = ['p3-root', 'p3-hero', 'p3-meta', 'p3-summary', 'p3-metrics', 'p3-metric',
      'p3-metric-total-value', 'p3-metric-channels-value', 'p3-metric-hot-value', 'p3-metric-cats-value',
      'p3-hot-section', 'p3-hot-list', 'p3-pie', 'p3-pie-legend', 'p3-channel-activity', 'p3-cross-source',
      'p3-methodology', 'p3-copyright', 'p3-goto-history'];
    for (const id of p3Ids) {
      const cnt = p3.counts[id] || 0;
      rec('D-' + id, 'D', `页面3 [${id}] 存在`, p3.rendered && cnt >= 1, `count=${cnt}`);
    }
    const p3Hot = p3.counts['p3-hot-row'] || 0;
    rec('D-p3-hot-rows', 'D', '页面3 热点行 p3-hot-row >=1', p3.rendered && p3Hot >= 1, `count=${p3Hot}`);
    const p3PieSvg = p3.rendered
      ? (await goto(routes.p3.path, routes.p3.root), await waitReady('p3'), await waitForSel('[data-testid="p3-pie"] svg', 4000), await safeEval(`!!document.querySelector('[data-testid="p3-pie"] svg')`))
      : false;
    rec('D-p3-pie-svg', 'D', '页面3 饼图含 <svg>', !!p3PieSvg, `hasSvg=${p3PieSvg}`);

    const p4Ids = ['p4-root', 'p4-trend', 'p4-trend-chart', 'p4-window', 'p4-metric', 'p4-months',
      'p4-lookback', 'p4-cal-day'];
    for (const id of p4Ids) {
      const cnt = (F.pages.p4.counts[id] || 0);
      rec('D-' + id, 'D', `页面4 [${id}] 存在`, F.pages.p4.rendered && cnt >= 1, `count=${cnt}`);
    }
    const p4Month = F.pages.p4.counts['p4-month-row'] || 0;
    rec('D-p4-month-rows', 'D', '页面4 月度明细 p4-month-row >=1', F.pages.p4.rendered && p4Month >= 1, `count=${p4Month}`);
    const p4Archive = (F.pages.p4.counts['p4-archive'] || 0) + (F.pages.p4.counts['p4-archive-none'] || 0);
    rec('D-p4-archive', 'D', '页面4 归档区存在（p4-archive 或 p4-archive-none）', F.pages.p4.rendered && p4Archive >= 1, `count=${p4Archive}`);
    const p4ChartSvg = F.pages.p4.rendered
      ? (await goto(routes.p4.path, routes.p4.root), await waitReady('p4'), await waitForSel('[data-testid="p4-trend-chart"] svg, [data-testid="p4-trend-chart"] path', 4000), await safeEval(`!!document.querySelector('[data-testid="p4-trend-chart"] svg, [data-testid="p4-trend-chart"] path')`))
      : false;
    rec('D-p4-chart-svg', 'D', '页面4 趋势图含 <svg>/<path>', !!p4ChartSvg, `hasSvg=${p4ChartSvg}`);

    const aboutIds = ['about-root', 'about-slogan', 'about-methodology-link', 'about-history-link', 'about-footer-text'];
    for (const id of aboutIds) {
      const cnt = F.pages.about.counts[id] || 0;
      rec('D-' + id, 'D', `关于页 [${id}] 存在`, F.pages.about.rendered && cnt >= 1, `count=${cnt}`);
    }
    for (const k of ['p1', 'p2', 'p3', 'p4', 'about']) {
      const pg = F.pages[k];
      rec('D-' + k + '-noexc', 'D', `页面 ${k} 无未捕获 JS 异常`, pg.rendered && pg.exceptions.length === 0, pg.rendered ? `exceptions=${pg.exceptions.length}` : 'page 未渲染');
    }

    // =========================================================================
    // E. 响应式三档（≥1024 / 768~1023 / <768）
    // =========================================================================
    console.log('\n' + c.warn('E. 响应式三档（375 / 800 / 1280 无横向溢出）'));
    const expCols = { 375: 1, 800: 2, 1280: 3 };
    for (const w of [375, 800, 1280]) {
      for (const k of ['p1', 'p2', 'p3', 'p4']) {
        const rp = F.responsive[w][k];
        const noOverflow = rp.rendered && rp.overflow.cw > 0 && rp.overflow.sw <= rp.overflow.cw;
        rec(`E-${w}-${k}-overflow`, 'E', `宽度 ${w} · 页面${k} 无横向溢出`, noOverflow, `sw=${rp.overflow.sw} cw=${rp.overflow.cw}`);
      }
      const rp2 = F.responsive[w].p2;
      rec(`E-${w}-p2-cols`, 'E', `宽度 ${w} · 页面2 栅格列数 == ${expCols[w]}`, rp2.rendered && rp2.columns === expCols[w], `cols=${rp2.columns}`);
    }
    // 页面1 移动端筛选折叠：375 显示 p1-filter-toggle，1280 隐藏
    await setVP(375); await goto(routes.p1.path, 'p1-root'); await waitReady('p1'); await sleep(300);
    const toggle375 = (await safeEval(`document.querySelectorAll('[data-testid="p1-filter-toggle"]').length`)) || 0;
    await setVP(1280); await goto(routes.p1.path, 'p1-root'); await waitReady('p1'); await sleep(300);
    const toggle1280 = (await safeEval(`document.querySelectorAll('[data-testid="p1-filter-toggle"]').length`)) || 0;
    await browser.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
    rec('E-toggle-375', 'E', '宽度 375 · 页面1 筛选折叠按钮出现', toggle375 >= 1, `count=${toggle375}`);
    rec('E-toggle-1280', 'E', '宽度 1280 · 页面1 筛选折叠按钮隐藏', toggle1280 === 0, `count=${toggle1280}`);

    // =========================================================================
    // F. 主理人 2026-09 交互口径（时间档「今天/全部」+ 排序整合无切换）
    //    来源：用户 2026-09-15 拍板（先删「近3小时」、再删「近6小时」；排序不再区分更新/创建时间）
    // =========================================================================
    console.log('\n' + c.warn('F. 页面1 时间档与排序口径（主理人 2026-09-15 拍板）'));
    await setVP(1280);
    await goto(routes.p1.path, 'p1-root');
    await waitReady('p1');
    await sleep(300);
    const timeBtns = (await safeEval(`Array.from(document.querySelectorAll('[data-testid="filter-time-range"] button')).map(b=>b.textContent.trim())`)) || [];
    const timeSelected = (await safeEval(`Array.from(document.querySelectorAll('[data-testid="filter-time-range"] button')).filter(b=>b.getAttribute('aria-pressed')==='true'||b.className.indexOf('Mui-selected')>=0).map(b=>b.textContent.trim())`)) || [];
    const sortUiCount = (await safeEval(`document.querySelectorAll('[data-testid="p1-sort"],[data-testid="p1-sort-updated"],[data-testid="p1-sort-published"]').length`)) || 0;
    const bodyText = (await safeEval(`document.body.innerText`)) || '';
    rec('F1', 'F', '时间档按钮恰为 [今天, 全部]（无近3小时/近6小时）',
      JSON.stringify(timeBtns) === JSON.stringify(['今天', '全部']), `buttons=${JSON.stringify(timeBtns)}`);
    rec('F2', 'F', '时间档默认选中「今天」',
      timeSelected.length === 1 && timeSelected[0] === '今天', `selected=${JSON.stringify(timeSelected)}`);
    rec('F3', 'F', '页面1 无排序切换 UI（排序整合口径，p1-sort* 全部不存在）',
      sortUiCount === 0, `count=${sortUiCount}`);
    rec('F4', 'F', '页面文案无「近3小时」「近6小时」残留（含已废弃档位）',
      bodyText.indexOf('近3小时') < 0 && bodyText.indexOf('近6小时') < 0,
      `has3h=${bodyText.indexOf('近3小时') >= 0} has6h=${bodyText.indexOf('近6小时') >= 0}`);

    // =========================================================================
    // 汇总
    // =========================================================================
    const anyFail = results.some((r) => r.status === 'fail');
    const anyUnverified = results.some((r) => r.status === 'unverified');
    // domVerified 的语义严格限定为「真的拿到了 DOM 与数据契约」，与
    // 「是否有少量断言未验证」**解耦**：后者只作警告，不得把已完成的 DOM 验证降级为未验证。
    if (!p1.rendered || !snap || !report) {
      if (!domWhy) domWhy = !p1.rendered ? '部分页面未渲染' : '数据契约未完整抓取';
      domVerified = false;
    } else {
      domVerified = true;
    }

    printSummary();
    // 退出码三态（互斥，语义不重叠）：
    //   0 = 取到 DOM 且无断言失败（unverified 仅作警告列出）
    //   1 = 至少一条断言失败（产品缺陷信号）
    //   2 = 完全没取到 DOM（Chrome 起不来 / 连不上服务 / 页面未渲染）
    let code = 0;
    if (anyFail) code = 1;
    else if (!domVerified) code = 2;
    if (anyUnverified) {
      console.log(c.warn('注意：存在未验证断言（不阻断），退出码不受其影响；详见上方未验证项清单。'));
    }
    closeAndExit(code, proc, browser, targetId, sessionId);
  } catch (e) {
    domWhy = 'harness 运行异常：' + (e && e.stack ? e.stack : e);
    console.error(c.fail('✗ ') + domWhy);
    if (proc) try { proc.child.kill('SIGKILL'); } catch {}
    process.exit(2);
  }
}

function printSummary() {
  console.log('\n' + '─'.repeat(60));
  const counts = { pass: 0, fail: 0, unverified: 0 };
  for (const r of results) counts[r.status]++;
  console.log('断言总数: ' + results.length + '   通过: ' + c.pass(counts.pass) +
    '   失败: ' + c.fail(counts.fail) + '   未验证: ' + c.warn(counts.unverified));
  console.log('domVerified: ' + (domVerified ? c.pass('true') : c.warn('false') + (domWhy ? ' (' + domWhy + ')' : '')));

  const fails = results.filter((r) => r.status === 'fail');
  const unvs = results.filter((r) => r.status === 'unverified');
  if (fails.length) {
    console.log('\n' + c.fail('失败项（' + fails.length + '）：'));
    for (const f of fails) console.log('  ' + c.fail('✗') + ' [' + f.group + '] ' + f.label + '  ' + c.dim(f.evidence));
  }
  if (unvs.length) {
    console.log('\n' + c.warn('未验证项（' + unvs.length + '）：'));
    for (const u of unvs) console.log('  ' + c.warn('•') + ' [' + u.group + '] ' + u.label + '  ' + c.dim(u.evidence));
  }
  console.log('\n' + c.dim('SUMMARY_JSON ' + JSON.stringify({ total: results.length, ...counts, domVerified })));
}

function closeAndExit(code, proc, browser, targetId, sessionId) {
  try { if (browser && targetId && sessionId) browser.send('Target.closeTarget', { targetId }, sessionId); } catch {}
  if (proc) { try { proc.child.kill('SIGKILL'); } catch {} }
  console.log(code === 0 ? c.pass('REGRESSION PASS') : code === 1 ? c.fail('REGRESSION FAIL') : c.warn('REGRESSION UNVERIFIED'));
  process.exit(code);
}

main().catch((e) => {
  console.error(c.fail('✗ 致命错误：') + (e && e.stack ? e.stack : e));
  process.exit(2);
});

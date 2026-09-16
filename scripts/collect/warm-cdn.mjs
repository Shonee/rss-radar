// scripts/collect/warm-cdn.mjs
// jsDelivr 边缘预热（2026-09-16）
//
// ── 为什么需要 ────────────────────────────────────────────────────────────────
// 快照 / 报告的文件名每轮带一个 4 位 UTC 时间戳（`snapshot-<date>-<HHmm>.json`），
// 于是**每小时都会出现一个全新 URL**。jsDelivr 是两级缓存（POP + Shield），
// 全新 URL 必然「双重 MISS」，此时它必须回源 GitHub 拉整份文件 —— 实测：
//
//     MISS, MISS（冷） →  TTFB 10.4s   transfer 608021B(br) / 源文件 3.55MB
//     MISS, HIT （盾热）→  TTFB 0.46s   total 0.94s
//
// **11 倍差距，且只由「每小时的第一位访客」承担** —— 这正是「第一次打开很慢、
// 之后就快了」的直接来源（后续访客命中盾层，第二位访客起就快了）。
//
// ── 为什么预热是安全且充分的 ──────────────────────────────────────────────────
// 无需改任何前端逻辑：推送数据后，用**与浏览器一致的 Accept-Encoding** 把新产物
// 请求一遍即可填满盾层。实测边缘响应头 `vary: Accept-Encoding` ⇒ 缓存变体**只按
// 编码维度切分、与 UA 无关**（同一 URL 换 UA 仍是 `MISS, HIT`）⇒ 一次预热就够，
// 不必模拟各家浏览器。故这里必须逐字发送浏览器会发的编码串，否则预热的会是
// 另一个变体、浏览器请求照样 MISS,MISS。
//
// ── 刻意不做的事 ──────────────────────────────────────────────────────────────
// **不预热指针**（`today/latest.json`）：它是**稳定文件名**，Shield 早已持有该 URL
// 的副本，且不会因为我们的 GET 而刷新（未过 TTL 不回源）—— 预热它对新鲜度毫无
// 帮助，只会制造「已经预热过」的错觉。指针的新鲜度由前端 `isStale()` 闸门负责。
//
// ── 失败策略 ──────────────────────────────────────────────────────────────────
// **warn-not-throw**：预热是纯投递优化，失败绝不能影响已推送的数据。进程恒以 0 退出。
//
// CLI：
//   node scripts/collect/warm-cdn.mjs [--pointer today/latest.json] [--dry-run]
//        [--hosts a,b] [--owner X] [--repo Y] [--branch deploy] [--timeout 60000]

import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 与浏览器一致的编码协商串 —— 必须逐字相同，否则预热的是另一个缓存变体 */
export const BROWSER_ACCEPT_ENCODING = 'gzip, deflate, br';

/** 默认边缘域名（顺序与前端 CDN_HOSTS 一致：前端按此顺序降级，前两个最常用） */
export const DEFAULT_HOSTS = [
  'fastly.jsdelivr.net',
  'gcore.jsdelivr.net',
  'cdn.jsdelivr.net',
];

/** 冷 MISS 时需回源 3.55MB，实测 10.4s；留足余量，避免把正常回源误判为失败 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 从指针里挑出「**每轮唯一**」的产物路径（即值得预热的那些）。
 *
 * 只取 snapshotPath / reportPath：这两个每轮换名 ⇒ 每轮都是全新 URL ⇒ 必然冷 MISS。
 * `today/latest.json` 与 `events-<date>.ndjson` 都是稳定名（前者），或前端首页不取
 * （后者），纳入只会浪费时间与带宽。
 */
export function warmTargets(pointer) {
  const seen = new Set();
  const out = [];
  for (const p of [pointer?.snapshotPath, pointer?.reportPath]) {
    if (typeof p !== 'string') continue;
    const t = p.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** 构造 jsDelivr 内容地址（`@<branch>` 引用即可：文件名本身每轮唯一） */
export function warmUrl(host, { owner, repo, branch }, relPath) {
  return `https://${host}/gh/${owner}/${repo}@${branch}/${relPath}`;
}

/**
 * 单次 GET 并**排干响应体**（只是排干、不解码）。
 *
 * 不解码是刻意的：我们主动协商了 `br`，而排干原始字节无需任何解码器参与，
 * 也就避免了「解码失败反而让预热无效」这一类问题。排干才是填满缓存的动作 ——
 * 只发 HEAD 或中途断开，边缘会认为传输未完成而不落缓存。
 */
function warmRequest(url, { acceptEncoding, timeoutMs }) {
  return new Promise((done) => {
    const startedAt = Date.now();
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      done(r);
    };

    let req;
    try {
      req = request(url, { method: 'GET', headers: { 'accept-encoding': acceptEncoding } }, (res) => {
        const ttfbMs = Date.now() - startedAt;
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
        });
        res.on('end', () =>
          finish({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            bytes,
            ttfbMs,
            ms: Date.now() - startedAt,
            url,
          }),
        );
        res.on('error', (err) =>
          finish({ ok: false, status: 0, bytes, error: err.message, ms: Date.now() - startedAt, url }),
        );
      });
    } catch (err) {
      finish({ ok: false, status: 0, error: err.message, ms: Date.now() - startedAt, url });
      return;
    }

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${timeoutMs}ms`)));
    req.on('error', (err) =>
      finish({ ok: false, status: 0, error: err.message, ms: Date.now() - startedAt, url }),
    );
    req.end();
  });
}

/**
 * 预热一批 URL（并发发出）。
 *
 * @param {object} opts
 * @param {string[]} opts.urls
 * @param {(url: string) => Promise<object>} [opts.fetchOne] 便于单测注入
 * @returns {Promise<object[]>} 每项含 { ok, status, bytes, ttfbMs, ms, url }
 */
export async function warmAll({ urls, fetchOne } = {}) {
  const one =
    fetchOne ??
    ((url) => warmRequest(url, { acceptEncoding: BROWSER_ACCEPT_ENCODING, timeoutMs: DEFAULT_TIMEOUT_MS }));
  // 逐条兜住异常：内建 warmRequest 只 resolve 不 reject，但注入式 fetcher（单测 /
  // 未来换实现）可能抛错，那时 Promise.all 会把整批带崩 —— 违反本模块的
  // warn-not-throw 契约。预热是纯投递优化，任一条失败都不该影响其余与主流程。
  return Promise.all(
    urls.map(async (url) => {
      try {
        return await one(url);
      } catch (err) {
        return { ok: false, status: 0, error: err?.message ?? String(err), url };
      }
    }),
  );
}

/** 极简参数解析：`--k v` / `--flag`。未知参数忽略（CI 里不要因拼错而整步失败） */
export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else {
      opts[key] = next;
      i += 1;
    }
  }
  return opts;
}

/** 从 `GITHUB_REPOSITORY=owner/repo` 拆出 owner/repo（CI 里天然存在） */
export function parseRepoSlug(slug) {
  if (typeof slug !== 'string') return null;
  const m = slug.trim().match(/^([^/]+)\/([^/]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const fromEnv = parseRepoSlug(process.env.GITHUB_REPOSITORY);
  const owner = typeof opts.owner === 'string' ? opts.owner : fromEnv?.owner ?? 'Shonee';
  const repo = typeof opts.repo === 'string' ? opts.repo : fromEnv?.repo ?? 'rss-radar';
  const branch = typeof opts.branch === 'string' ? opts.branch : 'deploy';
  const pointerPath = typeof opts.pointer === 'string' ? opts.pointer : 'today/latest.json';
  const hosts =
    typeof opts.hosts === 'string' && opts.hosts.trim()
      ? opts.hosts.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_HOSTS;

  let pointer;
  try {
    pointer = JSON.parse(await readFile(resolve(process.cwd(), pointerPath), 'utf8'));
  } catch (err) {
    console.warn(`[warm-cdn] 跳过：读不到指针 ${pointerPath}（${err.message}）`);
    return 0;
  }

  const targets = warmTargets(pointer);
  if (targets.length === 0) {
    console.warn('[warm-cdn] 跳过：指针里没有 snapshotPath / reportPath');
    return 0;
  }

  const urls = hosts.flatMap((host) => targets.map((p) => warmUrl(host, { owner, repo, branch }, p)));

  if (opts['dry-run'] === true) {
    console.log(`[warm-cdn] dry-run  urls=${urls.length}`);
    for (const u of urls) console.log(`  ${u}`);
    return 0;
  }

  console.log(`[warm-cdn] ${owner}/${repo}@${branch}  targets=${targets.length}  hosts=${hosts.length}`);
  const results = await warmAll({ urls });

  let okCount = 0;
  for (const r of results) {
    if (r.ok) okCount += 1;
    const host = r.url.replace(/^https:\/\//, '').split('/')[0];
    const tail = r.url.split('/').pop();
    console.log(
      r.ok
        ? `[warm-cdn] ok   ${host}  ${tail}  ${r.status}  ${r.bytes}B  ttfb=${r.ttfbMs}ms  total=${r.ms}ms`
        : `[warm-cdn] warn ${host}  ${tail}  ${r.status || '-'}  ${r.error ?? 'failed'}`,
    );
  }
  console.log(`[warm-cdn] 完成 ${okCount}/${results.length}（失败不影响数据发布）`);
  return 0;
}

// 入口守卫（纪律：被单测 import 时不得自动执行）
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.warn(`[warm-cdn] 未预期错误（忽略）：${err?.message ?? err}`);
      process.exit(0);
    },
  );
}

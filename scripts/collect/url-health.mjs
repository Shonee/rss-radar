// scripts/collect/url-health.mjs — URL 健康检查编排（ARCHITECTURE §15）
// 并发 4 + 同域串行 1s 间隔 + 两轮防抖动 + 状态机 + sources schema 持久化
//
// lastStatus 持久化已落地（P1 裁决 C + P2-A.1 裁决 C 闭环）：
//   - sources.schema.json 增 lastFetchAt / lastStatus / lastError 字段
//   - lastStatus enum: ok / moved / blocked / dead / unknown（已扩）
//   - 本模块 checkUrls() 完成后调用 persistSourceHealth() 回写 sources.json
//   - urlStatus / urlCheckedAt 写回 Item 字段
//   - pendingDead 内部计数用于防抖动
import { writeFile, readFile } from 'node:fs/promises';
import { checkOneUrl, classifyHttpStatus } from './lib/url-checker.mjs';
import { nowIso } from './lib/time.mjs';

/**
 * @typedef {Object} UrlHealthRecord
 * @property {string} url
 * @property {'ok'|'moved'|'blocked'|'dead'|'unknown'|'pendingDead'} status
 * @property {string} [urlCheckedAt]
 * @property {number} [httpStatus]
 * @property {string} [location]
 * @property {number} [latencyMs]
 * @property {number} [pendingDeadCount] 内部：连续 404 计数
 */

/**
 * 简单并发池（同 spec：并发 N）+ 同 host 串行（host 分桶）
 *
 * @param {string[]} urls
 * @param {Object} opts
 * @param {number} [opts.concurrency=4]
 * @param {number} [opts.perHostIntervalMs=1000]  同 host 串行间隔（ms）
 * @param {number} [opts.timeoutMs=10000]
 * @param {function(string):Promise<any>} opts.worker 单 url 处理函数
 * @returns {Promise<any[]>} 与 urls 顺序对应
 */
export async function poolUrls(urls, opts) {
  const concurrency = opts.concurrency ?? 4;
  const perHostIntervalMs = opts.perHostIntervalMs ?? 1000;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const worker = opts.worker;

  const out = new Array(urls.length);
  let idx = 0;
  const hostLastRun = new Map(); // host → timestamp(ms)
  const hostQueues = new Map();  // host → Promise (chain)

  async function runOne(i) {
    const url = urls[i];
    const host = hostOf(url);
    // 同 host 串行：chain 上一次完成 + 等待间隔
    const prev = hostQueues.get(host) ?? Promise.resolve();
    let resolveNext;
    const next = new Promise((r) => { resolveNext = r; });
    hostQueues.set(host, next);
    await prev;
    const last = hostLastRun.get(host) ?? 0;
    const wait = perHostIntervalMs - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    out[i] = await worker(url, { timeoutMs });
    hostLastRun.set(host, Date.now());
    resolveNext();
  }

  const workers = Array.from(
    { length: Math.min(concurrency, urls.length) },
    async () => {
      while (true) {
        const i = idx;
        idx += 1;
        if (i >= urls.length) break;
        await runOne(i);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
}

/**
 * 状态机：上一轮 urlStatus + 本轮分类 → 下一轮 urlStatus
 * 两轮防抖动：首轮 404 不立即 dead，记 pendingDead，下轮仍 404 才 dead
 *
 * @param {string} prev     上一轮 urlStatus（缺省 → 'ok'）
 * @param {string} cur      本轮 classifyHttpStatus 结果
 * @returns {string} 下一轮 urlStatus
 */
export function transition(prev, cur) {
  const p = prev ?? 'ok';
  // 本轮 ok：清 pending
  if (cur === 'ok' || cur === 'moved') {
    return cur;
  }
  // blocked 即时生效（明确信号）
  if (cur === 'blocked') {
    return 'blocked';
  }
  // dead 防抖
  if (cur === 'dead') {
    if (p === 'pendingDead') return 'dead';
    return 'pendingDead';
  }
  // unknown / 5xx / 网络错误：保持原状态
  return p;
}

/**
 * 主入口：批量校验 URL，返回每条新状态
 *
 * @param {string[]} urls
 * @param {Object} [opts]
 * @param {Object<string,string>} [opts.prevStatuses={}]  url → 旧 urlStatus（用于状态机）
 * @param {number} [opts.concurrency=4]
 * @param {number} [opts.perHostIntervalMs=1000]
 * @param {number} [opts.max=200]  单轮硬上限
 * @param {typeof fetch} [opts._fetch]  测试注入
 * @returns {Promise<{ results: CheckResult[], records: UrlHealthRecord[], stats }>}
 */
export async function checkUrls(urls, opts = {}) {
  const concurrency = opts.concurrency ?? 4;
  const perHostIntervalMs = opts.perHostIntervalMs ?? 1000;
  const max = opts.max ?? 200;
  const prevStatuses = opts.prevStatuses ?? {};
  const doFetch = opts._fetch ?? fetch;

  // 单轮上限
  const sliced = urls.slice(0, max);
  const overflow = urls.length - sliced.length;

  const rawResults = await poolUrls(sliced, {
    concurrency,
    perHostIntervalMs,
    worker: (url, wopts) => checkOneUrl(url, { ...wopts, _fetch: doFetch }),
  });

  const now = nowIso();
  const records = [];
  const results = [];
  for (let i = 0; i < sliced.length; i += 1) {
    const url = sliced[i];
    const r = rawResults[i];
    const prev = prevStatuses[url] ?? 'ok';
    const next = transition(prev, r.status);
    const rec = {
      url,
      status: next,
      urlCheckedAt: now,
      httpStatus: r.httpStatus,
      latencyMs: r.latencyMs,
      method: r.method,
    };
    if (r.location) rec.location = r.location;
    if (r.error) rec.error = r.error;
    if (next === 'pendingDead') {
      rec.pendingDeadCount = (prev === 'pendingDead') ? 2 : 1;
    }
    records.push(rec);
    results.push(r);
  }

  const stats = {
    total: urls.length,
    checked: sliced.length,
    overflow,
    ok: 0, moved: 0, blocked: 0, dead: 0, unknown: 0, pendingDead: 0,
  };
  for (const rec of records) {
    if (stats[rec.status] !== undefined) stats[rec.status] += 1;
  }

  return { results, records, stats };
}

/**
 * 跨源备用 URL 优先级（ARCHITECTURE §15.3）
 * 排序：success_time DESC → weight DESC → publishedAt DESC
 * 候选：sources[] 中 urlStatus != 'dead'
 * 主 URL 失效时（主 urlStatus === 'dead' 且 alternateUrl 未指定）调用
 *
 * @param {Object} item
 * @param {Object<string,string>} [successTimeByUrl]  url → success_time ISO 字符串
 * @param {Object<string,number>} [channelWeights]  channelId → weight
 * @returns {string|null} 备用 URL 或 null
 */
export function pickAlternate(item, successTimeByUrl = {}, channelWeights = {}) {
  if (!item) return null;
  // 主 url 仍 ok → 不需要备用
  if (item.urlStatus !== 'dead') return null;
  // 如果 alternateUrl 已存在 → 优先用（来自上一次 pickAlternate）
  if (item.alternateUrl) return item.alternateUrl;

  const sources = item.sources ?? [];
  if (sources.length === 0) return null;
  // 候选：urlStatus != 'dead'
  const candidates = sources
    .map((s) => ({ ...s, _status: s.urlStatus ?? 'ok' }))
    .filter((s) => s._status !== 'dead')
    .map((s) => ({
      ...s,
      _successTime: successTimeByUrl[s.url] ?? s.urlCheckedAt ?? '',
      _weight: channelWeights[s.channelId] ?? 0.5,
      _publishedAt: s.publishedAt ?? '',
    }));

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    // 1) success_time DESC
    if (a._successTime !== b._successTime) {
      return a._successTime < b._successTime ? 1 : -1;
    }
    // 2) weight DESC
    if (a._weight !== b._weight) return b._weight - a._weight;
    // 3) publishedAt DESC
    if (a._publishedAt !== b._publishedAt) {
      return a._publishedAt < b._publishedAt ? 1 : -1;
    }
    return 0;
  });

  return candidates[0].url ?? null;
}

/**
 * 回写 sources.json：把 lastFetchAt / lastStatus / lastError 持久化
 * sources.json 顶层结构 {channels, sources: [{id, ..., lastFetchAt?, lastStatus?, lastError?}]}
 *
 * @param {string} sourcesJsonPath
 * @param {Array<{id?:string,url?:string}>} sources  配置中的 sources 列表
 * @param {UrlHealthRecord[]} records  url-health 返回的 records
 */
export async function persistSourceHealth(sourcesJsonPath, sources, records) {
  // 构造 url → record map（按 source.url 匹配）
  const byUrl = new Map();
  for (const r of records) byUrl.set(r.url, r);

  const now = nowIso();
  let mutated = false;
  const updated = sources.map((src) => {
    if (!src.url) return src;
    const rec = byUrl.get(src.url);
    if (!rec) return src;
    mutated = true;
    return {
      ...src,
      lastFetchAt: now,
      lastStatus: rec.status,
      lastError: rec.error ?? null,
    };
  });
  if (mutated) {
    const raw = await readFile(sourcesJsonPath, 'utf8').catch(() => null);
    const obj = raw ? JSON.parse(raw) : { channels: [], sources: updated };
    obj.sources = updated;
    await writeFile(sourcesJsonPath, JSON.stringify(obj, null, 2), 'utf8');
  }
  return { updated, mutated };
}

/**
 * 复查频率决策（ARCHITECTURE §15.5）
 * - dead 每日
 * - blocked 每周
 * - moved 不复查
 * - ok 不主动复查
 *
 * @param {string} status
 * @returns {'daily'|'weekly'|null} 下次复查频率（null = 不复查）
 */
export function nextRecheckStrategy(status) {
  if (status === 'dead') return 'daily';
  if (status === 'blocked') return 'weekly';
  if (status === 'moved') return null;
  return null; // ok / pendingDead / unknown 不主动复查
}

export const _internal = { hostOf, transition };

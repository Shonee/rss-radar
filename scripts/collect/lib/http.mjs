// lib/http.mjs — fetch + AbortController + 重试 + UA + ETag/Last-Modified
import { readFileSync } from 'node:fs';

/**
 * @typedef {Object} FetchOpts
 * @property {number} [timeoutMs]   默认 15000
 * @property {number} [retries]     默认 2（最多 3 次尝试）
 * @property {string} [userAgent]   默认 rss-radar-bot/1.0
 * @property {string} [etag]        条件请求 If-None-Match
 * @property {string} [lastModified] 条件请求 If-Modified-Since
 * @property {Object<string,string>} [headers] 附加头（注意：不要塞密钥）
 */

/** 默认 UA：参考 ARCHITECTURE §3.7 */
const DEFAULT_UA = 'rss-radar-bot/1.0 (+https://github.com/<owner>/rss-radar)';

/** 判断错误是否可重试 */
function isRetryable(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') return true;
  // HTTP 5xx 由 caller 判定
  return false;
}

/**
 * 拉取 HTTP(S) URL 的原始 body + headers
 * @param {string} url
 * @param {FetchOpts & {extraRetries?: number}} [opts]
 * @returns {Promise<{status:number, headers:Headers, body:string, etag?:string, lastModified?:string, notModified?:boolean, contentType?:string, attempts:number}>}
 */
export async function fetchText(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const retries = opts.retries ?? 2;
  const userAgent = opts.userAgent ?? DEFAULT_UA;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const headers = {
        'User-Agent': userAgent,
        Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/json, text/xml, */*;q=0.5',
        ...(opts.headers ?? {}),
      };
      if (opts.etag) headers['If-None-Match'] = opts.etag;
      if (opts.lastModified) headers['If-Modified-Since'] = opts.lastModified;
      const res = await fetch(url, { headers, signal: ac.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (res.status === 304) {
        return {
          status: 304,
          headers: res.headers,
          body: '',
          notModified: true,
          attempts: attempt + 1,
        };
      }
      if (res.status >= 500 && attempt < retries) {
        // 5xx 可重试
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(backoff(attempt));
        continue;
      }
      const body = await res.text();
      return {
        status: res.status,
        headers: res.headers,
        body,
        etag: res.headers.get('etag') ?? undefined,
        lastModified: res.headers.get('last-modified') ?? undefined,
        contentType: res.headers.get('content-type') ?? undefined,
        attempts: attempt + 1,
      };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (isRetryable(err) && attempt < retries) {
        await sleep(backoff(attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('fetch failed');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoff(attempt) {
  // 指数退避：1s, 3s
  return [1000, 3000][Math.min(attempt, 1)];
}

/** 读取本地文件作为 connector 输入（local_json / local_csv） */
export function readLocal(relPath) {
  return readFileSync(relPath, 'utf8');
}
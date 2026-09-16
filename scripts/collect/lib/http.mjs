// lib/http.mjs — fetch + AbortController + 重试 + UA + ETag/Last-Modified
import { readFileSync } from 'node:fs';
import { decodeBody } from './charset.mjs';

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
export const DEFAULT_UA = 'rss-radar-bot/1.0 (+https://github.com/<owner>/rss-radar)';

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
 *
 * body 已按响应声明的编码正确解码（见 charset.mjs）——非 UTF-8 源（GBK/GB18030/
 * Big5 等）不会再变成 U+FFFD 乱码。判定过程与结果通过 encoding / encodingSource /
 * replacements 字段暴露，便于上层记录「这个源用什么编码解的、有没有残留坏字」。
 *
 * @param {string} url
 * @param {FetchOpts & {extraRetries?: number}} [opts]
 * @returns {Promise<{status:number, headers:Headers, body:string, encoding?:string, encodingSource?:string, replacements?:number, etag?:string, lastModified?:string, notModified?:boolean, contentType?:string, attempts:number}>}
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
      // ⚠️ 刻意不用 res.text()：WHATWG 规范规定它**始终按 UTF-8 解码并忽略响应头
      // 里的 charset**，于是 GBK 站点（52pojie 等 Discuz 论坛：HTTP 头只给
      // `application/xml` 不带 charset，编码写在 XML 声明里）会整源变成 U+FFFD 乱码。
      // 改取原始字节，交给 charset.mjs 分级嗅探（BOM → HTTP charset → 内嵌声明 →
      // UTF-8 严格试探 → GB18030 兜底），并把判定结果一并返回便于排查。
      const contentType = res.headers.get('content-type') ?? undefined;
      const decoded = decodeBody(Buffer.from(await res.arrayBuffer()), contentType);
      return {
        status: res.status,
        headers: res.headers,
        body: decoded.text,
        encoding: decoded.encoding,
        encodingSource: decoded.source,
        replacements: decoded.replacements,
        etag: res.headers.get('etag') ?? undefined,
        lastModified: res.headers.get('last-modified') ?? undefined,
        contentType,
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
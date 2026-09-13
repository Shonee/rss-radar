// scripts/collect/lib/url-checker.mjs — 单 URL 校验（ARCHITECTURE §15.1）
// HEAD 优先 + 405/501/无响应头 降级 GET Range: bytes=0-0
// 返回 { status, httpStatus, location, latencyMs, method, error }
/**
 * @typedef {Object} CheckResult
 * @property {'ok'|'moved'|'blocked'|'dead'|'unknown'} status
 * @property {number} httpStatus    HTTP 状态码
 * @property {string} [location]    301/308 Location 头
 * @property {number} latencyMs     耗时（毫秒）
 * @property {'HEAD'|'GET'} method  实际使用的方法
 * @property {string} [error]       错误信息（网络/超时）
 */

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * 状态码 → urlStatus 归类
 * @param {number} code
 * @returns {'ok'|'moved'|'blocked'|'dead'|'unknown'}
 */
export function classifyHttpStatus(code) {
  if (code === 200 || code === 204) return 'ok';
  if (code === 301 || code === 308) return 'moved';
  if (code === 302 || code === 303 || code === 307) return 'ok';
  if (code === 404 || code === 410) return 'dead';
  if (code === 403 || code === 429) return 'blocked';
  if (code >= 500) return 'unknown';
  return 'unknown';
}

/**
 * 校验单个 URL：HEAD 优先，405/501/无响应头降级 GET Range: bytes=0-0
 *
 * @param {string} url
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=10000]
 * @param {string} [opts.userAgent]
 * @param {typeof fetch} [opts._fetch] 测试可注入
 * @returns {Promise<CheckResult>}
 */
export async function checkOneUrl(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const userAgent = opts.userAgent ?? DESKTOP_UA;
  const doFetch = opts._fetch ?? fetch;

  // ---- 阶段 1：HEAD ----
  const headStart = Date.now();
  const headCtrl = new AbortController();
  const headTimeout = setTimeout(() => headCtrl.abort(), timeoutMs);
  let headRes;
  let headErr = null;
  try {
    headRes = await doFetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: headCtrl.signal,
      headers: { 'User-Agent': userAgent, 'Accept': '*/*' },
    });
  } catch (e) {
    headErr = e;
  } finally {
    clearTimeout(headTimeout);
  }
  if (headRes) {
    const code = headRes.status;
    if (code !== 405 && code !== 501) {
      return finalizeOk(url, headRes, 'HEAD', Date.now() - headStart);
    }
    // 405/501 → 降级 GET
  }

  // ---- 阶段 2：GET Range bytes=0-0（降级） ----
  const getStart = Date.now();
  const getCtrl = new AbortController();
  const getTimeout = setTimeout(() => getCtrl.abort(), timeoutMs);
  let getRes;
  let getErr = headErr;
  try {
    getRes = await doFetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: getCtrl.signal,
      headers: {
        'User-Agent': userAgent,
        'Accept': '*/*',
        'Range': 'bytes=0-0',
      },
    });
  } catch (e) {
    getErr = e;
  } finally {
    clearTimeout(getTimeout);
  }
  if (getRes) {
    return finalizeOk(url, getRes, 'GET', Date.now() - getStart);
  }

  // ---- 全部失败 ----
  return {
    status: 'unknown',
    httpStatus: 0,
    latencyMs: Date.now() - headStart,
    method: 'HEAD',
    error: getErr ? String(getErr.message ?? getErr) : 'fetch failed',
  };
}

function finalizeOk(url, res, method, latencyMs) {
  const httpStatus = res.status;
  const status = classifyHttpStatus(httpStatus);
  const result = { status, httpStatus, latencyMs, method };
  const loc = res.headers.get('location');
  if (loc) result.location = loc;
  return result;
}

export const _internal = { classifyHttpStatus, DESKTOP_UA };

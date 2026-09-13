// lib/retry.mjs — 指数退避 + retryable 判定
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 1s, 3s 指数退避（与 ARCHITECTURE §3.7 一致） */
export function backoff(attempt) {
  return [1000, 3000][Math.min(attempt, 1)];
}

/** 判定错误是否可重试（不含 4xx；4xx 是用户/源问题，重试无意义） */
export function isRetryable(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') return true;
  // HTTP 5xx 由 caller 显式判定
  return false;
}
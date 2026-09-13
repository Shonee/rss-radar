// lib/dedup-key.mjs — 退化链 + id 生成（ARCH §4.2 + §4.6）
// 严格走 url-norm.mjs 的 buildDedupKey（4 模式退化链）
import { sha256Hex, shortHash } from './hash.mjs';
import { buildDedupKey, normalizeUrl } from './url-norm.mjs';

/** 退化链 — ARCH §4.2 伪代码实现 */
export function keyOf(item, opts) {
  const r = buildDedupKey(item, opts);
  return r?.key ?? r;
}

/** id = "it_" + sha256(dedupKey).slice(0, 12)  —— ARCH §4.6 */
export function buildId(dedupKey) {
  // 兼容 {key, mode} 对象（直接传 buildDedupKey 结果）和纯字符串
  const keyStr = typeof dedupKey === 'string' ? dedupKey : (dedupKey?.key ?? '');
  return `it_${shortHash(keyStr, 12)}`;
}

/** 高层：一次出 key + id + mode（最常用） */
export function deriveKeyAndId(item, opts) {
  const r = buildDedupKey(item, opts);
  const key = r?.key ?? r;
  const mode = r?.mode;
  const id = buildId(key);
  return { key, id, mode };
}

/** sha256 完整 hex（re-export 给 lib/） */
export const sha256 = sha256Hex;

/** 重新导出 normalizeUrl（别名） */
export { normalizeUrl };
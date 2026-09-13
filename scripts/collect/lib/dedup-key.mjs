// lib/dedup-key.mjs — dedupKey 计算 + id 生成
import { shortHash, sha256Hex } from './hash.mjs';
import { normalizeUrl } from './url-norm.mjs';

/** 退化链：url → guid(URL) → "guid:" + sourceId + ":" + guid → "title:" + title 指纹 */
export function buildDedupKey(input) {
  const url = input?.url;
  if (url) return `url:${normalizeUrl(url)}`;
  const guid = input?.guid;
  if (guid && input?.sourceId) return `guid:${input.sourceId}:${guid}`;
  if (guid) return `guid:${guid}`;
  const title = (input?.title ?? '').toLowerCase().trim();
  if (title) return `title:${title}`;
  return `blank:${Date.now()}:${Math.random()}`;
}

/** id = "it_" + sha256(dedupKey).slice(0, 12) */
export function buildId(dedupKey) {
  return `it_${shortHash(dedupKey, 12)}`;
}

/** sha256 完整 hex */
export const sha256 = sha256Hex;
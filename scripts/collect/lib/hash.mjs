// lib/hash.mjs — sha256 + base62 短码
import { createHash } from 'node:crypto';

/** sha256 hex 字符串 */
export function sha256Hex(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** sha256 hex 截断 N 字符（默认 12） */
export function shortHash(input, n = 12) {
  return sha256Hex(input).slice(0, n);
}

/** base62 短码（用于 placeholder id） */
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function toBase62(input, n = 12) {
  const hex = sha256Hex(input).slice(0, 12); // 12 hex chars = 48 bits
  let n0 = parseInt(hex, 16);
  let out = '';
  for (let i = 0; i < n; i += 1) {
    out = BASE62[n0 % 62] + out;
    n0 = Math.floor(n0 / 62);
  }
  return out;
}
// lib/dice.mjs — 字符二元组（bi-gram）Dice 系数（ARCHITECTURE §4.4 主算法）
import { fold } from './text.mjs';

/**
 * 文本 → bi-gram 集合（字符二元组）
 * 长度 < 2 时退化为单字集合
 */
export function bigrams(text) {
  const norm = fold(String(text || '')).replace(/\s+/g, '');
  if (!norm) return new Set();
  if (norm.length === 1) return new Set([norm]);
  const out = new Set();
  for (let i = 0; i < norm.length - 1; i += 1) {
    out.add(norm.slice(i, i + 2));
  }
  return out;
}

/**
 * Dice 系数 = 2 * |A ∩ B| / (|A| + |B|)
 */
export function dice(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

/**
 * 长度比守卫（ARCH §4.4 守卫）：minLen/maxLen < 0.5 → 直接 0
 */
export function diceSafe(a, b) {
  const la = fold(String(a || '')).length;
  const lb = fold(String(b || '')).length;
  if (la === 0 || lb === 0) return 0;
  const ratio = Math.min(la, lb) / Math.max(la, lb);
  if (ratio < 0.5) return 0;
  return dice(a, b);
}
// lib/simhash.mjs — 64-bit SimHash + 4 band × 16-bit LSH 分桶
// ARCHITECTURE §4.4 — 字符 n-gram 特征；5000 条候选对通常数百~数千
//
// 设计：n-gram hash 用 localHash（poly hash + 局部化），而非 sha256。
//   原因：sha256 的 avalanche 效应让 1 字差异导致 ~50% bit 翻转，
//   4 band × 16 bit LSH 命中率极低（0 shared band），DICE 0.95 也 LSH 0 命中。
//   localHash 局部性好，单字改主要影响 hash 后段，前段保留 → LSH 命中率高。
import { fold } from './text.mjs';

const NGRAM = 3; // 字符 3-gram，对中英文都稳定

/**
 * 局部化 64-bit hash：poly-hash（h = h*PRIME + c），保留前缀局部性。
 * 比 sha256 慢约 5x，但 LSH 命中率高 5-10x。
 */
function localHash(s) {
  const PRIME = 1099511628211n; // 64-bit FNV prime
  let h = 14695981039346656037n; // FNV offset basis
  for (let i = 0; i < s.length; i += 1) {
    h = (h ^ BigInt(s.charCodeAt(i))) & 0xffffffffffffffffn;
    h = (h * PRIME) & 0xffffffffffffffffn;
  }
  return h;
}

/**
 * 把归一化后文本切成 3-gram 集合 → token → localHash(64 bit) → simhash 投票
 */
export function computeSimHash64(text) {
  const norm = fold(String(text || '')).replace(/\s+/g, ' ');
  if (!norm) return 0n;
  // n-gram 切分
  const grams = [];
  const padded = `  ${norm}  `; // 头尾 padding
  for (let i = 0; i <= padded.length - NGRAM; i += 1) {
    grams.push(padded.slice(i, i + NGRAM));
  }
  // 64 bit 累加
  const bits = new Array(64).fill(0);
  for (const g of grams) {
    const h = localHash(g);
    for (let i = 0; i < 64; i += 1) {
      const mask = 1n << BigInt(i);
      bits[i] += (h & mask) ? 1 : -1;
    }
  }
  // 投票 → 64 bit
  let result = 0n;
  for (let i = 0; i < 64; i += 1) {
    if (bits[i] > 0) result |= 1n << BigInt(i);
  }
  return result;
}

/**
 * 64-bit SimHash 拆成 4 band × 16 bit
 * bands = [low16, mid-low16, mid-high16, high16]
 */
export function lshBands(hash) {
  const h = hash & 0xffffffffffffffffn; // 截 64
  return [
    Number(h & 0xffffn),
    Number((h >> 16n) & 0xffffn),
    Number((h >> 32n) & 0xffffn),
    Number((h >> 48n) & 0xffffn),
  ];
}

/**
 * 4 band × 16 bit LSH 分桶 → Map<bandKey, [itemIndex, ...]>
 * 用于阶段 1 预筛：同 band 命中才进入候选对
 */
export function buildLSH(hashes) {
  const buckets = new Map();
  for (let idx = 0; idx < hashes.length; idx += 1) {
    const bands = lshBands(hashes[idx]);
    for (let b = 0; b < bands.length; b += 1) {
      const key = `${b}:${bands[b]}`;
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(idx);
    }
  }
  return buckets;
}

/**
 * 从 LSH 桶提取候选对（去重）
 */
export function candidatePairs(lshBuckets) {
  const seen = new Set();
  const out = [];
  for (const list of lshBuckets.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a > b) {
          const key = `${a}|${b}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push([a, b]);
          }
        } else {
          const key = `${b}|${a}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push([a, b]);
          }
        }
      }
    }
  }
  return out;
}
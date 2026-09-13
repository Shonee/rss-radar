// scripts/collect/lib/keyword.mjs — 关键词提取（ARCHITECTURE §5.4 + IMPLEMENTATION_PLAN §二 T-P2-05）
// 中文 Intl.Segmenter（zh/word）+ 停用词过滤 + TopN
// （G3 决策：MVP 用 Intl.Segmenter；P1 精度不足换 nodejieba）
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');

/**
 * 尝试加载 Intl.Segmenter（Node 16+ 内建，zh/word 需 ICU ≥73）
 */
const segmenter = (() => {
  try {
    return new Intl.Segmenter('zh', { granularity: 'word' });
  } catch {
    return null;
  }
})();

/**
 * 简易 ASCII 词切分（fallback）
 */
function asciiTokens(s) {
  if (typeof s !== 'string') return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 2);
}

/**
 * 把字符串切分为 token[]。
 * - 中文优先 Intl.Segmenter
 * - 英文 ASCII 按词拆
 * - 数字串保留
 */
export function tokenize(s) {
  if (typeof s !== 'string' || !s) return [];
  const tokens = [];

  // 1) Intl.Segmenter（中文/中日韩文）
  if (segmenter) {
    for (const seg of segmenter.segment(s)) {
      if (seg.isWordLike) {
        const w = seg.segment;
        if (w.length >= 2 && /[\u4e00-\u9fff]/.test(w)) {
          tokens.push(w);
        } else if (/[a-z0-9]/i.test(w) && w.length >= 2) {
          tokens.push(w.toLowerCase());
        }
      }
    }
  } else {
    // fallback：粗粒度 ASCII + 单字
    tokens.push(...asciiTokens(s));
    // 单字中文也加（G3 弱化版）
    const chinese = s.match(/[\u4e00-\u9fff]/g) ?? [];
    for (const c of chinese) tokens.push(c);
  }

  return tokens;
}

/**
 * 加载停用词表（中文 + 英文）
 * 路径：config/stopwords-zh.txt + config/stopwords-en.txt
 */
export function loadStopwords(extra = {}) {
  const set = new Set();
  function addFromTxt(path) {
    try {
      const raw = readFileSync(path, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        set.add(t.toLowerCase());
      }
    } catch (e) {
      // 停用词表缺失不阻断
      if (e.code !== 'ENOENT') console.warn(`[keyword] stopwords load warn: ${e.message}`);
    }
  }
  addFromTxt(resolve(ROOT, 'config/stopwords-zh.txt'));
  addFromTxt(resolve(ROOT, 'config/stopwords-en.txt'));
  if (extra?.zh) for (const w of extra.zh) set.add(w.toLowerCase());
  if (extra?.en) for (const w of extra.en) set.add(w.toLowerCase());
  return set;
}

/**
 * 从 items[] 提取 TopN 关键词
 * @param {Object[]} items
 * @param {Object} [opts]
 * @param {number} [opts.topN=20]
 * @param {Set<string>} [opts.stopwords] 已加载的停用词集
 * @param {number} [opts.minLen=2] 过滤过短的 token
 * @returns {Array<{word:string, count:number, weight:number}>}
 */
export function topKeywords(items, opts = {}) {
  const topN = opts.topN ?? 20;
  const minLen = opts.minLen ?? 2;
  const stops = opts.stopwords ?? loadStopwords();

  const counter = new Map();
  for (const it of items ?? []) {
    const text = `${it.title ?? ''} ${it.summary ?? ''}`;
    for (const tk of tokenize(text)) {
      if (tk.length < minLen) continue;
      if (stops.has(tk.toLowerCase())) continue;
      counter.set(tk, (counter.get(tk) ?? 0) + 1);
    }
  }

  const arr = Array.from(counter.entries())
    .map(([word, count]) => ({ word, count, weight: 0 }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));

  if (arr.length === 0) return arr;
  const max = arr[0].count;
  for (const w of arr) w.weight = max === 0 ? 0 : w.count / max;
  return arr.slice(0, topN);
}

/**
 * 给定 TopN 关键词 + items[]，计算每个 item.dedupKey 命中的关键词计数
 * （给 hot-score 的 Z_kw 用）
 *
 * @param {Object[]} items
 * @param {Array<{word:string}>} keywords
 * @returns {Object<string,number>} key → keywordHits（命中数）
 */
export function keywordHitsByItem(items, keywords) {
  const out = {};
  if (!keywords || keywords.length === 0) return out;
  const kwSet = new Set(keywords.map((k) => k.word.toLowerCase()));
  for (const it of items ?? []) {
    const text = `${it.title ?? ''} ${it.summary ?? ''}`.toLowerCase();
    let hits = 0;
    for (const w of kwSet) {
      if (text.includes(w)) hits += 1;
    }
    if (hits > 0) out[it.dedupKey ?? it.id] = hits;
  }
  return out;
}

// lib/text.mjs — 文本处理：NFKC / 大小写折叠 / 去 HTML
import sanitizeHtml from 'sanitize-html';

/** NFKC 归一化 */
export function normalizeNFKC(s) {
  if (typeof s !== 'string') return '';
  return s.normalize('NFKC');
}

/** 折叠空白 + 大小写折叠（中文无效，仅 ASCII） */
export function fold(s) {
  if (typeof s !== 'string') return '';
  return normalizeNFKC(s).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 去 HTML，保留纯文本 */
export function stripHtml(html) {
  if (!html) return '';
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

/** 截断 N 字符（中文按字符计），尾部加省略号 */
export function truncate(s, n = 200) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

/** 简化版中文分词（按字符 1~2 字符切分；P2 升级 nodejieba） */
export function segmentCJK(s) {
  if (!s) return [];
  // MVP：拆为 1~2 字词，过滤单字
  const cleaned = normalizeNFKC(s).toLowerCase();
  const out = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (/[\u4e00-\u9fff]/.test(ch)) {
      out.push(ch);
      const next = cleaned[i + 1];
      if (next && /[\u4e00-\u9fff]/.test(next)) {
        out.push(ch + next);
      }
    } else if (/[a-z0-9]+/.test(ch)) {
      // 英文/数字连续成词
      let j = i;
      while (j < cleaned.length && /[a-z0-9]/.test(cleaned[j])) j += 1;
      out.push(cleaned.slice(i, j));
      i = j - 1;
    }
  }
  return out;
}
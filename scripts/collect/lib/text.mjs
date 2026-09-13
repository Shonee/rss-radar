// lib/text.mjs — 文本处理：NFKC / 大小写折叠 / 去 HTML（P2-A 简化版）
// 注：HTML 净化留 P3 接 sanitize-html（本层 P2-A 不需要复杂 HTML 解析；RSS / Atom / JSON Feed
//     接入器在 normalize.mjs 前已剥离 content snippet 为纯文本）。

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

/**
 * 去 HTML，保留纯文本。
 * P2-A 简化版：正则去除所有 <...> 标签（足够 RSS / Atom / JSON Feed 已知输入）。
 * P3 升级：替换为 sanitize-html（依赖已 pre-declare 在 package.json）。
 */
export function stripHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 截断 N 字符（中文按字符计），尾部加省略号 */
export function truncate(s, n = 200) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

/** 简化版中文分词（按字符 1~2 字符切分；P2 升级 Intl.Segmenter（G3）） */
export function segmentCJK(s) {
  if (typeof s !== 'string' || !s) return [];
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

// lib/url-norm.mjs — URL 标准化 R1~R12（ARCHITECTURE §4.1）
// P1 占位：最小协议小写/host 小写/去 fragment/去尾斜杠
// P2 完整：R1~R12 全规则；R11/R12 默认关（按源开关化）
import { fold } from './text.mjs';

// R2 黑名单（严格按 ARCHITECTURE §4.1）
export const TRACKING_PARAMS = [
  // ARCH §4.1 标准列表
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name',
  'from', 'ref', 'ref_src', 'spm', 'share_source', 'share_medium', 'share_token',
  'fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid', 'yclid', '_ga', '_gl', '_hsenc', '_hsmi',
  'weibo_id',
];

/**
 * @typedef {Object} NormOpts
 * @property {boolean} [r11HttpToHttps] 默认 false（开关 R11）
 * @property {boolean} [r12StripWww]     默认 false（开关 R12）
 * @property {Set<string>} [extraTrackingParams] 额外黑名单（按源扩展）
 * @property {boolean} [debug]           命中黑名单时打 console.warn
 */

const DEFAULTS = {
  r11HttpToHttps: false,
  r12StripWww: false,
  extraTrackingParams: null,
  debug: false,
};

/**
 * 12 条规则全应用的主入口
 * 任何规则抛错 → 原样返回（容错优先）
 */
export function normalizeUrl(input, opts = {}) {
  if (!input || typeof input !== 'string') return '';
  const o = { ...DEFAULTS, ...opts };
  let raw;
  try {
    raw = new URL(input);
  } catch {
    return input;
  }

  try {
    // R3 大小写：protocol + host 转小写（path/query 保留）
    raw.protocol = raw.protocol.toLowerCase();
    raw.hostname = raw.hostname.toLowerCase();

    // R12 去 www.（按开关）
    if (o.r12StripWww && raw.hostname.startsWith('www.')) {
      raw.hostname = raw.hostname.slice(4);
    }

    // R11 http→https（按开关）
    if (o.r11HttpToHttps && raw.protocol === 'http:') {
      raw.protocol = 'https:';
    }

    // R4 去默认端口
    if (
      (raw.protocol === 'http:' && raw.port === '80') ||
      (raw.protocol === 'https:' && raw.port === '443')
    ) {
      raw.port = '';
    }

    // R10 百分号编码：解码常见安全字符（非 reserved），再让 URL 重新编码
    // 保守实现：直接保留原样（Node URL 不会再次编码），依赖原始源已 URL-encoded
    // 若需严格大写 → 解码 → 重编码，工作量大；P2 仅做 "解码非必要编码"
    try {
      const decoded = decodeURIComponent(raw.pathname);
      raw.pathname = reencodePath(decoded);
    } catch {
      // 非法编码 → 保留原样
    }

    // R6 合并 path 内 // → /
    raw.pathname = raw.pathname.replace(/\/{2,}/g, '/');

    // R9 去结尾 index.*（默认 php/htm/html）
    raw.pathname = raw.pathname.replace(/\/(?:index\.(?:html?|php))$/i, '');

    // R5 去尾斜杠（path 长度 > 1 时）
    if (raw.pathname.length > 1 && raw.pathname.endsWith('/')) {
      raw.pathname = raw.pathname.slice(0, -1);
    }

    // R1 去 fragment
    raw.hash = '';

    // R2 + R7 query 处理：先过滤黑名单 → 再按 key 字典序重组
    const params = Array.from(raw.searchParams.entries()).filter(([k]) => {
      if (isTrackingParam(k, o.extraTrackingParams)) {
        if (o.debug) console.warn(`[url-norm] strip tracking param: ${k}`);
        return false;
      }
      return true;
    });
    params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    raw.search = '';
    for (const [k, v] of params) raw.searchParams.append(k, v);

    // R8 去空 query（如果 search 仅有 ? 但无内容）
    if (raw.search === '?') raw.search = '';
    // URL.toString 会把空 search 转成 ? 需手动去掉
    let out = raw.toString();
    if (out.endsWith('?')) out = out.slice(0, -1);
    return out;
  } catch {
    return input;
  }
}

function isTrackingParam(key, extra) {
  const lower = key.toLowerCase();
  if (TRACKING_PARAMS.includes(lower)) return true;
  if (lower.startsWith('utm_')) return true;
  if (extra && extra.has(key)) return true;
  if (extra && extra.has(lower)) return true;
  return false;
}

function reencodePath(path) {
  // 仅重新编码 unsafe 字符（保留 / 与保留字）
  return Array.from(path)
    .map((ch) => {
      if (/[\w\-._~!$&'()+,;=:@/]/.test(ch)) return ch;
      return encodeURIComponent(ch);
    })
    .join('');
}

/**
 * 标题指纹：复用 text.mjs 的 NFKC + 大小写折叠 + 去标点
 * ARCH §4.2 退化链的最后一档
 */
export function titleFingerprint(title) {
  return fold(String(title || ''))
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
}

/**
 * 退化链 4 模式（ARCH §4.2 伪代码）：
 *   1) URL → sha256(normalizeUrl(item.url))
 *   2) guid 是 URL → sha256(normalizeUrl(item.guid))
 *   3) guid 仅源内唯一 → sha256("guid:" + sourceId + ":" + item.guid)
 *   4) title 指纹 → sha256("title:" + normTitle(item.title))
 * 返回 key + 命中档（便于调试/统计）
 */
import { sha256Hex } from './hash.mjs';

export function buildDedupKey(item, opts) {
  if (item.url && isHttpUrl(item.url)) {
    return { key: `url:${sha256Hex(normalizeUrl(item.url, opts))}`, mode: 'url' };
  }
  if (item.guid && isHttpUrl(item.guid)) {
    return { key: `guid-url:${sha256Hex(normalizeUrl(item.guid, opts))}`, mode: 'guid-url' };
  }
  if (item.guid && item.sourceId) {
    return { key: `guid:${sha256Hex(`guid:${item.sourceId}:${item.guid}`)}`, mode: 'guid-source' };
  }
  if (item.title) {
    return { key: `title:${sha256Hex(`title:${titleFingerprint(item.title)}`)}`, mode: 'title' };
  }
  return { key: `blank:${Date.now()}:${Math.random()}`, mode: 'blank' };
}

function isHttpUrl(s) {
  if (typeof s !== 'string') return false;
  return /^https?:\/\//i.test(s);
}

// 兼容 P1：导出 alias
export { sha256Hex as sha256 };
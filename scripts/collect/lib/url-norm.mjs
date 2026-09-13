// lib/url-norm.mjs — URL 标准化 R1~R12 规则（P2 主用，P1 仅占位）
// P1 阶段：先实现最简「小写 host + 去尾斜杠 + 去 fragment」三步
// P2 阶段（T-P2-01）：扩展 R1~R12 黑名单、开关 R11/R12

/** 最小 URL 标准化（P1）：协议小写 / host 小写 / 去 fragment / 去尾斜杠 */
export function normalizeUrl(input) {
  if (!input || typeof input !== 'string') return '';
  try {
    const u = new URL(input);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    let path = u.pathname;
    while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    u.pathname = path;
    // protocol 小写
    u.protocol = u.protocol.toLowerCase();
    return u.toString();
  } catch {
    return input;
  }
}

/** P2 占位：开关化黑名单（默认关） */
export function stripTrackingParams(url) {
  return url;
}

/** dedupKey 退化链：url → guid(URL) → "guid:" + sourceId + ":" + guid → "title:" + title 指纹 */
export function buildDedupKey(input) {
  if (input.url) return `url:${normalizeUrl(input.url)}`;
  if (input.guid && input.sourceId) return `guid:${input.sourceId}:${input.guid}`;
  if (input.guid) return `guid:${input.guid}`;
  if (input.title) return `title:${(input.title || '').toLowerCase().trim()}`;
  return `blank:${Date.now()}:${Math.random()}`;
}
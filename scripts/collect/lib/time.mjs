// lib/time.mjs — Asia/Shanghai 固定时区 + 切日 + ISO UTC 输出
const TZ = 'Asia/Shanghai';

const FIX = 8 * 60 * 60 * 1000; // UTC+8 offset

/** 当前 Asia/Shanghai 切日（YYYY-MM-DD） */
export function todayLocal(d = new Date()) {
  // 转 Asia/Shanghai 后取 Y-M-D
  const utc = d.getTime();
  const local = new Date(utc + FIX);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 当前时刻 → ISO 8601 UTC 字符串（带 Z） */
export function nowIso(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Date → ISO UTC（YYYY-MM-DDTHH:mm:ssZ） */
export function toIsoUtc(d) {
  if (typeof d === 'string') d = new Date(d);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 当天 00:00 Asia/Shanghai 的 UTC ISO 表示 */
export function windowStartUtc(dateStr = todayLocal()) {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Asia/Shanghai 00:00 = UTC 前一天 16:00
  const utcMs = Date.UTC(y, m - 1, d) - FIX;
  return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * 由 ISO 时间戳派生 4 位 UTC `HHmm` 标记。
 *
 * 用途：给当日快照 / 报告的文件名加一个**每小时唯一**的后缀，使 URL 本身成为
 * 内容地址（`snapshot-2026-09-16-0347.json`）。这是让 CDN 能安全长缓存的前提 ——
 * 2026-09-16 实测证据链：
 *
 *   ① jsDelivr 对 `@deploy/today/latest.json`（固定文件名）返回的内容落后 raw
 *      直读 **9 小时以上**（`age: 2467`）。机理是 CDN 按 URL 缓存 7 天
 *      （`cache-control: public, max-age=604800`），而该 URL 的内容每小时都变。
 *   ② 加 query string **无效**：实测 `?v=<timestamp>` 仍命中同一缓存条目
 *      （返回同一份 `age: 2759` 的旧内容）—— jsDelivr 不把 query 计入缓存键。
 *   ③ 但一个**从未被请求过的路径**会正常回源并拿到最新内容：实测
 *      `@deploy/today/events-2026-09-16.ndjson` 首次请求 `x-cache: MISS, MISS`
 *      → 200 + 最新内容。
 *
 * 结论：「同一天固定文件名 + 长缓存」是错的组合；「每小时唯一文件名 + 长缓存」
 * 才是对的组合。文件名不必是内容哈希 —— 生成时刻已足够确定内容。
 *
 * 用 UTC 而非 Asia/Shanghai 时基，与 `nowIso()` 保持一致，避免跨时区推导歧义。
 *
 * @param {string} iso 形如 `2026-09-16T03:47:12Z`
 * @returns {string} 形如 `0347`；非法输入回落 `0000`
 */
export function stampFromIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '0000';
  return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0');
}

/** 当日快照 / 报告文件名的不变后缀正则（4 位 UTC HHmm） */
export const STAMP_SUFFIX_RE = /-(\d{4})\.json$/;
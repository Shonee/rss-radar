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
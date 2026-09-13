// scripts/notify/lib/clock.mjs — Asia/Shanghai 固定时区时间工具
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12.5（defaults.timezone）
// 与 ARCHITECTURE §12.7（quietHours 静默时段，跨午夜）
//
// 说明：本模块只做「本地时钟」纯函数（无时区库依赖，固定 UTC+8）。
// 与 scripts/collect/lib/time.mjs 同语义；此处单独实现是为保持 notify 目录自洽，
// 且需暴露 minutes/hour 级别的跨午夜判定所需粒度。

const TZ_FIX_MS = 8 * 60 * 60 * 1000; // Asia/Shanghai = UTC+8

/**
 * 容错地把入参转为 Date。
 * @param {Date|number|string} [v]
 * @returns {Date}
 */
export function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  return new Date();
}

/**
 * 取 Asia/Shanghai 的本地时间分量。
 * @param {Date|number|string} [d]
 * @returns {{year:number,month:number,day:number,hour:number,minute:number}}
 */
export function localParts(d = new Date()) {
  const shifted = new Date(toDate(d).getTime() + TZ_FIX_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/**
 * Asia/Shanghai 切日字符串 YYYY-MM-DD。
 * @param {Date|number|string} [d]
 * @returns {string}
 */
export function localDate(d = new Date()) {
  const p = localParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Asia/Shanghai 本地 HH:mm。
 * @param {Date|number|string} [d]
 * @returns {string}
 */
export function localHHmm(d = new Date()) {
  const p = localParts(d);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/**
 * Asia/Shanghai 当天「自午夜起的分钟数」。
 * @param {Date|number|string} [d]
 * @returns {number} 0..1439
 */
export function localMinutes(d = new Date()) {
  const p = localParts(d);
  return p.hour * 60 + p.minute;
}

/**
 * 解析 "HH:mm" → 自午夜起分钟数；非法返回 null。
 * @param {string} s
 * @returns {number|null}
 */
export function parseHHmm(s) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * 静默时段判定（跨午夜安全）。
 * 例：'23:00-07:00' → cur >= 23:00 或 cur < 07:00 为静默。
 * 边界：[start, end) 半开区间；07:00 整点已「解除静默」。
 * @param {Date|number|string} d
 * @param {string} [range='23:00-07:00']
 * @returns {boolean}
 */
export function inQuietHours(d, range = '23:00-07:00') {
  const [a, b] = String(range).split('-');
  const start = parseHHmm(a);
  const end = parseHHmm(b);
  if (start === null || end === null || start === end) return false;
  const cur = localMinutes(d);
  if (start < end) {
    // 同日区间（如 12:00-14:00）
    return cur >= start && cur < end;
  }
  // 跨午夜区间（如 23:00-07:00）
  return cur >= start || cur < end;
}

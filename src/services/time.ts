// T-P3-01 前端基础设施 — 时间格式化（统一 Asia/Shanghai）
//
// 与 prototype/assets/js/components.js 的 formatAbsolute / formatRelative 语义一致，
// 但语言与边界按 IMPLEMENTATION_PLAN T-P3-01 收敛：
//   刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / MM-DD / YYYY-MM-DD

const TZ = 'Asia/Shanghai';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

type TimeInput = string | number | Date;

/** 页面1 时间范围档位（与 `config/site.ts` 的 `TIME_RANGES` 同源；`'all'` 为「今天为 0」时的逃生出口） */
export type TimeRangeKey = 'today' | '6h' | 'all';

function toDate(input: TimeInput): Date {
  return input instanceof Date ? input : new Date(input);
}

function isValid(d: Date): boolean {
  return !Number.isNaN(d.getTime());
}

function partsToMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

const ABS_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const HM_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 绝对时间：YYYY-MM-DD HH:mm（GMT+8），用于 title 悬浮提示 */
export function formatAbsolute(iso: string): string {
  if (!iso) return '—';
  const d = toDate(iso);
  if (!isValid(d)) return '—';
  const p = partsToMap(ABS_FORMATTER.formatToParts(d));
  return `${p.year ?? ''}-${p.month ?? ''}-${p.day ?? ''} ${p.hour ?? ''}:${p.minute ?? ''}（GMT+8）`;
}

/** 仅时分：HH:mm（GMT+8） */
export function formatHourMinute(iso: string): string {
  if (!iso) return '—';
  const d = toDate(iso);
  if (!isValid(d)) return '—';
  const p = partsToMap(HM_FORMATTER.formatToParts(d));
  return `${p.hour ?? ''}:${p.minute ?? ''}`;
}

/** 上海时区日期键：YYYY-MM-DD */
export function shanghaiDateKey(input: TimeInput): string {
  const d = toDate(input);
  if (!isValid(d)) return '';
  return DATE_FORMATTER.format(d);
}

/** 两个时刻是否同一上海自然日 */
export function isSameShanghaiDay(a: TimeInput, b: TimeInput): boolean {
  const ka = shanghaiDateKey(a);
  return ka !== '' && ka === shanghaiDateKey(b);
}

/**
 * 统计条目中落在指定上海自然日（date = `YYYY-MM-DD`）的条数。
 *
 * 谓词与页面列表的「今天」分支完全一致：取 `updatedAt 优先、回落 publishedAt`，
 * 用 `isSameShanghaiDay` 判定。两条时间都缺失的条目不计入。
 *
 * 抽成纯函数以便单测（页面1 状态条「今日 N 条」与列表「共 M 条」口径同源）。
 *
 * @param items 待统计条目（只需时间字段）
 * @param date  目标上海自然日 `YYYY-MM-DD`（通常传 `snap.date`）
 * @returns 命中条数
 */
export function countByShanghaiDay(
  items: ReadonlyArray<{ updatedAt?: string; publishedAt?: string }>,
  date: string,
): number {
  let n = 0;
  for (const it of items) {
    const t = it.updatedAt || it.publishedAt;
    if (t && isSameShanghaiDay(t, date)) n += 1;
  }
  return n;
}

/**
 * 判断单个条目是否通过页面1 的时间范围筛选（各时间档的统一谓词）。
 *
 * 档位语义（与页面1 列表及状态条口径一致）：
 *   - `'today'`：条目时间落在 `ctx.snapDate` 对应的上海自然日内；
 *   - `'6h'`：条目时间距今不超过 6 小时；
 *   - `'all'`：恒通过（不按时间过滤，作为「今天为 0」时的逃生出口）。
 *
 * 谓词与页面原文一致：取 `updatedAt 优先、回落 publishedAt`；时间缺失 / 非法一律不通过
 * （`'all'` 档除外）。抽成纯函数以便单测，`now` / `snapDate` 由调用方注入。
 *
 * @param item      待判条目（只需时间字段）
 * @param timeRange 时间档位
 * @param ctx       `now`（当前毫秒）与 `snapDate`（目标上海自然日 `YYYY-MM-DD`）
 * @returns 是否通过该时间档
 */
export function passesTimeRange(
  item: { updatedAt?: string; publishedAt?: string },
  timeRange: TimeRangeKey,
  ctx: { now: number; snapDate: string },
): boolean {
  if (timeRange === 'all') return true;
  const t = item.updatedAt || item.publishedAt;
  if (timeRange === 'today') return isSameShanghaiDay(t ?? '', ctx.snapDate);
  const hours = 6;
  if (!t) return false;
  const ms = new Date(t).getTime();
  if (Number.isNaN(ms)) return false;
  return ctx.now - ms <= hours * HOUR_MS;
}

/** 相对时间（中文） */
export function formatRelative(iso: string, now?: TimeInput): string {
  if (!iso) return '—';
  const t = toDate(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const nowMs = now === undefined ? Date.now() : toDate(now).getTime();
  let diff = nowMs - t;
  if (diff < 0) diff = 0;

  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;

  const isoKey = shanghaiDateKey(new Date(t));
  const yesterdayKey = shanghaiDateKey(new Date(nowMs - DAY_MS));
  if (isoKey !== '' && isoKey === yesterdayKey) return `昨天 ${formatHourMinute(iso)}`;

  const nowYear = shanghaiDateKey(new Date(nowMs)).slice(0, 4);
  if (isoKey.slice(0, 4) === nowYear) return isoKey.slice(5); // MM-DD
  return isoKey; // YYYY-MM-DD
}

/** n 小时前的 ISO 时刻（测试 / 深链用） */
export function hoursAgoIso(hours: number, now?: TimeInput): string {
  const base = now === undefined ? Date.now() : toDate(now).getTime();
  return new Date(base - hours * HOUR_MS).toISOString();
}

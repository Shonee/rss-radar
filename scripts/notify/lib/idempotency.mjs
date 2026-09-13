// scripts/notify/lib/idempotency.mjs — 幂等键构造 + 状态读写 + 结果落盘
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12.6（幂等）与 §12.7（去重）
//
// 状态文件（默认 stats/notify-state.json）结构：
//   {
//     "version": 1,
//     "sent": { "daily:2026-09-12": "<ISO>", "realtime:it_xxx": "<ISO>" },
//     "realtime": { "date": "2026-09-12", "count": 3, "lastSentAt": 1757654400000 }
//   }
// 读写容错：文件不存在 / JSON 损坏 / 结构异常 → 一律退回空状态，绝不抛错。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { localDate, toDate } from './clock.mjs';

export const DEFAULT_STATE_PATH = 'stats/notify-state.json';
export const DEFAULT_STATS_DIR = 'stats';
export const STATE_VERSION = 1;

/**
 * 构造幂等键。ARCHITECTURE §12.6：daily:<date> / realtime:<itemId>
 * @param {'dailyReport'|'realtime'} event
 * @param {{itemId?:string, date?:string}} [ctx]
 * @returns {string}
 */
export function idempotencyKey(event, ctx = {}) {
  if (event === 'realtime') {
    if (!ctx.itemId) throw new Error('idempotencyKey: realtime 事件需要 itemId');
    return `realtime:${ctx.itemId}`;
  }
  if (event === 'dailyReport') {
    if (!ctx.date) throw new Error('idempotencyKey: dailyReport 事件需要 date');
    return `daily:${ctx.date}`;
  }
  throw new Error(`idempotencyKey: 未知事件 "${event}"`);
}

/**
 * 空状态（工厂，避免共享引用）。
 * @returns {{version:number, sent:Object<string,string>, realtime:{date:?string,count:number,lastSentAt:number}}}
 */
export function emptyState() {
  return {
    version: STATE_VERSION,
    sent: {},
    realtime: { date: null, count: 0, lastSentAt: 0 },
  };
}

/**
 * 把任意「类状态」对象规整为合法状态（字段缺失/类型错误均补默认）。
 * @param {any} obj
 * @returns {ReturnType<typeof emptyState>}
 */
export function normalizeState(obj) {
  const base = emptyState();
  if (!obj || typeof obj !== 'object') return base;
  const sent = obj.sent && typeof obj.sent === 'object' ? obj.sent : {};
  const rt = obj.realtime && typeof obj.realtime === 'object' ? obj.realtime : {};
  return {
    version: Number.isFinite(obj.version) ? obj.version : STATE_VERSION,
    sent: { ...sent },
    realtime: {
      date: typeof rt.date === 'string' ? rt.date : null,
      count: Number.isFinite(rt.count) ? rt.count : 0,
      lastSentAt: Number.isFinite(rt.lastSentAt) ? rt.lastSentAt : 0,
    },
  };
}

/**
 * 读状态文件（容错）。文件不存在 / 损坏 → 空状态。
 * @param {string} [filePath=DEFAULT_STATE_PATH]
 * @returns {Promise<ReturnType<typeof emptyState>>}
 */
export async function readState(filePath = DEFAULT_STATE_PATH) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

/**
 * 写状态文件（自动建目录）。
 * @param {string} filePath
 * @param {any} state
 * @returns {Promise<any>} 写入的状态
 */
export async function writeState(filePath = DEFAULT_STATE_PATH, state) {
  const normalized = normalizeState(state);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

/**
 * 记录一次成功发送到状态（返回新状态，不修改入参）。
 * @param {any} state
 * @param {{key:string,event:string,itemId?:string,date?:string,now?:Date|number|string}} params
 * @returns {ReturnType<typeof emptyState>}
 */
export function applySend(state, { key, event, itemId, date, now = new Date() } = {}) {
  const next = normalizeState(state);
  const nowDate = toDate(now);
  if (!key) throw new Error('applySend: key 必填');
  next.sent[key] = nowDate.toISOString();

  if (event === 'realtime') {
    const d = date ?? localDate(nowDate);
    if (next.realtime.date !== d) {
      next.realtime.date = d;
      next.realtime.count = 0;
    }
    next.realtime.count += 1;
    next.realtime.lastSentAt = nowDate.getTime();
    if (itemId) next.sent[`realtime:${itemId}`] = nowDate.toISOString();
  }
  return next;
}

/**
 * 结果记录文件名：notify-<ISO(冒号/点替换为-)>.json
 * @param {Date|number|string} [ts]
 * @returns {string}
 */
export function notifyRecordFilename(ts = new Date()) {
  const iso = toDate(ts).toISOString().replace(/[:.]/g, '-');
  return `notify-${iso}.json`;
}

/**
 * 写一次发送结果记录（渠道/事件/结果/耗时/错误），失败也要写。
 * @param {string} [dir=DEFAULT_STATS_DIR]
 * @param {any} record
 * @param {Date|number|string} [ts]
 * @returns {Promise<string>} 实际写入路径
 */
export async function writeNotifyRecord(dir = DEFAULT_STATS_DIR, record, ts = new Date()) {
  await mkdir(dir, { recursive: true });
  const base = notifyRecordFilename(ts);
  let file = join(dir, base);
  // 同毫秒两次写入时追加序号，避免互相覆盖
  let seq = 1;
  while (existsSync(file)) {
    file = join(dir, base.replace(/\.json$/, `-${seq}.json`));
    seq += 1;
  }
  await writeFile(file, JSON.stringify(record, null, 2), 'utf8');
  return file;
}

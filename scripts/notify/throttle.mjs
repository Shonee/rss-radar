// scripts/notify/throttle.mjs — 去重 + 限频 + 每日上限 + 静默时段
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12.7（防刷屏）
//
// 规则：
//   - 条目级去重：realtime:<itemId> 一天内只推一次
//   - 事件级去重：daily:<date> 同一天不重复推
//   - 限频：同类实时提醒最小间隔 10 分钟，间隔内「合并」（由调用方决定合并/丢弃）
//   - 每日上限：realtime.maxPerDay（默认 10），超限「丢弃并记日志」
//   - 静默时段：quietHours（默认 23:00-07:00，跨午夜），实时静默，合并到次日日报
//
// shouldSend 只做「判定」，不修改状态；状态由调用方在发送成功后 applySend 落盘。

import { localDate, inQuietHours, toDate } from './lib/clock.mjs';

export const DEFAULT_MIN_REALTIME_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟
export const DEFAULT_MAX_PER_DAY = 10;
export const DEFAULT_QUIET_HOURS = '23:00-07:00';

/**
 * @typedef {Object} SendDecision
 * @property {boolean} allow
 * @property {string} [reason]  拒绝原因：duplicate-item|duplicate-event|rate-limited|daily-limit-exceeded|quiet-hours|unknown-event
 * @property {string} [key]     命中的幂等键（若适用）
 */

/**
 * 判定是否允许发送。
 * @param {Object} params
 * @param {Object} [params.state]   当前通知状态（见 lib/idempotency.mjs）
 * @param {'dailyReport'|'realtime'} params.event
 * @param {string} [params.itemId]  实时事件的条目 id
 * @param {Date|number|string} [params.now=new Date()]
 * @param {Object} [params.config]  notify 配置（读 realtime.maxPerDay / quietHours / minRealtimeIntervalMs / date）
 * @returns {SendDecision}
 */
export function shouldSend({ state = {}, event, itemId, now = new Date(), config = {} } = {}) {
  const sent = (state && state.sent) || {};
  const nowDate = toDate(now);
  const date = config.date ?? localDate(nowDate);

  if (event === 'dailyReport') {
    const key = `daily:${date}`;
    if (sent[key]) return { allow: false, reason: 'duplicate-event', key };
    return { allow: true, key };
  }

  if (event === 'realtime') {
    // 1) 静默时段（跨午夜）→ 实时静默
    const quietHours = config.quietHours ?? DEFAULT_QUIET_HOURS;
    if (inQuietHours(nowDate, quietHours)) {
      return { allow: false, reason: 'quiet-hours' };
    }

    // 2) 条目级去重
    if (itemId) {
      const key = `realtime:${itemId}`;
      if (sent[key]) return { allow: false, reason: 'duplicate-item', key };
    }

    // 3) 限频：最小间隔内合并
    const minInterval = Number.isFinite(config.minRealtimeIntervalMs)
      ? config.minRealtimeIntervalMs
      : DEFAULT_MIN_REALTIME_INTERVAL_MS;
    const lastSentAt = Number((state.realtime && state.realtime.lastSentAt) || 0) || 0;
    if (lastSentAt && nowDate.getTime() - lastSentAt < minInterval) {
      return { allow: false, reason: 'rate-limited' };
    }

    // 4) 每日上限
    const maxPerDay = Number.isFinite(config.realtime?.maxPerDay)
      ? config.realtime.maxPerDay
      : DEFAULT_MAX_PER_DAY;
    const sameDay = state.realtime && state.realtime.date === date;
    const count = sameDay ? Number(state.realtime.count || 0) : 0;
    if (count >= maxPerDay) {
      return { allow: false, reason: 'daily-limit-exceeded' };
    }

    return { allow: true, key: itemId ? `realtime:${itemId}` : undefined };
  }

  return { allow: false, reason: 'unknown-event' };
}

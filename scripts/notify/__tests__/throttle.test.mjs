// scripts/notify/__tests__/throttle.test.mjs — 去重 / 限频 / 每日上限 / 静默时段单测
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12.7
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import { shouldSend } from '../throttle.mjs';

const at = (local) => new Date(local); // 例：'2026-09-12T12:00:00+08:00'

describe('条目级去重（realtime:<itemId> 一天一次）', () => {
  test('已发送条目 → duplicate-item', () => {
    const state = { sent: { 'realtime:it_x': '2026-09-12T04:00:00.000Z' }, realtime: { date: '2026-09-12', count: 1, lastSentAt: 0 } };
    const d = shouldSend({ state, event: 'realtime', itemId: 'it_x', now: at('2026-09-12T12:00:00+08:00') });
    assert.equal(d.allow, false);
    assert.equal(d.reason, 'duplicate-item');
  });

  test('未发送条目 → allow', () => {
    const state = { sent: {}, realtime: { date: null, count: 0, lastSentAt: 0 } };
    const d = shouldSend({ state, event: 'realtime', itemId: 'it_new', now: at('2026-09-12T12:00:00+08:00') });
    assert.equal(d.allow, true);
    assert.equal(d.key, 'realtime:it_new');
  });
});

describe('事件级去重（daily:<date> 一天一次）', () => {
  test('同日已推日报 → duplicate-event', () => {
    const state = { sent: { 'daily:2026-09-12': '2026-09-12T00:00:00.000Z' }, realtime: {} };
    const d = shouldSend({ state, event: 'dailyReport', now: at('2026-09-12T12:00:00+08:00') });
    assert.equal(d.allow, false);
    assert.equal(d.reason, 'duplicate-event');
  });

  test('新日期 → allow', () => {
    const state = { sent: { 'daily:2026-09-11': 'x' }, realtime: {} };
    const d = shouldSend({ state, event: 'dailyReport', now: at('2026-09-12T12:00:00+08:00') });
    assert.equal(d.allow, true);
    assert.equal(d.key, 'daily:2026-09-12');
  });

  test('config.date 覆盖切日', () => {
    const state = { sent: { 'daily:2026-01-01': 'x' }, realtime: {} };
    const d = shouldSend({ state, event: 'dailyReport', now: at('2026-09-12T12:00:00+08:00'), config: { date: '2026-01-01' } });
    assert.equal(d.allow, false);
    assert.equal(d.reason, 'duplicate-event');
  });
});

describe('限频（同类实时最小间隔 10 分钟，间隔内合并）', () => {
  const t0 = at('2026-09-12T12:00:00+08:00').getTime();
  const baseState = { sent: {}, realtime: { date: '2026-09-12', count: 1, lastSentAt: t0 } };

  test('5 分钟内 → rate-limited（合并）', () => {
    const d = shouldSend({ state: baseState, event: 'realtime', itemId: 'it_a', now: t0 + 5 * 60 * 1000 });
    assert.equal(d.allow, false);
    assert.equal(d.reason, 'rate-limited');
  });

  test('刚过 10 分钟 → allow', () => {
    const d = shouldSend({ state: baseState, event: 'realtime', itemId: 'it_b', now: t0 + 11 * 60 * 1000 });
    assert.equal(d.allow, true);
  });

  test('lastSentAt=0（从未发送）不受限频影响', () => {
    const d = shouldSend({ state: { sent: {}, realtime: { date: null, count: 0, lastSentAt: 0 } }, event: 'realtime', itemId: 'it_c', now: t0 });
    assert.equal(d.allow, true);
  });
});

describe('每日上限（realtime.maxPerDay 默认 10，超限丢弃）', () => {
  test('已达上限 → daily-limit-exceeded', () => {
    const state = { sent: {}, realtime: { date: '2026-09-12', count: 10, lastSentAt: 0 } };
    const d = shouldSend({ state, event: 'realtime', itemId: 'it_z', now: at('2026-09-12T12:00:00+08:00'), config: { realtime: { maxPerDay: 10 } } });
    assert.equal(d.allow, false);
    assert.equal(d.reason, 'daily-limit-exceeded');
  });

  test('自定义 maxPerDay=3，count=3 → 超限', () => {
    const state = { sent: {}, realtime: { date: '2026-09-12', count: 3, lastSentAt: 0 } };
    const d = shouldSend({ state, event: 'realtime', itemId: 'it_z', now: at('2026-09-12T12:00:00+08:00'), config: { realtime: { maxPerDay: 3 } } });
    assert.equal(d.allow, false);
    assert.equal(d.reason, 'daily-limit-exceeded');
  });

  test('上一日计数不累加到今日', () => {
    const state = { sent: {}, realtime: { date: '2026-09-11', count: 99, lastSentAt: 0 } };
    const d = shouldSend({ state, event: 'realtime', itemId: 'it_z', now: at('2026-09-12T12:00:00+08:00'), config: { realtime: { maxPerDay: 10 } } });
    assert.equal(d.allow, true);
  });

  test('未达上限 → allow', () => {
    const state = { sent: {}, realtime: { date: '2026-09-12', count: 2, lastSentAt: 0 } };
    const d = shouldSend({ state, event: 'realtime', itemId: 'it_z', now: at('2026-09-12T12:00:00+08:00'), config: { realtime: { maxPerDay: 10 } } });
    assert.equal(d.allow, true);
  });
});

describe('静默时段（默认 23:00-07:00，跨午夜）', () => {
  const fresh = { sent: {}, realtime: { date: null, count: 0, lastSentAt: 0 } };

  test('22:59 允许', () => {
    const d = shouldSend({ state: fresh, event: 'realtime', itemId: 'q1', now: at('2026-09-12T22:59:00+08:00') });
    assert.equal(d.allow, true);
  });

  test('23:01 静默', () => {
    const d = shouldSend({ state: fresh, event: 'realtime', itemId: 'q2', now: at('2026-09-12T23:01:00+08:00') });
    assert.equal(d.allow, false);
    assert.equal(d.reason, 'quiet-hours');
  });

  test('次日 06:59 静默（跨午夜）', () => {
    const d = shouldSend({ state: fresh, event: 'realtime', itemId: 'q3', now: at('2026-09-13T06:59:00+08:00') });
    assert.equal(d.allow, false);
    assert.equal(d.reason, 'quiet-hours');
  });

  test('次日 07:01 允许（已解除静默）', () => {
    const d = shouldSend({ state: fresh, event: 'realtime', itemId: 'q4', now: at('2026-09-13T07:01:00+08:00') });
    assert.equal(d.allow, true);
  });

  test('同日区间 12:00-13:00 正午静默', () => {
    const cfg = { quietHours: '12:00-13:00' };
    assert.equal(shouldSend({ state: fresh, event: 'realtime', itemId: 'n1', now: at('2026-09-12T12:30:00+08:00'), config: cfg }).allow, false);
    assert.equal(shouldSend({ state: fresh, event: 'realtime', itemId: 'n2', now: at('2026-09-12T11:30:00+08:00'), config: cfg }).allow, true);
    assert.equal(shouldSend({ state: fresh, event: 'realtime', itemId: 'n3', now: at('2026-09-12T13:00:00+08:00'), config: cfg }).allow, true);
  });
});

describe('未知事件', () => {
  test('未知 event → unknown-event', () => {
    const d = shouldSend({ state: {}, event: 'weekly' });
    assert.equal(d.allow, false);
    assert.equal(d.reason, 'unknown-event');
  });
});

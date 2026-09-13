// T-P3-01 — time.ts 相对/绝对时间与上海时区单测（固定 now 注入）
import { describe, it, expect } from 'vitest';
import {
  formatAbsolute,
  formatRelative,
  hoursAgoIso,
  isSameShanghaiDay,
  shanghaiDateKey,
} from '../time';

describe('time — formatRelative 边界', () => {
  const now = '2026-09-14T10:00:00+08:00';

  it('刚刚（< 60s）', () => {
    expect(formatRelative('2026-09-14T09:59:30+08:00', now)).toBe('刚刚');
  });

  it('N 分钟前', () => {
    expect(formatRelative('2026-09-14T09:50:00+08:00', now)).toBe('10 分钟前');
  });

  it('N 小时前', () => {
    expect(formatRelative('2026-09-14T05:00:00+08:00', now)).toBe('5 小时前');
  });

  it('昨天 HH:mm（> 24h 且为前一自然日）', () => {
    expect(formatRelative('2026-09-13T06:00:00+08:00', now)).toBe('昨天 06:00');
  });

  it('跨月 → MM-DD', () => {
    expect(formatRelative('2026-08-20T06:00:00+08:00', now)).toBe('08-20');
  });

  it('跨年 → YYYY-MM-DD', () => {
    const nowJan = '2026-01-05T10:00:00+08:00';
    expect(formatRelative('2025-12-20T06:00:00+08:00', nowJan)).toBe('2025-12-20');
  });

  it('未来时间按 0 计 → 刚刚', () => {
    expect(formatRelative('2026-09-14T11:00:00+08:00', now)).toBe('刚刚');
  });

  it('空值 → —', () => {
    expect(formatRelative('', now)).toBe('—');
    expect(formatAbsolute('')).toBe('—');
  });
});

describe('time — formatAbsolute / 上海时区', () => {
  it('UTC 输入转 GMT+8 展示', () => {
    // 2026-09-13T17:26:12Z → 2026-09-14 01:26（+08）
    expect(formatAbsolute('2026-09-13T17:26:12Z')).toBe('2026-09-14 01:26（GMT+8）');
  });

  it('shanghaiDateKey 跨日换算', () => {
    expect(shanghaiDateKey('2026-09-13T17:26:12Z')).toBe('2026-09-14');
    expect(shanghaiDateKey('2026-09-13T15:59:59Z')).toBe('2026-09-13');
  });

  it('isSameShanghaiDay', () => {
    expect(isSameShanghaiDay('2026-09-13T17:26:12Z', '2026-09-14T01:00:00+08:00')).toBe(true);
    expect(isSameShanghaiDay('2026-09-13T17:26:12Z', '2026-09-13T01:00:00+08:00')).toBe(false);
  });
});

describe('time — hoursAgoIso', () => {
  it('按注入 now 计算', () => {
    const now = Date.parse('2026-09-14T10:00:00Z');
    expect(hoursAgoIso(6, now)).toBe('2026-09-14T04:00:00.000Z');
  });
});

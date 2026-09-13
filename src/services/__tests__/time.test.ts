// T-P3-01 — time.ts 相对/绝对时间与上海时区单测（固定 now 注入）
import { describe, it, expect } from 'vitest';
import {
  formatAbsolute,
  formatRelative,
  hoursAgoIso,
  isSameShanghaiDay,
  passesTimeRange,
  shanghaiDateKey,
  countByShanghaiDay,
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

describe('time — countByShanghaiDay（页面1 状态条「今日 N 条」口径）', () => {
  const date = '2026-09-14';

  it('全命中', () => {
    expect(
      countByShanghaiDay(
        [
          { updatedAt: '2026-09-14T01:00:00+08:00' },
          { publishedAt: '2026-09-13T17:00:00Z' }, // = 2026-09-14 01:00（+08）
          { updatedAt: '2026-09-14T23:59:00+08:00' },
        ],
        date,
      ),
    ).toBe(3);
  });

  it('全不命中', () => {
    expect(
      countByShanghaiDay(
        [
          { updatedAt: '2026-09-10T01:00:00+08:00' },
          { publishedAt: '2026-08-20T00:00:00Z' },
        ],
        date,
      ),
    ).toBe(0);
  });

  it('混合（部分命中）', () => {
    expect(
      countByShanghaiDay(
        [
          { updatedAt: '2026-09-14T09:00:00+08:00' }, // 命中
          { updatedAt: '2026-09-13T09:00:00+08:00' }, // 不命中（前一自然日）
          { publishedAt: '2026-09-13T16:30:00Z' }, // 命中（= 09-14 00:30 +08）
        ],
        date,
      ),
    ).toBe(2);
  });

  it('空数组', () => {
    expect(countByShanghaiDay([], date)).toBe(0);
  });

  it('updatedAt 优先回落 publishedAt；两者皆缺跳过', () => {
    expect(
      countByShanghaiDay(
        [
          { updatedAt: '2026-09-14T01:00:00+08:00', publishedAt: '2026-09-01T00:00:00Z' }, // 用 updatedAt → 命中
          { publishedAt: '2026-09-14T00:30:00+08:00' }, // 无 updatedAt → 用 publishedAt → 命中
          {}, // 无时间 → 跳过
          { updatedAt: '', publishedAt: '' }, // 空串 → 跳过
        ],
        date,
      ),
    ).toBe(2);
  });
});

describe('time — passesTimeRange（页面1 时间档过滤谓词）', () => {
  // now = 2026-09-14 10:00（+08）= 2026-09-14T02:00:00Z
  const ctx = { now: Date.parse('2026-09-14T10:00:00+08:00'), snapDate: '2026-09-14' };

  it("today：同一上海日命中（含 UTC 输入换算）", () => {
    expect(passesTimeRange({ updatedAt: '2026-09-14T09:00:00+08:00' }, 'today', ctx)).toBe(true);
    // 2026-09-13T16:00:00Z → 2026-09-14 00:00（+08），恰在上海日边界内
    expect(passesTimeRange({ publishedAt: '2026-09-13T16:00:00Z' }, 'today', ctx)).toBe(true);
  });

  it('today：跨上海日不命中（边界外侧）', () => {
    // 2026-09-13T15:59:59Z → 2026-09-13 23:59:59（+08），属前一自然日
    expect(passesTimeRange({ publishedAt: '2026-09-13T15:59:59Z' }, 'today', ctx)).toBe(false);
    expect(passesTimeRange({ updatedAt: '2026-09-10T09:00:00+08:00' }, 'today', ctx)).toBe(false);
  });

  it('today：缺失时间不命中', () => {
    expect(passesTimeRange({}, 'today', ctx)).toBe(false);
    expect(passesTimeRange({ updatedAt: '', publishedAt: '' }, 'today', ctx)).toBe(false);
  });

  it('3h：窗口内命中 / 超窗不命中', () => {
    expect(passesTimeRange({ updatedAt: '2026-09-14T08:30:00+08:00' }, '3h', ctx)).toBe(true); // 1.5h 前
    expect(passesTimeRange({ updatedAt: '2026-09-14T06:00:00+08:00' }, '3h', ctx)).toBe(false); // 4h 前
  });

  it('6h：窗口内命中 / 超窗不命中', () => {
    expect(passesTimeRange({ updatedAt: '2026-09-14T06:00:00+08:00' }, '6h', ctx)).toBe(true); // 4h 前
    expect(passesTimeRange({ updatedAt: '2026-09-14T03:00:00+08:00' }, '6h', ctx)).toBe(false); // 7h 前
  });

  it('all：恒为 true（含缺时间 / 陈年条目）', () => {
    expect(passesTimeRange({}, 'all', ctx)).toBe(true);
    expect(passesTimeRange({ updatedAt: '2020-01-01T00:00:00Z' }, 'all', ctx)).toBe(true);
  });

  it('3h/6h：非法时间与缺失时间不命中', () => {
    expect(passesTimeRange({ updatedAt: 'not-a-date' }, '3h', ctx)).toBe(false);
    expect(passesTimeRange({}, '6h', ctx)).toBe(false);
  });
});

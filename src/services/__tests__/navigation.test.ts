import { describe, expect, it } from 'vitest';
import { channelCardHref, timeRangeFromQuery } from '../navigation';

describe('navigation deep links', () => {
  it('查看全部深链显式使用全部时间范围', () => {
    expect(channelCardHref('channel/one')).toBe(
      '/#/?channel=channel%2Fone&timeRange=all',
    );
  });

  it('未知时间范围回落今天', () => {
    expect(timeRangeFromQuery('all')).toBe('all');
    expect(timeRangeFromQuery('today')).toBe('today');
    expect(timeRangeFromQuery('week')).toBe('today');
    expect(timeRangeFromQuery(null)).toBe('today');
  });
});

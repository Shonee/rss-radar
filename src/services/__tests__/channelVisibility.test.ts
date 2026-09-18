import { describe, expect, it } from 'vitest';
import { isSourceStale, shouldHideChannel } from '../channelVisibility';

const NOW = Date.parse('2026-09-18T00:00:00Z');

describe('channelVisibility', () => {
  it('hides failed channels with no items by default', () => {
    expect(
      shouldHideChannel({
        health: 'failed',
        itemCount: 0,
        lastUpdatedAt: null,
        showFailedEmpty: false,
        showStaleSources: false,
        staleSourceMonths: 12,
        nowMs: NOW,
      }),
    ).toBe(true);
    expect(
      shouldHideChannel({
        health: 'failed',
        itemCount: 0,
        lastUpdatedAt: null,
        showFailedEmpty: true,
        showStaleSources: false,
        staleSourceMonths: 12,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it('hides content older than the selected threshold and keeps unknown dates visible', () => {
    expect(isSourceStale('2025-09-17T23:59:59Z', 12, NOW)).toBe(true);
    expect(isSourceStale('2025-09-18T00:00:00Z', 12, NOW)).toBe(false);
    expect(isSourceStale(undefined, 12, NOW)).toBe(false);
    expect(
      shouldHideChannel({
        health: 'ok',
        itemCount: 1,
        lastUpdatedAt: '2025-09-17T23:59:59Z',
        showFailedEmpty: false,
        showStaleSources: false,
        staleSourceMonths: 12,
        nowMs: NOW,
      }),
    ).toBe(true);
  });
});

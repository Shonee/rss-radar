/** 页面2 渠道卡片的展示规则。 */

export type StaleSourceMonths = 6 | 12 | 24;

export const STALE_SOURCE_MONTH_OPTIONS: StaleSourceMonths[] = [6, 12, 24];

/**
 * 判断渠道最近一条内容是否超过配置的月份阈值。
 * 缺少或非法时间时返回 false：未知状态不应被静默隐藏。
 */
export function isSourceStale(
  lastUpdatedAt: string | null | undefined,
  months: StaleSourceMonths,
  nowMs = Date.now(),
): boolean {
  if (!lastUpdatedAt) return false;
  const updatedAtMs = Date.parse(lastUpdatedAt);
  if (!Number.isFinite(updatedAtMs)) return false;

  const cutoff = new Date(nowMs);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return updatedAtMs < cutoff.getTime();
}

export interface ChannelVisibilityInput {
  health: 'ok' | 'failed' | 'disabled' | 'empty';
  itemCount: number;
  lastUpdatedAt: string | null;
  showFailedEmpty: boolean;
  showStaleSources: boolean;
  staleSourceMonths: StaleSourceMonths;
  nowMs?: number;
}

/** 返回 true 表示该渠道应从页面2 卡片列表中隐藏。 */
export function shouldHideChannel({
  health,
  itemCount,
  lastUpdatedAt,
  showFailedEmpty,
  showStaleSources,
  staleSourceMonths,
  nowMs,
}: ChannelVisibilityInput): boolean {
  if (!showFailedEmpty && health === 'failed' && itemCount === 0) return true;
  if (
    !showStaleSources &&
    itemCount > 0 &&
    isSourceStale(lastUpdatedAt, staleSourceMonths, nowMs)
  ) {
    return true;
  }
  return false;
}

import type { TimeRangeKey } from './time';

/** 页面2「查看全部」使用的页面1 深链。 */
export function channelCardHref(channelId: string): string {
  return `/#/?channel=${encodeURIComponent(channelId)}&timeRange=all`;
}

/** 只接受页面1 支持的深链时间范围，未知值回落今天。 */
export function timeRangeFromQuery(value: string | null): TimeRangeKey {
  return value === 'all' ? 'all' : 'today';
}

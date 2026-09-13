// T-P3-08 前端基础设施 — useNotifyStats（通知状态只读；缺失时优雅降级）

import type { LoadResult } from '../types';
import {
  type NotifyStatsResult,
  emptyNotifyStats,
  fetchNotifyStats,
} from '../services/notifyStatsClient';
import { NOTIFY_STATS_KEY, useResource } from './useResource';

export interface NotifyStatsState {
  data: NotifyStatsResult | null;
  loading: boolean;
  error: string | null;
  /** true = 未取到任何 notify 产物（空态降级） */
  degraded: boolean;
  reload: () => void;
}

/** 通知状态（只读）。fetchNotifyStats 已内建降级，正常不会进入 error 分支。 */
export function useNotifyStats(): NotifyStatsState {
  const res = useResource<LoadResult<NotifyStatsResult>>(NOTIFY_STATS_KEY, () => fetchNotifyStats());
  return {
    data: res.data?.data ?? null,
    loading: res.loading,
    error: res.error,
    degraded: res.data?.data.degraded ?? true,
    reload: res.reload,
  };
}

export { emptyNotifyStats };

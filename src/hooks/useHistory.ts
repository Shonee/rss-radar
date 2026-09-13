// T-P3-01 前端基础设施 — useHistory（历史索引 / 归档索引 / 月度明细）

import type { DataSource, HistoryIndex, HistoryItem, LoadResult } from '../types';
import { fetchArchiveIndex, fetchHistoryIndex, fetchMonthItems } from '../services/historyClient';
import { ARCHIVE_INDEX_KEY, HISTORY_INDEX_KEY, useResource } from './useResource';

export interface HistoryIndexState {
  data: HistoryIndex | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  source: DataSource | null;
  reload: () => void;
}

/** 历史索引（页面4 首屏趋势，1 请求 ~25KB） */
export function useHistoryIndex(): HistoryIndexState {
  const res = useResource<LoadResult<HistoryIndex>>(HISTORY_INDEX_KEY, () => fetchHistoryIndex());
  return {
    data: res.data?.data ?? null,
    loading: res.loading,
    error: res.error,
    stale: res.stale,
    source: res.source,
    reload: res.reload,
  };
}

/** 归档索引（一年以外，可隐藏） */
export function useArchiveIndex(): HistoryIndexState {
  const res = useResource<LoadResult<HistoryIndex>>(ARCHIVE_INDEX_KEY, () => fetchArchiveIndex());
  return {
    data: res.data?.data ?? null,
    loading: res.loading,
    error: res.error,
    stale: res.stale,
    source: res.source,
    reload: res.reload,
  };
}

export interface MonthItemsState {
  data: HistoryItem[];
  loading: boolean;
  error: string | null;
  source: DataSource | null;
  reload: () => void;
}

/**
 * 月度明细（懒加载）。year / month 为 null 时不请求。
 * key 按月份区分，已拉月份不重复拉（TTL 内）。
 */
export function useMonthItems(year: number | null, month: number | null): MonthItemsState {
  const key = year !== null && month !== null ? `month-${year}-${String(month)}` : 'month-none';
  const loader = (): Promise<LoadResult<HistoryItem[]>> => {
    if (year === null || month === null) {
      return Promise.resolve({ data: [], source: 'local' as DataSource, fetchedAt: new Date().toISOString(), stale: false });
    }
    return fetchMonthItems(year, month);
  };
  const res = useResource<LoadResult<HistoryItem[]>>(key, loader);
  return {
    data: res.data?.data ?? [],
    loading: res.loading,
    error: res.error,
    source: res.source,
    reload: res.reload,
  };
}

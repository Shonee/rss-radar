// T-P3-01 前端基础设施 — useHistory（历史索引 / 归档索引 / 月度明细）

import { useEffect, useRef, useState } from 'react';
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

export interface MonthItemsStreamState {
  data: HistoryItem[];
  loading: boolean;
  error: string | null;
  /** 已解析条数（流式进度，逐行累加） */
  progress: number;
  source: DataSource | null;
}

/**
 * 月度明细「流式」加载（页面4 下钻）：暴露 onProgress，用于展示逐行加载进度。
 *
 * 与 useMonthItems 的区别：useMonthItems 走 resourceRegistry 缓存但不暴露进度；
 * 本 hook 直接消费 fetchMonthItems 的 onProgress，供下钻面板显示「已加载 N 条」。
 * year / month 为 null 时不请求；切换月份会 abort 上一次请求。
 */
export function useMonthItemsStream(
  year: number | null,
  month: number | null,
): MonthItemsStreamState {
  const [state, setState] = useState<MonthItemsStreamState>({
    data: [],
    loading: false,
    error: null,
    progress: 0,
    source: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (year === null || month === null) {
      setState({ data: [], loading: false, error: null, progress: 0, source: null });
      return undefined;
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    setState({ data: [], loading: true, error: null, progress: 0, source: null });

    fetchMonthItems(year, month, {
      onProgress: (n) => {
        if (mountedRef.current) setState((s) => ({ ...s, progress: n }));
      },
      signal: controller?.signal,
    })
      .then((res) => {
        if (mountedRef.current) {
          setState({
            data: res.data,
            loading: false,
            error: null,
            progress: res.data.length,
            source: res.source,
          });
        }
      })
      .catch((err: unknown) => {
        if (mountedRef.current && !controller?.signal.aborted) {
          setState({
            data: [],
            loading: false,
            error: err instanceof Error ? err.message : String(err),
            progress: 0,
            source: null,
          });
        }
      });

    return () => {
      mountedRef.current = false;
      controller?.abort();
    };
  }, [year, month]);

  return state;
}

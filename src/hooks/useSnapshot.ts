// T-P3-01 前端基础设施 — useSnapshot（当天投影快照）
//
// 与 useReport 共享 resourceRegistry 的 'latest' 键：同一页面内两者都调用时，
// loadLatest() 只会执行一次（in-flight 去重 + 60s TTL）。

import type { Snapshot } from '../types';
import type { DataSource, LatestBundle, LoadResult } from '../types';
import { loadLatest } from '../services/dataClient';
import { LATEST_KEY, useResource } from './useResource';

export interface SnapshotState {
  data: Snapshot | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  source: DataSource | null;
  reload: () => void;
}

export function useSnapshot(): SnapshotState {
  const res = useResource<LoadResult<LatestBundle>>(LATEST_KEY, () => loadLatest());
  return {
    data: res.data?.data.snap ?? null,
    loading: res.loading,
    error: res.error,
    stale: res.stale,
    source: res.source,
    reload: res.reload,
  };
}

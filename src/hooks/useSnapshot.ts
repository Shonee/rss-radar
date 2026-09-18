// T-P3-01 前端基础设施 — useSnapshot（当天投影快照）
//
// 使用独立的 'latest-snapshot' 键：报告属于页面3的非关键资源，不能拖慢页面1/2。

import type { Snapshot } from '../types';
import type { DataSource, LatestBundle, LoadResult } from '../types';
import { loadLatestSnapshot } from '../services/dataClient';
import { LATEST_SNAPSHOT_KEY, useResource } from './useResource';

export interface SnapshotState {
  data: Snapshot | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  source: DataSource | null;
  reload: () => void;
}

export function useSnapshot(): SnapshotState {
  const res = useResource<LoadResult<LatestBundle>>(LATEST_SNAPSHOT_KEY, () => loadLatestSnapshot());
  return {
    data: res.data?.data.snap ?? null,
    loading: res.loading,
    error: res.error,
    stale: res.stale,
    source: res.source,
    reload: res.reload,
  };
}

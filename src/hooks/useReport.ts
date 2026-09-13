// T-P3-01 前端基础设施 — useReport（当天报告；缺位时为 null，页面降级现算 hotScore）

import type { DataSource, LatestBundle, LoadResult, Report } from '../types';
import { loadLatest } from '../services/dataClient';
import { LATEST_KEY, useResource } from './useResource';

export interface ReportState {
  data: Report | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  source: DataSource | null;
  reload: () => void;
}

export function useReport(): ReportState {
  const res = useResource<LoadResult<LatestBundle>>(LATEST_KEY, () => loadLatest());
  return {
    data: res.data?.data.rep ?? null,
    loading: res.loading,
    error: res.error,
    stale: res.stale,
    source: res.source,
    reload: res.reload,
  };
}

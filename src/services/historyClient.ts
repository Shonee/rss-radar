// T-P3-01 前端基础设施 — 历史数据客户端（页面4 / 归档）
//
// 路径约定来源 config/site-config.json → history.*：
//   索引   history/history-index.json
//   归档   history/archive-index.json
//   月度   history/YYYY/MM/items.ndjson（流式逐行）
//   按天   history/YYYY/MM/snapshot-<date>.json / report-<date>.json
//
// 均支持 _fetch 注入 + 超时 + 三层基址（复用 dataClient 的 resolveOrder）。

import type { HistoryIndex, HistoryItem, Report, Snapshot } from '../types/models';
import type { DataSource, LoadResult } from '../types/api';
import {
  ARCHIVE_INDEX_PATH,
  HISTORY_INDEX_PATH,
  dayReportPath,
  daySnapshotPath,
  monthItemsPath,
} from '../config/site';
import {
  type LoadOptions,
  fetchRelativeJson,
  fetchRelativeNdjson,
} from './dataClient';

export interface HistoryOptions extends LoadOptions {
  onProgress?: (count: number) => void;
  signal?: AbortSignal;
}

function envelope<T>(data: T, source: DataSource): LoadResult<T> {
  return { data, source, fetchedAt: new Date().toISOString(), stale: false };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 历史索引（一年天级聚合，页面4 首屏趋势） */
export async function fetchHistoryIndex(
  options: HistoryOptions = {},
): Promise<LoadResult<HistoryIndex>> {
  const { json, source } = await fetchRelativeJson(HISTORY_INDEX_PATH, options);
  if (!isObject(json) || !Array.isArray(json['days'])) {
    throw new Error('history-index payload invalid');
  }
  return envelope(json as unknown as HistoryIndex, source);
}

/** 归档索引（一年以外的只读元数据） */
export async function fetchArchiveIndex(
  options: HistoryOptions = {},
): Promise<LoadResult<HistoryIndex>> {
  const { json, source } = await fetchRelativeJson(ARCHIVE_INDEX_PATH, options);
  if (!isObject(json) || !Array.isArray(json['days'])) {
    throw new Error('archive-index payload invalid');
  }
  return envelope(json as unknown as HistoryIndex, source);
}

/** 月度条目明细（NDJSON，流式逐行；onProgress 报告已解析条数） */
export async function fetchMonthItems(
  year: number,
  month: number,
  options: HistoryOptions = {},
): Promise<LoadResult<HistoryItem[]>> {
  const relPath = monthItemsPath(year, month);
  const { items, source } = await fetchRelativeNdjson<HistoryItem>(relPath, options);
  return envelope(items, source);
}

/** 按天快照（日历回看） */
export async function fetchDaySnapshot(
  date: string,
  options: HistoryOptions = {},
): Promise<LoadResult<Snapshot>> {
  const { json, source } = await fetchRelativeJson(daySnapshotPath(date), options);
  if (!isObject(json) || !Array.isArray(json['items'])) {
    throw new Error(`snapshot payload invalid for ${date}`);
  }
  return envelope(json as unknown as Snapshot, source);
}

/** 按天报告（日历回看） */
export async function fetchDayReport(
  date: string,
  options: HistoryOptions = {},
): Promise<LoadResult<Report | null>> {
  try {
    const { json, source } = await fetchRelativeJson(dayReportPath(date), options);
    if (!isObject(json) || !Array.isArray(json['hotList'])) return envelope<Report | null>(null, source);
    return envelope<Report | null>(json as unknown as Report, source);
  } catch {
    return envelope<Report | null>(null, 'local');
  }
}

/** 从历史索引构造趋势序列（页面4 直接消费） */
export interface TrendPoint {
  date: string;
  totalItems: number;
  activeChannels: number;
}

export function toTrendSeries(index: HistoryIndex, windowDays?: number): TrendPoint[] {
  const days = index.days ?? [];
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const sliced =
    typeof windowDays === 'number' && windowDays > 0 ? sorted.slice(-windowDays) : sorted;
  return sliced.map((d) => ({
    date: d.date,
    totalItems: d.totalItems,
    activeChannels: d.activeChannels,
  }));
}

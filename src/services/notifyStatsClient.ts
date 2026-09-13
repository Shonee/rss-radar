// T-P3-08 前端基础设施 — 通知状态只读客户端
//
// 数据来源（notify 模块产物，deploy 分支 data/stats/）：
//   stats/notify-state.json   —— 幂等状态：{ version, sent:{key:ISO}, realtime:{date,count,lastSentAt(ms)} }
//   stats/notify-latest.json  —— 可选「最近一次发送结果」聚合（summary{total,sent,failed,skipped} + results[]）；
//                                存在则用于展示成功/失败计数与逐渠道明细，缺位则从 state.sent 降级派生。
//
// 硬约束（ARCHITECTURE §12）：**纯只读**，绝不提供任何触发发送的按钮 / 链接。
// 三层降级（raw → jsDelivr → local）；两份文件都取不到时**优雅降级**为空态（degraded=true），
// 由 UI 呈现「暂无发送记录」，绝不抛错阻断页面。
//
// 注：state.sent 的键是「消息级幂等键」（daily:<date> / realtime:<itemId>），
// 不是渠道 id；逐渠道的成功/失败计数来自可选的 notify-latest.json summary。

import type { DataSource, LoadResult, NotifyRecord, NotifyStats } from '../types/api';
import { type LoadOptions, fetchRelativeJson } from './dataClient';
import notifyConfigJson from '../../config/notify.json';

/** 幂等状态文件相对路径（拼接三层基址：local → ./data/stats/notify-state.json） */
export const NOTIFY_STATE_PATH = 'stats/notify-state.json';
/** 可选的「最近一次发送结果」聚合文件相对路径 */
export const NOTIFY_LATEST_PATH = 'stats/notify-latest.json';

/** notify-state.json 形状（对齐 scripts/notify/lib/idempotency.mjs） */
interface NotifyStateShape {
  version: number;
  sent: Record<string, string>;
  realtime: { date: string | null; count: number; lastSentAt: number };
}

/** notify-<ISO>.json 单次发送结果形状（对齐 scripts/notify/index.mjs dispatch） */
interface NotifyRunRecord {
  schemaVersion?: string;
  generatedAt: string;
  event: string;
  idempotencyKey: string;
  date: string | null;
  summary: { total: number; sent: number; failed: number; skipped: number };
  results: Array<{
    channelId: string;
    channelType: string;
    ok: boolean;
    skipped: boolean;
    skipReason?: string | null;
    status?: number | null;
    error?: string | null;
    durationMs?: number;
  }>;
}

/** 面板消费结果：在 NotifyStats 基础上补充降级标记与来源计数 */
export interface NotifyStatsResult extends NotifyStats {
  /** true = 未取到任何 notify 产物（空态降级） */
  degraded: boolean;
  /** 已解析出的发送记录条数（仅用于展示） */
  recordCount: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 从 config/notify.json 统计启用渠道数（构建期内联，无网络请求） */
export function enabledChannelCount(): number {
  const channels = (notifyConfigJson as { channels?: Array<{ enabled?: boolean }> }).channels;
  if (!Array.isArray(channels)) return 0;
  return channels.filter((c) => c && c.enabled === true).length;
}

/** 启用渠道明细（页面「关于」展示用） */
export function enabledChannelIds(): string[] {
  const channels = (notifyConfigJson as { channels?: Array<{ id?: string; enabled?: boolean }> }).channels;
  if (!Array.isArray(channels)) return [];
  return channels.filter((c) => c && c.enabled === true).map((c) => c.id ?? '').filter(Boolean);
}

/** 空态统计（降级用） */
export function emptyNotifyStats(): NotifyStatsResult {
  return {
    lastSentAt: null,
    successCount: 0,
    failureCount: 0,
    enabledChannels: enabledChannelCount(),
    records: [],
    degraded: true,
    recordCount: 0,
  };
}

/** 规整任意外部对象为合法状态；缺失/类型错误补默认（与 idempotency.mjs 口径一致） */
function normalizeState(raw: unknown): NotifyStateShape | null {
  if (!isObject(raw)) return null;
  const sentRaw = isObject(raw['sent']) ? (raw['sent'] as Record<string, unknown>) : {};
  const sent: Record<string, string> = {};
  for (const [k, v] of Object.entries(sentRaw)) {
    if (typeof v === 'string') sent[k] = v;
  }
  const rt = isObject(raw['realtime']) ? (raw['realtime'] as Record<string, unknown>) : {};
  return {
    version: typeof raw['version'] === 'number' ? raw['version'] : 1,
    sent,
    realtime: {
      date: typeof rt['date'] === 'string' ? rt['date'] : null,
      count: typeof rt['count'] === 'number' ? rt['count'] : 0,
      lastSentAt: typeof rt['lastSentAt'] === 'number' ? rt['lastSentAt'] : 0,
    },
  };
}

/** 解析可选的最近一次发送结果文件 */
function parseRunRecord(raw: unknown): NotifyRunRecord | null {
  if (!isObject(raw)) return null;
  const summary = isObject(raw['summary']) ? (raw['summary'] as Record<string, unknown>) : null;
  if (!summary || !Array.isArray(raw['results'])) return null;
  return {
    schemaVersion: typeof raw['schemaVersion'] === 'string' ? raw['schemaVersion'] : undefined,
    generatedAt: typeof raw['generatedAt'] === 'string' ? raw['generatedAt'] : '',
    event: typeof raw['event'] === 'string' ? raw['event'] : '',
    idempotencyKey: typeof raw['idempotencyKey'] === 'string' ? raw['idempotencyKey'] : '',
    date: typeof raw['date'] === 'string' ? raw['date'] : null,
    summary: {
      total: typeof summary['total'] === 'number' ? summary['total'] : 0,
      sent: typeof summary['sent'] === 'number' ? summary['sent'] : 0,
      failed: typeof summary['failed'] === 'number' ? summary['failed'] : 0,
      skipped: typeof summary['skipped'] === 'number' ? summary['skipped'] : 0,
    },
    results: (raw['results'] as unknown[]).filter(isObject).map((r) => ({
      channelId: typeof r['channelId'] === 'string' ? r['channelId'] : '',
      channelType: typeof r['channelType'] === 'string' ? r['channelType'] : '',
      ok: r['ok'] === true,
      skipped: r['skipped'] === true,
      skipReason: typeof r['skipReason'] === 'string' ? r['skipReason'] : null,
      status: typeof r['status'] === 'number' ? r['status'] : null,
      error: typeof r['error'] === 'string' ? r['error'] : null,
      durationMs: typeof r['durationMs'] === 'number' ? r['durationMs'] : undefined,
    })),
  };
}

/** 从状态派生「最近发送时间」：优先 realtime.lastSentAt（ms），否则取 sent 里最大的 ISO */
function lastSentAtFromState(state: NotifyStateShape | null): string | null {
  if (!state) return null;
  if (state.realtime.lastSentAt > 0) {
    const d = new Date(state.realtime.lastSentAt);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  let max = '';
  for (const iso of Object.values(state.sent)) {
    if (iso && iso > max) max = iso;
  }
  return max || null;
}

/** 事件类型：daily:<date> → dailyReport，其余 → realtime */
function eventOfKey(key: string): 'dailyReport' | 'realtime' {
  return key.startsWith('daily:') ? 'dailyReport' : 'realtime';
}

/** 从状态派生的记录列表（消息级，无逐渠道信息） */
function recordsFromState(state: NotifyStateShape | null): NotifyRecord[] {
  if (!state) return [];
  return Object.entries(state.sent)
    .map(([key, iso]) => ({
      id: key,
      sentAt: iso,
      channelId: key,
      channelType: '—',
      event: eventOfKey(key),
      success: true,
    }))
    .sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0));
}

/** 从最近一次发送结果派生的逐渠道记录 */
function recordsFromRun(run: NotifyRunRecord | null): NotifyRecord[] {
  if (!run) return [];
  return run.results.map((r, i) => ({
    id: `${run.generatedAt}-${r.channelId}-${i}`,
    sentAt: run.generatedAt,
    channelId: r.channelId,
    channelType: r.channelType,
    event: run.event === 'realtime' ? 'realtime' : 'dailyReport',
    success: r.ok && !r.skipped,
    error: r.error ?? (r.skipped ? r.skipReason ?? 'skipped' : undefined) ?? undefined,
  }));
}

/** 组装最终面板数据 */
function buildStats(state: NotifyStateShape | null, run: NotifyRunRecord | null): NotifyStatsResult {
  const enabledChannels = enabledChannelCount();
  if (!state && !run) return emptyNotifyStats();

  const records = run ? recordsFromRun(run) : recordsFromState(state);
  const successCount = run ? run.summary.sent : Object.keys(state?.sent ?? {}).length;
  const failureCount = run ? run.summary.failed : 0;
  const lastSentAt = run?.generatedAt || lastSentAtFromState(state);

  return {
    lastSentAt: lastSentAt || null,
    successCount,
    failureCount,
    enabledChannels,
    records,
    degraded: false,
    recordCount: records.length,
  };
}

/**
 * 拉取通知状态（只读）。
 * 同时尝试 notify-state.json 与可选的 notify-latest.json；两者皆失败 → 空态降级，不抛错。
 */
export async function fetchNotifyStats(
  options: LoadOptions = {},
): Promise<LoadResult<NotifyStatsResult>> {
  let state: NotifyStateShape | null = null;
  let stateSource: DataSource = 'local';
  let run: NotifyRunRecord | null = null;
  let runSource: DataSource = 'local';

  try {
    const { json, source } = await fetchRelativeJson(NOTIFY_STATE_PATH, options);
    state = normalizeState(json);
    stateSource = source;
  } catch {
    state = null;
  }

  try {
    const { json, source } = await fetchRelativeJson(NOTIFY_LATEST_PATH, options);
    run = parseRunRecord(json);
    runSource = source;
  } catch {
    run = null;
  }

  const data = buildStats(state, run);
  const source: DataSource = state !== null ? stateSource : runSource;
  return {
    data,
    source,
    fetchedAt: new Date().toISOString(),
    stale: false,
  };
}

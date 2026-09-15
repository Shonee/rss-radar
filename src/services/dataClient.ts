// T-P3-01 前端基础设施 — 数据客户端（三层降级：raw 主 → jsDelivr 回退 → local 兜底）
//
// 严格对齐 ARCHITECTURE §6.3.3：
//   ① raw.githubusercontent.com（小指针文件 + 当天快照 / 报告，接受 ≤5min TTL）
//   ② jsDelivr 版本化 URL（用指针里的 commit，规避分支引用长缓存）
//   ③ 构建期内联 / dev bridge 的 ./data/（展示「数据可能非最新」横幅）
//
// 设计要点：
//   - fetch 可注入（{ _fetch }），便于单测 mock 失败序列（testId / test hook）
//   - 每次 fetch 加 AbortController 超时（默认 8000ms）
//   - location.protocol === 'file:' 时优先 local，避免白等网络超时
//   - 兼容两种 today 载荷：指针（含 snapshotPath）或「直接就是快照」（dev 软链）

import type { Report, Snapshot } from '../types/models';
import type { DataSource, LatestBundle, LatestPointer, LoadResult } from '../types/api';
import { SITE, jsdelivrBase, localBase, rawBase } from '../config/site';

export const DEFAULT_TIMEOUT_MS = 8000;
/**
 * generatedAt 超过 **120 分钟**判定 stale（ARCH §6.3.3）。
 *
 * 阈值语义 =「**两个采集周期未更新**」。采集为每小时一次（cron `7 * * * *`），
 * 正常运行时数据年龄本就会走到 60~90 分钟（轮询等待最多 60 分钟 + GitHub
 * Actions 调度延迟 5~30 分钟），原 60 分钟阈值在每小时采集下会**持续误报**
 * 「数据可能非最新」黄条。故随采集周期等比改为 2 × 60 = 120 分钟。
 */
export const STALE_THRESHOLD_MS = 120 * 60 * 1000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 所有 client 共用的可注入选项 */
export interface LoadOptions {
  _fetch?: FetchLike;
  timeoutMs?: number;
  now?: number;
  /** true=优先 local；false=强制 raw 优先；缺省按运行环境推断 */
  preferLocal?: boolean;
  /** jsDelivr 版本化 URL 用的 commit（指针提供时由调用方透传） */
  commit?: string;
}

/** 解析数据源尝试顺序 */
export function resolveOrder(options: LoadOptions): DataSource[] {
  if (options.preferLocal === true) return ['local', 'raw', 'jsdelivr'];
  if (options.preferLocal === false) return ['raw', 'jsdelivr', 'local'];
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return ['local', 'raw', 'jsdelivr'];
  }
  return ['raw', 'jsdelivr', 'local'];
}

function baseFor(source: DataSource, commit?: string): string {
  if (source === 'raw') return rawBase();
  if (source === 'jsdelivr') return jsdelivrBase(commit ?? SITE.branch);
  return localBase();
}

function resolveFetch(options: LoadOptions): FetchLike {
  if (options._fetch) return options._fetch;
  return (input, init) => fetch(input, init);
}

async function fetchWithTimeout(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const externalAbort = (): void => controller?.abort();
  if (controller && signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', externalAbort, { once: true });
  }
  try {
    return await fetchImpl(url, { cache: 'no-store', signal: controller?.signal });
  } finally {
    if (timer) clearTimeout(timer);
    if (controller && signal) signal.removeEventListener('abort', externalAbort);
  }
}

async function fetchJson(url: string, fetchImpl: FetchLike, timeoutMs: number): Promise<unknown> {
  const res = await fetchWithTimeout(url, fetchImpl, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// ---------- 载荷形状识别 ----------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isSnapshot(v: unknown): v is Snapshot {
  return isObject(v) && Array.isArray(v['items']) && isObject(v['stats']);
}

function isPointer(v: unknown): v is LatestPointer {
  return isObject(v) && typeof v['snapshotPath'] === 'string';
}

function isReport(v: unknown): v is Report {
  return isObject(v) && Array.isArray(v['hotList']) && typeof v['date'] === 'string';
}

/** generatedAt 是否过期（缺失 / 非法 / 超阈值均判 stale） */
export function isStale(generatedAt: string | undefined, nowMs: number): boolean {
  if (!generatedAt) return true;
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return true;
  return nowMs - t > STALE_THRESHOLD_MS;
}

// ---------- 单基址加载 ----------

interface BaseLoad {
  snap: Snapshot;
  rep: Report | null;
  pointer: LatestPointer;
}

async function loadFromBase(
  base: string,
  firstPath: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  onPointer?: (pointer: LatestPointer) => void,
): Promise<BaseLoad> {
  const first = await fetchJson(base + firstPath, fetchImpl, timeoutMs);

  let pointer: LatestPointer;
  let snap: Snapshot;

  if (isPointer(first)) {
    pointer = first;
    // 在继续拉快照前即上报指针：即使随后的快照失败，
    // 调用方也能拿到 commit 用于 jsDelivr 版本化回退。
    onPointer?.(pointer);
    const snapRaw = await fetchJson(base + pointer.snapshotPath, fetchImpl, timeoutMs);
    if (!isSnapshot(snapRaw)) throw new Error(`snapshot payload invalid: ${pointer.snapshotPath}`);
    snap = snapRaw;
  } else if (isSnapshot(first)) {
    // dev bridge：latest.json 是软链到快照本身
    snap = first;
    pointer = {
      date: snap.date,
      generatedAt: snap.generatedAt,
      snapshotPath: firstPath,
      reportPath: `today/report-${snap.date}.json`,
    };
    onPointer?.(pointer);
  } else {
    throw new Error(`unrecognized today payload: ${firstPath}`);
  }

  // report 缺位不算失败（当日报告可能尚未生成）
  let rep: Report | null = null;
  const reportRel = pointer.reportPath || (pointer.date ? `today/report-${pointer.date}.json` : '');
  if (reportRel) {
    try {
      const repRaw = await fetchJson(base + reportRel, fetchImpl, timeoutMs);
      if (isReport(repRaw)) rep = repRaw;
    } catch {
      rep = null;
    }
  }

  return { snap, rep, pointer };
}

/**
 * 加载「最新」数据：指针 + 当天投影快照 + 报告（三层降级）。
 * 全部来源失败时抛出最后一个错误。
 */
export async function loadLatest(options: LoadOptions = {}): Promise<LoadResult<LatestBundle>> {
  const fetchImpl = resolveFetch(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const nowMs = options.now ?? Date.now();
  const order = resolveOrder(options);

  let commit = options.commit;
  let lastError: Error = new Error('loadLatest: no source attempted');

  for (const source of order) {
    const base = baseFor(source, commit);
    // local 兜底：先试 latest.json（指针或直接快照），再退 P1 的 snapshot.json
    const paths = source === 'local' ? [SITE.pointerPath, 'today/snapshot.json'] : [SITE.pointerPath];
    for (const relPath of paths) {
      try {
        const loaded = await loadFromBase(base, relPath, fetchImpl, timeoutMs, (p) => {
          if (p.commit) commit = p.commit;
        });
        if (loaded.pointer.commit) commit = loaded.pointer.commit;
        return {
          data: { snap: loaded.snap, rep: loaded.rep, pointer: loaded.pointer },
          source,
          fetchedAt: new Date(nowMs).toISOString(),
          stale: isStale(loaded.pointer.generatedAt, nowMs),
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw lastError;
}

/**
 * 按三层顺序拉取任意相对路径的 JSON（history 等复用）。
 * 返回首个成功的 { json, source }。
 */
export async function fetchRelativeJson(
  relPath: string,
  options: LoadOptions = {},
): Promise<{ json: unknown; source: DataSource }> {
  const fetchImpl = resolveFetch(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const order = resolveOrder(options);
  let lastError: Error = new Error('fetchRelativeJson: no source');

  for (const source of order) {
    const base = baseFor(source, options.commit);
    try {
      const json = await fetchJson(base + relPath, fetchImpl, timeoutMs);
      return { json, source };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError;
}

/**
 * 按三层顺序流式解析任意相对路径的 NDJSON（history 月度明细复用）。
 * 逐行解析，边下边回调 onProgress。
 */
export async function fetchRelativeNdjson<T>(
  relPath: string,
  options: LoadOptions & { onProgress?: (count: number) => void; signal?: AbortSignal } = {},
): Promise<{ items: T[]; source: DataSource }> {
  const fetchImpl = resolveFetch(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const order = resolveOrder(options);
  let lastError: Error = new Error('fetchRelativeNdjson: no source');

  for (const source of order) {
    const base = baseFor(source, options.commit);
    try {
      const items = await streamNdjson<T>(
        base + relPath,
        fetchImpl,
        timeoutMs,
        options.onProgress,
        options.signal,
      );
      return { items, source };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError;
}

async function streamNdjson<T>(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  onProgress?: (count: number) => void,
  signal?: AbortSignal,
): Promise<T[]> {
  const res = await fetchWithTimeout(url, fetchImpl, timeoutMs, signal);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  const items: T[] = [];
  const push = (line: string): void => {
    const s = line.trim();
    if (!s) return;
    try {
      items.push(JSON.parse(s) as T);
      onProgress?.(items.length);
    } catch {
      /* 单行损坏不阻断整月（与 NDJSON 容错口径一致） */
    }
  };

  if (!res.body) {
    // 环境无 body 流（部分 mock / 旧运行时）：退化为一次性文本切行
    const text = await res.text();
    for (const line of text.split('\n')) push(line);
    return items;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n');
    while (idx >= 0) {
      push(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  push(buffer);
  return items;
}

/** 便捷：把 LoadResult 里的 snapshot 直接取出 */
export function snapshotOf(result: LoadResult<LatestBundle>): Snapshot {
  return result.data.snap;
}

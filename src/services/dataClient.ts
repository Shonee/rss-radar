// T-P3-01 前端基础设施 — 数据客户端
//
// 2026-09-16 起改为**按资源分流**的加载策略，取代原先「raw 优先 + 整链降级」。
// 起因是两项本机实测（见 docs/DESIGN-garss-integration-and-optimization.md §6）：
//
//   实测 A｜jsDelivr 的**分支引用**会返回陈旧内容
//     cdn.jsdelivr.net/gh/Shonee/rss-radar@deploy/today/latest.json
//       → age: 2467 且 body.generatedAt 落后 raw 直读 **9 小时以上**
//     故「指针」绝不能以 @branch 为主通道：指针一陈旧，整站加载到昨天的快照。
//
//   实测 B｜raw 不适合扛大文件
//     2.4MB 快照：raw 传输 13.6~16.4s（**不压缩**），短时间连续请求约 **1/3 连接级失败**
//     同一文件 jsDelivr：brotli 后仅 377KB（-84%）、1.9~2.2s
//     但 jsDelivr 只有用 **内容寻址**（@<commit>）才可靠 —— 分支引用见实测 A。
//
// 于是分成两条独立降级链：
//
//   【指针】today/latest.json（约 237B，必须新鲜）
//       raw → jsDelivr@branch → local
//       raw 只有 237B，不压缩也无所谓；它自身 cache-control=max-age=300 本就只有 5 分钟窗口。
//
//   【内容】snapshot / report（200KB ~ 2.4MB）
//       有效 commit：jsDelivr@<commit> → raw → local
//         内容寻址 ⇒ 同一 commit 内容永不变 ⇒ br 压缩 + 边缘长期缓存
//       无效 commit：raw → jsDelivr@branch → local
//         ⚠️ 生产指针曾长期是 `"commit": "local"`（collect.yml 从未回填真实 sha），
//            而 jsdelivrBase('local') → https://cdn.jsdelivr.net/gh/<o>/<r>@local/ → **404**，
//            等于第二层降级此前 100% 失效。isValidCommit() 专门拦这种情况。
//
// 其余设计要点（沿用）：
//   - fetch 可注入（{ _fetch }），便于单测 mock 失败序列（testId / test hook）
//   - 每次 fetch 加 AbortController 超时
//   - location.protocol === 'file:' 时优先 local，避免白等网络超时
//   - 兼容两种 today 载荷：指针（含 snapshotPath）或「直接就是快照」（dev 软链）
//   - 缓存：指针 no-cache（存本地但每次条件请求校验）；内容 default（交给 HTTP 头：
//     jsDelivr@commit 给 7 天，raw 给 5 分钟）；local no-cache（本地调试要即时）

import type { Report, Snapshot } from '../types/models';
import type { DataSource, LatestBundle, LatestPointer, LoadResult } from '../types/api';
import { CDN_HOST_BY_SOURCE, SITE, cdnBase, localBase, rawBase } from '../config/site';

/**
 * 指针 / 小文件超时。
 *
 * 原为 8000ms，2026-09-16 下调到 3500ms：实测 jsDelivr 同文件 TTFB 0.74~0.78s、
 * total 1.9~2.2s，3.5s 已覆盖 P95。原 8s 的代价是「首个通道卡住时必须干等满 8 秒
 * 才降级」——这正是「打开就转圈」的直接来源。
 */
export const DEFAULT_TIMEOUT_MS = 3500;

/**
 * 大文件（快照 / 报告）超时。
 *
 * 保留较宽窗口：jsDelivr 对**新 commit 的首次请求**要回源（实测 10.4s）。
 * 内容寻址下这只发生在每个 commit 的第一次，之后全部边缘命中。
 */
export const CONTENT_TIMEOUT_MS = 12000;

/**
 * generatedAt 超过 **120 分钟**判定 stale（ARCH §6.3.3）。
 *
 * 阈值语义 =「**两个采集周期未更新**」。采集为每小时一次（cron `7 * * * *`），
 * 正常运行时数据年龄本就会走到 60~90 分钟（轮询等待最多 60 分钟 + GitHub
 * Actions 调度延迟 5~30 分钟），原 60 分钟阈值在每小时采集下会**持续误报**
 * 「数据可能非最新」黄条。故随采集周期等比改为 2 × 60 = 120 分钟。
 */
export const STALE_THRESHOLD_MS = 120 * 60 * 1000;

/** fetch 的缓存模式（对齐 RequestInit['cache']） */
type CacheMode = 'no-cache' | 'default' | 'no-store';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 所有 client 共用的可注入选项 */
export interface LoadOptions {
  _fetch?: FetchLike;
  /** 指针 / 小文件超时（缺省 DEFAULT_TIMEOUT_MS） */
  timeoutMs?: number;
  /** 内容 / 大文件超时（缺省 CONTENT_TIMEOUT_MS） */
  contentTimeoutMs?: number;
  now?: number;
  /** true=优先 local；false=强制远程优先；缺省按运行环境推断 */
  preferLocal?: boolean;
  /** jsDelivr 版本化 URL 用的 commit（指针提供时由调用方透传） */
  commit?: string;
}

// ---------- commit 有效性 ----------

/**
 * commit 是否可用于 jsDelivr 的**内容寻址** URL。
 *
 * 必须过滤占位值，否则会构造出必然 404 的地址。两个已知占位来源：
 *   - `scripts/collect/project-snapshot.mjs` 的默认值 `commit: 'local'`
 *   - 分支名本身（`@deploy` 是**引用**而非内容地址，会被 jsDelivr 长期缓存 → 陈旧）
 *
 * ⚠️ 2026-09-16 实测生产指针仍是 `"commit": "local"`，也就是本函数上线前
 *    「第二层降级」从未真正工作过：raw 失败 → jsDelivr@local 404 → 直接掉 local 兜底。
 */
export function isValidCommit(commit: string | undefined | null): boolean {
  if (typeof commit !== 'string') return false;
  const c = commit.trim();
  if (!c) return false;
  if (c === SITE.branch) return false;
  // git sha（短 7 位 ~ 完整 40 位）；jsDelivr 也接受 tag，但本仓库只用 sha
  return /^[0-9a-f]{7,40}$/i.test(c);
}

function isFileProtocol(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'file:';
}

// ---------- 来源顺序（两条独立链） ----------

/** CDN 家族来源（顺序即降级顺序；与 config/site.ts 的 CDN_HOSTS 一一对应） */
const CDN_SOURCES: readonly DataSource[] = ['fastly', 'gcore', 'jsdelivr'];

/**
 * 指针文件的来源顺序：**CDN 打头，raw 退居后备**。
 *
 * 2026-09-16 实测（杭州）后重排。原顺序是 `raw 打头`，理由是「jsDelivr 对分支引用
 * 返回陈旧内容，指针一陈旧整站就加载旧快照」。该理由本身没错 —— 当日复测
 * `cdn.jsdelivr.net` 上的指针确实仍陈旧 14 小时 —— 但**代价被低估了**：raw 在国内
 * 会连接挂起（实测 `http=000`、60s 无任何响应），把它排在首位等于让每次首访都白等
 * 一个完整超时才降级，这正是「第一次打开转圈」的直接来源。
 *
 * 重排后同时拿下两点：
 *   ① `fastly` / `gcore` 边缘的指针是**实时**的（age=0），并非「CDN 一律陈旧」；
 *   ② 它们更快（0.90s / 0.99s，走东京节点）。
 *
 * ⚠️ 但「CDN 打头」能成立的前提是**新鲜度校验**：CDN 的陈旧风险依然存在且各家边缘
 * 表现不一致，故 `loadLatest` 阶段 1 会用 isStale() 校验 generatedAt，陈旧即继续
 * 降级到下一来源。这道校验与本顺序是一体两面 —— 去掉校验，这个顺序就会加载到旧快照。
 */
export function resolvePointerOrder(options: LoadOptions): DataSource[] {
  if (options.preferLocal === true) return ['local', ...CDN_SOURCES, 'raw'];
  if (isFileProtocol()) return ['local', ...CDN_SOURCES, 'raw'];
  return [...CDN_SOURCES, 'raw', 'local'];
}

/**
 * 不可变内容路径：形如 `today/snapshot-2026-09-16-0347.json` /
 * `today/report-2026-09-16-0347.json`。
 *
 * 后缀是 4 位 UTC `HHmm`（由采集端 `lib/time.mjs` 的 `stampFromIso()` 生成），
 * 每小时唯一 ⇒ **URL 本身即内容地址** ⇒ 可被 CDN 安全长缓存。
 *
 * 这是 2026-09-16 实测驱动出的契约：固定文件名 + `max-age=604800` 会让前端
 * 拿到落后 9 小时以上的陈旧数据（`age: 2467`），而带唯一后缀的路径会正常回源。
 */
const IMMUTABLE_CONTENT_RE = /\/(?:snapshot|report)-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;

/**
 * 该内容路径是否**不可变**（带唯一后缀 ⇒ 内容不会原地变化）。
 *
 * 可变路径（如历史遗留的 `today/snapshot-<date>.json`）**绝不可**走长缓存通道，
 * 否则会命中 CDN 缓存的旧内容。
 */
export function isImmutablePath(relPath: string | undefined | null): boolean {
  return typeof relPath === 'string' && IMMUTABLE_CONTENT_RE.test(relPath);
}

/**
 * 内容文件（快照 / 报告）的来源顺序。
 *
 * CDN 打头需要**两个条件之一**成立，否则会拿到陈旧数据：
 *   ① 有效 commit → `@<commit>` 内容寻址（同一 commit 内容永不变）
 *   ② 路径不可变（带小时戳后缀）→ 新内容 = 新 URL = 必然回源
 * 两者都不满足时只能走 raw：`@branch` 会被 CDN 按 URL 缓存数小时，
 * `@<占位值>`（如 `@local`）直接 404。
 *
 * 内容侧的多域名顺序没有指针侧那种顾虑 —— 条件 ①/② 一旦成立，URL 即内容地址，
 * 任何边缘拿到的都是同一份，故 fastly/gcore 打头纯粹是拿它们的速度。
 */
export function resolveContentOrder(
  options: LoadOptions,
  commit?: string,
  contentPath?: string | null,
): DataSource[] {
  if (options.preferLocal === true) return ['local', ...CDN_SOURCES, 'raw'];
  if (isFileProtocol()) return ['local', ...CDN_SOURCES, 'raw'];
  if (isValidCommit(commit) || isImmutablePath(contentPath)) {
    return [...CDN_SOURCES, 'raw', 'local'];
  }
  return ['raw', ...CDN_SOURCES, 'local'];
}

/**
 * 远程优先的通用顺序（保留导出以兼容既有调用方与单测）。
 *
 * 新代码请按资源类型选用 resolvePointerOrder / resolveContentOrder ——
 * 「指针」与「内容」对陈旧度的容忍度完全不同，不该共用一个顺序。
 */
export function resolveOrder(options: LoadOptions): DataSource[] {
  return resolveContentOrder(options, options.commit);
}

function baseFor(source: DataSource, commit?: string): string {
  if (source === 'raw') return rawBase();
  if (source === 'local') return localBase();
  // CDN 家族（fastly / gcore / jsdelivr）：仅域名不同，URL 构造规则一致。
  // ⚠️ 只有**有效** commit 才能进 URL —— 把占位值（如 'local'）拼进去会构造出
  // 必然 404 的地址（`@local`），这正是本函数此前让第二层降级 100% 失效的原因。
  // 无有效 commit 时退回分支引用；此时能否安全长缓存改由「路径是否不可变」决定
  // （见 isImmutablePath / resolveContentOrder）。
  const host = CDN_HOST_BY_SOURCE[source as 'fastly' | 'gcore' | 'jsdelivr'];
  return cdnBase(host, isValidCommit(commit) ? (commit as string) : SITE.branch);
}

/** 各来源的缓存模式：本地调试要即时，远程交给 HTTP 头 */
function cacheModeFor(source: DataSource, isPointer: boolean): CacheMode {
  if (source === 'local') return 'no-cache';
  // 指针必须每次校验（它决定整站加载哪份快照）；内容交给 HTTP 头，
  // 这样 jsDelivr@<commit> 的 max-age=604800 才能真正生效。
  return isPointer ? 'no-cache' : 'default';
}

function resolveFetch(options: LoadOptions): FetchLike {
  if (options._fetch) return options._fetch;
  return (input, init) => fetch(input, init);
}

async function fetchWithTimeout(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  cache: CacheMode,
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
    return await fetchImpl(url, { cache, signal: controller?.signal });
  } finally {
    if (timer) clearTimeout(timer);
    if (controller && signal) signal.removeEventListener('abort', externalAbort);
  }
}

async function fetchJson(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  cache: CacheMode,
): Promise<unknown> {
  const res = await fetchWithTimeout(url, fetchImpl, timeoutMs, cache);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * 浅重试：**只重试「快速失败」**。
 *
 * 依据实测 B：raw 对短时间连续请求会出现约 1/3 的**连接级**失败（`http=000`），
 * 连 48KB 的小文件也会中招。这类失败通常立即返回，重试一次成本极低。
 *
 * 但**超时类失败不重试** —— 它已经花掉一整个超时窗口，再重试只会让等待翻倍，
 * 正确的动作是尽快降级到下一个通道。
 */
async function withQuickRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    const startedAt = Date.now();
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (Date.now() - startedAt >= 1000) break;
    }
  }
  throw lastErr;
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

// ---------- 单基址加载（拆成「指针」与「内容」两阶段） ----------

interface PointerLoad {
  pointer: LatestPointer;
  /** dev bridge：latest.json 直接就是快照本身，无需再拉一次 */
  inlineSnap: Snapshot | null;
}

/** 阶段 1：只取指针（或识别出 dev bridge 的内联快照） */
async function fetchPointerFromBase(
  base: string,
  relPath: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  source: DataSource,
): Promise<PointerLoad> {
  const first = await fetchJson(base + relPath, fetchImpl, timeoutMs, cacheModeFor(source, true));

  if (isPointer(first)) {
    return { pointer: first, inlineSnap: null };
  }
  if (isSnapshot(first)) {
    // dev bridge：latest.json 是软链到快照本身。
    // 报告路径取快照**自带的声明**（2026-09-16 起采集端写入），刻意不猜固定名：
    // 报告名已带 4 位 UTC 后缀，按 `report-<date>.json` 猜会 404，或静默命中
    // 遗留的同名陈旧文件。老快照无该字段 → 空串 → 本次不拉报告（重跑采集即有）。
    return {
      pointer: {
        date: first.date,
        generatedAt: first.generatedAt,
        snapshotPath: relPath,
        reportPath: first.reportPath ?? '',
      },
      inlineSnap: first,
    };
  }
  throw new Error(`unrecognized today payload: ${relPath}`);
}

/** 阶段 2：按已确定的指针取快照 + 报告 */
async function fetchContentFromBase(
  base: string,
  pointer: LatestPointer,
  inlineSnap: Snapshot | null,
  fetchImpl: FetchLike,
  timeoutMs: number,
  source: DataSource,
): Promise<{ snap: Snapshot; rep: Report | null }> {
  let snap = inlineSnap;
  if (!snap) {
    const snapRaw = await fetchJson(
      base + pointer.snapshotPath,
      fetchImpl,
      timeoutMs,
      cacheModeFor(source, false),
    );
    if (!isSnapshot(snapRaw)) throw new Error(`snapshot payload invalid: ${pointer.snapshotPath}`);
    snap = snapRaw;
  }

  // report 缺位不算失败（当日报告可能尚未生成）
  let rep: Report | null = null;
  // 只认声明式路径，缺省即跳过。**刻意不做「按日期猜固定名」的 fallback**：
  // 报告名带 4 位 UTC 后缀后，猜出来的名字要么 404，要么静默命中遗留的
  // 同名陈旧文件（回归断言 A4 曾被 903 条旧数据污染，就是这条摘掉了）。
  const reportRel = pointer.reportPath ?? '';
  if (reportRel) {
    try {
      const repRaw = await fetchJson(
        base + reportRel,
        fetchImpl,
        timeoutMs,
        cacheModeFor(source, false),
      );
      if (isReport(repRaw)) rep = repRaw;
    } catch {
      rep = null;
    }
  }

  return { snap, rep };
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * 加载「最新」数据：指针 + 当天投影快照 + 报告。
 *
 * 两条独立的降级链（见文件头注释）：
 *   1) 指针：raw 打头（必须新鲜），拿到 commit
 *   2) 内容：commit 有效则 jsDelivr@<commit> 打头（内容寻址 + br 压缩 + 长缓存）
 *
 * 返回的 `source` 描述**内容（快照）的来源** —— 它才是页面渲染的主体。
 * 全部来源失败时抛出最后一个错误。
 */
export async function loadLatest(options: LoadOptions = {}): Promise<LoadResult<LatestBundle>> {
  const fetchImpl = resolveFetch(options);
  const nowMs = options.now ?? Date.now();
  const pointerTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const contentTimeout = options.contentTimeoutMs ?? CONTENT_TIMEOUT_MS;

  let commit = options.commit;
  let lastError: Error = new Error('loadLatest: no source attempted');

  // ---------- 阶段 1：指针 ----------
  let pointer: LatestPointer | null = null;
  let inlineSnap: Snapshot | null = null;
  let pointerSource: DataSource = 'local';
  /** 首个「成功但已过期」的指针：全部来源都过期时兜底用它（陈旧数据优于无数据） */
  let staleFallback: { pointer: LatestPointer; inlineSnap: Snapshot | null; source: DataSource } | null = null;

  for (const source of resolvePointerOrder(options)) {
    // local 兜底：先试 latest.json（指针或直接快照），再退 P1 的 snapshot.json
    const paths = source === 'local' ? [SITE.pointerPath, 'today/snapshot.json'] : [SITE.pointerPath];
    for (const relPath of paths) {
      try {
        const loaded = await withQuickRetry(() =>
          fetchPointerFromBase(baseFor(source, commit), relPath, fetchImpl, pointerTimeout, source),
        );
        // ★ 新鲜度校验：「请求成功」不等于「可用」。
        // CDN 对分支引用存在长缓存，且各家边缘表现不一致（2026-09-16 实测
        // cdn.jsdelivr.net 的指针陈旧 14 小时、而 fastly/gcore 实时），而指针一旦
        // 陈旧，**整站都会加载到旧快照**。故这里必须看 generatedAt，不能只要 HTTP 200
        // 就用：过期就记下兜底、继续降级到下一个来源找更新鲜的。
        if (isStale(loaded.pointer.generatedAt, nowMs)) {
          if (!staleFallback) {
            staleFallback = { pointer: loaded.pointer, inlineSnap: loaded.inlineSnap, source };
          }
          continue;
        }
        pointer = loaded.pointer;
        inlineSnap = loaded.inlineSnap;
        pointerSource = source;
        if (loaded.pointer.commit) commit = loaded.pointer.commit;
        break;
      } catch (err) {
        lastError = toError(err);
      }
    }
    if (pointer) break;
  }

  // 全部来源都过期 → 用最早拿到的那个兜底。此时不静默：isStale() 会把 stale=true
  // 一路透传到 UI，由界面提示「数据已过期」，而不是假装成新鲜数据。
  if (!pointer && staleFallback) {
    pointer = staleFallback.pointer;
    inlineSnap = staleFallback.inlineSnap;
    pointerSource = staleFallback.source;
    if (pointer.commit) commit = pointer.commit;
  }

  if (!pointer) throw lastError;

  // ---------- 阶段 2：内容 ----------
  // dev bridge 的内联快照本身已含数据，此时**不再遍历内容通道** —— 否则
  // fetchContentFromBase 里「report 取不到就被吞掉」的容错会让列表第一个通道
  // 假成功，source 被误报（实测：local 内联快照会被报成 raw）。
  let snap: Snapshot | null = inlineSnap;
  let rep: Report | null = null;
  let source: DataSource = pointerSource;

  if (snap) {
    const loaded = await fetchContentFromBase(
      baseFor(pointerSource, commit),
      pointer,
      snap,
      fetchImpl,
      contentTimeout,
      pointerSource,
    );
    rep = loaded.rep;
  } else {
    for (const candidate of resolveContentOrder(options, commit, pointer.snapshotPath)) {
      try {
        const loaded = await fetchContentFromBase(
          baseFor(candidate, commit),
          pointer,
          null,
          fetchImpl,
          contentTimeout,
          candidate,
        );
        snap = loaded.snap;
        rep = loaded.rep;
        source = candidate;
        break;
      } catch (err) {
        lastError = toError(err);
      }
    }
  }

  if (!snap) throw lastError;

  return {
    data: { snap, rep, pointer },
    source,
    fetchedAt: new Date(nowMs).toISOString(),
    stale: isStale(pointer.generatedAt, nowMs),
  };
}

/**
 * 按降级顺序拉取任意相对路径的 JSON（history 等复用）。
 * 返回首个成功的 { json, source }。
 */
export async function fetchRelativeJson(
  relPath: string,
  options: LoadOptions = {},
): Promise<{ json: unknown; source: DataSource }> {
  const fetchImpl = resolveFetch(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const order = resolveContentOrder(options, options.commit);
  let lastError: Error = new Error('fetchRelativeJson: no source');

  for (const source of order) {
    const base = baseFor(source, options.commit);
    try {
      const json = await fetchJson(base + relPath, fetchImpl, timeoutMs, cacheModeFor(source, false));
      return { json, source };
    } catch (err) {
      lastError = toError(err);
    }
  }

  throw lastError;
}

/**
 * 按降级顺序流式解析任意相对路径的 NDJSON（history 月度明细复用）。
 * 逐行解析，边下边回调 onProgress。
 */
export async function fetchRelativeNdjson<T>(
  relPath: string,
  options: LoadOptions & { onProgress?: (count: number) => void; signal?: AbortSignal } = {},
): Promise<{ items: T[]; source: DataSource }> {
  const fetchImpl = resolveFetch(options);
  const timeoutMs = options.contentTimeoutMs ?? options.timeoutMs ?? CONTENT_TIMEOUT_MS;
  const order = resolveContentOrder(options, options.commit);
  let lastError: Error = new Error('fetchRelativeNdjson: no source');

  for (const source of order) {
    const base = baseFor(source, options.commit);
    try {
      const items = await streamNdjson<T>(
        base + relPath,
        fetchImpl,
        timeoutMs,
        cacheModeFor(source, false),
        options.onProgress,
        options.signal,
      );
      return { items, source };
    } catch (err) {
      lastError = toError(err);
    }
  }

  throw lastError;
}

async function streamNdjson<T>(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  cache: CacheMode,
  onProgress?: (count: number) => void,
  signal?: AbortSignal,
): Promise<T[]> {
  const res = await fetchWithTimeout(url, fetchImpl, timeoutMs, cache, signal);
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

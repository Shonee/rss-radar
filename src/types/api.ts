// T-P3-01 前端基础设施 — 前端视图模型（不与 models.ts 重复，仅做派生 / 封装）
//
// models.ts 是 9 份 schema 的直译；本文件是「页面消费层」的派生类型，
// 把 Item / HotItem / DayAgg 等压缩成卡片直接可渲染的形状。

import type {
  CategoryKey,
  HotItem,
  HotScoreComponents,
  Item,
  ItemSource,
  Report,
  Snapshot,
  UrlStatus,
} from './models';

// ---------- 通用加载状态 ----------

/** 资源加载状态机 */
export type LoadState = 'idle' | 'loading' | 'ok' | 'error';

/**
 * 数据来源。
 *
 * 2026-09-16 起不再是一条固定链，而是**按资源分流**的两条独立降级链
 * （见 `src/services/dataClient.ts` 文件头）：
 *   - 指针 `today/latest.json` → raw 打头（必须新鲜；jsDelivr@branch 实测陈旧 9 小时+）
 *   - 内容 snapshot / report → 有有效 commit 时 jsDelivr@<commit> 打头（内容寻址 + br 压缩）
 * `LoadResult.source` 描述**内容（快照）的来源**。
 */
export type DataSource = 'raw' | 'jsdelivr' | 'local';

/** 统一的加载结果信封（所有 client 均返回此结构） */
export interface LoadResult<T> {
  data: T;
  source: DataSource;
  fetchedAt: string;
  /** generatedAt 超过 120 分钟（两个采集周期，或缺失）判定为过期 */
  stale: boolean;
}

/** today/latest.json 指针（字段以 scripts/collect/project-snapshot.mjs 实际产物为准） */
export interface LatestPointer {
  date: string;
  generatedAt: string;
  snapshotPath: string;
  /**
   * 同轮次报告路径（相对 `data/`，形如 `today/report-<date>-<stamp>.json`）。
   *
   * 2026-09-16 起权威指针必带；但**老指针 / 软链降级产物可能缺省**，
   * 故按「可选」处理：缺省时不拉报告，**切勿**按 `report-<date>.json`
   * 的固定名反推（会 404，或静默命中遗留同名陈旧文件）。
   */
  reportPath?: string;
  eventPath?: string;
  /**
   * 采集轮次 commit（jsDelivr 内容寻址 URL 用）。
   *
   * ⚠️ 必须是**远端真实存在的 git sha**。占位值（如 `'local'`）会让
   * `jsdelivrBase(commit)` 构造出 404 地址 —— 消费前请用
   * `dataClient.isValidCommit()` 校验。
   */
  commit?: string;
}

/** loadLatest() 的聚合产物 */
export interface LatestBundle {
  snap: Snapshot;
  /** 报告可能缺位（当日尚未生成），缺位时前端降级现算 hotScore */
  rep: Report | null;
  pointer: LatestPointer;
}

// ---------- 页面1 / 页面2：卡片视图模型 ----------

/** ItemCard 渲染数据（从 Item 派生） */
export interface ItemCardData {
  id: string;
  title: string;
  summary?: string;
  /** 最终点击地址 = alternateUrl ?? url */
  href: string;
  /** 原始 url（用于判断是否切换了备用地址） */
  url: string;
  alternateUrl: string | null;
  channelId: string;
  channelName: string;
  category: CategoryKey[];
  publishedAt: string;
  updatedAt: string;
  status: UrlStatus;
  sourceCount: number;
  isNew: boolean;
  sources?: ItemSource[];
}

/** 从 Item 生成 ItemCardData（统一降级渲染入口，ARCH §15.4） */
export function toItemCardData(item: Item): ItemCardData {
  const alternateUrl = item.alternateUrl ?? null;
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    href: alternateUrl ?? item.url,
    url: item.url,
    alternateUrl,
    channelId: item.channelId,
    channelName: item.channelName,
    category: item.category ?? [],
    publishedAt: item.publishedAt,
    updatedAt: item.updatedAt,
    status: item.urlStatus ?? 'unknown',
    sourceCount: item.sourceCount ?? 1,
    isNew: item.isNew === true,
    sources: item.sources,
  };
}

/** 渠道健康状态 */
export type ChannelHealth = 'ok' | 'failed' | 'disabled' | 'empty';

/** ChannelCard 渲染数据 */
export interface ChannelCardData {
  channelId: string;
  channelName: string;
  icon?: string;
  homepage: string;
  feedUrl?: string;
  categories: CategoryKey[];
  lastUpdatedAt: string | null;
  todayCount: number;
  health: ChannelHealth;
  items: ItemCardData[];
}

// ---------- 页面3：热点榜视图模型 ----------

export interface HotItemData {
  rank: number;
  id: string;
  title: string;
  url: string;
  href: string;
  channelId: string;
  channelName: string;
  category?: CategoryKey[];
  hotScore: number;
  sourceCount: number;
  channelNames?: string[];
  publishedAt?: string;
  components?: HotScoreComponents;
}

export function toHotItemData(hot: HotItem): HotItemData {
  return {
    rank: hot.rank,
    id: hot.id,
    title: hot.title,
    url: hot.url,
    href: hot.url,
    channelId: hot.channelId,
    channelName: hot.channelName,
    category: hot.category,
    hotScore: hot.hotScore,
    sourceCount: hot.sourceCount,
    channelNames: hot.channelNames,
    publishedAt: hot.publishedAt,
    components: hot.components,
  };
}

// ---------- 页面4：历史趋势视图模型 ----------

export interface TrendDay {
  date: string;
  totalItems: number;
  activeChannels: number;
  categoryStats?: Record<string, number>;
  topKeywords?: string[];
}

export interface MonthBucket {
  /** 'YYYY-MM' */
  month: string;
  itemCount: number;
  loaded: boolean;
  items: ItemCardData[];
}

// ---------- 页面2 / 通知面板：只读状态 ----------

export interface NotifyRecord {
  id: string;
  sentAt: string;
  channelId: string;
  channelType: string;
  event: 'dailyReport' | 'realtime';
  success: boolean;
  error?: string;
}

/** T-P3-08 通知状态面板只读数据（先放此处备用） */
export interface NotifyStats {
  lastSentAt: string | null;
  successCount: number;
  failureCount: number;
  enabledChannels: number;
  records: NotifyRecord[];
}

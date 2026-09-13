// 数据模型类型定义 — 手写覆盖 docs/data-model/schema/*.schema.json 全部 9 份
// JSDoc 注释指向对应 schema 路径，便于维护
// ARCHITECTURE §2.4 — 时间字段统一 ISO 8601 UTC string

// ---------- 通用 ----------

/**
 * 分类枚举（与 sources.schema.json #/definitions/categoryKey 对齐，13 个取值）
 *
 * 前 8 个为 **MVP 启用集**，与 config/categories.json + config/keyword-rules.json 一致：
 *   tech_blog / ai / news / dev_community / podcast / newsletter / finance / other
 * 后 5 个为 **预留扩展位**，当前无渠道使用：
 *   tech_media / product_design / video / security / opensource
 */
export type CategoryKey =
  | 'tech_blog'
  | 'ai'
  | 'news'
  | 'dev_community'
  | 'podcast'
  | 'newsletter'
  | 'finance'
  | 'other'
  | 'tech_media'
  | 'product_design'
  | 'video'
  | 'security'
  | 'opensource';

/**
 * Source.type 枚举
 *
 * 取值必须与 scripts/collect/connectors/registry.mjs 注册的 type 完全一致。
 * 注意是 `generic_api` 而不是 `api`（T-P2-07 注册名）。
 */
export type SourceType =
  | 'rss'
  | 'atom'
  | 'json_feed'
  | 'local_json'
  | 'local_csv'
  | 'feishu_bitable'
  | 'notion_db'
  | 'generic_api';

/** URL 健康状态（v1.4 新增） */
export type UrlStatus = 'ok' | 'dead' | 'moved' | 'blocked';

/** 来源语言 BCP-47 */
export type Language = string;

// ---------- 1. sources.json ----------
// schema: docs/data-model/schema/sources.schema.json

export interface Category {
  key: CategoryKey;
  label: string;
  color?: string;
}

export interface Channel {
  id: string;
  name: string;
  homepage: string;
  category: CategoryKey[];
  enabled: boolean;
  displayLimit?: number;
  icon?: string;
  language?: Language;
  weight?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthRef {
  type: 'none' | 'env' | 'actions_secret' | 'bearer_env' | 'header_env' | 'query_env';
  ref?: string;
  headerName?: string;
  scheme?: string;
  note?: string;
}

export interface FieldMapping {
  mode: 'jsonpath' | 'table' | 'header';
  itemsPath?: string;
  map: Record<string, string>;
  typeCoercion?: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'array'>;
  defaults?: Record<string, unknown>;
}

export interface Pagination {
  strategy: 'none' | 'page' | 'offset' | 'cursor' | 'link_header';
  pageParam?: string;
  pageSizeParam?: string;
  pageSize?: number;
  offsetParam?: string;
  cursorParam?: string;
  cursorPath?: string;
  maxPages?: number;
}

export interface Source {
  id: string;
  channelId: string;
  name: string;
  type: SourceType;
  url: string;
  enabled: boolean;
  auth?: AuthRef;
  fieldMapping?: FieldMapping;
  interval?: number;
  language?: Language;
  pagination?: Pagination;
  headers?: Record<string, string>;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastFetchAt?: string;
  lastStatus?: 'ok' | 'error' | 'empty' | 'unknown';
  lastError?: string;
  etag?: string;
  lastModified?: string;
}

export interface SourcesConfig {
  schemaVersion: string;
  generatedAt: string;
  categories?: Category[];
  channels: Channel[];
  sources: Source[];
}

// ---------- 2. snapshot.json ----------
// schema: docs/data-model/schema/snapshot.schema.json

export interface SourceStat {
  channelId: string;
  channelName: string;
  ok: boolean;
  itemCount: number;
  error?: string;
}

export interface SnapshotStats {
  sourceTotal: number;
  sourceOk: number;
  sourceFailed: number;
  itemsBeforeDedup: number;
  itemsAfterDedup: number;
  mergedCount?: number;
  durationMs?: number;
  sources?: SourceStat[];
}

export interface ItemSource {
  channelId: string;
  channelName: string;
  url: string;
  publishedAt?: string;
}

export interface Item {
  id: string;
  guid?: string;
  title: string;
  url: string;
  summary?: string;
  author?: string;
  channelId: string;
  channelName: string;
  category: CategoryKey[];
  publishedAt: string;
  updatedAt: string;
  fetchedAt: string;
  sourceUrl?: string;
  sourceType?: SourceType;
  tags?: string[];
  dedupKey: string;
  duplicateOf?: string | null;
  sourceCount?: number;
  sources?: ItemSource[];
  isNew?: boolean;
  hotScore?: number | null;
  language?: Language;
  mediaType?: 'article' | 'video' | 'podcast' | 'release' | 'post' | 'other';
  // v1.4 新增
  urlStatus?: UrlStatus;
  urlCheckedAt?: string;
  // P2-B T-P2-09: 跨源备用 URL 展示层替换（item.url 失效时由 pickAlternate 派生）
  // - 不回写 item.url（避免 dedupKey 漂移）
  // - 该字段是前端渲染层使用，原始溯源信息仍保留在 sources[]
  alternateUrl?: string | null;
}

export interface Snapshot {
  schemaVersion: string;
  date: string;
  timezone: 'Asia/Shanghai';
  generatedAt: string;
  stats: SnapshotStats;
  items: Item[];
}

// ---------- 3. report.json ----------
// schema: docs/data-model/schema/report.schema.json

export interface HotScoreComponents {
  sourceOverlap: number;
  frequency: number;
  recency: number;
  channelWeight: number;
  keywordHeat: number;
}

export interface HotScoreWeights {
  sourceOverlap: number;
  frequency: number;
  recency: number;
  channelWeight: number;
  keywordHeat: number;
  halfLifeHours: number;
}

export interface HotItem {
  rank: number;
  id: string;
  title: string;
  url: string;
  channelId: string;
  channelName: string;
  category?: CategoryKey[];
  hotScore: number;
  sourceCount: number;
  channelNames?: string[];
  publishedAt?: string;
  components?: HotScoreComponents;
}

export interface KeywordEntry {
  word: string;
  count: number;
  weight?: number;
}

export interface CrossSourceEntry {
  topic: string;
  sourceCount: number;
  itemIds: string[];
  channelNames?: string[];
}

export interface ChannelActivity {
  channelId: string;
  channelName: string;
  category?: CategoryKey[];
  itemCount: number;
  lastUpdatedAt?: string;
  activityScore?: number;
}

export interface CategoryStat {
  category: CategoryKey;
  label?: string;
  itemCount: number;
  channelCount: number;
  ratio: number;
}

export interface Report {
  schemaVersion: string;
  date: string;
  timezone: 'Asia/Shanghai';
  generatedAt: string;
  totalItems: number;
  activeChannels: number;
  windowStart?: string;
  windowEnd?: string;
  weights?: HotScoreWeights;
  categoryStats: CategoryStat[];
  hotList: HotItem[];
  keywords?: KeywordEntry[];
  crossSource?: CrossSourceEntry[];
  channelActivity?: ChannelActivity[];
  summary?: string;
}

// ---------- 4. exclude-rules.json ----------
// schema: docs/data-model/schema/exclude-rules.schema.json

export type ExcludeLevel = 'channel' | 'item' | 'category';
export type ExcludeType = 'keyword' | 'domain' | 'url' | 'title_regex';
export type ExcludeMatchMode = 'contains' | 'equals' | 'regex';
export type ExcludeScope =
  | 'global'
  | `source:${string}`
  | `channel:${string}`
  | `category:${string}`;

export interface ExcludeRule {
  id: string;
  level: ExcludeLevel;
  scope: ExcludeScope;
  type?: ExcludeType;
  value?: string | string[];
  matchMode?: ExcludeMatchMode;
  caseSensitive?: boolean;
  enabled: boolean;
  note?: string;
  hitCount?: number;
}

export interface ExcludeConfig {
  schemaVersion: string;
  updatedAt?: string;
  rules: ExcludeRule[];
}

// ---------- 5. site-config.json ----------
// schema: docs/data-model/schema/site-config.schema.json

export interface SiteConfig {
  schemaVersion: string;
  site: {
    title: string;
    slogan: string;
    baseUrl?: string;
    dataBranch?: string;
    timezone: 'Asia/Shanghai';
    footer?: string;
  };
  display?: {
    defaultChannels?: string[];
    cardLimit?: number;
    page1BatchSize?: number;
    defaultSort?: 'updatedAt' | 'publishedAt';
    hotListSize?: number;
    showWordCloud?: boolean;
    showSummary?: boolean;
    density?: 'comfortable' | 'compact';
  };
  filters?: {
    enabledCategories?: CategoryKey[];
    timeRanges?: Array<'today' | '3h' | '6h' | '24h'>;
  };
  analysis?: {
    hotListSize?: number;
    keywordTopN?: number;
    titleSimilarityThreshold?: number;
    summaryMaxChars?: number;
    halfLifeHours?: number;
    weights?: HotScoreWeights;
    useLLM?: boolean;
  };
  network?: {
    timeoutMs?: number;
    retries?: number;
    concurrency?: number;
    userAgent?: string;
    respectRobots?: boolean;
  };
  deploy?: {
    branch?: string;
    dataBaseUrl?: string;
    pointerPath?: string;
  };
  history?: {
    windowDays?: number;
    windowOptions?: number[];
    visibleDays?: number;
    showArchive?: boolean;
    indexPath?: string;
    archiveIndexPath?: string;
  };
  notify?: {
    dailyReportTime?: string;
    quietHours?: string;
    realtime?: {
      enabled?: boolean;
      hotScoreThreshold?: number;
      sourceCountThreshold?: number;
      maxPerDay?: number;
    };
  };
}

// ---------- 6. history-index.json ----------
// schema: docs/data-model/schema/history-index.schema.json

export interface DayAgg {
  date: string;
  totalItems: number;
  activeChannels: number;
  categoryStats?: Record<string, number>;
  topKeywords?: string[];
  topIds?: string[];
  sourceOk?: number;
  sourceFailed?: number;
}

export interface ArchiveEntry {
  year: number;
  releaseTag: string;
  releaseUrl: string;
  months: Array<{
    month: string;
    itemCount: number;
    bytes?: number;
    sha256?: string;
  }>;
  generatedAt?: string;
}

export interface HistoryIndex {
  schemaVersion: string;
  updatedAt: string;
  days: DayAgg[];
  archives?: ArchiveEntry[];
}

// ---------- 7. history-item (NDJSON 单行) ----------
// schema: docs/data-model/schema/history-item.schema.json

export interface HistoryItem {
  id: string;
  dedupKey: string;
  title: string;
  url: string;
  channelId: string;
  channelName: string;
  category: CategoryKey[];
  publishedAt: string;
  updatedAt: string;
  sourceCount?: number;
  hotScore?: number | null;
  date: string;
}

// ---------- 8. notify.json ----------
// schema: docs/data-model/schema/notify.schema.json

export interface NotifyRefs {
  [logicalKey: string]: string;
}

export interface NotifyChannel {
  id: string;
  channelType: 'email' | 'feishu' | 'dingtalk' | 'wecom';
  enabled: boolean;
  events: Array<'dailyReport' | 'realtime'>;
  refs: NotifyRefs;
  // email 渠道
  smtpHost?: string;
  smtpPort?: number;
  secure?: boolean;
  from?: string;
  to?: string[];
  // webhook 渠道（飞书/钉钉/企业微信）
  webhookRef?: string;
  signSecretRef?: string;
  // 企业微信应用消息
  corpId?: string;
  agentId?: string;
  toUser?: string;
  toParty?: string;
  // 通用
  quietHours?: string;
  severity?: 'info' | 'warn' | 'critical';
}

export interface NotifyConfig {
  schemaVersion: string;
  defaults?: {
    timezone?: string;
    dailyReportTime?: string;
    retry?: {
      max?: number;
      backoffMs?: number[];
    };
  };
  channels: NotifyChannel[];
  realtime?: {
    enabled?: boolean;
    hotScoreThreshold?: number;
    sourceCountThreshold?: number;
    maxPerDay?: number;
  };
  quietHours?: string;
}

// ---------- 9. categories.json ----------
// 站点级 categories（轻量版，区别于 sources.json 中 categories）

export interface CategoryConfig {
  schemaVersion: string;
  categories: Category[];
}
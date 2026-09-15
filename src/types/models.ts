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

/**
 * URL 健康状态（v1.4 新增，ARCH §15.2 状态机）
 *
 * `pendingDead` 是内部防抖态：首轮 404/410 落它，下轮仍失败才转 `dead`。
 * 必须可持久化到 `source.lastStatus`，否则两轮防抖动跨轮失效。
 */
export type UrlStatus = 'ok' | 'dead' | 'moved' | 'blocked' | 'pendingDead' | 'unknown';

/** Source.lastStatus：UrlStatus 全集（与 sources.schema.json 对齐） */
export type SourceLastStatus = UrlStatus;

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
  /**
   * 自由标签（非受控词表，仅作展示/检索；正式分类请用 `category`）。
   * 承载外部源清单导入时的原始标签，如 `['Mac', '软件下载']`。
   */
  tags?: string[];
  /** 渠道自由描述（如「已断更，最新文章 2024 年」），来自外部源清单导入，不参与采集逻辑 */
  description?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 鉴权配置。形状随 `source.type` 而变（权威说明见 docs/SOURCES.md §6）：
 * - `generic_api` → `{ kind, tokenEnv | token, valueEnv, headerName }`
 * - `feishu_bitable` → `{ appId, appSecret, tokenType, tokenUrl }`
 * - `notion_db` → `{ token }`
 * 声明式 `{ type, ref, headerName, scheme, note }` 仍被接受（旧配置兼容）。
 * ⚠️ 绝不允许把明文密钥提交进仓库，用 tokenEnv/valueEnv 引用环境变量。
 */
export interface AuthRef {
  /** 声明式旧字段（generic_api 不读取） */
  type?: 'none' | 'env' | 'actions_secret' | 'bearer_env' | 'header_env' | 'query_env';
  ref?: string;
  headerName?: string;
  scheme?: string;
  note?: string;
  /** generic_api 真实读取的鉴权方式 */
  kind?: 'none' | 'bearer' | 'api_key';
  token?: string;
  tokenEnv?: string;
  value?: string;
  valueEnv?: string;
  /** feishu_bitable */
  appId?: string;
  appSecret?: string;
  tokenType?: string;
  tokenUrl?: string;
}

/** 字段路径：字符串取单层键，数组逐层下钻（如 `['fields','标题']`、`['properties','Name','title',0,'plain_text']`） */
export type FieldPath = string | Array<string | number>;

/**
 * 异构源 → 内部 Item 字段的映射。⚠️ 两种形状并存，按 `source.type` 定（见 docs/SOURCES.md §6）：
 * - `local_json` / `local_csv` → `{ itemsPath, map, typeCoercion, defaults }`（①）
 * - `feishu_bitable` / `notion_db` / `generic_api` → **顶层** `<内部字段>: FieldPath`（②）
 *
 * 把 ① 的形状用在 ② 的连接器上会被**静默忽略**、标题退化为 `(untitled)`；
 * `npm run validate` 的语义守卫（`scripts/validate-schema.mjs` `checkSourceShapes`）会拦截这种写法。
 */
export interface FieldMapping {
  // ---- ① local_json / local_csv 形状 ----
  /** ① 使用；② 的连接器不读取 */
  mode?: 'jsonpath' | 'table' | 'header';
  itemsPath?: string;
  map?: Record<string, string>;
  typeCoercion?: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'array'>;
  defaults?: Record<string, unknown>;
  // ---- ② feishu_bitable / notion_db / generic_api 顶层形状 ----
  id?: FieldPath;
  title?: FieldPath;
  url?: FieldPath;
  summary?: FieldPath;
  publishedAt?: FieldPath;
  author?: FieldPath;
  tags?: FieldPath;
  /** ② 形状允许任意内部字段名 */
  [internalField: string]: unknown;
}

/**
 * 分页/翻页策略。⚠️ `generic_api` 真实读取的是 `kind`（及其配套参数），
 * 不是声明式的 `strategy`（见 docs/SOURCES.md §6）。
 */
export interface Pagination {
  /** 声明式旧字段；generic_api 不读取 */
  strategy?: 'none' | 'page' | 'offset' | 'cursor' | 'link_header';
  /** generic_api 真实读取的分页方式 */
  kind?: 'none' | 'page' | 'offset' | 'cursor' | 'link_header';
  pageParam?: string;
  pageSizeParam?: string;
  pageSize?: number;
  offsetParam?: string;
  cursorParam?: string;
  cursorPath?: string;
  maxPages?: number;
  // ---- generic_api 配套参数 ----
  paramName?: string;
  size?: number;
  sizeParamName?: string;
  startAt?: number;
  totalPath?: FieldPath;
  limitParam?: string;
  limit?: number;
  responsePath?: FieldPath;
  headerName?: string;
  relNext?: string;
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
  /** 仅 generic_api：HTTP 方法，默认 GET */
  method?: 'GET' | 'POST';
  /** 仅 generic_api：响应中条目数组的路径，默认 ['data'] */
  itemListPath?: FieldPath;
  /** 仅 notion_db：query body（filter / sorts） */
  body?: Record<string, unknown>;
  /** 仅 notion_db：每页条数（Notion 上限 100） */
  pageSize?: number;
  /** 仅 feishu_bitable：附加查询参数，如 { page_size: 200 } */
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastFetchAt?: string;
  lastStatus?: SourceLastStatus;
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

/**
 * `stats.sources[]` 元素 —— 「**条目归并后的渠道分布**」。
 *
 * ⚠ 语义提醒：这是**条目维度**（哪些渠道产出了条目、各多少条），不是「逐源抓取健康度」。
 * 页面1 状态条的「共 N 个渠道」用它；「抓取失败黄条」**不应**用它（见 `SourceHealth`）。
 *
 * `ok` / `error` 是 v1.4 预留的历史字段：生产路径 `project-snapshot.mjs`
 * 的 `computeSources()` 并**不产出** `ok`（只出 channelId/channelName/itemCount），
 * 因此这里把 `ok` 标为可选，避免「类型承诺必填、运行时缺失」的契约漂移。
 * 逐源成功/失败请读 `stats.sourceHealth[]`。
 */
export interface SourceStat {
  channelId: string;
  channelName: string;
  itemCount: number;
  ok?: boolean;
  error?: string;
}

/**
 * `stats.sourceHealth[]` 元素 —— 「**逐源**抓取健康度」（T-P3-fix 新增）。
 *
 * 由采集端 `main.mjs` 的 `runPool` 真实结果（`collectOne` 返回）汇总而来，
 * 是页面1「本次抓取失败 N 个渠道」黄条的数据来源。
 * 与 `sources[]` 是两个维度：一个 source 对应一个 channel，但一个 channel 可有多个 source。
 */
export interface SourceHealth {
  sourceId: string;
  channelId: string;
  channelName: string;
  ok: boolean;
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
  /**
   * 逐源抓取健康度（T-P3-fix）。采集端传入真实逐源结果时产出；
   * 老快照 / e2e 回落路径可能缺失 → 消费方需按「可选」处理。
   */
  sourceHealth?: SourceHealth[];
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
    hotListSize?: number;
    showWordCloud?: boolean;
    showSummary?: boolean;
    density?: 'comfortable' | 'compact';
  };
  filters?: {
    enabledCategories?: CategoryKey[];
    timeRanges?: Array<'today' | 'all'>;
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
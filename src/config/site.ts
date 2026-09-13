// T-P3-01 前端基础设施 — 站点常量 + 数据基址（新增支撑文件）
//
// 为什么新增此文件：ARCHITECTURE §6.3.3 / §13.2 要求前端在「不重新构建」下
// 通过三层基址（raw → jsDelivr → local）读取独立 `deploy` 分支数据。把基址与
// 路径约定集中到一处，便于 dataClient / historyClient 复用与测试注入，避免
// 页面层散落硬编码 URL。owner/repo 可用 VITE_DATA_OWNER / VITE_DATA_REPO 覆盖
// （fork 场景），默认指向本仓库。

import siteConfigJson from '../../config/site-config.json';
import type { CategoryKey, HotScoreWeights } from '../types/models';
import type { TimeRangeKey } from '../services/time';

/** 站点常量（branch 固定 deploy；pointerPath 与 config/site-config.json 对齐） */
export const SITE = {
  owner: import.meta.env.VITE_DATA_OWNER ?? 'Shonee',
  repo: import.meta.env.VITE_DATA_REPO ?? 'rss-radar',
  branch: (siteConfigJson.deploy?.branch as string | undefined) ?? 'deploy',
  pointerPath: (siteConfigJson.deploy?.pointerPath as string | undefined) ?? 'today/latest.json',
} as const;

/** raw.githubusercontent.com 主基址（末尾带 /） */
export function rawBase(): string {
  return `https://raw.githubusercontent.com/${SITE.owner}/${SITE.repo}/${SITE.branch}/`;
}

/** jsDelivr 版本化基址（必须用 commit / tag，规避分支引用长缓存，末尾带 /） */
export function jsdelivrBase(commit: string): string {
  return `https://cdn.jsdelivr.net/gh/${SITE.owner}/${SITE.repo}@${commit}/`;
}

/** 本地 / 构建期内联兜底基址（Vite 把 public/ 暴露为 ./） */
export function localBase(): string {
  return './data/';
}

// ---------- history 路径约定（来源 config/site-config.json → history.*） ----------

export const HISTORY_INDEX_PATH: string =
  (siteConfigJson.history?.indexPath as string | undefined) ?? 'history/history-index.json';

export const ARCHIVE_INDEX_PATH: string =
  (siteConfigJson.history?.archiveIndexPath as string | undefined) ?? 'history/archive-index.json';

export const HISTORY_WINDOW_OPTIONS: number[] =
  (siteConfigJson.history?.windowOptions as number[] | undefined) ?? [90, 180, 365];

/** 补零到 2 位 */
export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 月度 NDJSON 明细路径：history/YYYY/MM/items.ndjson */
export function monthItemsPath(year: number, month: number): string {
  return `history/${year}/${pad2(month)}/items.ndjson`;
}

/** 按天快照路径：history/YYYY/MM/snapshot-<date>.json */
export function daySnapshotPath(date: string): string {
  const [y, m] = date.split('-');
  return `history/${y ?? '0000'}/${m ?? '00'}/snapshot-${date}.json`;
}

/** 按天报告路径：history/YYYY/MM/report-<date>.json */
export function dayReportPath(date: string): string {
  const [y, m] = date.split('-');
  return `history/${y ?? '0000'}/${m ?? '00'}/report-${date}.json`;
}

// ---------- 展示 / 筛选 / 分析默认值（来源 config/site-config.json） ----------

/** display.cardLimit 默认值 */
export const DEFAULT_CARD_LIMIT: number = siteConfigJson.display?.cardLimit ?? 10;

/** display.page1BatchSize 默认值 */
export const DEFAULT_PAGE1_BATCH_SIZE: number = siteConfigJson.display?.page1BatchSize ?? 20;

/** display.defaultSort 默认值 */
export const DEFAULT_SORT: 'updatedAt' | 'publishedAt' =
  (siteConfigJson.display?.defaultSort as 'updatedAt' | 'publishedAt' | undefined) ?? 'updatedAt';

/** 已启用分类（空数组表示全部） */
export const ENABLED_CATEGORIES: CategoryKey[] =
  (siteConfigJson.filters?.enabledCategories as CategoryKey[] | undefined) ?? [];

/** 时间范围选项（prototype F 决策：展示「今天 / 近3小时 / 近6小时」）。
 *
 * P1-1 起**固定追加「全部」档**：由于采集端无条目时间窗过滤，快照条目天然跨日期，
 * 默认「今天」在数据陈旧时可能恒为 0；「全部」作为「今天为 0」时的逃生出口，
 * 必须始终可选，因此不依赖 `config` 是否声明（详见 docs/PRD.md 页面1 筛选说明）。 */
export const TIME_RANGES: TimeRangeKey[] = (() => {
  const configured = (siteConfigJson.filters?.timeRanges as TimeRangeKey[] | undefined) ?? [
    'today',
    '3h',
    '6h',
  ];
  const valid = configured.filter(
    (r): r is TimeRangeKey => r === 'today' || r === '3h' || r === '6h' || r === 'all',
  );
  return valid.includes('all') ? valid : [...valid, 'all'];
})();

/**
 * 热点公式权重（前端降级现算时使用，来源 analysis.weights）。
 *
 * 口径权威：scripts/collect/lib/hot-score.mjs 的 DEFAULT_WEIGHTS。
 * 配置与代码的一致性由 scripts/collect/__tests__/weights-drift.test.mjs 守卫（容差 1e-9）；
 * 下列 `??` 兜底值与 DEFAULT_WEIGHTS 保持一致，避免配置缺键时反向漂移。
 */
export const DATA_WEIGHTS: HotScoreWeights = {
  sourceOverlap: siteConfigJson.analysis?.weights?.sourceOverlap ?? 0.4,
  recency: siteConfigJson.analysis?.weights?.recency ?? 0.25,
  frequency: siteConfigJson.analysis?.weights?.frequency ?? 0.2,
  channelWeight: siteConfigJson.analysis?.weights?.channelWeight ?? 0.1,
  keywordHeat: siteConfigJson.analysis?.weights?.keywordHeat ?? 0.05,
  halfLifeHours: siteConfigJson.analysis?.halfLifeHours ?? 6,
};

/** display.hotListSize 默认值 */
export const DEFAULT_HOT_LIST_SIZE: number = siteConfigJson.analysis?.hotListSize ?? 10;

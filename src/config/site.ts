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

/** jsDelivr 的边缘域名。顺序按「内容新鲜度 + 国内可达性」实测结果排列（见 cdnBase 注释） */
export const CDN_HOSTS = [
  'fastly.jsdelivr.net',
  'gcore.jsdelivr.net',
  'cdn.jsdelivr.net',
] as const;

export type CdnHost = (typeof CDN_HOSTS)[number];

/** DataSource 里的 CDN 标识 → 实际边缘域名 */
export const CDN_HOST_BY_SOURCE: Record<'fastly' | 'gcore' | 'jsdelivr', CdnHost> = {
  fastly: 'fastly.jsdelivr.net',
  gcore: 'gcore.jsdelivr.net',
  jsdelivr: 'cdn.jsdelivr.net',
};

/**
 * 指定边缘域名的版本化基址（末尾带 `/`）。
 *
 * 为什么需要**多个**域名：2026-09-16 实测（杭州，请求同一份 `today/latest.json`）
 * 发现三家边缘的缓存状态并不一致 ——
 *   cdn.jsdelivr.net    → 内容陈旧 14 小时（age=20775、cf-cache-status: HIT）
 *   fastly.jsdelivr.net → 实时（age=0），走东京节点，0.90s
 *   gcore.jsdelivr.net  → 实时（age=0），0.99s
 * 即：**换域名确实能换到更新、更快的边缘**，故不把它们合成一个笼统的 `jsdelivr`。
 *
 * 分支引用 vs 内容寻址（2026-09-16 实测校正）：
 *   - **稳定文件名**（`today/latest.json`）：`@deploy` 按 URL 长缓存 → 实测陈旧 14 小时。
 *     故指针**绝不能**只靠 CDN 单通道，必须配 `isStale()` 新鲜度闸门。
 *   - **每轮唯一文件名**（`snapshot-<date>-<HHmm>.json`）：URL 本身是全新的 ⇒ 必然回源，
 *     实测 `@deploy/<新文件>` → `x-cache: MISS, MISS` + **200**，既不陈旧也不 404。
 *     此时 `@branch` 与 `@<sha>` 等价 —— 差别只在语义严格度，不在性能。
 *     ⚠️ 「@deploy 会被解析到固定 commit，内容不随分支推进更新」这句只对**稳定文件名**
 *     成立；曾据此把占位 commit 判为性能根因，属过度外推。
 *   - 传占位值（如 `local`）会构造出必然 404 的 `@local/`；`isValidCommit()` 专门拦它。
 */
export function cdnBase(host: string, commit: string): string {
  return `https://${host}/gh/${SITE.owner}/${SITE.repo}@${commit}/`;
}

/** jsDelivr 版本化基址（默认域名，等价于 `cdnBase('cdn.jsdelivr.net', commit)`） */
export function jsdelivrBase(commit: string): string {
  return cdnBase('cdn.jsdelivr.net', commit);
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

/** 已启用分类（空数组表示全部） */
export const ENABLED_CATEGORIES: CategoryKey[] =
  (siteConfigJson.filters?.enabledCategories as CategoryKey[] | undefined) ?? [];

/** 时间范围档位的固定渲染顺序（主理人 2026-09-15 再次收敛：今天 → 全部）。 */
const TIME_RANGE_ORDER: TimeRangeKey[] = ['today', 'all'];

/** 时间范围选项（主理人 2026-09-15 再次收敛：今天 / 全部）。
 *
 * 顺序**恒按 `TIME_RANGE_ORDER` 输出**，不受 `config/site-config.json` 声明次序影响
 * （该配置仍可能残留已废弃的 `'3h'` / `'6h'` 等档位，一律在此处被过滤掉）。
 * `'all'` 档恒保在列，作为「今天为 0」时的逃生出口：采集端无条目时间窗过滤，
 * 快照条目天然跨日期，默认「今天」在数据陈旧时可能恒为 0。
 * 默认选中档位仍为 `'today'`（见 `FilterBar` 的 `EMPTY_FILTER`，不受本顺序影响）。 */
export const TIME_RANGES: TimeRangeKey[] = (() => {
  const configured =
    (siteConfigJson.filters?.timeRanges as TimeRangeKey[] | undefined) ?? TIME_RANGE_ORDER;
  const picked = new Set<TimeRangeKey>(
    configured.filter((r): r is TimeRangeKey => r === 'today' || r === 'all'),
  );
  picked.add('all');
  return TIME_RANGE_ORDER.filter((r) => picked.has(r));
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

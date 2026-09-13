// scripts/collect/lib/history-row.mjs — 历史精简行（ARCHITECTURE §6.8）
// 月度 NDJSON 一行 = 一个精简 Item，不含 summary/sources（~300B/行）
import { nowIso } from './time.mjs';

/**
 * 把完整 Item 转为 history-item 行（精简字段）
 *
 * schema 参考 docs/data-model/schema/history-item.schema.json
 *
 * 保留字段：id / dedupKey / title / url / channelId / channelName / category
 *           / publishedAt / updatedAt / sourceCount / hotScore / date
 * 不含：summary / sources / author / language / mediaType（按 SCHEMA_BLOB_BUDGET ~300B 设计）
 */
export function toHistoryRow(item, date) {
  return {
    id: item.id,
    dedupKey: item.dedupKey,
    title: item.title,
    url: item.url,
    channelId: item.channelId,
    channelName: item.channelName,
    category: item.category ?? ['other'],
    publishedAt: item.publishedAt,
    updatedAt: item.updatedAt,
    sourceCount: item.sourceCount ?? 1,
    hotScore: typeof item.hotScore === 'number' ? item.hotScore : null,
    date,
  };
}

/**
 * 构造 dayAgg（history-index.json 的 days[] 一项）
 *
 * schema 参考 docs/data-model/schema/history-index.schema.json
 *
 * @param {Object} opts
 * @param {string} opts.date
 * @param {Object} opts.snapshot   已 dedup 后的 projection snapshot
 * @param {string[]} [opts.topIds] hotScore TopN 对应的 item.id（可空）
 * @param {string[]} [opts.topKeywords]
 * @returns {{
 *   date, totalItems, activeChannels, categoryStats, topKeywords, topIds,
 *   sourceOk, sourceFailed
 * }}
 */
export function aggregateDay({ date, snapshot, topIds = [], topKeywords = [] }) {
  const items = snapshot.items ?? [];
  const stats = snapshot.stats ?? {};

  const categoryStats = {};
  const channelSet = new Set();
  for (const it of items) {
    const cats = it.category ?? ['other'];
    for (const c of cats) {
      categoryStats[c] = (categoryStats[c] ?? 0) + 1;
    }
    if (it.channelId) channelSet.add(it.channelId);
  }

  return {
    date,
    totalItems: items.length,
    activeChannels: channelSet.size,
    categoryStats,
    topKeywords,
    topIds,
    sourceOk: stats.sourceOk ?? 0,
    sourceFailed: stats.sourceFailed ?? 0,
  };
}

/**
 * 计算 estimate byte 长度（用于体积断言）
 */
export function estimateRowBytes(row) {
  return Buffer.byteLength(JSON.stringify(row) + '\n', 'utf8');
}

/**
 * 当日快照的 toRow[] 批量转换入口
 */
export function snapshotToRows(snapshot, date) {
  const items = snapshot.items ?? [];
  return items.map((it) => toHistoryRow(it, date));
}

/**
 * 构造空的 history-index.json 骨架（文件不存在时首次写入）
 */
export function newHistoryIndex() {
  return {
    schemaVersion: '1.0',
    updatedAt: nowIso(),
    days: [],
    archives: [],
  };
}

/**
 * 把 dayAgg 追加到 history-index.json（保持 days[] 按 date 升序且唯一）
 * 若 date 已存在则替换为新 entry（事件流幂等）。
 */
export function appendOrUpdateDay(history, dayAgg) {
  if (!Array.isArray(history.days)) history.days = [];
  const idx = history.days.findIndex((d) => d.date === dayAgg.date);
  if (idx >= 0) {
    history.days[idx] = dayAgg;
  } else {
    history.days.push(dayAgg);
  }
  history.days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  history.updatedAt = nowIso();
  return history;
}

/**
 * 月末标记工具：写一个 SEALED 哨兵文件。
 */
export function sealedMarkPath(historyRoot, year, month) {
  return `${historyRoot}/${year}/${String(month).padStart(2, '0')}/SEALED`;
}

// scripts/collect/project-snapshot.mjs — 折叠事件流 → dedup → 投影快照覆盖写
// ARCHITECTURE §6.7 / §3.7
import { writeJsonCompact } from './write.mjs';
import { foldEventsById } from './append-events.mjs';
import { dedup } from './dedup.mjs';
import { nowIso, todayLocal } from './lib/time.mjs';

/**
 * 给定当天事件流文件 → 投影出 snapshot-{date}.json
 *
 * @param {Object} opts
 * @param {string} opts.roundRoot   tmp/deploy 目录（P2 暂不入库 deploy 分支）
 * @param {string} opts.date        YYYY-MM-DD
 * @param {Object<string,number>} [opts.channelWeights] 渠道权重（channelId→0..1）
 * @param {number} [opts.threshold=0.9] Dice 阈值
 * @param {string} [opts.commit='local']
 * @param {Array<Object>} [opts.fetchResults] 本轮 runPool 的逐源采集结果
 *        （元素形如 {sourceId, channelId, channelName, ok?, items?, error?}）。
 *        **可选**：提供时 `stats.sourceTotal/sourceOk/sourceFailed` 按真实逐源结果计算，
 *        并产出 `stats.sourceHealth[]`；缺省时回落历史行为（sourceTotal=sourceOk=渠道分布数、
 *        sourceFailed=0，且不产出 sourceHealth），保证既有 e2e/smoke/单测不回归。
 * @returns {Promise<{ snapshotPath: string, latestPath: string, eventPath: string, reportPath: string, itemCount: number, mergedCount: number, lineCount: number }>}
 */
export async function projectSnapshot(opts) {
  const {
    roundRoot,
    date,
    channelWeights = {},
    threshold = 0.9,
    commit = 'local',
    fetchResults,
  } = opts;
  if (!roundRoot || !date) {
    throw new Error('projectSnapshot: roundRoot/date required');
  }

  const todayDir = `${roundRoot}/today`;
  const eventPath = `${todayDir}/events-${date}.ndjson`;
  const snapshotPath = `${todayDir}/snapshot-${date}.json`;
  // reportPath 留 T-P2-05 写报告；这里先指向未来文件名
  const reportPath = `${todayDir}/report-${date}.json`;
  const latestPath = `${roundRoot}/latest.json`;

  // 1) 折叠事件流
  const { items, lineCount, parseErrors } = await foldEventsById(eventPath);
  if (parseErrors > 0) {
    // 故意使用 warn 级别；事件流偶发 JSON 损坏不应阻断主流程
    console.warn(`[project-snapshot] ${parseErrors} 个事件行解析失败，按 NDJSON 兼容性跳过`);
  }

  // 2) 去重归并
  const { groups, stats } = dedup(items, { threshold, channelWeights });
  const merged = stats.totalMerged;

  // 3) 构造 snapshot
  // 注：此处曾算 `allChannels = uniq(items[].category)` 并写成 `snapshot.channels`。
  // 该字段不在 snapshot.schema.json 白名单内（additionalProperties:false）、前端零消费，
  // 且名字（channels）与内容（分类）语义不符 —— 已移除，勿再加回。
  const sources = computeSources(groups);
  // T-P3-fix：逐源健康度（可选）。缺 fetchResults 时 health=null → 回落历史行为。
  const health = computeSourceHealth(fetchResults);

  const snapshot = {
    schemaVersion: '1.0',
    date,
    timezone: 'Asia/Shanghai',
    generatedAt: nowIso(),
    stats: {
      // 三值语义（snapshot.schema.json）：参与采集的源总数 / 抓取成功 / 抓取失败。
      // 有真实逐源结果时按结果计算；否则回落——⚠ 历史行为是硬编码
      // （sourceOk=sourceTotal=sources.length、sourceFailed=0），会导致页面1
      // 「抓取失败」黄条永远不可达，故生产路径必须传 fetchResults。
      sourceTotal: health ? health.sourceTotal : sources.length,
      sourceOk: health ? health.sourceOk : sources.length,
      sourceFailed: health ? health.sourceFailed : 0,
      itemsBeforeDedup: items.length,
      itemsAfterDedup: groups.length,
      mergedCount: merged,
      durationMs: 0,
      // ⚠ sources[] 语义保持不变：它是「条目归并后的渠道分布」（页面1 状态条
      //   「共 N 个渠道」用），与「逐源抓取健康度」是两个维度，勿混成同一字段。
      sources,
      ...(health ? { sourceHealth: health.sourceHealth } : {}),
    },
    items: groups,
  };

  // 4) 覆盖写快照（前端一次 JSON.parse）
  writeJsonCompact(snapshotPath, snapshot);

  // 5) 写 latest.json 指针
  const latest = {
    date,
    generatedAt: snapshot.generatedAt,
    snapshotPath: `today/snapshot-${date}.json`,
    reportPath: `today/report-${date}.json`,
    eventPath: `today/events-${date}.ndjson`,
    commit,
  };
  writeJsonCompact(latestPath, latest);

  return {
    snapshotPath,
    latestPath,
    eventPath,
    reportPath,
    itemCount: groups.length,
    mergedCount: merged,
    lineCount,
  };
}

/**
 * 从主条目（sources/或自身）派生出 sources[]，用于 stats.sources[]
 * 仅含主条目归并后的渠道分布；不展开 duplicateOf（已并入 sources）
 */
function computeSources(groups) {
  const map = new Map();
  for (const it of groups) {
    const sources = (it.sources && it.sources.length > 0)
      ? it.sources
      : [{ channelId: it.channelId, channelName: it.channelName, url: it.url }];
    for (const s of sources) {
      const k = s.channelId;
      if (!map.has(k)) {
        map.set(k, {
          channelId: s.channelId,
          channelName: s.channelName,
          itemCount: 0,
        });
      }
      map.get(k).itemCount += 1;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.itemCount - a.itemCount);
}

/**
 * 由 runPool 的逐源采集结果计算「统计三值 + 逐源健康数组」（T-P3-fix）。
 *
 * 输入元素形状（见 main.mjs `collectOne`）：
 *   { sourceId, channelId, channelName, ok?, items?, rawItemCount?, httpStatus?, hitCount?, error? }
 *
 * - 成功判定：优先取显式 `ok`（boolean）；否则按 `error` 有无推断。
 * - **不传 fetchResults（undefined / 非数组）→ 返回 null**，调用方回落历史行为，
 *   从而不破坏 e2e / smoke / 既有单测。
 *
 * @param {Array<Object>|undefined} fetchResults
 * @returns {{sourceTotal:number, sourceOk:number, sourceFailed:number, sourceHealth:Array<{sourceId:string,channelId:string,channelName:string,ok:boolean,error?:string}>}|null}
 */
export function computeSourceHealth(fetchResults) {
  if (!Array.isArray(fetchResults)) return null;

  const sourceHealth = fetchResults.map((raw) => {
    const r = raw ?? {};
    const ok = typeof r.ok === 'boolean' ? r.ok : !r.error;
    /** @type {{sourceId:string,channelId:string,channelName:string,ok:boolean,error?:string}} */
    const entry = {
      sourceId: String(r.sourceId ?? ''),
      channelId: String(r.channelId ?? ''),
      channelName: String(r.channelName ?? r.channelId ?? ''),
      ok,
    };
    if (!ok) {
      entry.error = r.error?.message ?? (r.error ? String(r.error) : 'unknown error');
    }
    return entry;
  });

  const sourceOk = sourceHealth.filter((h) => h.ok).length;
  return {
    sourceTotal: sourceHealth.length,
    sourceOk,
    sourceFailed: sourceHealth.length - sourceOk,
    sourceHealth,
  };
}

/**
 * 便捷：今天快照（P2-B/T-P2-05 之前不创建报告；latest 字段指向空占位即可）
 */
export async function projectTodaySnapshot(roundRoot, opts = {}) {
  return projectSnapshot({
    roundRoot,
    date: todayLocal(),
    ...opts,
  });
}

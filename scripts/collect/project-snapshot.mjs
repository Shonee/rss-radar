// scripts/collect/project-snapshot.mjs — 折叠事件流 → dedup → 投影快照覆盖写
// ARCHITECTURE §6.7 / §3.7
//
// 2026-09-16 变更：快照 / 报告文件名追加 4 位 UTC `HHmm` 后缀
//   `today/snapshot-2026-09-16-0347.json`
// 使 URL 本身成为内容地址，从而可被 CDN **安全长缓存**。完整实测依据见
// `lib/time.mjs` 的 `stampFromIso()` 注释（固定文件名 + max-age=604800 ⇒ 前端
// 拿到落后 9 小时以上的陈旧数据；带唯一后缀的路径则会正常回源）。
//
// 因此本模块在写新快照后会**清理同日旧后缀**的快照，避免 deploy 分支按小时堆积。
import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonCompact } from './write.mjs';
import { foldEventsById } from './append-events.mjs';
import { dedup } from './dedup.mjs';
import { nowIso, todayLocal, stampFromIso } from './lib/time.mjs';

/** 当日快照文件名（含不变后缀） */
export function snapshotFileName(date, stamp) {
  return `snapshot-${date}-${stamp}.json`;
}

/** 当日报告文件名（含不变后缀） */
export function reportFileName(date, stamp) {
  return `report-${date}-${stamp}.json`;
}

/**
 * 删除 `today/` 下同日、非本轮后缀的产物，只保留 `keep` 里列出的文件。
 *
 * 为什么必须清理：后缀让每天产生 24 组文件；不清理则 `today/` 会以每小时
 * ~2.4MB 的速度在 deploy 分支堆积。前端只通过指针访问当前一份，历史追溯由
 * `history/YYYY/MM/` 的按天归档承担，故「只留本轮」不损失任何能力。
 *
 * 容错：目录不存在 / 权限异常一律 warn-not-throw（ARCH §12），不阻断采集落盘。
 *
 * @param {string} todayDir
 * @param {string} date            `YYYY-MM-DD`
 * @param {'snapshot'|'report'} kind 只清理该类文件（避免误删 events NDJSON）
 * @param {string[]} keep          需保留的文件名（本轮新写入的）
 */
export function pruneOldStampedArtifacts(todayDir, date, kind, keep) {
  const keepSet = new Set(keep);
  // 同日同类产物有两种命名：带 4 位 UTC 后缀（当前约定）与旧固定名
  // `<kind>-<date>.json`（2026-09-16 之前）。**旧固定名同样必须清理** ——
  // 它一旦残留，任何「按固定名猜路径」的调用方就会静默读到陈旧数据
  // （回归断言 A4 曾被 903 条旧报告污染，根因正是它没被清掉）。
  const legacyName = `${kind}-${date}.json`;
  const stampedPrefix = `${kind}-${date}-`;
  let removed = 0;
  try {
    for (const name of readdirSync(todayDir)) {
      if (!name.startsWith(stampedPrefix) && name !== legacyName) continue;
      if (!/\.json$/.test(name)) continue;
      if (keepSet.has(name)) continue;
      try {
        unlinkSync(join(todayDir, name));
        removed += 1;
      } catch {
        /* 单个删除失败不阻断 */
      }
    }
  } catch {
    /* 目录不可读：无妨，下一轮再来 */
  }
  return removed;
}

/**
 * 给定当天事件流文件 → 投影出 snapshot-{date}-{stamp}.json
 *
 * @param {Object} opts
 * @param {string} opts.roundRoot   tmp/deploy 目录
 * @param {string} opts.date        YYYY-MM-DD
 * @param {Object<string,number>} [opts.channelWeights] 渠道权重（channelId→0..1）
 * @param {number} [opts.threshold=0.9] Dice 阈值
 * @param {string} [opts.commit]  采集轮次 commit（jsDelivr 内容寻址用；缺省 `'local'` 占位）
 * @param {Array<Object>} [opts.fetchResults] 本轮 runPool 的逐源采集结果
 *        （元素形如 {sourceId, channelId, channelName, ok?, items?, error?}）。
 *        **可选**：提供时 `stats.sourceTotal/sourceOk/sourceFailed` 按真实逐源结果计算，
 *        并产出 `stats.sourceHealth[]`；缺省时回落历史行为（sourceTotal=sourceOk=渠道分布数、
 *        sourceFailed=0，且不产出 sourceHealth），保证既有 e2e/smoke/单测不回归。
 * @returns {Promise<{ snapshotPath: string, latestPath: string, eventPath: string, reportPath: string, stamp: string, itemCount: number, mergedCount: number, lineCount: number, pruned: number }>}
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
  // generatedAt 先取，路径由它派生 —— 保证「快照文件名的后缀」与「快照内容里的
  // generatedAt」时基一致，report.mjs 也能用同一条规则推出同一后缀。
  const generatedAt = nowIso();
  const stamp = stampFromIso(generatedAt);
  const snapshotName = snapshotFileName(date, stamp);
  const reportName = reportFileName(date, stamp);
  const snapshotPath = `${todayDir}/${snapshotName}`;
  const reportPath = `${todayDir}/${reportName}`;
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
    generatedAt,
    // 2026-09-16：快照自带报告路径。报告名带 4 位 UTC 后缀（见 lib/time.mjs
    // stampFromIso），消费者**不得**再按 `report-<date>.json` 的固定名反推 ——
    // 这里声明一次，dev-bridge 与回归 harness 直接读字段即可。
    // 基准与 latest.json 指针一致：相对 `data/`，含 `today/` 前缀。
    reportPath: `today/${reportName}`,
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

  // 4.5) 清理同日旧后缀快照（只留本轮这一份）
  const pruned = pruneOldStampedArtifacts(todayDir, date, 'snapshot', [snapshotName]);

  // 5) 写 latest.json 指针
  const latest = {
    date,
    generatedAt: snapshot.generatedAt,
    snapshotPath: `today/${snapshotName}`,
    reportPath: `today/${reportName}`,
    eventPath: `today/events-${date}.ndjson`,
    commit,
  };
  writeJsonCompact(latestPath, latest);

  return {
    snapshotPath,
    latestPath,
    eventPath,
    reportPath,
    stamp,
    itemCount: groups.length,
    mergedCount: merged,
    lineCount,
    pruned,
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
 * 便捷：今天快照
 */
export async function projectTodaySnapshot(roundRoot, opts = {}) {
  return projectSnapshot({
    roundRoot,
    date: todayLocal(),
    ...opts,
  });
}

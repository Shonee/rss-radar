// scripts/collect/report.mjs — 当日报告落盘（ARCHITECTURE §5.5）
import { writeJsonCompact } from './write.mjs';
import { analyzeSnapshot } from './analyze.mjs';
import { nowIso, stampFromIso } from './lib/time.mjs';
import { pruneOldStampedArtifacts, reportFileName } from './project-snapshot.mjs';

/**
 * 构造完整 report-<date>.json（不落盘）
 *
 * @param {Object} snapshot
 * @param {Object} [opts]
 * @returns {Object} reportObj
 */
export function buildReport(snapshot, opts = {}) {
  const analyzed = analyzeSnapshot(snapshot, opts);

  const report = {
    schemaVersion: '1.0',
    date: snapshot.date,
    timezone: snapshot.timezone ?? 'Asia/Shanghai',
    generatedAt: nowIso(),
    totalItems: analyzed.totalItems,
    activeChannels: analyzed.activeChannels,
    windowStart: analyzed.windowStart,
    windowEnd: analyzed.windowEnd,
    weights: analyzed.weights,
    categoryStats: analyzed.categoryStats,
    hotList: analyzed.hotList,
    keywords: analyzed.keywords,
    crossSource: analyzed.crossSource,
    channelActivity: analyzed.channelActivity,
    summary: analyzed.summary,
  };
  return report;
}

/**
 * 直接落盘 report-<date>-<stamp>.json
 *
 * 后缀由 **snapshot.generatedAt** 派生（而非本函数内的 nowIso()），保证同一轮的
 * `snapshot-<date>-<stamp>.json` 与 `report-<date>-<stamp>.json` 后缀**完全一致** ——
 * 前端据此用同一套正则判定「该路径是否不可变、可否长缓存」。若这里改用 nowIso()，
 * 跨分钟边界时两者后缀会分叉，前端就会把可缓存的路径误判为可变的。
 *
 * @param {string} outRoot  roundRoot（包含 today/）
 * @param {Object} snapshot
 * @param {Object} [opts]
 * @returns {{path: string, report: Object}}
 */
export function writeReport(outRoot, snapshot, opts = {}) {
  const report = buildReport(snapshot, opts);
  const stamp = stampFromIso(snapshot.generatedAt);
  const name = reportFileName(snapshot.date, stamp);
  const path = `${outRoot}/today/${name}`;
  writeJsonCompact(path, report);
  // 清理同日旧后缀报告（只留本轮这一份），避免 deploy 分支按小时堆积
  pruneOldStampedArtifacts(`${outRoot}/today`, snapshot.date, 'report', [name]);
  return { path, report };
}

// scripts/collect/report.mjs — 当日报告落盘（ARCHITECTURE §5.5）
import { writeJsonCompact } from './write.mjs';
import { analyzeSnapshot } from './analyze.mjs';
import { nowIso } from './lib/time.mjs';

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
 * 直接落盘 report-<date>.json
 *
 * @param {string} outRoot  roundRoot（包含 today/）
 * @param {Object} snapshot
 * @param {Object} [opts]
 * @returns {string} reportPath
 */
export function writeReport(outRoot, snapshot, opts = {}) {
  const report = buildReport(snapshot, opts);
  const path = `${outRoot}/today/report-${snapshot.date}.json`;
  writeJsonCompact(path, report);
  return { path, report };
}

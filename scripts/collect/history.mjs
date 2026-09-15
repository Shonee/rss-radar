// scripts/collect/history.mjs — 次日转换：月度 NDJSON + history-index（ARCHITECTURE §6.8）
import { readFile, writeFile, appendFile, readdir, unlink, mkdir } from 'node:fs/promises';

import {
  toHistoryRow,
  aggregateDay,
  snapshotToRows,
  newHistoryIndex,
  appendOrUpdateDay,
  sealedMarkPath,
} from './lib/history-row.mjs';
import { nowIso } from './lib/time.mjs';

/**
 * 输入 roundRoot 顶层结构（典型布局）：
 *   roundRoot/
 *     today/
 *       events-<date>.ndjson
 *       snapshot-<date>.json
 *       report-<date>.json
 *     history/
 *       history-index.json            # 滚动 days[]
 *       2026/
 *         09/
 *           items.ndjson              # 月度精简累积
 *           snapshot-<date>.json      # 按天归档（可选）
 *           SEALED                   # 月末哨兵文件
 *
 * @typedef {Object} RolloverOpts
 * @property {string} roundRoot
 * @property {string} currentDate           今天 Asia/Shanghai
 * @property {string} [previousDate]        上一活跃日期（默认从 latest.json 读）
 * @property {Object} [snapshotByDate]      手工喂入（测试）{date → snapshot}
 * @property {Object} [siteConfig]
 * @property {number} [retainedEventDays=7]
 */

/**
 * 跨天 rollover：封口 previousDate → 月度 NDJSON + history-index。
 * 若 previousDate == currentDate 则 no-op。
 *
 * @param {RolloverOpts} opts
 * @returns {Promise<{sealed:boolean, prevDate:string, monthlyAppended:number, daysAppended:number}>}
 */
export async function rolloverIfNewDay(opts) {
  const {
    roundRoot,
    currentDate,
    previousDate,
    snapshotByDate,
    retainedEventDays = 7,
  } = opts;
  if (!roundRoot || !currentDate) {
    throw new Error('rolloverIfNewDay: roundRoot/currentDate required');
  }
  // 默认从 latest.json 推断 prevDate
  let prev = previousDate;
  if (!prev && !snapshotByDate) {
    prev = await readLatestDate(roundRoot);
  }
  if (!prev || prev === currentDate) {
    return { sealed: false, prevDate: prev ?? currentDate, monthlyAppended: 0, daysAppended: 0 };
  }

  const snap = snapshotByDate?.[prev] ?? (await readSnapshotIfExists(roundRoot, prev));
  if (!snap) {
    // 没有 snapshot 就无法封口；记 warn 但不抛错
    console.warn(`[history] rollover: no snapshot for ${prev}, skip`);
    return { sealed: false, prevDate: prev, monthlyAppended: 0, daysAppended: 0 };
  }

  const result = {
    sealed: false,
    prevDate: prev,
    monthlyAppended: 0,
    daysAppended: 0,
  };

  // 1) 月度 NDJSON 追加
  const rowCount = await appendSnapshotToMonthlyNdjson(roundRoot, snap, prev);
  result.monthlyAppended = rowCount;

  // 2) 按天 snapshot 归档 move
  await archiveSnapshot(roundRoot, prev);

  // 3) history-index 追加 dayAgg
  const dayAgg = aggregateDay({ date: prev, snapshot: snap });
  await appendDayToHistoryIndex(roundRoot, dayAgg);
  result.daysAppended = 1;

  // 4) 月末封口？若 previousDate 是月底最后一天 → 写 SEALED 哨兵
  if (isLastDayOfMonth(prev)) {
    const [yStr, mStr] = prev.split('-');
    const year = Number(yStr);
    const month = Number(mStr);
    await writeSealed(roundRoot, year, month);
    result.sealed = true;
  }

  // 5) 清理过期事件流（保留最近 7 天）
  await pruneOldEvents(roundRoot, currentDate, retainedEventDays);

  return result;
}

/**
 * 把 snapshot.items[] 转为精简行 → append 到 history/YYYY/MM/items.ndjson
 */
export async function appendSnapshotToMonthlyNdjson(roundRoot, snapshot, prevDate) {
  const { year, month } = ymOf(prevDate);
  const monthDir = `${roundRoot}/history/${year}/${String(month).padStart(2, '0')}`;
  const ndjsonPath = `${monthDir}/items.ndjson`;
  await mkdir(monthDir, { recursive: true });

  const rows = snapshotToRows(snapshot, prevDate);
  if (rows.length === 0) return 0;
  const payload = rows.map((r) => JSON.stringify(r) + '\n').join('');
  await appendFile(ndjsonPath, payload, 'utf8');
  return rows.length;
}

/**
 * 把 today/snapshot-<prevDate>.json move 到 history/YYYY/MM/snapshot-<prevDate>.json
 * 若 today/snapshot-<prevDate>.json 不存在则 no-op（archive-index 路径）
 */
export async function archiveSnapshot(roundRoot, prevDate) {
  const { year, month } = ymOf(prevDate);
  const monthDir = `${roundRoot}/history/${year}/${String(month).padStart(2, '0')}`;
  const from = `${roundRoot}/today/snapshot-${prevDate}.json`;
  const to = `${monthDir}/snapshot-${prevDate}.json`;
  await mkdir(monthDir, { recursive: true });
  let raw;
  try {
    raw = await readFile(from, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
  // 直接 copy（避免 rename 失败导致丢数据）
  await writeFile(to, raw, 'utf8');
  return true;
}

/**
 * 追加 dayAgg 到 history-index.json（首次创建则初始化）
 */
export async function appendDayToHistoryIndex(roundRoot, dayAgg) {
  const idxPath = `${roundRoot}/history/history-index.json`;
  let hist;
  try {
    const raw = await readFile(idxPath, 'utf8');
    hist = JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') hist = newHistoryIndex();
    else throw e;
  }
  appendOrUpdateDay(hist, dayAgg);
  await writeFile(idxPath, JSON.stringify(hist, null, 2), 'utf8');
  return hist;
}

/**
 * 写入 SEALED 哨兵
 */
export async function writeSealed(roundRoot, year, month) {
  const path = sealedMarkPath(`${roundRoot}/history`, year, month);
  await writeFile(path, `sealed_at=${nowIso()}\n`, 'utf8');
  return path;
}

/**
 * 删除历史日期 < currentDate - retainedDays 的 events-<date>.ndjson
 * 仅清理 events 文件，history/index 是按规则滚动累积不删
 */
export async function pruneOldEvents(roundRoot, currentDate, retainedDays = 7) {
  const todayDir = `${roundRoot}/today`;
  let entries;
  try {
    entries = await readdir(todayDir);
  } catch (e) {
    if (e.code === 'ENOENT') return { pruned: 0 };
    throw e;
  }
  const floor = daysBefore(currentDate, retainedDays);
  let pruned = 0;
  for (const name of entries) {
    const m = name.match(/^events-(\d{4}-\d{2}-\d{2})\.ndjson$/);
    if (!m) continue;
    const eventDate = m[1];
    if (eventDate < floor) {
      try {
        await unlink(`${todayDir}/${name}`);
        pruned += 1;
      } catch {
        // 容忍
      }
    }
  }
  return { pruned, floor };
}

function ymOf(date) {
  const [y, m] = date.split('-').map(Number);
  return { year: y, month: m };
}

function isLastDayOfMonth(date) {
  const [y, m, d] = date.split('-').map(Number);
  // 下一月 0 日 = 本月最后一天
  const next = new Date(Date.UTC(y, m, 0));
  return d === next.getUTCDate();
}

function daysBefore(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() - n);
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(base.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * 读 `latest.json` 记录的上一个活跃日期（Asia/Shanghai 的 `YYYY-MM-DD`）。
 *
 * 注意调用时机：`projectSnapshot` 会覆盖写 `latest.json`，因此**必须在写今日快照之前**
 * 读取，否则拿到的永远是今天、跨天 rollover 会恒判 no-op（T-P4-fix 的真实根因）。
 *
 * @param {string} roundRoot
 * @returns {Promise<string|null>} 无 latest.json 时返回 null；内容非法时抛错（由调用方兜住）
 */
export async function readLatestDate(roundRoot) {
  const latestPath = `${roundRoot}/latest.json`;
  try {
    const raw = await readFile(latestPath, 'utf8');
    const obj = JSON.parse(raw);
    return obj.date;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function readSnapshotIfExists(roundRoot, prevDate) {
  const p = `${roundRoot}/today/snapshot-${prevDate}.json`;
  try {
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

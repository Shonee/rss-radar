// scripts/collect/append-events.mjs — 当天事件流 NDJSON 追加 + 折叠
// ARCHITECTURE §6.7「方案 C 双写」
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 事件行 schema（append-only NDJSON）：
 *   { op: 'upsert', runId, fetchedAt, item: {...完整 Item...} }
 *   兼容期可省略 op（默认 upsert）。
 *
 * 追加语义：O(1) appendFile，绝不改动历史行。
 *
 * @param {string} ndjsonPath 文件路径
 * @param {Object|Object[]} events 事件对象或事件数组
 */
export async function appendEvents(ndjsonPath, events) {
  const arr = Array.isArray(events) ? events : [events];
  if (arr.length === 0) return { appended: 0 };
  await mkdir(dirname(ndjsonPath), { recursive: true });
  const lines = arr.map((ev) => JSON.stringify(ev) + '\n').join('');
  await appendFile(ndjsonPath, lines, 'utf8');
  return { appended: arr.length };
}

/**
 * 折叠事件流 → 按 id 取最后一行（last-write-wins，ARCH §6.7）
 * 读取整文件 + 逐行解析 + Map.set 覆盖。
 *
 * @param {string} ndjsonPath
 * @returns {{ items: Object[], byId: Map<string, Object>, lineCount: number, parseErrors: number }}
 */
export async function foldEventsById(ndjsonPath) {
  const byId = new Map();
  let lineCount = 0;
  let parseErrors = 0;
  let raw;
  try {
    raw = await readFile(ndjsonPath, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return { items: [], byId, lineCount: 0, parseErrors: 0 };
    }
    throw e;
  }
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lineCount += 1;
    try {
      const ev = JSON.parse(trimmed);
      if (!ev || typeof ev !== 'object' || !ev.item || !ev.item.id) {
        parseErrors += 1;
        continue;
      }
      byId.set(ev.item.id, ev.item);
    } catch {
      parseErrors += 1;
    }
  }
  return { items: Array.from(byId.values()), byId, lineCount, parseErrors };
}

/**
 * 仅追加一个标准事件对象（op=upsert 强制）
 */
export function makeEvent({ item, runId, fetchedAt, op = 'upsert' }) {
  return { op, runId, fetchedAt, item };
}

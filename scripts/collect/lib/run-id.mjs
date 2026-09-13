// scripts/collect/lib/run-id.mjs — runId 与 workerId 短随机
import { randomBytes } from 'node:crypto';

/**
 * 生成 16 hex chars 的 runId，例：`r_<16hex>`。
 * ARCHITECTURE §6.7：事件流每轮一行 runId + fetchedAt。
 */
export function makeRunId(prefix = 'r') {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/**
 * 简单 ULID-ish 友好 ID（可读、不带分隔符；24 hex）。
 */
export function makeId24() {
  return randomBytes(12).toString('hex');
}

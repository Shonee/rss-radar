// write.mjs — 写 JSON 产物（覆盖写 + 软链 latest.json）
import { writeFileSync, mkdirSync, existsSync, copyFileSync, symlinkSync, unlinkSync, readlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 写 JSON（覆盖写，一次性 stringify，不分块） */
export function writeJsonCompact(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/** 复制产物到 public/data/today/（dev bridge 路径） */
export function copyToPublicData(src, publicDir) {
  const dstDir = join(publicDir, 'data/today');
  mkdirSync(dstDir, { recursive: true });
  const baseName = src.split('/').pop();
  const dst = join(dstDir, baseName);
  copyFileSync(src, dst);
  return dst;
}

/**
 * 维护 latest.json（dev bridge 入口）
 *
 * 正常路径：创建软链，指向**真实快照文件名**。
 * 降级路径（文件系统不支持软链）：写出**权威指针文件的副本**，而不是就地拼一个
 * 残缺对象。理由：`report-<date>.json` 的固定名约定已于 2026-09-16 废弃
 * （报告名带 4 位 UTC 后缀，见 lib/time.mjs stampFromIso），任何「就地拼路径」
 * 的写法都会随时间漂移 —— 直接复制 project-snapshot 的产物，字段天然一致。
 * （历史 bug：旧降级分支写的 snapshotPath 基准是 `./`，少一层 `today/`，
 *   而 `base + path` 的消费方式会把它拼成 `data/snapshot-*.json` → 必然 404。）
 *
 * @param {string} publicDir e.g. ./public
 * @param {string} date YYYY-MM-DD
 * @param {string} [snapshotName] 实际快照文件名（含 4 位 UTC 后缀）。
 *   2026-09-16 起快照文件名带不变后缀（`snapshot-<date>-<stamp>.json`），
 *   软链目标必须用**真实文件名**而非 `snapshot-<date>.json` 的旧约定，
 *   否则软链会指向一个不存在的文件、dev 环境直接 404。
 * @param {string} [pointerSource] 权威指针文件绝对路径（project-snapshot 的
 *   `latestPath`）。降级时作为副本来源；缺省则退回最小可用形状（基准仍为 `today/`）。
 */
export function refreshLatestLink(publicDir, date, snapshotName, pointerSource) {
  const linkPath = join(publicDir, 'data/today/latest.json');
  const name = snapshotName || `snapshot-${date}.json`;
  const target = `./${name}`;
  if (existsSync(linkPath)) {
    try {
      unlinkSync(linkPath);
    } catch {
      // windows 可能失败；忽略
    }
  }
  try {
    symlinkSync(target, linkPath);
  } catch {
    // 软链失败时降级：优先复制权威指针，保证字段与线上逐字一致
    if (pointerSource && existsSync(pointerSource)) {
      try {
        copyFileSync(pointerSource, linkPath);
        return;
      } catch {
        // 复制失败则继续走下面的最小兜底
      }
    }
    // 最小兜底：只需形状可被 isPointer 识别，且基准与权威指针一致（today/）
    writeFileSync(linkPath, JSON.stringify({ date, snapshotPath: `today/${name}` }, null, 2), 'utf8');
  }
}

/** 检查软链是否仍指向预期目标 */
export function checkLatestLink(publicDir) {
  const linkPath = join(publicDir, 'data/today/latest.json');
  if (!existsSync(linkPath)) return null;
  try {
    return readlinkSync(linkPath);
  } catch {
    return null;
  }
}
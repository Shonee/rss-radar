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
 * 维护 latest.json 软链（dev bridge 入口）
 * @param {string} publicDir e.g. ./public
 * @param {string} date YYYY-MM-DD
 */
export function refreshLatestLink(publicDir, date) {
  const linkPath = join(publicDir, 'data/today/latest.json');
  const target = `./snapshot-${date}.json`;
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
    // 软链失败时降级为写一份真文件
    const real = join(publicDir, `data/today/snapshot-${date}.json`);
    if (existsSync(real)) {
      writeFileSync(linkPath, JSON.stringify({ date, snapshotPath: target }, null, 2), 'utf8');
    }
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
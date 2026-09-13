// scripts/collect/archive.mjs
// 年度归档 + 安全删除（ARCHITECTURE §6.9 / §13.5 + T-P2-06）
//
// 流程：
//   1. 打包 history/<YYYY>/**/*.ndjson 为 tar.zst（去掉 .json 和 SEALED 已封口月份）
//   2. 计算 sha256
//   3. 准备 GitHub Release 资产（README.md 上传步骤）
//   4. **严格早于 today - 365 天** 才删（边界日不删）
//   5. 先成功后删除（CI 侧由 archive.yml 跑）
//
// 本地 P2-B 默认 --dry-run：仅列出待删除文件清单 + 统计；不真删
// 实装条件：CI 侧有 GH_TOKEN（老登 15:45 拍板：延后到代码上传远程仓库后再做）
//
// 用法：
//   node scripts/collect/archive.mjs --year 2025 --dry-run     # 列清单
//   node scripts/collect/archive.mjs --year 2025 --execute     # 真删（CI 跑）
//   node scripts/collect/archive.mjs --round-root <dir>        # 自定义输出根

import { readdir, stat, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { todayLocal } from './lib/time.mjs';
import { prepareReleaseAssets } from './lib/release.mjs';

function _parseArgs() {
  const args = process.argv.slice(2);
  const out = { year: null, dryRun: true, roundRoot: null, bundlePath: null };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--year') out.year = parseInt(args[++i], 10);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--execute') out.dryRun = false;
    else if (a === '--round-root') out.roundRoot = args[++i];
    else if (a === '--bundle') out.bundlePath = args[++i];
    else if (a === '--help' || a === '-h') {
      console.log([
        '用法：node scripts/collect/archive.mjs [options]',
        '',
        '选项：',
        '  --year <YYYY>          归档哪一年（默认去年）',
        '  --dry-run              列出待删除文件，不真删（默认）',
        '  --execute              真删（要求 CI 凭证）',
        '  --round-root <dir>     输出根目录（默认部署目录 tmp/deploy）',
        '  --bundle <path>        自定义 tar.zst 路径',
        '  --help, -h             显示帮助',
      ].join('\n'));
      process.exit(0);
    }
  }
  return out;
}

function parseArgs() { return _parseArgs(); }

/**
 * 列出某年内所有 NDJSON + 跨年快照（候选删除集）
 * 边界：严格早于 today - 365 天 才列入候选
 */
export async function listCandidatesForArchival(roundRoot, year, today = todayLocal()) {
  const historyRoot = join(roundRoot, 'history');
  const cutoffDate = cutoffBefore(today, 365);
  if (!existsSync(historyRoot)) {
    return { candidates: [], byMonth: {}, cutoffDate, note: 'history/ 不存在' };
  }
  const candidates = [];
  const byMonth = {};

  // 遍历 history/<YEAR>/<MM>/目录
  const yearDir = join(historyRoot, String(year));
  if (!existsSync(yearDir)) {
    return { candidates: [], byMonth: {}, note: `${year}/ 不存在` };
  }
  const months = await readdir(yearDir, { withFileTypes: true });
  for (const mo of months) {
    if (!mo.isDirectory()) continue;
    if (!/^\d{2}$/.test(mo.name)) continue;
    const mmDir = join(yearDir, mo.name);
    byMonth[mo.name] = [];
    const files = await readdir(mmDir, { withFileTypes: true });
    for (const f of files) {
      if (f.isDirectory()) continue;
      if (f.name === 'SEALED') continue;  // 月末封口哨兵保留
      const full = join(mmDir, f.name);
      const stat_ = await stat(full);
      // 仅删除 NDJSON + snapshot.json（按 ARCH §6.9）
      if (!/\.(ndjson|json)$/.test(f.name)) continue;
      candidates.push({
        path: full,
        size: stat_.size,
        mtime: stat_.mtime.toISOString(),
        month: mo.name,
        name: f.name,
      });
      byMonth[mo.name].push(full);
    }
  }

  // 过滤：严格早于 cutoffDate 才纳入删除候选
  const filtered = candidates.filter((c) => {
    // 月份级别判定：
    //   1) 文件名含完整日期 → 用文件名日期
    //   2) 文件名含 YYYYMM 6 位 → 用当月 1 号
    //   3) 否则用父目录 YYYY/MM 路径解析
    //   4) 都没有 → mtime
    let itemDate = null;
    let m;
    if ((m = c.name.match(/(\d{4}-\d{2}-\d{2})/))) {
      itemDate = m[1];
    } else if ((m = c.name.match(/^(\d{4})(\d{2})\.ndjson$/))) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      itemDate = `${y}-${String(mo).padStart(2, '0')}-01`;
    } else {
      // c.path: <root>/history/<YYYY>/<MM>/<name>
      const segs = c.path.split('/');
      const yearSeg = segs[segs.length - 3];
      const monthSeg = segs[segs.length - 2];
      if (/^\d{4}$/.test(yearSeg) && /^\d{2}$/.test(monthSeg)) {
        itemDate = `${yearSeg}-${monthSeg}-01`;
      } else {
        itemDate = c.mtime.slice(0, 10);
      }
    }
    return itemDate < cutoffDate;
  });

  return { candidates: filtered, byMonth, cutoffDate };
}

/** 算 today - N 天 的 ISO date（YYYY-MM-DD） */
function cutoffBefore(today, days) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * 列出将被打包进 tar.zst 的文件清单（NDJSON + snapshot）
 */
export async function listBundlable(roundRoot, year) {
  const out = [];
  const historyRoot = join(roundRoot, 'history');
  const yearDir = join(historyRoot, String(year));
  if (!existsSync(yearDir)) return out;
  const months = await readdir(yearDir, { withFileTypes: true });
  for (const mo of months) {
    if (!mo.isDirectory() || !/^\d{2}$/.test(mo.name)) continue;
    const mmDir = join(yearDir, mo.name);
    const files = await readdir(mmDir, { withFileTypes: true });
    for (const f of files) {
      if (f.isDirectory()) continue;
      if (/\.ndjson$/.test(f.name) || /\.json$/.test(f.name)) {
        out.push(join(mmDir, f.name));
      }
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs();
  const roundRoot = resolve(opts.roundRoot ?? join(process.cwd(), 'tmp', 'deploy'));
  const today = todayLocal();
  const year = opts.year ?? new Date(today).getUTCFullYear() - 1;

  console.log(`[archive] year=${year}  dryRun=${opts.dryRun}  roundRoot=${roundRoot}  today=${today}`);

  const { candidates, byMonth, cutoffDate, note } = await listCandidatesForArchival(roundRoot, year, today);
  if (note) console.log(`[archive] note: ${note}`);

  const bundlable = await listBundlable(roundRoot, year);

  // 1) 报告筛选结果
  const totalSize = candidates.reduce((sum, c) => sum + c.size, 0);
  console.log(`[archive] cutoffDate=${cutoffDate}`);
  console.log(`[archive] candidates=${candidates.length}  size=${totalSize}B`);
  for (const [mm, files] of Object.entries(byMonth)) {
    const todo = files.filter((f) => candidates.some((c) => c.path === f));
    if (todo.length > 0) console.log(`  - ${year}/${mm}: ${todo.length} files`);
  }
  console.log(`[archive] bundlable=${bundlable.length}`);
  for (const b of bundlable) console.log(`  - ${b}`);

  // 2) 打包（dry-run 时仅准备元数据）
  const bundlePath = opts.bundlePath ?? join(roundRoot, `archive-${year}.tar.zst`);
  if (!opts.dryRun) {
    // CI 侧实装 tar.zst 打包（用 node:zlib / node:fs 拼流）
    // 本地 P2-B 不实装：老登 15:45 拍板延后
    throw new Error('archive.mjs --execute 模式暂未实装；CI 侧由 archive.yml 跑');
  } else {
    console.log(`[archive] DRY RUN: --execute 才能真删；本轮不打包`);
  }

  // 3) 准备 Release 资产元数据（dry-run 仍可调用）
  if (bundlable.length > 0) {
    try {
      const meta = await prepareReleaseAssets(bundlePath, {
        releaseName: `rss-radar-${year}.tar.zst`,
        releaseNotes: `RSS Radar ${year} 年度归档 (history + monthly NDJSON)`,
      });
      console.log(`[archive] would release: ${meta.name}  size=${meta.size}B  sha256=${meta.sha256.slice(0, 16)}...`);
    } catch (e) {
      // dry-run 时 bundlePath 不存在也允许
      console.log(`[archive] release meta skipped (${e.code ?? e.message})`);
    }
  }

  console.log(`[archive] DONE  (dryRun=${opts.dryRun})`);
}

// 仅当作为入口（CLI）执行时启动 main()；被 import 时不触发
import { fileURLToPath } from 'node:url';
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[archive] fatal:', err);
    process.exit(1);
  });
}

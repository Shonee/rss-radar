#!/usr/bin/env node
// scripts/reconcile-entities.mjs
//
// 实体层重收敛 CLI —— 修正「同一实体被拆成多条渠道」与「不同实体被压成一条渠道」。
//
// ── 与 import-channels.mjs 的分工 ─────────────────────────────────────────
//
//   import-channels.mjs  负责「把外部清单装进来」，幂等键 = 归一化 feed URL。
//   本脚本               负责「把已装进来的结构校正好」，实体键 = 栏目级主页。
//
//   两者共用 scripts/lib/channel-registry.mjs 的同一套纯函数（deriveHomepageFromFeed
//   / normalizeHomepage / reconcileEntities），不各算一次。
//
// ── 为什么需要它 ─────────────────────────────────────────────────────────
//
// 原导入实现的 homepage 兜底用的是 `new URL(feedUrl).origin`，**丢掉了整个路径**：
//   - `feedx.net` 上的 cnBeta / 环球科学 / 摄影世界 → 压成一条名叫「cnBeta」的渠道；
//   - `feeds.feedburner.com` 上的「书伴」与「可能吧」→ 同样被压成一条；
//   - http 与 https 两种写法被当成两个实体 → 前端出现两张同名卡片。
//
// 代码侧已改（`deriveHomepageFromFeed`），但**已经落盘的数据不会自己变**，
// 所以需要这个显式的收敛动作。它同时是「下次导入」的安全网：即使将来又有
// 类似的结构漂移，跑一遍即可回到规范形式。
//
// ── 安全性 ───────────────────────────────────────────────────────────────
//
//   - 默认 `scope=garss`：只动外部导入来的渠道，历史人工配置一律不碰
//     （实测若放开，会把 v2ex / 豆瓣 / 开源中国等正确渠道的多个栏目强行拆开）。
//   - 拆出的新渠道**继承原渠道的开关**：拆分不增加采集请求（那几条 feed 原本就在
//     抓），只是把文章归还给正确的刊名。强制停用会让用户直接丢失那些内容。
//   - 默认 dry-run；`--write` 才落盘，且写前过 ajv 门禁。
//   - **幂等**：收敛到规范形式后，再跑一次必然 no-op（单测里锁住）。
//
// CLI：
//   node scripts/reconcile-entities.mjs                     # dry-run，只报告
//   node scripts/reconcile-entities.mjs --write             # 真写（写前过 schema）
//   node scripts/reconcile-entities.mjs --scope all         # 含历史渠道（慎用）
//   node scripts/reconcile-entities.mjs --json              # 额外输出机器可读报告
//   node scripts/reconcile-entities.mjs --config <path>     # 覆盖配置文件
//   node scripts/reconcile-entities.mjs --out <path>        # 覆盖报告落点
//
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reconcileEntities, auditRegistry } from './lib/channel-registry.mjs';
import { validateData } from './validate-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEFAULT_CONFIG = resolve(ROOT, 'config', 'sources.json');

/** 非空问题摘要（auditRegistry 的 problems 里只留有内容的桶） */
function nonEmptyProblems(problems) {
  const out = {};
  for (const [k, v] of Object.entries(problems || {})) {
    const n = Array.isArray(v) ? v.length : 0;
    if (n > 0) out[k] = n;
  }
  return out;
}

function fmtCounts(m) {
  const parts = Object.entries(m || {}).map(([k, v]) => `${k}=${v}`);
  return parts.length ? parts.join(' ') : '—';
}

export async function mainCli(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  const configPath = resolve(opts.config || DEFAULT_CONFIG);
  const started = Date.now();

  // ---- 读 ----
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error(`❌ 无法读取/解析 ${configPath}：${e.message}`);
    return 1;
  }
  const before = {
    channels: (raw.channels || []).length,
    sources: (raw.sources || []).length,
    enabledChannels: (raw.channels || []).filter((c) => c.enabled !== false).length,
    enabledSources: (raw.sources || []).filter((s) => s.enabled !== false).length,
  };
  console.log(`[1/3] 读取 ${configPath.replace(`${ROOT}/`, '')}`);
  console.log(`      渠道 ${before.channels}（启用 ${before.enabledChannels}）｜源 ${before.sources}（启用 ${before.enabledSources}）`);

  // ---- 收敛 ----
  console.log(`[2/3] 实体层重收敛（scope=${opts.scope}）`);
  const { config: next, report } = reconcileEntities(raw, { scope: opts.scope, now: opts.now });

  if (report.splits.length === 0 && report.merges.length === 0) {
    console.log('      ✅ 已处于规范形式：无可拆、无可并 —— 幂等空跑');
  } else {
    for (const s of report.splits) {
      console.log(`      拆  ${s.id}  →  ${s.into.join(' , ')}`);
    }
    for (const m of report.merges) {
      console.log(`      并  ${m.id}  →  ${m.into}   （迁移 ${m.moved.length} 条${m.dropped ? `，丢弃 ${m.dropped} 条同内容源` : ''}）`);
    }
    if (report.droppedSources.length > 0) {
      console.log(`      丢弃（目标已有同内容源，避免重复抓取）：`);
      for (const d of report.droppedSources) console.log(`         ${d.id}  ${d.url}`);
    }
  }

  const after = {
    channels: (next.channels || []).length,
    sources: (next.sources || []).length,
    enabledChannels: (next.channels || []).filter((c) => c.enabled !== false).length,
    enabledSources: (next.sources || []).filter((s) => s.enabled !== false).length,
  };
  console.log(`      渠道 ${before.channels} → ${after.channels}（启用 ${before.enabledChannels} → ${after.enabledChannels}）`);
  console.log(`      源   ${before.sources} → ${after.sources}（启用 ${before.enabledSources} → ${after.enabledSources}）`);

  // ---- 门禁 + 落盘 ----
  const errors = next === raw ? [] : validateData('sources', next);
  const audit = auditRegistry(next);
  const outPath = resolve(opts.out || resolve(ROOT, 'tmp', 'reconcile-report.json'));
  const machineReport = {
    generatedAt: new Date().toISOString(),
    scope: opts.scope,
    config: configPath,
    before,
    after,
    splits: report.splits,
    merges: report.merges,
    droppedSources: report.droppedSources,
    audit: { ok: audit.ok, counts: audit.counts, problems: nonEmptyProblems(audit.problems) },
    schemaErrors: errors.slice(0, 20),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(machineReport, null, 2)}\n`, 'utf8');

  console.log('[3/3] 门禁');
  if (errors.length > 0) {
    console.error(`      ❌ sources schema 未通过（${errors.length} 处），拒绝写盘：`);
    for (const e of errors.slice(0, 10)) console.error(`         ${e.instancePath} ${e.message}`);
  } else {
    console.log('      ✅ sources schema 通过');
  }
  const probs = nonEmptyProblems(audit.problems);
  console.log(audit.ok
    ? `      ✅ 一致性审计通过（渠道 ${audit.counts.channels} / 源 ${audit.counts.sources}）`
    : `      ⚠️  一致性审计：${fmtCounts(probs)}`);
  console.log(`      报告 ${outPath.replace(`${ROOT}/`, '')}`);
  if (opts.json) console.log(JSON.stringify(machineReport, null, 2));

  if (!opts.write) {
    console.log('\n🔎 dry-run —— 未改动任何文件。加 --write 才会写入 config/sources.json');
    return 0;
  }
  if (errors.length > 0) {
    console.log('\n🚫 未写入（schema 校验未通过）');
    return 1;
  }
  if (next === raw) {
    console.log('\n✅ 无变更，未写盘');
    return 0;
  }
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`\n✅ 已写入 ${configPath.replace(`${ROOT}/`, '')}（${((Date.now() - started) / 1000).toFixed(1)}s）`);
  return 0;
}

function parseArgs(argv) {
  const o = { scope: 'garss', write: false, json: false, help: false, config: '', out: '', now: '' };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--write': o.write = true; break;
      case '--json': o.json = true; break;
      case '--help': case '-h': o.help = true; break;
      case '--scope': o.scope = argv[++i] || 'garss'; break;
      case '--config': o.config = argv[++i] || ''; break;
      case '--out': o.out = argv[++i] || ''; break;
      case '--now': o.now = argv[++i] || ''; break;
      default:
        if (argv[i].startsWith('--')) {
          console.error(`未知参数：${argv[i]}`);
          o.help = true;
        }
    }
  }
  if (o.scope !== 'garss' && o.scope !== 'all') {
    console.error(`--scope 只接受 garss | all，收到 ${o.scope}`);
    o.help = true;
  }
  return o;
}

function printHelp() {
  console.log(`
实体层重收敛 —— 修正渠道注册表里的「同实体误分裂 / 异实体误合并」。

用法：
  node scripts/reconcile-entities.mjs [选项]

选项：
  --write             真正写入 config/sources.json（默认 dry-run）
  --scope <s>         收敛范围：garss（默认，只动导入渠道）| all（含历史渠道，慎用）
  --config <path>     覆盖配置文件路径（默认 config/sources.json）
  --out <path>        报告落点（默认 tmp/reconcile-report.json）
  --now <iso>         固定时间戳（便于测试复现）
  --json              额外打印机器可读报告
  -h, --help          显示本帮助

判据：
  实体键 = 栏目级主页（协议/www 归一，剥掉尾部 feed 特征段后取首个路径段）；
  feed 托管站 / 路由站（feedburner、feedx、rsshub 等）改用完整 URL 作键，
  因为它们的路径是「订阅标识」而非站点栏目。详见 lib 里 HOSTED_FEED_HOSTS。
`);
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  mainCli().then((code) => process.exit(code)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

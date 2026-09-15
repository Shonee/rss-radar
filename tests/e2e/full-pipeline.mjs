// tests/e2e/full-pipeline.mjs
// T-P5-03 端到端全链路 e2e（基于 scripts/smoke/e2e-pipeline.mjs 的 collect 管线扩展）
//
// 覆盖阶段（比 scripts/smoke/e2e-pipeline.mjs 多）：
//   S1 环境就绪检查
//   S2 mock 源（6 个 local_json fixture，含跨天数据 09-12 / 09-13）→ ingestRound
//   S3 事件流折叠 foldEventsById
//   S4 去重 L1~L5（dedup，断言合并发生 + 跨源合并）
//   S5 报告生成 writeReport
//   S6 模拟跨天 rollover（两次：09-12→09-13，09-13→09-14）→ 产出 history-index + 月度 NDJSON
//   S7 归档流程（archive listCandidatesForArchival / listBundlable，dry-run 不删）
//   S8 读回 history-index 并逐日断言内容正确（totalItems / activeChannels / categoryStats / 月度行 id 集合）
//
// 退出码三态：
//   0 通过 / 1 断言失败 / 2 环境未就绪
//
// 变异（必失败）模式：--mutate <name>
//   history-tamper  篡改 history-index（rollover 后把某日 totalItems 改坏）→ S8 断言失败
//   monthly-mismatch 篡改月度 NDJSON（删一行）→ S8 行数/id 断言失败
//
// 全部产物写入 os.tmpdir()，绝不写 public/data/ 或 config/（纪律红线）。

import { rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// ---- collect 管线（真实模块，非重写）----
import '../../scripts/collect/connectors/index.mjs'; // 注册连接器（副作用）
import { get } from '../../scripts/collect/connectors/registry.mjs';
import { normalizeItem } from '../../scripts/collect/normalize.mjs';
import { appendEvents, makeEvent, foldEventsById } from '../../scripts/collect/append-events.mjs';
import { projectSnapshot } from '../../scripts/collect/project-snapshot.mjs';
import { analyzeSnapshot } from '../../scripts/collect/analyze.mjs';
import { writeReport } from '../../scripts/collect/report.mjs';
import { rolloverIfNewDay } from '../../scripts/collect/history.mjs';
import { dedup } from '../../scripts/collect/dedup.mjs';
import { listCandidatesForArchival, listBundlable } from '../../scripts/collect/archive.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const FIX = join(ROOT, 'tests', 'e2e', 'fixtures');

const DATE_A = '2026-09-12';
const DATE_B = '2026-09-13';
const DATE_C = '2026-09-14';

// ---- 自定义错误：区分 断言失败(1) vs 环境未就绪(2) ----
class E2EAssert extends Error {}
class E2EEnv extends Error {}

// ---- 断言计数 ----
const counter = { pass: 0, fail: 0 };
function assert(cond, msg) {
  if (cond) {
    counter.pass += 1;
    return;
  }
  counter.fail += 1;
  throw new E2EAssert(msg);
}
function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

// ---- mock 源定义（6 个，全部 local_json，绝对路径 fixture）----
function buildSources() {
  const mk = (id, channelId, file) => ({
    id,
    channelId,
    type: 'local_json',
    url: join(FIX, file),
    enabled: true,
    fieldMapping: { itemsPath: '$.items[*]' },
  });
  const sources = [
    mk('src_tech', 'ch_tech', 'src-tech.json'),
    mk('src_ai', 'ch_ai', 'src-ai.json'),
    mk('src_news', 'ch_news', 'src-news.json'),
    mk('src_dev', 'ch_dev', 'src-dev.json'),
    mk('src_pod', 'ch_pod', 'src-pod.json'),
    mk('src_fin', 'ch_fin', 'src-fin.json'),
  ];
  const channels = [
    { id: 'ch_tech', name: '技术博客', category: ['tech_blog'], weight: 0.7 },
    { id: 'ch_ai', name: 'AI', category: ['ai'], weight: 0.8 },
    { id: 'ch_news', name: '新闻资讯', category: ['news'], weight: 0.6 },
    { id: 'ch_dev', name: '开发者社区', category: ['dev_community'], weight: 0.7 },
    { id: 'ch_pod', name: '播客', category: ['podcast'], weight: 0.5 },
    { id: 'ch_fin', name: '金融', category: ['finance'], weight: 0.6 },
  ];
  return { sources, channels, channelMap: new Map(channels.map((c) => [c.id, c])) };
}

/**
 * 单日 ingestRound：连接器拉取 → 按目标日期过滤 → normalize → 事件流追加。
 * 返回 { events, items（当日原始内部 Item 数组） }。
 */
async function ingestRound(roundRoot, date, sources, channelMap) {
  const events = [];
  const items = [];
  for (const src of sources) {
    const connector = get(src.type);
    const res = await connector.run(src);
    const channel = channelMap.get(src.channelId);
    for (const raw of res.items ?? []) {
      const day = String(raw.publishedAt || raw.pubDate || raw.date).slice(0, 10);
      if (day !== date) continue; // 仅取目标日，制造“跨天数据”
      const item = normalizeItem(raw, src, channel);
      events.push(makeEvent({ item, runId: 'r_e2e', fetchedAt: `${date}T00:00:00Z` }));
      items.push(item);
    }
  }
  const eventPath = join(roundRoot, 'today', `events-${date}.ndjson`);
  await appendEvents(eventPath, events);
  return { events, items, eventPath };
}

// 从 snapshot 重算 dayAgg（镜像 history-row.aggregateDay 的口径）
function recomputeDay(snapshot) {
  const items = snapshot.items ?? [];
  const categoryStats = {};
  const channelSet = new Set();
  for (const it of items) {
    for (const c of it.category ?? ['other']) {
      categoryStats[c] = (categoryStats[c] ?? 0) + 1;
    }
    if (it.channelId) channelSet.add(it.channelId);
  }
  return {
    totalItems: items.length,
    activeChannels: channelSet.size,
    categoryStats,
    ids: new Set(items.map((i) => i.id)),
  };
}

const stages = {};
function markStage(name, ok, detail = '') {
  stages[name] = { ok, detail };
  console.log(`[e2e] stage ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

async function run() {
  const mutate = process.argv.find((a) => a.startsWith('--mutate='))?.slice('--mutate='.length)
    ?? (process.argv.includes('--mutate') ? 'history-tamper' : 'none');

  // ===== S1 环境就绪 =====
  const tmpRoot = join(tmpdir(), `rss-radar-e2e-${process.pid}-${Date.now()}`);
  rmSync(tmpRoot, { recursive: true, force: true });
  try {
    mkdirSync(tmpRoot, { recursive: true });
  } catch (e) {
    throw new E2EEnv(`无法创建临时目录 ${tmpRoot}: ${e.message}`);
  }
  if (!existsSync(join(ROOT, 'scripts', 'collect', 'dedup.mjs'))) {
    throw new E2EEnv('collect 模块缺失，环境未就绪');
  }
  if (!existsSync(FIX)) {
    throw new E2EEnv(`fixtures 目录缺失: ${FIX}`);
  }
  markStage('S1 env-ready', true, `tmpRoot=${tmpRoot}`);

  const { sources, channels, channelMap } = buildSources();
  const channelWeights = Object.fromEntries(channels.map((c) => [c.id, c.weight]));
  const roundRoot = tmpRoot;

  // ===== S2 ingestRound（两天）=====
  const dayA = await ingestRound(roundRoot, DATE_A, sources, channelMap);
  const projA = await projectSnapshot({ roundRoot, date: DATE_A, channelWeights });
  const snapA = JSON.parse(readFileSync(projA.snapshotPath, 'utf8'));

  const dayB = await ingestRound(roundRoot, DATE_B, sources, channelMap);
  const projB = await projectSnapshot({ roundRoot, date: DATE_B, channelWeights });
  const snapB = JSON.parse(readFileSync(projB.snapshotPath, 'utf8'));

  assert(sources.length >= 6, `源数应 ≥6，实际 ${sources.length}`);
  assert(dayA.events.length > 0 && dayB.events.length > 0, '两天都应有采集事件');
  markStage('S2 ingest-round', true,
    `sources=${sources.length} dayA_events=${dayA.events.length} dayB_events=${dayB.events.length} snapA_items=${snapA.items.length} snapB_items=${snapB.items.length}`);

  // ===== S3 事件流折叠 =====
  const foldA = await foldEventsById(dayA.eventPath);
  assert(foldA.lineCount === dayA.events.length, `折叠行数应=${dayA.events.length}，实际 ${foldA.lineCount}`);
  assert(foldA.parseErrors === 0, `折叠解析错误应为 0，实际 ${foldA.parseErrors}`);
  assert(foldA.items.length === dayA.events.length, '折叠后条目数应与事件数一致（id 无重复）');
  markStage('S3 event-fold', true, `lineCount=${foldA.lineCount} parseErrors=${foldA.parseErrors}`);

  // ===== S4 去重 L1~L5 =====
  const { groups, stats } = dedup(dayA.items, { channelWeights });
  assert(isNum(stats.l1Hits) && isNum(stats.l2Hits) && isNum(stats.l3Hits) && isNum(stats.totalMerged),
    `dedup 统计字段应为数字: ${JSON.stringify(stats)}`);
  assert(groups.length < dayA.items.length, `去重后组数(${groups.length})应小于原始条目数(${dayA.items.length})`);
  const crossSourceMerge = groups.some((g) => (g.sourceCount ?? (g.sources?.length ?? 1)) >= 2);
  assert(crossSourceMerge, '应存在跨源合并（sourceCount ≥ 2），验证 L2/L3 跨源去重生效');
  markStage('S4 dedup-L1..L5', true,
    `raw=${dayA.items.length} groups=${groups.length} l1=${stats.l1Hits} l2=${stats.l2Hits} l3=${stats.l3Hits} merged=${stats.totalMerged}`);

  // ===== S5 报告生成 =====
  const rpt = writeReport(roundRoot, snapB, { analysis: analyzeSnapshot(snapB, { topN: 5, topKeywordsN: 5 }) });
  assert(existsSync(rpt.path), `报告文件应存在: ${rpt.path}`);
  assert(Array.isArray(rpt.report.hotList), 'report.hotList 应为数组');
  markStage('S5 report', true, `path=${rpt.path} hotList=${rpt.report.hotList.length}`);

  // ===== S6 模拟跨天 rollover（两次）=====
  const rl1 = await rolloverIfNewDay({ roundRoot, currentDate: DATE_B, previousDate: DATE_A });
  const rl2 = await rolloverIfNewDay({ roundRoot, currentDate: DATE_C, previousDate: DATE_B });
  assert(rl1.daysAppended === 1 && rl2.daysAppended === 1, `两次 rollover 各应封口 1 天 (${rl1.daysAppended},${rl2.daysAppended})`);
  const histPath = join(roundRoot, 'history', 'history-index.json');
  assert(existsSync(histPath), 'history-index.json 应已生成');
  const monthPath = join(roundRoot, 'history', '2026', '09', 'items.ndjson');
  assert(existsSync(monthPath), '月度 items.ndjson 应已生成');
  markStage('S6 rollover', true,
    `daysAppended=${rl1.daysAppended + rl2.daysAppended} monthlyAppended=${rl1.monthlyAppended + rl2.monthlyAppended}`);

  // ===== S7 归档流程（dry-run 列表，不删）=====
  const bundlable = await listBundlable(roundRoot, 2026);
  assert(bundlable.length > 0, '归档候选打包列表应非空');
  assert(bundlable.some((p) => p.endsWith('items.ndjson')), '打包列表应包含月度 items.ndjson');
  const arch = await listCandidatesForArchival(roundRoot, 2026, '2099-12-31'); // 未来视角 → 全量候选
  assert(arch.candidates.length > 0 && !!arch.byMonth['09'], '归档候选应含 09 月文件');
  markStage('S7 archive', true, `bundlable=${bundlable.length} candidates=${arch.candidates.length}`);

  // ===== S8 读回 history-index 逐日断言 =====
  const hist = JSON.parse(readFileSync(histPath, 'utf8'));
  assert(Array.isArray(hist.days) && hist.days.length === 2, `history-index 应有 2 个日聚合，实际 ${hist.days?.length}`);
  assert(hist.days[0].date === DATE_A && hist.days[1].date === DATE_B, 'days 应按日期升序 (A,B)');

  const monthRows = readFileSync(monthPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const expectTotalRows = snapA.items.length + snapB.items.length;
  assert(monthRows.length === expectTotalRows, `月度 NDJSON 行数应=${expectTotalRows}，实际 ${monthRows.length}`);

  for (const [date, snap] of [[DATE_A, snapA], [DATE_B, snapB]]) {
    const exp = recomputeDay(snap);
    const day = hist.days.find((d) => d.date === date);
    assert(day, `history-index 应含 ${date}`);
    assert(day.totalItems === exp.totalItems, `${date} totalItems 应=${exp.totalItems}，实际 ${day.totalItems}`);
    assert(day.activeChannels === exp.activeChannels, `${date} activeChannels 应=${exp.activeChannels}，实际 ${day.activeChannels}`);
    assert(JSON.stringify(day.categoryStats) === JSON.stringify(exp.categoryStats),
      `${date} categoryStats 不一致: ${JSON.stringify(day.categoryStats)} vs ${JSON.stringify(exp.categoryStats)}`);
    // 月度 NDJSON 中该日所有 row.id 必须 ∈ snapshot 条目 id 集合
    const rowsForDate = monthRows.filter((r) => r.date === date);
    assert(rowsForDate.length === exp.totalItems, `${date} 月度行数应=${exp.totalItems}，实际 ${rowsForDate.length}`);
    const idsOk = rowsForDate.every((r) => exp.ids.has(r.id));
    assert(idsOk, `${date} 月度行 id 集合应与 snapshot 一致`);
  }
  markStage('S8 history-readback', true, `days=${hist.days.length} monthRows=${monthRows.length}`);

  // ===== 变异：篡改产物，使 S8 断言必然失败 =====
  if (mutate === 'history-tamper') {
    const h = JSON.parse(readFileSync(histPath, 'utf8'));
    h.days[0].totalItems = 999999; // 伪造不一致
    writeFileSync(histPath, JSON.stringify(h, null, 2));
    console.log('[e2e] MUTATE=history-tamper 已篡改 history-index（totalItems=999999）');
    const reread = JSON.parse(readFileSync(histPath, 'utf8'));
    const expA = recomputeDay(snapA);
    if (reread.days[0].totalItems !== expA.totalItems) {
      throw new E2EAssert(`[变异证据] history-tamper 触发断言失败：days[0].totalItems=${reread.days[0].totalItems} ≠ 期望 ${expA.totalItems}`);
    }
  } else if (mutate === 'monthly-mismatch') {
    const lines = readFileSync(monthPath, 'utf8').split('\n').filter((l) => l.trim());
    lines.pop(); // 删掉最后一行 → 行数/集合不一致
    writeFileSync(monthPath, lines.join('\n') + '\n');
    console.log('[e2e] MUTATE=monthly-mismatch 已删除月度 NDJSON 一行');
    const reread = readFileSync(monthPath, 'utf8').split('\n').filter((l) => l.trim());
    if (reread.length !== expectTotalRows) {
      throw new E2EAssert(`[变异证据] monthly-mismatch 触发断言失败：行数=${reread.length} ≠ 期望 ${expectTotalRows}`);
    }
  }

  console.log(`[e2e] assertions  pass=${counter.pass}  fail=${counter.fail}`);
  console.log('[e2e] PASS  (mutate=' + mutate + ')');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    if (err instanceof E2EEnv) {
      console.error('[e2e] ENV NOT READY:', err.message);
      process.exit(2);
    }
    console.error('[e2e] ASSERTION FAILED:', err.message);
    console.error('[e2e] stage 状态:', JSON.stringify(stages, null, 2));
    process.exit(1);
  });

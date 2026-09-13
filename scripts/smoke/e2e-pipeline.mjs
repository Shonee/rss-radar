// scripts/smoke/e2e-pipeline.mjs
// T-P2-10 端到端管线测试（local fixture-based, no real network）
//
// 流程：
//   1) 安装 mock fetch（按 fixtures/url-health.txt 路由）
//   2) 用 fixtures/sources-fixture.json 配置（6 种 type 含 zipf/feishu/notion/api）
//   3) ingestRound：append-events + project-snapshot + writeReport
//   4) 模拟跨天 rolloverIfNewDay
//   5) URL 健康检查 fixture 跑通
//   6) 验证 events/snapshot/report/latest/history-index/月度 NDJSON 全产出
//
// 用法：node scripts/smoke/e2e-pipeline.mjs
// 或：npm run test:e2e

import { readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import '../collect/connectors/index.mjs';
import { appendEvents, makeEvent, foldEventsById } from '../collect/append-events.mjs';
import { projectSnapshot } from '../collect/project-snapshot.mjs';
import { analyzeSnapshot } from '../collect/analyze.mjs';
import { writeReport } from '../collect/report.mjs';
import { rolloverIfNewDay } from '../collect/history.mjs';
import { checkUrls, pickAlternate } from '../collect/url-health.mjs';
import { normalizeUrl, titleFingerprint } from '../collect/lib/url-norm.mjs';
import { keyOf, buildId } from '../collect/lib/dedup-key.mjs';
import { normalizeItem } from '../collect/normalize.mjs';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(__dirname, '..', '..');
const FIXTURE_DIR = join(__dirname, 'fixtures');
if (process.env.DEBUG_E2E) console.log('[e2e] FIXTURE_DIR:', FIXTURE_DIR);

function readFixture(name) {
  const full = join(FIXTURE_DIR, name);
  const result = readFileSync(full, 'utf8');
  if (process.env.DEBUG_E2E) console.log('[e2e] readFixture:', name, '→', result.length, 'chars');
  return result;
}

function loadMockHealthMap() {
  const text = readFixture('url-health.txt');
  const map = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [code, url] = line.split(':');
    map.set(url.trim(), parseInt(code.trim(), 10));
  }
  return map;
}

/** 安装 mock fetch（按 URL health map 路由 + feishu/notion/api 路径返回各自 fixture） */
function installMockFetch(healthMap) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const key = typeof url === 'string' ? url : url.url;
    function makeJson(body) {
      const json = typeof body === 'string' ? body : JSON.stringify(body);
      return new Response(json, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    if (key.includes('/auth/v3/tenant_access_token')) {
      return makeJson({ code: 0, tenant_access_token: 't-e2e', expire: 7200 });
    }
    if (key.includes('feishu') || key.includes('/bitable/v1/')) {
      const txt = readFixture('feishu-bitable.json');
      if (process.env.DEBUG_E2E) console.log('[mock] feishu body length:', txt.length, 'first 60:', txt.slice(0, 60));
      return new Response(txt, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (key.includes('notion') ) {
      const txt = readFixture('notion-db.json');
      if (process.env.DEBUG_E2E) console.log('[mock] notion body length:', txt.length);
      return new Response(txt, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (key.includes('/api') ) {
      const txt = readFixture('generic-api.json');
      return new Response(txt, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (key.includes('/feed-json')) {
      const txt = readFixture('feed-json.json');
      if (process.env.DEBUG_E2E) console.log('[mock] feed-json body length:', txt.length);
      return new Response(txt, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const code = healthMap.get(key) ?? 200;
    return new Response('', {
      status: code,
      headers: code === 200 ? { 'content-type': 'text/plain' } : {},
    });
  };
  return () => { globalThis.fetch = origFetch; };
}

/** 构造 normalize 后的 Item (raw → Item) */
function toInternalItem(raw, source, channel) {
  return normalizeItem({
    title: raw.title,
    link: raw.url ?? raw.link,
    guid: raw.guid ?? raw.id ?? raw.url ?? raw.link,
    pubDate: raw.publishedAt ?? raw.published_at,
    isoDate: raw.publishedAt ?? raw.published_at,
    contentSnippet: raw.summary,
  }, source, channel);
}

const stats = { totalSources: 0, okSources: 0, errSources: 0, totalItems: 0, historyDays: 0, snapshotsWritten: 0 };

async function main() {
  console.log('[e2e] start');
  const roundRoot = `${ROOT}/tmp/e2e-${Date.now()}`;
  rmSync(roundRoot, { recursive: true, force: true });
  const todayDir = join(roundRoot, 'today');

  const sources = JSON.parse(readFixture('sources-fixture.json'));
  const today = '2026-09-12';
  stats.totalSources = sources.sources.length;

  const healthMap = loadMockHealthMap();
  const restoreFetch = installMockFetch(healthMap);

  try {
    // 1) ingestRound：每个 source 一次抓取
    const events = [];
    const channelMap = new Map(sources.channels.map((c) => [c.id, c]));
    for (const src of sources.sources) {
      try {
        const connector = (await import('../collect/connectors/registry.mjs')).get(src.type);
        const res = await connector.run(src);
        const channel = channelMap.get(src.channelId);
        for (const raw of res.items) {
          const item = toInternalItem(raw, src, channel);
          events.push(makeEvent({ item, runId: 'r_e2e', fetchedAt: `${today}T00:00:00Z` }));
        }
        stats.okSources += 1;
      } catch (err) {
        if (process.env.DEBUG_E2E) console.error(`[e2e] source ${src.id} stack:`, err.stack);
        console.warn(`[e2e] source ${src.id} failed:`, err.message);
        stats.errSources += 1;
      }
    }
    stats.totalItems = events.length;

    const eventPath = join(todayDir, `events-${today}.ndjson`);
    await appendEvents(eventPath, events);

    // 2) 折叠 + 写 snapshot
    const proj = await projectSnapshot({
      roundRoot,
      date: today,
      channelWeights: Object.fromEntries(sources.channels.map((c) => [c.id, c.weight])),
      commit: 'e2e',
    });
    stats.snapshotsWritten += 1;
    console.log(`[e2e] snapshot: ${proj.snapshotPath}  items=${proj.itemCount}`);

    // 3) 分析 + 报告
    const snap = JSON.parse(readFileSync(proj.snapshotPath, 'utf8'));
    const analysis = analyzeSnapshot(snap, { topN: 5, topKeywordsN: 5 });
    const reportWritten = writeReport(roundRoot, snap, { analysis });
    console.log(`[e2e] report: ${reportWritten.path}  hotList=${analysis.hotList.length}`);

    // 4) URL 健康检查 fixture：5 个 URL
    const urls = [
      'https://example.test/rss1',
      'https://example.test/dead',
      'https://example.test/blocked',
      'https://example.test/gone',
      'https://example.test/redirect',
    ];
    const health = await checkUrls(urls, { _fetch: globalThis.fetch, concurrency: 4 });
    console.log(`[e2e] url-health: ${health.records.length} URLs  byStatus=${Object.fromEntries(['ok','dead','moved','blocked'].map((s) => [s, health.records.filter((r) => r.status === s).length]))}`);

    // 5) 跨天 rollover
    const rl = await rolloverIfNewDay({
      roundRoot,
      currentDate: '2026-09-13',
      previousDate: '2026-09-12',
      snapshotByDate: { '2026-09-12': snap },
    });
    stats.historyDays = rl.daysAppended;
    console.log(`[e2e] rollover: monthAppended=${rl.monthlyAppended}  daysAppended=${rl.daysAppended}  sealed=${rl.sealed}`);

    // 6) verify artifacts
    const artifacts = {
      event: existsSync(eventPath),
      snapshot: existsSync(proj.snapshotPath),
      latest: existsSync(proj.latestPath),
      report: reportWritten.path && existsSync(reportWritten.path),
      historyIndex: existsSync(join(roundRoot, 'history', 'history-index.json')),
      monthlyNdjson: existsSync(join(roundRoot, 'history', '2026', '09', 'items.ndjson')),
    };
    console.log('[e2e] artifacts:', artifacts);
    for (const [k, v] of Object.entries(artifacts)) {
      if (!v) throw new Error(`artifact missing: ${k}`);
    }

    // 7) pickAlternate 派生
    const { alternateMap } = deriveAlternateMap(itemsFromProject(proj.itemCount, snap));
    console.log(`[e2e] pickAlternate: ${alternateMap.size} items with alternateUrl`);
  } finally {
    restoreFetch();
  }

  console.log('[e2e] stats:', stats);
  console.log('[e2e] PASS');
}

function itemsFromProject(_count, snap) {
  return snap.items;
}

function deriveAlternateMap(items) {
  const alternateMap = new Map();
  for (const it of items) {
    const alt = pickAlternate(it);
    if (alt) alternateMap.set(it.id, alt);
  }
  return { alternateMap };
}

main().catch((err) => {
  console.error('[e2e] FATAL:', err);
  process.exit(1);
});

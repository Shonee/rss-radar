// scripts/collect/__tests__/url-health.test.mjs — URL 健康检查单测
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { checkOneUrl, classifyHttpStatus } from '../lib/url-checker.mjs';
import {
  checkUrls,
  transition,
  pickAlternate,
  nextRecheckStrategy,
  poolUrls,
  persistSourceHealth,
} from '../url-health.mjs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ===== url-checker 单元 =====

test('classifyHttpStatus：200/204 → ok；301/308 → moved；302/303/307 → ok；404/410 → dead；403/429 → blocked；5xx → unknown', () => {
  assert.strictEqual(classifyHttpStatus(200), 'ok');
  assert.strictEqual(classifyHttpStatus(204), 'ok');
  assert.strictEqual(classifyHttpStatus(301), 'moved');
  assert.strictEqual(classifyHttpStatus(308), 'moved');
  assert.strictEqual(classifyHttpStatus(302), 'ok');
  assert.strictEqual(classifyHttpStatus(307), 'ok');
  assert.strictEqual(classifyHttpStatus(404), 'dead');
  assert.strictEqual(classifyHttpStatus(410), 'dead');
  assert.strictEqual(classifyHttpStatus(403), 'blocked');
  assert.strictEqual(classifyHttpStatus(429), 'blocked');
  assert.strictEqual(classifyHttpStatus(500), 'unknown');
  assert.strictEqual(classifyHttpStatus(503), 'unknown');
});

// 模拟 fetch：返回指定 httpStatus
function mockFetch(map) {
  return async function _fetch(url, opts = {}) {
    const m = map[url];
    if (!m) {
      return new Response('', { status: 599 }); // 网络错误占位
    }
    if (typeof m === 'number') {
      return new Response('', { status: m });
    }
    // { status, headers, method? }
    const status = m[opts.method ?? 'GET'] ?? m.GET ?? 200;
    const headers = m.headers ?? {};
    return new Response('', { status, headers });
  };
}

test('checkOneUrl：HEAD 200 → ok，method=HEAD', async () => {
  const r = await checkOneUrl('https://example.com/a', {
    _fetch: mockFetch({ 'https://example.com/a': { HEAD: 200 } }),
    timeoutMs: 1000,
  });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.httpStatus, 200);
  assert.strictEqual(r.method, 'HEAD');
});

test('checkOneUrl：HEAD 405 → 降级 GET Range: bytes=0-0，method=GET', async () => {
  const seen = [];
  const _fetch = async (url, opts = {}) => {
    seen.push({ method: opts.method, headers: opts.headers });
    if (opts.method === 'HEAD') return new Response('', { status: 405 });
    return new Response('', { status: 200 });
  };
  const r = await checkOneUrl('https://example.com/b', { _fetch, timeoutMs: 1000 });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.method, 'GET');
  assert.strictEqual(seen.length, 2);
  assert.strictEqual(seen[0].method, 'HEAD');
  assert.strictEqual(seen[1].method, 'GET');
  assert.ok(seen[1].headers.Range === 'bytes=0-0');
});

test('checkOneUrl：HEAD 501 → 降级 GET', async () => {
  const _fetch = async (url, opts = {}) => {
    if (opts.method === 'HEAD') return new Response('', { status: 501 });
    return new Response('', { status: 200 });
  };
  const r = await checkOneUrl('https://example.com/c', { _fetch, timeoutMs: 1000 });
  assert.strictEqual(r.method, 'GET');
  assert.strictEqual(r.status, 'ok');
});

test('checkOneUrl：HEAD 404 → dead', async () => {
  const r = await checkOneUrl('https://example.com/missing', {
    _fetch: mockFetch({ 'https://example.com/missing': { HEAD: 404 } }),
  });
  assert.strictEqual(r.status, 'dead');
  assert.strictEqual(r.httpStatus, 404);
});

test('checkOneUrl：HEAD 403 → blocked', async () => {
  const r = await checkOneUrl('https://example.com/locked', {
    _fetch: mockFetch({ 'https://example.com/locked': { HEAD: 403 } }),
  });
  assert.strictEqual(r.status, 'blocked');
});

test('checkOneUrl：HEAD 301 + Location → moved + location', async () => {
  const _fetch = async () => new Response('', { status: 301, headers: { location: 'https://new.example.com/x' } });
  const r = await checkOneUrl('https://example.com/redir', { _fetch, timeoutMs: 1000 });
  assert.strictEqual(r.status, 'moved');
  assert.strictEqual(r.location, 'https://new.example.com/x');
});

test('checkOneUrl：HEAD 500 → unknown（保持 prev），不报错', async () => {
  const r = await checkOneUrl('https://example.com/err5xx', {
    _fetch: mockFetch({ 'https://example.com/err5xx': { HEAD: 500 } }),
  });
  assert.strictEqual(r.status, 'unknown');
});

// ===== transition 状态机 =====

test('transition：prev=ok + cur=ok → ok', () => {
  assert.strictEqual(transition('ok', 'ok'), 'ok');
});
test('transition：prev=ok + cur=moved → moved（清 pending）', () => {
  assert.strictEqual(transition('ok', 'moved'), 'moved');
});
test('transition：prev=ok + cur=dead → pendingDead（防抖首轮）', () => {
  assert.strictEqual(transition('ok', 'dead'), 'pendingDead');
});
test('transition：prev=pendingDead + cur=dead → dead（防抖次轮）', () => {
  assert.strictEqual(transition('pendingDead', 'dead'), 'dead');
});
test('transition：prev=pendingDead + cur=ok → ok（恢复）', () => {
  assert.strictEqual(transition('pendingDead', 'ok'), 'ok');
});
test('transition：prev=ok + cur=blocked → blocked（blocked 即时生效）', () => {
  assert.strictEqual(transition('ok', 'blocked'), 'blocked');
});
test('transition：prev=dead + cur=ok → ok（恢复）', () => {
  assert.strictEqual(transition('dead', 'ok'), 'ok');
});
test('transition：prev=ok + cur=unknown → ok（保持）', () => {
  assert.strictEqual(transition('ok', 'unknown'), 'ok');
});
test('transition：prev=undefined + cur=ok → ok（首次）', () => {
  assert.strictEqual(transition(undefined, 'ok'), 'ok');
});

// ===== checkUrls 编排 =====

test('checkUrls：10 个 mock URL 分类正确', async () => {
  const urls = [
    'https://example.com/ok1',
    'https://example.com/ok2',
    'https://example.com/missing',
    'https://example.com/gone',
    'https://example.com/blocked',
    'https://example.com/ratelimit',
    'https://example.com/redir',
    'https://example.com/temp-redirect',
    'https://example.com/server-error',
    'https://example.com/another-ok',
  ];
  const statusMap = {
    'https://example.com/ok1': 200,
    'https://example.com/ok2': 200,
    'https://example.com/missing': 404,
    'https://example.com/gone': 410,
    'https://example.com/blocked': 403,
    'https://example.com/ratelimit': 429,
    'https://example.com/redir': 301,
    'https://example.com/temp-redirect': 302,
    'https://example.com/server-error': 500,
    'https://example.com/another-ok': 200,
  };
  const r = await checkUrls(urls, {
    _fetch: mockFetch(statusMap),
    concurrency: 4,
    perHostIntervalMs: 0, // 测试用，跳过 1s 间隔
  });
  assert.equal(r.records.length, 10);
  const byUrl = Object.fromEntries(r.records.map((rec) => [rec.url, rec.status]));
  assert.strictEqual(byUrl['https://example.com/ok1'], 'ok');
  assert.strictEqual(byUrl['https://example.com/missing'], 'pendingDead'); // 首次 404 → pendingDead
  assert.strictEqual(byUrl['https://example.com/gone'], 'pendingDead');
  assert.strictEqual(byUrl['https://example.com/blocked'], 'blocked');
  assert.strictEqual(byUrl['https://example.com/ratelimit'], 'blocked');
  assert.strictEqual(byUrl['https://example.com/redir'], 'moved');
  assert.strictEqual(byUrl['https://example.com/temp-redirect'], 'ok');
  // 5xx → unknown（raw），transition 后 prev=undefined → 'ok'（保持）
  // record.status 是 transition 后值，raw 看 r.results
  assert.strictEqual(byUrl['https://example.com/server-error'], 'ok');
  // raw results 仍记录 unknown
  const raws = r.results;
  const errRaw = raws.find((x) => x && (x.method === 'HEAD' || x.method === 'GET'));
  // 至少有一个 raw unknown（5xx）
  const fivexxRaw = raws.find((x) => x && x.status === 'unknown');
  assert.ok(fivexxRaw, 'raw results 应含 5xx → unknown 分类');
});

test('checkUrls：同一 URL 连续 2 轮 404 → dead（防误杀两轮）', async () => {
  const url = 'https://example.com/404';
  // 第 1 轮
  const r1 = await checkUrls([url], { _fetch: mockFetch({ [url]: 404 }), perHostIntervalMs: 0 });
  assert.strictEqual(r1.records[0].status, 'pendingDead');
  // 第 2 轮（prev=pendingDead）
  const r2 = await checkUrls([url], {
    _fetch: mockFetch({ [url]: 404 }),
    prevStatuses: { [url]: 'pendingDead' },
    perHostIntervalMs: 0,
  });
  assert.strictEqual(r2.records[0].status, 'dead');
});

test('checkUrls：max=200 单轮硬上限', async () => {
  const urls = Array.from({ length: 250 }, (_, i) => `https://example.com/u${i}`);
  const r = await checkUrls(urls, {
    _fetch: mockFetch(Object.fromEntries(urls.map((u) => [u, 200]))),
    concurrency: 4,
    perHostIntervalMs: 0,
    max: 200,
  });
  assert.equal(r.records.length, 200);
  assert.equal(r.stats.total, 250);
  assert.equal(r.stats.checked, 200);
  assert.equal(r.stats.overflow, 50);
});

test('checkUrls：urlCheckedAt 写回（ISO 8601）', async () => {
  const r = await checkUrls(['https://example.com/x'], {
    _fetch: mockFetch({ 'https://example.com/x': 200 }),
    perHostIntervalMs: 0,
  });
  assert.ok(r.records[0].urlCheckedAt);
  assert.match(r.records[0].urlCheckedAt, /^\d{4}-\d{2}-\d{2}T/);
});

// ===== pickAlternate =====

test('pickAlternate：主 URL 仍 ok → null（不需要备用）', () => {
  const item = { url: 'https://a.com/x', urlStatus: 'ok', sources: [{ channelId: 'a', url: 'https://a.com/x' }] };
  assert.strictEqual(pickAlternate(item), null);
});

test('pickAlternate：主 dead + 备用 ok → 返回备用 URL（按 success_time DESC）', () => {
  const item = {
    url: 'https://a.com/x',
    urlStatus: 'dead',
    sources: [
      { channelId: 'a', url: 'https://a.com/x', urlStatus: 'dead', publishedAt: '2026-09-12T00:00:00Z' },
      { channelId: 'b', url: 'https://b.com/x', urlStatus: 'ok', publishedAt: '2026-09-12T00:00:00Z' },
      { channelId: 'c', url: 'https://c.com/x', urlStatus: 'ok', publishedAt: '2026-09-12T00:00:00Z' },
    ],
  };
  const successTime = {
    'https://a.com/x': '2026-09-12T01:00:00Z',
    'https://b.com/x': '2026-09-12T03:00:00Z', // 最新
    'https://c.com/x': '2026-09-12T02:00:00Z',
  };
  const r = pickAlternate(item, successTime);
  assert.strictEqual(r, 'https://b.com/x'); // 最新的 success_time
});

test('pickAlternate：success_time 相同 → weight DESC 优先', () => {
  const item = {
    url: 'https://a.com/x',
    urlStatus: 'dead',
    sources: [
      { channelId: 'a', url: 'https://a.com/x', urlStatus: 'dead' },
      { channelId: 'b', url: 'https://b.com/x', urlStatus: 'ok' },
      { channelId: 'c', url: 'https://c.com/x', urlStatus: 'ok' },
    ],
  };
  const successTime = {
    'https://a.com/x': '2026-09-12T01:00:00Z',
    'https://b.com/x': '2026-09-12T02:00:00Z',
    'https://c.com/x': '2026-09-12T02:00:00Z',
  };
  const r = pickAlternate(item, successTime, { b: 0.3, c: 0.9 });
  assert.strictEqual(r, 'https://c.com/x'); // weight 0.9 优先
});

test('pickAlternate：全部 dead → null', () => {
  const item = {
    url: 'https://a.com/x',
    urlStatus: 'dead',
    sources: [
      { channelId: 'a', url: 'https://a.com/x', urlStatus: 'dead' },
      { channelId: 'b', url: 'https://b.com/x', urlStatus: 'dead' },
    ],
  };
  assert.strictEqual(pickAlternate(item), null);
});

test('pickAlternate：item.alternateUrl 已存在 → 直接返回（不重算）', () => {
  const item = {
    url: 'https://a.com/x',
    urlStatus: 'dead',
    alternateUrl: 'https://memo.example.com/x',
    sources: [],
  };
  assert.strictEqual(pickAlternate(item), 'https://memo.example.com/x');
});

// ===== nextRecheckStrategy =====

test('nextRecheckStrategy：dead 每日、blocked 每周、moved/ok 不复查', () => {
  assert.strictEqual(nextRecheckStrategy('dead'), 'daily');
  assert.strictEqual(nextRecheckStrategy('blocked'), 'weekly');
  assert.strictEqual(nextRecheckStrategy('moved'), null);
  assert.strictEqual(nextRecheckStrategy('ok'), null);
  assert.strictEqual(nextRecheckStrategy('pendingDead'), null);
});

// ===== poolUrls 并发 + 同 host 串行 =====

test('poolUrls：同 host 串行 1s 间隔（2 URL 同 host + 1 异 host）', async () => {
  const times = [];
  const t0 = Date.now();
  const fakeFetch = async (url) => {
    times.push({ url, at: Date.now() - t0 });
    return new Response('', { status: 200 });
  };
  const urls = [
    'https://a.example.com/x',
    'https://a.example.com/y',
    'https://b.example.com/z',
  ];
  await poolUrls(urls, {
    concurrency: 4,
    perHostIntervalMs: 50, // 测试用 50ms，避免 1s 默认慢测试
    worker: (u) => fakeFetch(u),
  });
  // 同 host a.x 和 a.y 间隔应 ≥ 50ms
  const a1 = times.find((t) => t.url === 'https://a.example.com/x');
  const a2 = times.find((t) => t.url === 'https://a.example.com/y');
  assert.ok(a2.at - a1.at >= 50, `a.y 应在 a.x 50ms 后，实际间隔 ${a2.at - a1.at}ms`);
});

// ===== persistSourceHealth =====

test('persistSourceHealth：回写 lastFetchAt/lastStatus/lastError 到 sources.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rss-radar-health-'));
  try {
    const sourcesPath = join(root, 'sources.json');
    const sources = [
      { id: 'src-a', channelId: 'ch-a', url: 'https://a.com/x', type: 'rss', name: 'A', enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'src-b', channelId: 'ch-b', url: 'https://b.com/y', type: 'atom', name: 'B', enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ];
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(sourcesPath, JSON.stringify({ channels: [], sources }, null, 2), 'utf8');

    const records = [
      { url: 'https://a.com/x', status: 'ok' },
      { url: 'https://b.com/y', status: 'blocked' },
    ];
    const r = await persistSourceHealth(sourcesPath, sources, records);
    assert.equal(r.mutated, true);
    const updated = JSON.parse(await readFile(sourcesPath, 'utf8'));
    assert.strictEqual(updated.sources[0].lastStatus, 'ok');
    assert.ok(updated.sources[0].lastFetchAt);
    assert.strictEqual(updated.sources[1].lastStatus, 'blocked');
  } finally {
    await rm(root, { recursive: true });
  }
});

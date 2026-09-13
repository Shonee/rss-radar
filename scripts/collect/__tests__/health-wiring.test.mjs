// scripts/collect/__tests__/health-wiring.test.mjs
// T-P2-B.3：验证 runSourceHealthCheck 真的把 lastStatus 写回 config/sources.json
// 这是 P1 裁决 C → P2-A 裁决 C → P2-B QA 裁决 B-1 挂了三轮的旧账：
// 此前 persistSourceHealth 只有定义 + 单测，生产零调用方。
// 本测试用注入 _fetch 打桩，不触网，验证「接线后真的写」而非「函数存在」。
import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSourceHealthCheck } from '../main.mjs';

/** 保存并恢复全局 fetch，避免污染其他测试文件 */
let origFetch;

before(() => {
  origFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = origFetch;
});

/** 安装桩 fetch：按 url → status 映射返回，永不触网 */
function installStubFetch(statusMap) {
  globalThis.fetch = async (url) => {
    const key = typeof url === 'string' ? url : url.url;
    const status = statusMap[key] ?? 200;
    return new Response('', { status });
  };
}

/** 造一份最小 sources 配置 */
function makeSources() {
  return {
    schemaVersion: '1.0',
    channels: [{ id: 'ch-a', name: 'A', homepage: 'https://a.example.com', category: ['tech_blog'], enabled: true }],
    sources: [
      { id: 'src-ok', channelId: 'ch-a', name: 'OK', type: 'rss', url: 'https://a.example.com/feed.xml', enabled: true },
      { id: 'src-404', channelId: 'ch-a', name: 'Gone', type: 'rss', url: 'https://b.example.com/gone', enabled: true },
      { id: 'src-403', channelId: 'ch-a', name: 'Blocked', type: 'rss', url: 'https://c.example.com/blocked', enabled: true },
    ],
  };
}

describe('runSourceHealthCheck（T-P2-B.3 lastStatus 生产接线）', () => {
  it('首轮：写回 lastFetchAt / lastStatus / lastError，404 落 pendingDead（防抖）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rss-radar-health-'));
    const path = join(dir, 'sources.json');
    const sources = makeSources();
    await writeFile(path, JSON.stringify(sources, null, 2), 'utf8');

    installStubFetch({
      'https://a.example.com/feed.xml': 200,
      'https://b.example.com/gone': 404,
      'https://c.example.com/blocked': 403,
    });

    try {
      const r = await runSourceHealthCheck({
        sources,
        dueSources: sources.sources,
        sourcesJsonPath: path,
        concurrency: 6,
      });

      // 返回值
      assert.strictEqual(r.checked, 3, '三个源都该被检查');
      assert.strictEqual(r.persisted.mutated, true, '应触发写回');
      assert.strictEqual(r.stats.ok, 1);
      assert.strictEqual(r.stats.blocked, 1);
      assert.strictEqual(r.stats.pendingDead, 1, '404 首轮应落 pendingDead 而非 dead');

      // **关键**：真的落盘了（此前三轮都没落）
      const after = JSON.parse(await readFile(path, 'utf8'));
      const byId = Object.fromEntries(after.sources.map((s) => [s.id, s]));

      assert.strictEqual(byId['src-ok'].lastStatus, 'ok');
      assert.strictEqual(byId['src-404'].lastStatus, 'pendingDead');
      assert.strictEqual(byId['src-403'].lastStatus, 'blocked');

      // lastFetchAt 全部写入 ISO 8601
      for (const id of ['src-ok', 'src-404', 'src-403']) {
        assert.match(byId[id].lastFetchAt, /^\d{4}-\d{2}-\d{2}T/, `${id} 缺 lastFetchAt`);
      }

      // 结构未被破坏：channels 保留
      assert.strictEqual(after.channels.length, 1);
      assert.strictEqual(after.sources.length, 3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('次轮：prev=pendingDead + 仍 404 → 落 dead（两轮防抖动跨轮生效）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rss-radar-health2-'));
    const path = join(dir, 'sources.json');
    const sources = makeSources();
    // 模拟上一轮已写入 pendingDead
    sources.sources[1].lastStatus = 'pendingDead';
    await writeFile(path, JSON.stringify(sources, null, 2), 'utf8');

    installStubFetch({
      'https://a.example.com/feed.xml': 200,
      'https://b.example.com/gone': 404,
      'https://c.example.com/blocked': 403,
    });

    try {
      await runSourceHealthCheck({
        sources,
        dueSources: sources.sources,
        sourcesJsonPath: path,
        concurrency: 6,
      });

      const after = JSON.parse(await readFile(path, 'utf8'));
      const byId = Object.fromEntries(after.sources.map((s) => [s.id, s]));
      assert.strictEqual(byId['src-404'].lastStatus, 'dead', '第二轮仍 404 应落 dead');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('只检查 dueSources：disabled 源不进检查、不被写状态', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rss-radar-health3-'));
    const path = join(dir, 'sources.json');
    const sources = makeSources();
    await writeFile(path, JSON.stringify(sources, null, 2), 'utf8');

    installStubFetch({ 'https://a.example.com/feed.xml': 200 });

    try {
      const r = await runSourceHealthCheck({
        sources,
        dueSources: [sources.sources[0]], // 只跑第一个源
        sourcesJsonPath: path,
        concurrency: 6,
      });
      assert.strictEqual(r.checked, 1);

      const after = JSON.parse(await readFile(path, 'utf8'));
      const byId = Object.fromEntries(after.sources.map((s) => [s.id, s]));
      assert.strictEqual(byId['src-ok'].lastStatus, 'ok');
      assert.strictEqual(byId['src-404'].lastStatus, undefined, '未采集的源不该被写状态');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('dueSources 为空 → checked=0 且不写盘', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rss-radar-health4-'));
    const path = join(dir, 'sources.json');
    const sources = makeSources();
    await writeFile(path, JSON.stringify(sources, null, 2), 'utf8');

    installStubFetch({});

    try {
      const r = await runSourceHealthCheck({
        sources,
        dueSources: [],
        sourcesJsonPath: path,
      });
      assert.strictEqual(r.checked, 0);
      assert.strictEqual(r.persisted.mutated, false);
      const after = JSON.parse(await readFile(path, 'utf8'));
      assert.strictEqual(after.sources[0].lastStatus, undefined, '空 dueSources 不应写状态');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('网络故障归 unknown，不抛错也【不误标 ok】（ARCH §15.1 本轮未知不改写）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rss-radar-health5-'));
    const path = join(dir, 'sources.json');
    const sources = makeSources();
    await writeFile(path, JSON.stringify(sources, null, 2), 'utf8');

    // 桩 fetch 直接抛错，模拟网络层故障
    globalThis.fetch = async () => {
      throw new Error('network down');
    };

    try {
      // 关键点 1：网络故障不抛异常（checkOneUrl 内部兜底为 unknown）
      // —— ARCH §15.1「网络超时/连接拒绝单独记为本轮未知」
      const r = await runSourceHealthCheck({
        sources,
        dueSources: sources.sources,
        sourcesJsonPath: path,
      });
      assert.strictEqual(r.checked, 3);
      assert.strictEqual(r.stats.unknown, 3, '三条都该归 unknown');

      // 关键点 2：从未检查过的源（无 lastStatus）在网络故障时必须落 unknown，
      // 不能被 transition 的 prev ?? 'ok' 兜成 'ok'（那会造成假绿）
      const after = JSON.parse(await readFile(path, 'utf8'));
      const byId = Object.fromEntries(after.sources.map((s) => [s.id, s]));
      for (const id of ['src-ok', 'src-404', 'src-403']) {
        assert.strictEqual(byId[id].lastStatus, 'unknown', `${id} 网络故障时应为 unknown，不能误标 ok`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('网络故障不覆写既有 dead 状态（unknown 保持原状态）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rss-radar-health6-'));
    const path = join(dir, 'sources.json');
    const sources = makeSources();
    sources.sources[1].lastStatus = 'dead'; // 上一轮已确认失效
    await writeFile(path, JSON.stringify(sources, null, 2), 'utf8');

    globalThis.fetch = async () => {
      throw new Error('network down');
    };

    try {
      await runSourceHealthCheck({
        sources,
        dueSources: sources.sources,
        sourcesJsonPath: path,
      });

      const after = JSON.parse(await readFile(path, 'utf8'));
      const byId = Object.fromEntries(after.sources.map((s) => [s.id, s]));
      assert.strictEqual(byId['src-404'].lastStatus, 'dead', '临时网络故障不应把已确认的 dead 洗白');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

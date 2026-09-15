// T-P3-01 前端基础设施 — dataClient 三层降级单测
// 覆盖：raw 成功 / raw 全挂→jsdelivr 挂→local 成功 / 指针 report 缺位 /
//       raw 指针成功但快照失败 → jsdelivr 用 commit 回退 / stale 判定
import { describe, it, expect } from 'vitest';
import { loadLatest, isStale } from '../dataClient';
import type { FetchLike } from '../dataClient';

const RAW = 'https://raw.githubusercontent.com/Shonee/rss-radar/deploy/';
const JSDELIVR_ABC = 'https://cdn.jsdelivr.net/gh/Shonee/rss-radar@abc123/';
const LOCAL = './data/';

function makeSnapshot(date = '2026-09-14', generatedAt = '2026-09-14T00:00:00Z') {
  return {
    schemaVersion: '1.0',
    date,
    timezone: 'Asia/Shanghai',
    generatedAt,
    stats: { sourceTotal: 1, sourceOk: 1, sourceFailed: 0, itemsBeforeDedup: 1, itemsAfterDedup: 1 },
    items: [],
  };
}

function makePointer(
  date = '2026-09-14',
  generatedAt = '2026-09-14T00:00:00Z',
  commit = 'abc123',
) {
  return {
    date,
    generatedAt,
    snapshotPath: `today/snapshot-${date}.json`,
    reportPath: `today/report-${date}.json`,
    eventPath: `today/events-${date}.ndjson`,
    commit,
  };
}

function makeReport(date = '2026-09-14') {
  return {
    schemaVersion: '1.0',
    date,
    timezone: 'Asia/Shanghai',
    generatedAt: `${date}T00:00:00Z`,
    totalItems: 0,
    activeChannels: 0,
    categoryStats: [],
    hotList: [],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const notFound = (): Response => new Response('not found', { status: 404 });

describe('loadLatest — 三层降级', () => {
  it('① raw 成功：指针 + 快照 + 报告均命中', async () => {
    const now = Date.parse('2026-09-14T00:00:00Z');
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${RAW}today/latest.json`) return json(makePointer());
      if (url === `${RAW}today/snapshot-2026-09-14.json`) return json(makeSnapshot());
      if (url === `${RAW}today/report-2026-09-14.json`) return json(makeReport());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: false, now });
    expect(res.source).toBe('raw');
    expect(res.stale).toBe(false);
    expect(res.data.snap.date).toBe('2026-09-14');
    expect(res.data.rep?.date).toBe('2026-09-14');
  });

  it('② raw 全挂 → jsdelivr 挂 → local 兜底成功', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.startsWith('https://')) throw new Error('network down');
      if (url === `${LOCAL}today/latest.json`) return json(makeSnapshot());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: false, now: Date.now() });
    expect(res.source).toBe('local');
    expect(res.data.rep).toBeNull();
    expect(res.data.snap.date).toBe('2026-09-14');
  });

  it('③ 指针里 report 缺位不算失败（rep=null，source=raw）', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${RAW}today/latest.json`) return json(makePointer());
      if (url === `${RAW}today/snapshot-2026-09-14.json`) return json(makeSnapshot());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: false, now: Date.now() });
    expect(res.source).toBe('raw');
    expect(res.data.rep).toBeNull();
  });

  it('④ raw 指针成功但快照失败 → jsdelivr 用指针 commit 版本化回退', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${RAW}today/latest.json`) return json(makePointer('2026-09-14', '2026-09-14T00:00:00Z', 'abc123'));
      if (url === `${RAW}today/snapshot-2026-09-14.json`) return notFound();
      if (url === `${JSDELIVR_ABC}today/latest.json`) return json(makePointer());
      if (url === `${JSDELIVR_ABC}today/snapshot-2026-09-14.json`) return json(makeSnapshot());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: false, now: Date.now() });
    expect(res.source).toBe('jsdelivr');
    expect(res.data.snap.date).toBe('2026-09-14');
  });

  it('⑤ generatedAt 超 120 分钟（两个采集周期）→ stale=true；缺失/非法亦为 true', async () => {
    const now = Date.parse('2026-09-14T10:00:00Z');
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${RAW}today/latest.json`) return json(makePointer('2026-09-14', '2026-09-14T07:00:00Z'));
      if (url === `${RAW}today/snapshot-2026-09-14.json`) return json(makeSnapshot('2026-09-14', '2026-09-14T07:00:00Z'));
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: false, now });
    expect(res.stale).toBe(true);

    expect(isStale(undefined, now)).toBe(true);
    expect(isStale('not-a-date', now)).toBe(true);
    // 每小时采集下的典型年龄（30 分钟 / 60 分钟 / 90 分钟）必须都判 fresh，
    // 否则「数据可能非最新」黄条会在正常运行时持续误报。
    expect(isStale('2026-09-14T09:30:00Z', now)).toBe(false);
    expect(isStale('2026-09-14T09:00:00Z', now)).toBe(false);
    expect(isStale('2026-09-14T08:30:00Z', now)).toBe(false);
    // 边界：恰好 120 分钟不算过期（判定用 `>`）
    expect(isStale('2026-09-14T08:00:00Z', now)).toBe(false);
    // 超出一个采集周期才判 stale
    expect(isStale('2026-09-14T07:59:00Z', now)).toBe(true);
  });

  it('⑥ 全部来源失败时抛出错误', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('offline');
    };
    await expect(loadLatest({ _fetch: fetchImpl, preferLocal: false })).rejects.toThrow(/offline/);
  });
});

// scripts/collect/__tests__/history-rollover.test.mjs — 次日转换 rollover 单测
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rolloverIfNewDay } from '../history.mjs';
import {
  toHistoryRow,
  aggregateDay,
  estimateRowBytes,
  appendOrUpdateDay,
  newHistoryIndex,
} from '../lib/history-row.mjs';

async function mkRoot() {
  return mkdtemp(join(tmpdir(), 'rss-radar-rollover-'));
}

function makeSnapshot(over = {}) {
  return {
    schemaVersion: '1.0',
    date: '2026-09-11',
    timezone: 'Asia/Shanghai',
    generatedAt: '2026-09-11T15:00:00Z',
    stats: {
      sourceTotal: 3,
      sourceOk: 3,
      sourceFailed: 0,
      itemsBeforeDedup: 10,
      itemsAfterDedup: 8,
      mergedCount: 2,
      sources: [
        { channelId: 'ch_a', channelName: 'A', itemCount: 5 },
        { channelId: 'ch_b', channelName: 'B', itemCount: 3 },
      ],
    },
    items: [
      {
        id: 'it_aaa', dedupKey: 'dk1', title: 'A1', url: 'https://a.com/1',
        channelId: 'ch_a', channelName: 'A', category: ['tech_blog'],
        publishedAt: '2026-09-11T10:00:00Z', updatedAt: '2026-09-11T10:00:00Z',
        sourceCount: 1, hotScore: 0.7,
      },
      {
        id: 'it_bbb', dedupKey: 'dk2', title: 'B1', url: 'https://b.com/1',
        channelId: 'ch_b', channelName: 'B', category: ['news', 'ai'],
        publishedAt: '2026-09-11T11:00:00Z', updatedAt: '2026-09-11T11:00:00Z',
        sourceCount: 2, hotScore: 0.5,
      },
    ],
    ...over,
  };
}

test('toHistoryRow 精简字段：不含 summary/sources', () => {
  const item = {
    id: 'it_x', dedupKey: 'dk', title: 'T', url: 'https://x.com/1',
    channelId: 'ch_a', channelName: 'A', category: ['tech_blog'],
    publishedAt: '2026-09-11T10:00:00Z', updatedAt: '2026-09-11T10:00:00Z',
    sourceCount: 1, hotScore: 0.7,
    summary: '很长很长的摘要', author: 'someone',
    sources: [{ channelId: 'x', channelName: 'X', url: 'https://x.com/1' }],
  };
  const row = toHistoryRow(item, '2026-09-11');
  for (const k of Object.keys(row)) {
    assert.notEqual(k, 'summary', '精简行不应含 summary');
    assert.notEqual(k, 'sources', '精简行不应含 sources');
    assert.notEqual(k, 'author', '精简行不应含 author');
  }
  assert.equal(row.id, 'it_x');
  assert.equal(row.date, '2026-09-11');
  assert.equal(row.hotScore, 0.7);
  // 体积断言（schema 约定 ~300B/行）
  const bytes = estimateRowBytes(row);
  assert.ok(bytes < 600, `单行应 < 600B（含 newline），实际 ${bytes}`);
});

test('aggregateDay 计算 categoryStats/totalItems/activeChannels', () => {
  const snap = makeSnapshot();
  const day = aggregateDay({
    date: '2026-09-11',
    snapshot: snap,
    topIds: ['it_aaa'],
    topKeywords: ['ai', 'openai'],
  });
  assert.equal(day.date, '2026-09-11');
  assert.equal(day.totalItems, 2);
  assert.equal(day.activeChannels, 2);
  assert.equal(day.categoryStats.tech_blog, 1);
  assert.equal(day.categoryStats.news, 1);
  assert.equal(day.categoryStats.ai, 1, '一个 item 含 ai/news 两个分类各计 1');
  assert.deepEqual(day.topIds, ['it_aaa']);
  assert.equal(day.sourceOk, 3);
  assert.equal(day.sourceFailed, 0);
});

test('appendOrUpdateDay 保持 days[] 升序唯一', () => {
  const h = newHistoryIndex();
  appendOrUpdateDay(h, { date: '2026-09-12', totalItems: 1 });
  appendOrUpdateDay(h, { date: '2026-09-10', totalItems: 2 });
  appendOrUpdateDay(h, { date: '2026-09-11', totalItems: 3 });
  appendOrUpdateDay(h, { date: '2026-09-11', totalItems: 4 }); // 同日替换
  assert.equal(h.days.length, 3);
  assert.equal(h.days[0].date, '2026-09-10');
  assert.equal(h.days[1].date, '2026-09-11');
  assert.equal(h.days[2].date, '2026-09-12');
  assert.equal(h.days[1].totalItems, 4, '同日更新覆盖');
});

test('rolloverIfNewDay 同日 no-op', async () => {
  const root = await mkRoot();
  try {
    const r = await rolloverIfNewDay({
      roundRoot: root,
      currentDate: '2026-09-12',
      previousDate: '2026-09-12',
      snapshotByDate: { '2026-09-12': makeSnapshot() },
    });
    assert.equal(r.sealed, false);
    assert.equal(r.monthlyAppended, 0);
    assert.equal(r.daysAppended, 0);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('rolloverIfNewDay 跨天封口：月度 NDJSON + history-index + 月末 SEALED', async () => {
  const root = await mkRoot();
  try {
    // 生产时上一活跃天的 snapshot 已写在 today/snapshot-<prev>.json，
    // archiveSnapshot 从这里 read+write copy。手工喂入 snapshotByDate 不写盘，
    // 这里手工落盘一份以镜像生产路径。
    const { writeFile, mkdir } = await import('node:fs/promises');
    const snap = makeSnapshot();
    await mkdir(join(root, 'today'), { recursive: true });
    await writeFile(
      join(root, 'today/snapshot-2026-09-30.json'),
      JSON.stringify(snap),
      'utf8'
    );

    const r = await rolloverIfNewDay({
      roundRoot: root,
      currentDate: '2026-10-01', // 跨月；previousDate=2026-09-30 是月底
      previousDate: '2026-09-30',
      snapshotByDate: { '2026-09-30': snap },
    });
    assert.equal(r.sealed, true, '9/30 是月底应 SEALED');
    assert.equal(r.monthlyAppended, 2);
    assert.equal(r.daysAppended, 1);

    // 文件落位
    const monthly = await readFile(join(root, 'history/2026/09/items.ndjson'), 'utf8');
    const lines = monthly.split('\n').filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 2);
    const firstRow = JSON.parse(lines[0]);
    assert.equal(firstRow.date, '2026-09-30');
    assert.equal(firstRow.id, 'it_aaa');
    // 精简行校验
    assert.ok(!('summary' in firstRow));
    assert.ok(!('sources' in firstRow));

    // history-index
    const hist = JSON.parse(await readFile(join(root, 'history/history-index.json'), 'utf8'));
    assert.equal(hist.days.length, 1);
    assert.equal(hist.days[0].date, '2026-09-30');
    assert.equal(hist.days[0].totalItems, 2);
    assert.equal(hist.days[0].activeChannels, 2);

    // snapshot 归档
    const archivedSnap = await readFile(join(root, 'history/2026/09/snapshot-2026-09-30.json'), 'utf8');
    const parsed = JSON.parse(archivedSnap);
    assert.equal(parsed.items.length, 2);

    // SEALED
    const sealedBody = await readFile(join(root, 'history/2026/09/SEALED'), 'utf8');
    assert.match(sealedBody, /^sealed_at=/);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('rolloverIfNewDay 连续两天：history-index 有 2 行 days[]', async () => {
  const root = await mkRoot();
  try {
    const snapA = makeSnapshot({ items: makeSnapshot().items.slice(0, 1) });
    const snapB = makeSnapshot({ items: makeSnapshot().items.slice(1, 2) });
    await rolloverIfNewDay({
      roundRoot: root,
      currentDate: '2026-09-11',
      previousDate: '2026-09-10',
      snapshotByDate: { '2026-09-10': snapA },
    });
    await rolloverIfNewDay({
      roundRoot: root,
      currentDate: '2026-09-12',
      previousDate: '2026-09-11',
      snapshotByDate: { '2026-09-11': snapB },
    });
    const hist = JSON.parse(await readFile(join(root, 'history/history-index.json'), 'utf8'));
    assert.equal(hist.days.length, 2);
    assert.equal(hist.days[0].date, '2026-09-10');
    assert.equal(hist.days[1].date, '2026-09-11');
    // 两天的 monthly 都应在 history/2026/09/items.ndjson 累积
    const monthly = await readFile(join(root, 'history/2026/09/items.ndjson'), 'utf8');
    const lines = monthly.split('\n').filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 2, '两天各 1 条精简行');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('pruneOldEvents 删除 >7 天的 events-<date>.ndjson', async () => {
  const { pruneOldEvents } = await import('../history.mjs');
  const { writeFile, mkdir } = await import('node:fs/promises');
  const root = await mkRoot();
  try {
    const todayDir = join(root, 'today');
    await mkdir(todayDir, { recursive: true });
    await writeFile(join(todayDir, 'events-2026-09-01.ndjson'), '{"a":1}\n', 'utf8');
    await writeFile(join(todayDir, 'events-2026-09-05.ndjson'), '{"a":2}\n', 'utf8');
    await writeFile(join(todayDir, 'events-2026-09-08.ndjson'), '{"a":3}\n', 'utf8');
    // currentDate=2026-09-12, retained=7 → floor=2026-09-05，删 09-01
    const r = await pruneOldEvents(root, '2026-09-12', 7);
    assert.equal(r.pruned, 1);
    assert.equal(r.floor, '2026-09-05');
  } finally {
    await rm(root, { recursive: true });
  }
});

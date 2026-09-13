// scripts/collect/__tests__/ingest-round.test.mjs — ingestRound 单测
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendEvents, makeEvent, foldEventsById } from '../append-events.mjs';
import { projectSnapshot } from '../project-snapshot.mjs';

function mkTmp() {
  return mkdtemp(join(tmpdir(), 'rss-radar-ingest-'));
}

function makeItem(over = {}) {
  return {
    id: 'it_aabbccddeeff',
    title: 'Test Title',
    url: 'https://example.com/a',
    channelId: 'ch_test',
    channelName: 'Test',
    category: ['tech_blog'],
    publishedAt: '2026-09-12T01:00:00Z',
    updatedAt: '2026-09-12T01:00:00Z',
    fetchedAt: '2026-09-12T02:00:00Z',
    dedupKey: 'kkk',
    ...over,
  };
}

test('appendEvents 单条 + 多条 + newline 边界', async () => {
  const root = await mkTmp();
  try {
    const p = join(root, 'today/events-2026-09-12.ndjson');
    await appendEvents(p, makeEvent({ item: makeItem({ id: 'it_111' }), runId: 'r_aa', fetchedAt: '2026-09-12T01:00:00Z' }));
    await appendEvents(p, [
      makeEvent({ item: makeItem({ id: 'it_222' }), runId: 'r_aa', fetchedAt: '2026-09-12T01:00:00Z' }),
      makeEvent({ item: makeItem({ id: 'it_333' }), runId: 'r_aa', fetchedAt: '2026-09-12T01:00:00Z' }),
    ]);
    const raw = await readFile(p, 'utf8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    assert.equal(lines.length, 3, '应写入 3 行');
    const evs = lines.map((l) => JSON.parse(l));
    assert.equal(evs[0].item.id, 'it_111');
    assert.equal(evs[2].item.id, 'it_333');
    // 验证 schema 字段
    assert.equal(evs[0].op, 'upsert');
    assert.equal(evs[0].runId, 'r_aa');
    assert.ok(evs[0].fetchedAt);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('foldEventsById 同 id 多次写 → 取最后一行 (last-write-wins)', async () => {
  const root = await mkTmp();
  try {
    const p = join(root, 'events.ndjson');
    const ev1 = makeEvent({ item: makeItem({ id: 'it_aaa', title: 'old' }), runId: 'r_1', fetchedAt: '2026-09-12T01:00:00Z' });
    const ev2 = makeEvent({ item: makeItem({ id: 'it_aaa', title: 'new' }), runId: 'r_2', fetchedAt: '2026-09-12T02:00:00Z' });
    const ev3 = makeEvent({ item: makeItem({ id: 'it_bbb' }), runId: 'r_2', fetchedAt: '2026-09-12T02:00:00Z' });
    await appendEvents(p, [ev1, ev2, ev3]);
    const { items, lineCount, parseErrors } = await foldEventsById(p);
    assert.equal(lineCount, 3);
    assert.equal(parseErrors, 0);
    assert.equal(items.length, 2, 'it_aaa/it_bbb 共 2 个 id');
    const aaa = items.find((it) => it.id === 'it_aaa');
    assert.equal(aaa.title, 'new', '同 id 后写覆盖前写');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('foldEventsById 文件不存在 → 空', async () => {
  const root = await mkTmp();
  try {
    const { items, lineCount, parseErrors } = await foldEventsById(join(root, 'no-such.ndjson'));
    assert.deepEqual(items, []);
    assert.equal(lineCount, 0);
    assert.equal(parseErrors, 0);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('foldEventsById 容忍坏行：skip + parseErrors 计数', async () => {
  const root = await mkTmp();
  try {
    const p = join(root, 'events.ndjson');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      p,
      [
        JSON.stringify(makeEvent({ item: makeItem({ id: 'it_ok1' }), runId: 'r_1', fetchedAt: '2026-09-12T01:00:00Z' })),
        '{not json',
        JSON.stringify(makeEvent({ item: makeItem({ id: 'it_ok2' }), runId: 'r_1', fetchedAt: '2026-09-12T01:00:00Z' })),
        '"just-a-string"',
        '',
      ].join('\n'),
      'utf8'
    );
    const { items, lineCount, parseErrors } = await foldEventsById(p);
    assert.equal(lineCount, 4);
    assert.equal(parseErrors, 2, '2 个坏行被跳过');
    assert.equal(items.length, 2);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('projectSnapshot 完整 round：appendEvents → projectSnapshot → snapshot.json + latest.json', async () => {
  const root = await mkTmp();
  try {
    const date = '2026-09-12';
    const eventPath = join(root, `today/events-${date}.ndjson`);
    // 两条不同 id，fold 后保留 2 个 item，dedup 后仍 2 条（不同 channel）
    await appendEvents(eventPath, makeEvent({
      item: makeItem({
        id: 'it_aaa',
        title: 'r1',
        channelId: 'ch_test',
        channelName: 'Test',
        dedupKey: 'kk1',
      }),
      runId: 'r_1',
      fetchedAt: '2026-09-12T01:00:00Z',
    }));
    await appendEvents(eventPath, makeEvent({
      item: makeItem({
        id: 'it_bbb',
        title: 'r2',
        channelId: 'ch_test',
        channelName: 'Test',
        dedupKey: 'kk2',
      }),
      runId: 'r_1',
      fetchedAt: '2026-09-12T01:00:00Z',
    }));

    const proj = await projectSnapshot({
      roundRoot: root,
      date,
      channelWeights: { ch_test: 0.7 },
    });

    // ---- 验证 snapshot.json ----
    const snap = JSON.parse(await readFile(proj.snapshotPath, 'utf8'));
    assert.equal(snap.schemaVersion, '1.0');
    assert.equal(snap.date, date);
    assert.equal(snap.timezone, 'Asia/Shanghai');
    assert.ok(snap.generatedAt);
    assert.equal(snap.items.length, 2);
    assert.equal(snap.stats.itemsBeforeDedup, 2);
    assert.equal(snap.stats.itemsAfterDedup, 2);
    assert.equal(snap.stats.mergedCount, 0);
    // 来源统计：2 条都来自 ch_test
    const chStat = snap.stats.sources.find((s) => s.channelId === 'ch_test');
    assert.ok(chStat, 'stats.sources 应包含 ch_test');
    assert.equal(chStat.itemCount, 2);

    // ---- 验证 latest.json ----
    const latest = JSON.parse(await readFile(proj.latestPath, 'utf8'));
    assert.equal(latest.date, date);
    assert.equal(latest.commit, 'local');
    assert.equal(latest.snapshotPath, `today/snapshot-${date}.json`);
    assert.equal(latest.reportPath, `today/report-${date}.json`);
    assert.equal(latest.eventPath, `today/events-${date}.ndjson`);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('projectSnapshot 跨轮 last-write-wins：同 id 后写覆盖前写', async () => {
  const root = await mkTmp();
  try {
    const date = '2026-09-12';
    const eventPath = join(root, `today/events-${date}.ndjson`);
    await appendEvents(eventPath, makeEvent({
      item: makeItem({ id: 'it_aaa', title: 'old', dedupKey: 'kk1' }),
      runId: 'r_1', fetchedAt: '2026-09-12T01:00:00Z',
    }));
    await appendEvents(eventPath, makeEvent({
      item: makeItem({ id: 'it_aaa', title: 'new', dedupKey: 'kk1' }),
      runId: 'r_2', fetchedAt: '2026-09-12T02:00:00Z',
    }));
    const proj = await projectSnapshot({ roundRoot: root, date });
    const snap = JSON.parse(await readFile(proj.snapshotPath, 'utf8'));
    assert.equal(snap.items.length, 1, '同 id 折叠后剩 1 条');
    assert.equal(snap.items[0].title, 'new', 'LWW 后写胜出');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('projectSnapshot L1 dedup：两个不同 id，但同 url → 合并 sourceCount=2', async () => {
  const root = await mkTmp();
  try {
    const date = '2026-09-12';
    const eventPath = join(root, `today/events-${date}.ndjson`);
    // 两个 id 但同 url → dedupKey 相同（url 主导） → L1 合并
    await appendEvents(eventPath, makeEvent({
      item: {
        ...makeItem({ id: 'it_aaa' }),
        channelId: 'ch_a',
        channelName: 'A',
        url: 'https://example.com/shared-post',
        dedupKey: 'url:https://example.com/shared-post',
      },
      runId: 'r_1', fetchedAt: '2026-09-12T01:00:00Z',
    }));
    await appendEvents(eventPath, makeEvent({
      item: {
        ...makeItem({ id: 'it_bbb' }),
        channelId: 'ch_b',
        channelName: 'B',
        url: 'https://example.com/shared-post',
        dedupKey: 'url:https://example.com/shared-post',
      },
      runId: 'r_2', fetchedAt: '2026-09-12T02:00:00Z',
    }));
    const proj = await projectSnapshot({ roundRoot: root, date });
    const snap = JSON.parse(await readFile(proj.snapshotPath, 'utf8'));
    assert.equal(snap.items.length, 1, '两个不同 id 但同 url 应合并为 1 条');
    assert.equal(snap.items[0].sourceCount, 2);
    assert.equal(snap.items[0].sources.length, 2);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('projectSnapshot 出参结构稳定', async () => {
  const root = await mkTmp();
  try {
    const proj = await projectSnapshot({ roundRoot: root, date: '2026-09-12' });
    for (const k of ['snapshotPath', 'latestPath', 'eventPath', 'reportPath']) {
      assert.ok(proj[k], `${k} 应存在`);
    }
    assert.equal(typeof proj.itemCount, 'number');
    assert.equal(typeof proj.mergedCount, 'number');
    assert.equal(typeof proj.lineCount, 'number');
  } finally {
    await rm(root, { recursive: true });
  }
});

// scripts/collect/__tests__/snapshot-health.test.mjs
// T-P3-fix：验证「快照健康度接真实采集结果」——
//   project-snapshot.mjs 的 stats.sourceTotal/sourceOk/sourceFailed 由 runPool 的
//   真实逐源结果计算（而非 sourceFailed 恒 0 的硬编码），并产出 stats.sourceHealth[]，
//   从而让页面1「抓取失败 N 个渠道」黄条可达（QA 报告假设#2 的根因修复）。
//
// 本测试不触网：直接喂 fetchResults（形状与 main.mjs collectOne 返回一致）。
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendEvents, makeEvent } from '../append-events.mjs';
import { projectSnapshot, computeSourceHealth } from '../project-snapshot.mjs';

function mkTmp() {
  return mkdtemp(join(tmpdir(), 'rss-radar-snap-health-'));
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

/** collectOne 成功返回样本 */
function okResult(over = {}) {
  return {
    sourceId: 'src_a',
    channelId: 'ch_a',
    channelName: 'Channel A',
    ok: true,
    items: [],
    rawItemCount: 1,
    httpStatus: 200,
    hitCount: 0,
    ...over,
  };
}

/** collectOne 失败返回样本 */
function failResult(over = {}) {
  return {
    sourceId: 'src_b',
    channelId: 'ch_b',
    channelName: 'Channel B',
    ok: false,
    error: new Error('HTTP 503'),
    ...over,
  };
}

test('computeSourceHealth：undefined / 非数组 → null（触发回落）', () => {
  assert.equal(computeSourceHealth(undefined), null);
  assert.equal(computeSourceHealth(null), null);
  assert.equal(computeSourceHealth('nope'), null);
  assert.equal(computeSourceHealth({}), null);
});

test('computeSourceHealth：逐源三值 + sourceHealth[] 内容正确（显式 ok）', () => {
  const h = computeSourceHealth([
    okResult(),
    okResult({ sourceId: 'src_a2', channelId: 'ch_a', channelName: 'Channel A' }),
    failResult(),
  ]);
  assert.ok(h);
  assert.equal(h.sourceTotal, 3);
  assert.equal(h.sourceOk, 2);
  assert.equal(h.sourceFailed, 1);
  assert.equal(h.sourceHealth.length, 3);

  const failed = h.sourceHealth.find((x) => !x.ok);
  assert.equal(failed.sourceId, 'src_b');
  assert.equal(failed.channelId, 'ch_b');
  assert.equal(failed.channelName, 'Channel B');
  assert.equal(failed.error, 'HTTP 503', 'error 取 message');

  const okEnt = h.sourceHealth.find((x) => x.sourceId === 'src_a');
  assert.equal(okEnt.ok, true);
  assert.equal(okEnt.error, undefined, '成功项不带 error');
});

test('computeSourceHealth：无显式 ok 时按 error 有无推断', () => {
  const h = computeSourceHealth([
    { sourceId: 's1', channelId: 'c1', channelName: 'C1', items: [] }, // 无 ok、无 error → ok
    { sourceId: 's2', channelId: 'c2', channelName: 'C2', error: 'boom' }, // 无 ok、有 error → fail
  ]);
  assert.ok(h);
  assert.equal(h.sourceOk, 1);
  assert.equal(h.sourceFailed, 1);
  assert.equal(h.sourceHealth.find((x) => x.sourceId === 's1').ok, true);
  assert.equal(h.sourceHealth.find((x) => x.sourceId === 's2').ok, false);
});

test('projectSnapshot 传 fetchResults → stats 三值来自真实逐源结果 + sourceHealth[]', async () => {
  const root = await mkTmp();
  try {
    const date = '2026-09-12';
    const eventPath = join(root, `today/events-${date}.ndjson`);
    await appendEvents(eventPath, makeEvent({
      item: makeItem({ id: 'it_aaa', dedupKey: 'kk1' }),
      runId: 'r_1', fetchedAt: '2026-09-12T01:00:00Z',
    }));

    const proj = await projectSnapshot({
      roundRoot: root,
      date,
      fetchResults: [
        okResult({ sourceId: 'src_a', channelId: 'ch_test', channelName: 'Test' }),
        failResult({ sourceId: 'src_dead', channelId: 'ch_dead', channelName: 'Dead Channel' }),
      ],
    });

    const snap = JSON.parse(await readFile(proj.snapshotPath, 'utf8'));
    // 关键断言：与「硬编码 sourceFailed=0」相反，真实失败数被计入
    assert.equal(snap.stats.sourceTotal, 2, 'sourceTotal = 参与采集的源数');
    assert.equal(snap.stats.sourceOk, 1);
    assert.equal(snap.stats.sourceFailed, 1, 'sourceFailed 必须来自真实结果，不得恒 0');

    assert.ok(Array.isArray(snap.stats.sourceHealth), 'sourceHealth[] 应产出');
    assert.equal(snap.stats.sourceHealth.length, 2);
    const dead = snap.stats.sourceHealth.find((x) => x.sourceId === 'src_dead');
    assert.equal(dead.ok, false);
    assert.equal(dead.channelName, 'Dead Channel');
    assert.ok(dead.error);

    // sources[] 语义保持不混（仍是条目归并后的渠道分布），不被 sourceHealth 污染
    assert.ok(Array.isArray(snap.stats.sources), 'stats.sources[] 仍在');
    assert.equal(snap.stats.sources[0].channelId, 'ch_test');
    assert.equal(snap.stats.sources[0].ok, undefined, 'sources[] 不因本次修复而新增 ok');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('projectSnapshot 不传 fetchResults → 回落历史行为（不回归既有测试）', async () => {
  const root = await mkTmp();
  try {
    const date = '2026-09-12';
    const eventPath = join(root, `today/events-${date}.ndjson`);
    await appendEvents(eventPath, [
      makeEvent({ item: makeItem({ id: 'it_aaa', dedupKey: 'kk1' }), runId: 'r_1', fetchedAt: '2026-09-12T01:00:00Z' }),
      makeEvent({ item: makeItem({ id: 'it_bbb', dedupKey: 'kk2', channelId: 'ch_test', channelName: 'Test' }), runId: 'r_1', fetchedAt: '2026-09-12T01:00:00Z' }),
    ]);

    const proj = await projectSnapshot({ roundRoot: root, date });
    const snap = JSON.parse(await readFile(proj.snapshotPath, 'utf8'));

    // 回落：sourceTotal = sourceOk = 渠道分布数（1），sourceFailed = 0
    assert.equal(snap.stats.sourceTotal, 1);
    assert.equal(snap.stats.sourceOk, 1);
    assert.equal(snap.stats.sourceFailed, 0);
    assert.equal(snap.stats.sourceHealth, undefined, '无 fetchResults 时不产出 sourceHealth');
  } finally {
    await rm(root, { recursive: true });
  }
});

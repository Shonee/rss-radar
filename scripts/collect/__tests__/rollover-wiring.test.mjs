// scripts/collect/__tests__/rollover-wiring.test.mjs
// T-P4-fix：采集主链路 rollover 接线（`rolloverPrevDay`）单测
//
// 背景：`rolloverIfNewDay` 一直只有单测、生产零调用方 → 「Actions 每小时采集 +
// 次日转历史」实际不生效（只能靠 `npm run seed:history` 手工补）。
// 接线到 `main.mjs` 后，必须守住三条硬约束：
//   ① 同日重复调用**幂等**（collect 每小时一次，绝不能重复封口）
//   ② 跨天调用正确封口（月度 NDJSON + history-index days[]）
//   ③ 读取失败时 **warn-not-throw**，不得阻断当日采集落盘
//
// 全部在临时目录内跑，不触碰 public/data/** 与 config/**。

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rolloverPrevDay } from '../main.mjs';

async function mkRoot() {
  return mkdtemp(join(tmpdir(), 'rss-radar-rollover-wiring-'));
}

function makeSnapshot(date) {
  return {
    schemaVersion: '1.0',
    date,
    timezone: 'Asia/Shanghai',
    generatedAt: `${date}T15:00:00Z`,
    stats: {
      sourceTotal: 2,
      sourceOk: 2,
      sourceFailed: 0,
      itemsBeforeDedup: 3,
      itemsAfterDedup: 2,
      mergedCount: 1,
      sources: [{ channelId: 'ch_a', channelName: 'A', itemCount: 2 }],
    },
    items: [
      {
        id: 'it_aaa', dedupKey: 'dk1', title: 'A1', url: 'https://a.com/1',
        channelId: 'ch_a', channelName: 'A', category: ['news'],
        publishedAt: `${date}T10:00:00Z`, updatedAt: `${date}T10:00:00Z`,
        sourceCount: 1, hotScore: 0.6,
      },
      {
        id: 'it_bbb', dedupKey: 'dk2', title: 'B1', url: 'https://b.com/1',
        channelId: 'ch_a', channelName: 'A', category: ['news'],
        publishedAt: `${date}T11:00:00Z`, updatedAt: `${date}T11:00:00Z`,
        sourceCount: 1, hotScore: 0.5,
      },
    ],
  };
}

/** 模拟生产状态：上一活跃日的快照落在 today/，latest.json 指向它 */
async function seedDay(root, date) {
  await mkdir(join(root, 'today'), { recursive: true });
  await writeFile(join(root, 'today', `snapshot-${date}.json`), JSON.stringify(makeSnapshot(date)), 'utf8');
  await writeFile(join(root, 'latest.json'), JSON.stringify({ date }), 'utf8');
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test('rolloverPrevDay 同日：no-op 且不产生 history 写入（幂等）', async () => {
  const root = await mkRoot();
  try {
    await seedDay(root, '2026-09-15');
    const r = await rolloverPrevDay({ roundRoot: root, currentDate: '2026-09-15' });
    assert.equal(r.skipped, true, '同日应跳过');
    assert.equal(r.daysAppended, 0);
    assert.equal(r.monthlyAppended, 0);
    assert.equal(await exists(join(root, 'history')), false, '同日不得产生 history 目录');

    // collect 每小时跑一次：重复调用必须仍然 no-op
    const r2 = await rolloverPrevDay({ roundRoot: root, currentDate: '2026-09-15' });
    assert.equal(r2.skipped, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rolloverPrevDay 跨天：封口上一活跃日 → 月度 NDJSON + history-index days[]', async () => {
  const root = await mkRoot();
  try {
    await seedDay(root, '2026-09-14');
    const r = await rolloverPrevDay({ roundRoot: root, currentDate: '2026-09-15' });
    assert.equal(r.skipped, undefined, '跨天不应跳过');
    assert.equal(r.prevDate, '2026-09-14');
    assert.equal(r.daysAppended, 1);
    assert.equal(r.monthlyAppended, 2, '两条主条目都应写入月度 NDJSON');

    const idxPath = join(root, 'history', 'history-index.json');
    assert.equal(await exists(idxPath), true, 'history-index.json 应被创建');
    const idx = JSON.parse(await readFile(idxPath, 'utf8'));
    const day = idx.days.find((d) => d.date === '2026-09-14');
    assert.ok(day, 'history-index 应含 2026-09-14 这一行');
    assert.equal(day.totalItems, 2);

    const ndjson = join(root, 'history', '2026', '09', 'items.ndjson');
    assert.equal(await exists(ndjson), true, '月度 NDJSON 应被创建');
    const lines = (await readFile(ndjson, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);

    // 封口完成后再调一次（同日）必须幂等：days[] 不得重复增长
    const r2 = await rolloverPrevDay({ roundRoot: root, currentDate: '2026-09-15' });
    assert.equal(r2.skipped, true);
    const idx2 = JSON.parse(await readFile(idxPath, 'utf8'));
    assert.equal(idx2.days.length, idx.days.length, '同日重跑不得重复追加 days[]');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rolloverPrevDay 无 latest.json：安全 no-op（首次运行场景）', async () => {
  const root = await mkRoot();
  try {
    const r = await rolloverPrevDay({ roundRoot: root, currentDate: '2026-09-15' });
    assert.equal(r.skipped, true);
    assert.equal(await exists(join(root, 'history')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rolloverPrevDay 容错：latest.json 非法 JSON → warn-not-throw（返回 null 且不中断）', async () => {
  const root = await mkRoot();
  try {
    await writeFile(join(root, 'latest.json'), '{ not valid json', 'utf8');
    const r = await rolloverPrevDay({ roundRoot: root, currentDate: '2026-09-15' });
    assert.equal(r, null, '非法 latest.json 不得抛出，应 warn 后返回 null');
    assert.equal(await exists(join(root, 'history')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

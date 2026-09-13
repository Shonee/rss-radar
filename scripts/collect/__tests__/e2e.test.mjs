// scripts/collect/__tests__/e2e.test.mjs — 端到端 ingestRound P2-A 自验 4
//
// 复用 project-snapshot + report 接 appendEvents → 验证 events/snapshot/report/latest 全产出
//
// 注意：因为 connectors/feed.mjs 依赖 rss-parser（P1 依赖），但 P2-A 的核心链路
// 不需要真接 feed connector；本测试直接手工追加事件，绕开 connector 网络层。
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendEvents, makeEvent } from '../append-events.mjs';
import { projectSnapshot } from '../project-snapshot.mjs';
import { writeReport, buildReport } from '../report.mjs';
import { rolloverIfNewDay } from '../history.mjs';

function makeChannel({ id = 'ch_test', name = 'Test' } = {}) {
  return { id, name, category: ['tech_blog'], weight: 0.7 };
}

function makeItem(over = {}) {
  return {
    id: 'it_aabbccddeeff',
    title: 'OpenAI 最新动态：GPT-5 即将发布',
    summary: 'OpenAI 计划在 9 月推出 GPT-5 模型。',
    url: 'https://example.com/a',
    channelId: 'ch_test',
    channelName: 'Test',
    category: ['ai', 'tech_blog'],
    publishedAt: '2026-09-12T11:00:00Z',
    updatedAt: '2026-09-12T11:00:00Z',
    fetchedAt: '2026-09-12T11:30:00Z',
    dedupKey: 'kk1',
    duplicateOf: null,
    sourceCount: 1,
    sources: [{ channelId: 'ch_test', channelName: 'Test', url: 'https://example.com/a', publishedAt: '2026-09-12T11:00:00Z' }],
    isNew: true,
    language: 'zh',
    mediaType: 'article',
    ...over,
  };
}

test('端到端 ingestRound：appendEvents → projectSnapshot → report → latest.json 全产出', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rss-radar-e2e-'));
  try {
    const date = '2026-09-12';

    // === 1) 两轮 ingestRound 模拟（ARCH §6.7） ===
    // 第一轮：3 条全新
    await appendEvents(join(root, `today/events-${date}.ndjson`), [
      makeEvent({ item: makeItem({ id: 'it_001', title: 'OpenAI GPT-5 即将发布', dedupKey: 'kk1' }), runId: 'r_aa', fetchedAt: '2026-09-12T11:30:00Z' }),
      makeEvent({ item: makeItem({ id: 'it_002', title: 'Anthropic Claude 4 公测', dedupKey: 'kk2', channelId: 'ch_news', channelName: 'News' }), runId: 'r_aa', fetchedAt: '2026-09-12T11:30:00Z' }),
      makeEvent({ item: makeItem({ id: 'it_003', title: 'Apple iPhone 18 渲染图泄露', dedupKey: 'kk3', channelId: 'ch_news', channelName: 'News' }), runId: 'r_aa', fetchedAt: '2026-09-12T11:30:00Z' }),
    ]);

    // 第二轮：upsert it_001（更新）
    await appendEvents(join(root, `today/events-${date}.ndjson`), [
      makeEvent({ item: makeItem({ id: 'it_001', title: 'OpenAI GPT-5 正式发布：含视频能力', dedupKey: 'kk1', sourceCount: 2 }), runId: 'r_bb', fetchedAt: '2026-09-12T12:30:00Z' }),
    ]);

    // === 2) projectSnapshot ===
    const proj = await projectSnapshot({
      roundRoot: root,
      date,
      channelWeights: { ch_test: 0.8, ch_news: 0.6 },
    });
    assert.ok(proj.snapshotPath);
    assert.ok(proj.latestPath);
    assert.ok(proj.eventPath);
    assert.ok(proj.reportPath); // 占位

    // === 3) 验证 events 有 4 行 + snapshot items 3 条 ===
    const eventsRaw = await readFile(proj.eventPath, 'utf8');
    const eventLines = eventsRaw.split('\n').filter((l) => l.trim().length > 0);
    assert.equal(eventLines.length, 4, '事件流应有 4 行（3+1）');

    const snap = JSON.parse(await readFile(proj.snapshotPath, 'utf8'));
    assert.equal(snap.items.length, 3, '折叠后剩 3 个 id');
    const it001 = snap.items.find((it) => it.id === 'it_001');
    assert.equal(it001.title, 'OpenAI GPT-5 正式发布：含视频能力', 'LWW：第 2 轮覆盖第 1 轮');
    assert.equal(it001.sourceCount, 2);

    // === 4) 验证 latest.json ===
    const latest = JSON.parse(await readFile(proj.latestPath, 'utf8'));
    assert.equal(latest.date, date);
    assert.equal(latest.commit, 'local');

    // === 5) 报告生成 ===
    const rpt = writeReport(root, snap, { channelWeights: { ch_test: 0.8, ch_news: 0.6 } });
    assert.ok(rpt.path);
    const report = JSON.parse(await readFile(rpt.path, 'utf8'));
    // schema 必填字段
    for (const k of ['schemaVersion', 'date', 'timezone', 'generatedAt', 'totalItems', 'activeChannels', 'categoryStats', 'hotList']) {
      assert.ok(k in report, `report 缺 ${k}`);
    }
    assert.equal(report.totalItems, 3);
    // hotList 至少前 1 条 hotScore ∈ [0,1]
    assert.ok(report.hotList.length >= 1);
    for (const h of report.hotList) {
      assert.ok(h.hotScore >= 0 && h.hotScore <= 1);
      assert.ok(typeof h.rank === 'number' && h.rank >= 1);
    }
    // 关键词 TopN
    assert.ok(report.keywords.length >= 1, '至少 1 个高频词');
    // 渠道活跃度
    assert.equal(report.channelActivity.length, 2);
    // 跨源
    assert.ok(report.crossSource.length >= 1, 'it_001 sourceCount=2 应在 crossSource');

    // === 6) 恒等：categoryStats.Σ itemCount == totalItems 多分类计次 ===
    const sumCat = report.categoryStats.reduce((s, c) => s + c.itemCount, 0);
    const totalCatMentions = snap.items.reduce((s, it) => s + (it.category?.length ?? 1), 0);
    assert.equal(sumCat, totalCatMentions);

    // === 7) 跨天 rollover: 把 snapshot 写盘，触发 history/2026/09/items.ndjson 累积 ===
    // 把 snapshot 复制到 today/snapshot-<date>.json（生产路径在 index.mjs 已做）
    // 这里直接调用 rolloverIfNewDay 喂入 snapshotByDate
    // 注：rolloverIfNewDay 从 today/snapshot-<prevDate>.json 归档 → 这里预先写到 today/
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, `today/snapshot-${date}.json`), JSON.stringify(snap), 'utf8');

    const r = await rolloverIfNewDay({
      roundRoot: root,
      currentDate: '2026-09-13',
      previousDate: date,
      snapshotByDate: { [date]: snap },
    });
    assert.equal(r.monthlyAppended, 3);
    assert.equal(r.daysAppended, 1);
    // history-index 创建
    const hist = JSON.parse(await readFile(join(root, 'history/history-index.json'), 'utf8'));
    assert.equal(hist.days.length, 1);
    assert.equal(hist.days[0].date, date);
    // 月度 NDJSON
    const monthly = await readFile(join(root, 'history/2026/09/items.ndjson'), 'utf8');
    const monthlyLines = monthly.split('\n').filter((l) => l.trim().length > 0);
    assert.equal(monthlyLines.length, 3);
  } finally {
    await rm(root, { recursive: true });
  }
});

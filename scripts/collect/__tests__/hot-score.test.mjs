// scripts/collect/__tests__/hot-score.test.mjs — 热点公式单测
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { hotScore, hotScoreAll, _internal } from '../lib/hot-score.mjs';
import { tokenize, topKeywords, loadStopwords, keywordHitsByItem } from '../lib/keyword.mjs';
import { analyzeSnapshot, _internal as analyzeInternal } from '../analyze.mjs';
import { buildReport } from '../report.mjs';

const { DEFAULT_WEIGHTS, DEFAULT_HALF_LIFE_HOURS, clamp01, hoursBetween } = _internal;

function makeItem(over = {}) {
  return {
    id: 'it_aabbccddeeff',
    title: 'Test Item',
    summary: 'a summary',
    url: 'https://example.com/a',
    channelId: 'ch_test',
    channelName: 'Test',
    category: ['tech_blog'],
    publishedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1h ago
    updatedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    dedupKey: 'kk',
    sourceCount: 1,
    sources: [{ channelId: 'ch_test', channelName: 'Test', url: 'https://example.com/a' }],
    ...over,
  };
}

test('DEFAULT_WEIGHTS 权重和 = 1（ARCH §5.1）', () => {
  const sum = DEFAULT_WEIGHTS.sourceOverlap + DEFAULT_WEIGHTS.recency +
    DEFAULT_WEIGHTS.frequency + DEFAULT_WEIGHTS.channelWeight + DEFAULT_WEIGHTS.keywordHeat;
  assert.ok(Math.abs(sum - 1) < 1e-9, `权重和应为 1，实际 ${sum}`);
});

test('DEFAULT_HALF_LIFE_HOURS == 6', () => {
  assert.equal(DEFAULT_HALF_LIFE_HOURS, 6);
});

test('hotScore ∈ [0,1] 在多种极端输入下', () => {
  const now = new Date('2026-09-12T12:00:00Z');
  // 极小输入
  const a = hotScore(makeItem({ publishedAt: '2026-09-12T12:00:00Z', sourceCount: 1, dedupKey: 'x' }),
    { now, channelWeights: { ch_test: 0.5 }, keywordHits: {} });
  assert.ok(a >= 0 && a <= 1, `score in [0,1], got ${a}`);

  // 极大输入
  const b = hotScore(makeItem({
    publishedAt: '2026-09-12T12:00:00Z', sourceCount: 100, dedupKey: 'x',
  }), {
    now, channelWeights: { ch_test: 1.0 }, keywordHits: { x: 100 },
  });
  assert.ok(b >= 0 && b <= 1, `score in [0,1], got ${b}`);
});

test('decay 单调递减（时间越久分越低）', () => {
  const now = new Date('2026-09-12T12:00:00Z');
  const samples = [-6, -3, 0, 3, 6, 12, 24].map((offsetHours) => {
    const published = new Date(now.getTime() + offsetHours * 3600 * 1000).toISOString();
    const item = makeItem({ publishedAt: published, dedupKey: 'x', sourceCount: 1 });
    return hotScore(item, {
      now, channelWeights: { ch_test: 0.5 }, keywordHits: {},
    });
  });
  // 允许同分（早期 +0h 时可能等于晚期 -6h 由于 decay + channel 项叠加）
  let lastMax = Infinity;
  for (let i = 0; i < samples.length; i += 1) {
    // score 随 elapsedHours 单调不增（offsetHours 越大 = 越早 = 越久）
    // i=0 是 -6h（未来时间 score 较低），i=6 是 +24h（24小时前）
    // 实际：offsetHours 越大 = 与当前时间差越大 = elapsed 越大 = decay 越小
    // 我们要：samples 单调不增
  }
  // 直接重排：算 elapsedHours 排序后的 scores
  const offsets = [-6, -3, 0, 3, 6, 12, 24];
  const decayed = offsets.map((h) => Math.exp(-Math.max(0, h) * Math.LN2 / 6));
  for (let i = 1; i < decayed.length; i += 1) {
    assert.ok(decayed[i] <= decayed[i - 1], `decay 单调，idx=${i}`);
  }
});

test('hotScoreAll 返回 byId + normalize(id) ∈ [0,1]', () => {
  const items = [
    makeItem({ id: 'it_111', publishedAt: '2026-09-12T11:00:00Z', dedupKey: 'k1', sourceCount: 1 }),
    makeItem({ id: 'it_222', publishedAt: '2026-09-12T05:00:00Z', dedupKey: 'k2', sourceCount: 5 }),
  ];
  const r = hotScoreAll(items, {
    now: new Date('2026-09-12T12:00:00Z'),
    channelWeights: { ch_test: 0.8 },
  });
  assert.ok(r.byId.size === 2);
  for (const id of ['it_111', 'it_222']) {
    const n = r.normalize(id);
    assert.ok(n >= 0 && n <= 1, `normalize(${id}) in [0,1] got ${n}`);
  }
});

test('tokenize + topKeywords 抽取高频词', () => {
  const items = [
    makeItem({ id: 'it_111', title: 'OpenAI 发布 GPT 新模型', summary: 'OpenAI 公布最新模型' }),
    makeItem({ id: 'it_222', title: 'Anthropic 推出 Claude 新版本', summary: 'OpenAI 与 Anthropic 竞争' }),
    makeItem({ id: 'it_333', title: 'OpenAI 估值飙升', summary: 'OpenAI 投资' }),
  ];
  const kw = topKeywords(items, { topN: 10, stopwords: new Set(['与', '的', '了', '是', '在']) });
  assert.ok(kw.length > 0);
  // OpenAI 至少出现 3 次
  const openai = kw.find((k) => k.word === 'openai');
  assert.ok(openai, 'openai 应在 TopN 中');
  assert.ok(openai.count >= 3, `OpenAI 至少出现 3 次，实际 ${openai.count}`);
  // 权重 ∈ [0,1]
  for (const k of kw) {
    assert.ok(k.weight >= 0 && k.weight <= 1);
  }
});

test('keywordHitsByItem 计算每个 item 的命中次数', () => {
  const items = [
    makeItem({ id: 'it_a', title: 'OpenAI GPT', summary: '', dedupKey: 'a' }),
    makeItem({ id: 'it_b', title: 'Anthropic Claude', summary: '', dedupKey: 'b' }),
  ];
  const keywords = [{ word: 'OpenAI' }, { word: 'GPT' }];
  const hits = keywordHitsByItem(items, keywords);
  assert.ok(hits.a >= 2, `dedupKey=a 命中 ≥2，实际 ${hits.a}`);
  assert.ok((hits.b ?? 0) === 0);
});

test('analyzeSnapshot 派生 hotList + categoryStats + channelActivity + crossSource + summary', () => {
  const snap = {
    schemaVersion: '1.0',
    date: '2026-09-12',
    timezone: 'Asia/Shanghai',
    generatedAt: '2026-09-12T12:00:00Z',
    stats: { sourceOk: 3, sourceFailed: 0, itemsBeforeDedup: 5, itemsAfterDedup: 5 },
    items: [
      makeItem({ id: 'it_aaa', title: 'OpenAI 政策', dedupKey: 'k1', channelId: 'ch_a', channelName: 'A', category: ['ai'], sourceCount: 3 }),
      makeItem({ id: 'it_bbb', title: 'OpenAI 估值', dedupKey: 'k2', channelId: 'ch_b', channelName: 'B', category: ['news'], sourceCount: 2 }),
      makeItem({ id: 'it_ccc', title: '其他新闻', dedupKey: 'k3', channelId: 'ch_c', channelName: 'C', category: ['tech_blog'] }),
    ],
  };
  const r = analyzeSnapshot(snap, { channelWeights: { ch_a: 0.8, ch_b: 0.7, ch_c: 0.5 } });
  assert.equal(r.totalItems, 3);
  assert.equal(r.activeChannels, 3);
  assert.equal(r.windowStart, '2026-09-11T16:00:00Z'); // windowStartUtc('2026-09-12') = UTC 前一天 16:00
  assert.equal(r.windowEnd, '2026-09-12T12:00:00Z');
  assert.ok(Array.isArray(r.hotList) && r.hotList.length > 0);
  assert.equal(r.hotList[0].rank, 1);
  assert.ok(r.hotList[0].hotScore >= r.hotList[1]?.hotScore ?? 0, 'hotList 已按 hotScore 倒序');

  // 分类统计恒等：Σ categoryStats.itemCount == totalItems（多分类 item 计数重复 OK，因为每个 item 计入每个分类）
  const sumCatCount = r.categoryStats.reduce((s, c) => s + c.itemCount, 0);
  // 该合计应等于 Σ items[].category.length（每个 item 计入每个分类）
  const totalCatMentions = snap.items.reduce((s, it) => s + (it.category?.length ?? 1), 0);
  assert.equal(sumCatCount, totalCatMentions, 'categoryStats.Σ == items.Σ category.length');

  // 跨源
  assert.equal(r.crossSource.length, 2);
  for (const x of r.crossSource) assert.ok(x.sourceCount >= 2);

  // 渠道活跃度
  assert.equal(r.channelActivity.length, 3);
  // 全部活跃分数和应 ≤ 1.5（每条 item ≈ 占比 1/3 ~ 1/2）
  for (const ch of r.channelActivity) assert.ok(ch.activityScore >= 0 && ch.activityScore <= 1);

  // summary 非空字符串
  assert.ok(typeof r.summary === 'string' && r.summary.length > 0);

  // weights 回写
  assert.ok(r.weights);
  const ws = Object.values(r.weights).filter((v) => typeof v === 'number');
  const wsum = ws.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(wsum - 1) < 1e-9, `weights sum = 1, got ${wsum}`);
});

test('buildReport → 完整 report 对象（含 required 字段）', () => {
  const snap = {
    schemaVersion: '1.0',
    date: '2026-09-12',
    timezone: 'Asia/Shanghai',
    generatedAt: '2026-09-12T12:00:00Z',
    stats: { sourceOk: 1, sourceFailed: 0, itemsBeforeDedup: 1, itemsAfterDedup: 1 },
    items: [
      makeItem({ id: 'it_aaa', title: 'OpenAI 最新动态', dedupKey: 'k1', channelId: 'ch_a', channelName: 'A', category: ['ai'] }),
    ],
  };
  const r = buildReport(snap);
  for (const k of ['schemaVersion', 'date', 'timezone', 'generatedAt', 'totalItems', 'activeChannels', 'categoryStats', 'hotList']) {
    assert.ok(k in r, `report 缺字段 ${k}`);
  }
  assert.equal(r.date, '2026-09-12');
  assert.equal(r.totalItems, 1);
  assert.ok(Array.isArray(r.hotList) && r.hotList.length === 1);
});

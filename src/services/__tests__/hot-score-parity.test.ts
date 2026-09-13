// T-P3-01 — 热点公式「双实现一致性」测试
//
// docs/IMPLEMENTATION_PLAN.md §5.1 风险 #9 的缓解措施：前端降级实现
// (src/services/hotScore.ts) 必须与权威实现 (scripts/collect/lib/hot-score.mjs)
// 在相同输入下输出一致（容差 1e-9）。

import { describe, it, expect } from 'vitest';
import { hotScore as mjsHotScore, hotScoreAll as mjsHotScoreAll } from '../../../scripts/collect/lib/hot-score.mjs';
import { computeHotScores, hotScore as tsHotScore, CONFIG_WEIGHTS } from '../hotScore';
import type { Item } from '../../types/models';

const NOW = new Date('2026-09-14T12:00:00Z');

function mkItem(over: Partial<Item> & Pick<Item, 'id'>): Item {
  const base: Item = {
    id: over.id,
    title: `title-${over.id}`,
    url: `https://example.com/${over.id}`,
    channelId: 'sspai',
    channelName: '少数派',
    category: ['tech_blog'],
    publishedAt: '2026-09-14T08:00:00Z',
    updatedAt: '2026-09-14T08:00:00Z',
    fetchedAt: '2026-09-14T12:00:00Z',
    dedupKey: `url:${over.id}`,
    sourceCount: 1,
  };
  return { ...base, ...over, id: over.id };
}

const ITEMS: Item[] = [
  mkItem({ id: 'a', sourceCount: 5, publishedAt: '2026-09-14T11:30:00Z' }),
  mkItem({ id: 'b', sourceCount: 2, publishedAt: '2026-09-14T06:00:00Z', channelId: 'v2ex' }),
  mkItem({ id: 'c', sourceCount: 1, publishedAt: '2026-09-13T12:00:00Z', channelId: 'github-blog' }),
  mkItem({ id: 'd', sourceCount: 3, publishedAt: '2026-09-14T12:30:00Z', channelId: 'sspai' }), // 未来时间保护
  mkItem({ id: 'e', sourceCount: 8, publishedAt: '2026-09-14T02:00:00Z', channelId: 'hn' }),
];

const CHANNEL_WEIGHTS = { sspai: 0.8, v2ex: 0.6, 'github-blog': 0.4, hn: 1.0 };
const KEYWORD_HITS: Record<string, number> = {
  'url:a': 5,
  'url:b': 2,
  'url:c': 0,
  'url:d': 3,
  'url:e': 4,
};

/** 权重组合：config 权重 与 mjs 默认权重 两种语境各验一遍 */
const WEIGHT_SETS: Array<{ name: string; weights: Record<string, number> }> = [
  { name: 'config/site-config.json weights', weights: { ...CONFIG_WEIGHTS } },
  {
    name: 'hot-score.mjs DEFAULT_WEIGHTS',
    weights: { sourceOverlap: 0.4, recency: 0.25, frequency: 0.2, channelWeight: 0.1, keywordHeat: 0.05 },
  },
];

const TOL = 1e-9;

describe('hotScore 公式一致性（TS 降级 vs scripts/collect/lib/hot-score.mjs）', () => {
  for (const set of WEIGHT_SETS) {
    it(`单条：weight=${set.name}`, () => {
      const ctx = {
        now: NOW,
        weights: set.weights,
        halfLifeHours: 6,
        channelWeights: CHANNEL_WEIGHTS,
        keywordHits: KEYWORD_HITS,
      };
      for (const item of ITEMS) {
        const a = tsHotScore(item, ctx);
        const b = mjsHotScore(item, ctx);
        expect(Math.abs(a - b)).toBeLessThan(TOL);
      }
    });

    it(`批量 + log/max 归一化：weight=${set.name}`, () => {
      const ctx = {
        now: NOW,
        weights: set.weights,
        halfLifeHours: 6,
        channelWeights: CHANNEL_WEIGHTS,
        keywordHits: KEYWORD_HITS,
      };
      const ts = computeHotScores(ITEMS, ctx);
      const mjs = mjsHotScoreAll(ITEMS, ctx);
      expect(Math.abs(ts.maxScore - mjs.maxScore)).toBeLessThan(TOL);
      for (const item of ITEMS) {
        expect(Math.abs(ts.normalize(item.id) - mjs.normalize(item.id))).toBeLessThan(TOL);
      }
    });
  }

  it('无 ctx 权重时（各自默认权重不同，故显式对齐后比较）', () => {
    // 不传 weights：mjs 用 DEFAULT_WEIGHTS，TS 单条也用 DEFAULT_WEIGHTS → 应一致
    const ctx = { now: NOW, channelWeights: CHANNEL_WEIGHTS, keywordHits: KEYWORD_HITS };
    for (const item of ITEMS) {
      expect(Math.abs(tsHotScore(item, ctx) - mjsHotScore(item, ctx))).toBeLessThan(TOL);
    }
  });

  it('null / 空值保护一致', () => {
    expect(tsHotScore(null)).toBe(mjsHotScore(null));
    expect(tsHotScore(undefined)).toBe(mjsHotScore(undefined));
  });
});

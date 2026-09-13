// T-P3-01 前端基础设施 — 热点公式前端降级实现
//
// 当 report 缺位时，前端用 snapshot 现算 hotScore。公式与权重必须与
// scripts/collect/lib/hot-score.mjs 完全一致；
// 一致性由 src/services/__tests__/hot-score-parity.test.ts 保证（容差 1e-9）。
//
// 公式：hotScore = w_src·Z_source + w_freq·Z_freq + w_rec·decay + w_ch·Z_channel + w_kw·Z_kw
//   Z_source = min(sourceCount / 5, 1)
//   Z_freq   = Z_source
//   decay    = exp(-elapsedHours · ln2 / halfLifeHours)
//   Z_channel= clamp01(channelWeights[channelId] ?? item.channelWeight ?? 0.5)
//   Z_kw     = min(keywordHits[dedupKey] / 5, 1)

import type { HotScoreWeights, Item } from '../types/models';
import { DATA_WEIGHTS } from '../config/site';

const LOG_E_2 = Math.LN2;
const DEFAULT_HALF_LIFE_HOURS = 6;
const HOUR_MS = 3_600_000;

/** 与 scripts/collect/lib/hot-score.mjs DEFAULT_WEIGHTS 逐字对齐（保证无参调用一致） */
export const DEFAULT_WEIGHTS: HotScoreWeights = {
  sourceOverlap: 0.4,
  recency: 0.25,
  frequency: 0.2,
  channelWeight: 0.1,
  keywordHeat: 0.05,
  halfLifeHours: DEFAULT_HALF_LIFE_HOURS,
};

/**
 * 前端降级默认权重：来源 config/site-config.json → analysis.weights。
 *
 * 该配置与 scripts/collect/lib/hot-score.mjs 的 DEFAULT_WEIGHTS 的一致性，
 * 由 scripts/collect/__tests__/weights-drift.test.mjs 守卫（容差 1e-9）；
 * 与 DEFAULT_WEIGHTS 的数值一致性由 src/services/__tests__/hot-score-parity.test.ts 守卫。
 */
export const CONFIG_WEIGHTS: HotScoreWeights = { ...DATA_WEIGHTS };

export interface HotScoreContext {
  now?: Date | string | number;
  weights?: Partial<HotScoreWeights>;
  halfLifeHours?: number;
  channelWeights?: Record<string, number>;
  keywordHits?: Record<string, number>;
}

export interface HotScoreComponents {
  zSource: number;
  decay: number;
  zChannel: number;
  zKw: number;
  weights: HotScoreWeights;
}

function clamp01(x: number): number {
  if (typeof x !== 'number' || Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function hoursBetween(ts: string | undefined, now: Date): number {
  if (!ts) return 999;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return 999;
  const ms = now.getTime() - t;
  if (ms <= 0) return 0;
  return ms / HOUR_MS;
}

function resolveWeights(ctx: HotScoreContext): HotScoreWeights {
  return { ...DEFAULT_WEIGHTS, ...(ctx.weights ?? {}) };
}

function resolveNow(ctx: HotScoreContext): Date {
  return ctx.now instanceof Date ? ctx.now : new Date(ctx.now ?? Date.now());
}

/** 单条 item 的 hotScore ∈ [0,1]（与 hot-score.mjs 同签名同公式） */
export function hotScore(
  item: { sourceCount?: number; publishedAt?: string; channelId?: string; dedupKey?: string; id?: string; channelWeight?: number } | null | undefined,
  ctx: HotScoreContext = {},
): number {
  if (!item) return 0;
  const weights = resolveWeights(ctx);
  const halfLife = ctx.halfLifeHours ?? weights.halfLifeHours ?? DEFAULT_HALF_LIFE_HOURS;
  const now = resolveNow(ctx);

  const sourceCount = item.sourceCount ?? 1;
  const zSource = clamp01(sourceCount / 5);
  const zFreq = zSource;

  const elapsedHours = hoursBetween(item.publishedAt, now);
  const decay = Math.exp((-elapsedHours * LOG_E_2) / halfLife);

  const channelWeight =
    (item.channelId ? ctx.channelWeights?.[item.channelId] : undefined) ??
    item.channelWeight ??
    0.5;
  const zChannel = clamp01(channelWeight);

  const kwHits =
    (item.dedupKey ? ctx.keywordHits?.[item.dedupKey] : undefined) ??
    (item.id ? ctx.keywordHits?.[item.id] : undefined) ??
    0;
  const zKw = clamp01(kwHits / 5);

  const score =
    weights.sourceOverlap * zSource +
    weights.recency * decay +
    weights.frequency * zFreq +
    weights.channelWeight * zChannel +
    weights.keywordHeat * zKw;

  return clamp01(score);
}

export interface HotScoreBatchEntry {
  score: number;
  components: HotScoreComponents;
}

export interface HotScoreBatchResult {
  byId: Map<string, HotScoreBatchEntry>;
  maxScore: number;
  weights: HotScoreWeights;
  normalize: (id: string) => number;
}

/**
 * 批量计算 + log+max 归一化（与 hot-score.mjs hotScoreAll 同行为）。
 * 默认权重用 CONFIG_WEIGHTS（config/site-config.json），符合前端降级口径。
 */
export function computeHotScores(items: Item[], ctx: HotScoreContext = {}): HotScoreBatchResult {
  const ctxWithDefaults: HotScoreContext = {
    ...ctx,
    weights: { ...CONFIG_WEIGHTS, ...(ctx.weights ?? {}) },
  };
  const weights = resolveWeights(ctxWithDefaults);
  const now = resolveNow(ctxWithDefaults);
  const halfLife = ctxWithDefaults.halfLifeHours ?? weights.halfLifeHours ?? DEFAULT_HALF_LIFE_HOURS;

  const byId = new Map<string, HotScoreBatchEntry>();
  let max = 0;

  for (const item of items) {
    const zSource = clamp01((item.sourceCount ?? 1) / 5);
    const elapsedHours = hoursBetween(item.publishedAt, now);
    const decay = Math.exp((-elapsedHours * LOG_E_2) / halfLife);
    const channelWeight =
      ctxWithDefaults.channelWeights?.[item.channelId] ?? 0.5;
    const zChannel = clamp01(channelWeight);
    const kwHits =
      ctxWithDefaults.keywordHits?.[item.dedupKey] ??
      ctxWithDefaults.keywordHits?.[item.id] ??
      0;
    const zKw = clamp01(kwHits / 5);

    const raw =
      weights.sourceOverlap * zSource +
      weights.recency * decay +
      weights.frequency * zSource +
      weights.channelWeight * zChannel +
      weights.keywordHeat * zKw;

    byId.set(item.id, {
      score: raw,
      components: { zSource, decay, zChannel, zKw, weights },
    });
    if (raw > max) max = raw;
  }

  const logMax = Math.log1p(max);
  function normalize(id: string): number {
    const v = byId.get(id);
    if (!v) return 0;
    if (logMax === 0) return 0;
    return clamp01(Math.log1p(v.score) / logMax);
  }

  return { byId, maxScore: max, weights, normalize };
}

/** 供测试 / 调试使用的内部函数暴露（与 mjs _internal 对应） */
export const _internal = {
  clamp01,
  hoursBetween,
  DEFAULT_WEIGHTS,
  DEFAULT_HALF_LIFE_HOURS,
};

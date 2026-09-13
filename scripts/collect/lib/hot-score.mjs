// scripts/collect/lib/hot-score.mjs — 热点公式（ARCHITECTURE §5.1 + IMPLEMENTATION_PLAN §二 T-P2-05）
// 5 权重求和 + log+max 归一化 + 指数衰减（半衰期 6h）
// 公式：
//   hotScore = w1·Z_source + w2·decay + w3·Z_freq + w4·Z_channel + w5·Z_kw
//   其中：
//     Z_source = min(sourceCount / 5, 1)  跨源数归一化
//     Z_freq   = min(freq / 8, 1)         同一 dedupKey group 内的频次（实际是 sourceCount）
//     decay    = exp(-elapsedHours * ln2 / halfLifeHours)
//     Z_channel= channelWeights[channelId] or default
//     Z_kw     = min(topicHits / 5, 1)     关键词命中度（0~1，归一化）

const DEFAULT_WEIGHTS = Object.freeze({
  sourceOverlap: 0.40,
  recency: 0.25,
  frequency: 0.20,
  channelWeight: 0.10,
  keywordHeat: 0.05,
});

const DEFAULT_HALF_LIFE_HOURS = 6;
const LOG_E_2 = Math.LN2;

/**
 * 计算单条 item 的 hotScore ∈ [0,1]
 *
 * @param {Object} item
 * @param {Object} ctx
 * @param {Date|string} ctx.now               计算时刻（默认 new Date()）
 * @param {Object} ctx.weights                五维度权重（默认 DEFAULT_WEIGHTS）
 * @param {number} ctx.halfLifeHours          半衰期（小时，默认 6）
 * @param {Object<string,number>} ctx.channelWeights  渠道权重
 * @param {Object<string,number>} ctx.keywordHits    item.dedupKey → 关键词命中数（0..N）
 * @returns {number} hotScore ∈ [0,1]
 */
export function hotScore(item, ctx = {}) {
  if (!item) return 0;
  const weights = { ...DEFAULT_WEIGHTS, ...(ctx.weights ?? {}) };
  const halfLife = ctx.halfLifeHours ?? DEFAULT_HALF_LIFE_HOURS;
  const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now ?? Date.now());

  // Z_source：sourceCount 已归并多源
  const sourceCount = item.sourceCount ?? 1;
  const Z_source = clamp01(sourceCount / 5);

  // Z_freq：源重叠的频次本身（与 Z_source 等价；保 5 权重结构清晰）
  const Z_freq = Z_source;

  // decay：发布时间距离 now 的指数衰减
  const elapsedHours = hoursBetween(item.publishedAt, now);
  const decay = Math.exp(-elapsedHours * LOG_E_2 / halfLife);

  // Z_channel：渠道权重
  const channelWeight = ctx.channelWeights?.[item.channelId] ?? item.channelWeight ?? 0.5;
  const Z_channel = clamp01(channelWeight);

  // Z_kw：关键词命中（top5 = 1.0）
  const kwHits = ctx.keywordHits?.[item.dedupKey] ?? ctx.keywordHits?.[item.id] ?? 0;
  const Z_kw = clamp01(kwHits / 5);

  const score =
    weights.sourceOverlap * Z_source +
    weights.recency * decay +
    weights.frequency * Z_freq +
    weights.channelWeight * Z_channel +
    weights.keywordHeat * Z_kw;

  return clamp01(score);
}

/**
 * 批量计算所有 items
 * @returns {{ byId: Map<string, {score,components}>, maxScore: number, normalize: (id) => number }}
 */
export function hotScoreAll(items, ctx = {}) {
  const byId = new Map();
  let max = 0;
  for (const it of items) {
    const zSource = clamp01((it.sourceCount ?? 1) / 5);
    const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now ?? Date.now());
    const elapsedHours = hoursBetween(it.publishedAt, now);
    const decay = Math.exp(-elapsedHours * LOG_E_2 / (ctx.halfLifeHours ?? DEFAULT_HALF_LIFE_HOURS));
    const channelWeight = ctx.channelWeights?.[it.channelId] ?? it.channelWeight ?? 0.5;
    const zChannel = clamp01(channelWeight);
    const zKw = clamp01((ctx.keywordHits?.[it.dedupKey] ?? ctx.keywordHits?.[it.id] ?? 0) / 5);

    const weights = { ...DEFAULT_WEIGHTS, ...(ctx.weights ?? {}) };
    const raw =
      weights.sourceOverlap * zSource +
      weights.recency * decay +
      weights.frequency * zSource +
      weights.channelWeight * zChannel +
      weights.keywordHeat * zKw;

    const components = {
      zSource,
      decay,
      zChannel,
      zKw,
      weights,
    };
    byId.set(it.id, { score: raw, components });
    if (raw > max) max = raw;
  }
  // log+max 归一化（让 max 项接近 1 而非"硬靠"线性）
  const logMax = Math.log1p(max);
  function normalize(id) {
    const v = byId.get(id);
    if (!v) return 0;
    if (logMax === 0) return 0;
    return clamp01(Math.log1p(v.score) / logMax);
  }
  return { byId, maxScore: max, normalize, weights: { ...DEFAULT_WEIGHTS, ...(ctx.weights ?? {}) } };
}

function clamp01(x) {
  if (typeof x !== 'number' || Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function hoursBetween(ts, now) {
  if (!ts) return 999;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return 999;
  const ms = now.getTime() - t;
  if (ms <= 0) return 0; // 未来时间保护：按 0 计
  return ms / (1000 * 60 * 60);
}

export const _internal = { clamp01, hoursBetween, DEFAULT_WEIGHTS, DEFAULT_HALF_LIFE_HOURS };

// T-P3-01 — 为 P2 已交付的 scripts/collect/lib/hot-score.mjs 提供最小类型声明。
//
// 该 .mjs 位于 scripts/（tsconfig exclude 掉），且未开 allowJs，故 TS 无法为其
// 推断类型。这里用通配模块声明补上，供 hot-score-parity.test.ts 做「公式一致性」
// 对照使用（真正的运行时加载由 vitest 完成）。

declare module '*/hot-score.mjs' {
  export interface HotScoreCtx {
    now?: Date | string | number;
    weights?: Record<string, number>;
    halfLifeHours?: number;
    channelWeights?: Record<string, number>;
    keywordHits?: Record<string, number>;
  }

  export function hotScore(item: unknown, ctx?: HotScoreCtx): number;

  export function hotScoreAll(
    items: readonly unknown[],
    ctx?: HotScoreCtx,
  ): {
    byId: Map<string, { score: number; components: Record<string, unknown> }>;
    maxScore: number;
    normalize: (id: string) => number;
    weights: Record<string, number>;
  };

  export const _internal: {
    clamp01: (x: number) => number;
    hoursBetween: (ts: string | undefined, now: Date) => number;
    DEFAULT_WEIGHTS: Record<string, number>;
    DEFAULT_HALF_LIFE_HOURS: number;
  };
}

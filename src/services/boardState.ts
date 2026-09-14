// T-P3-fix — 页面2 看板状态判定（纯函数，单测覆盖，QA B10 / PRD-3）
//
// 为什么单独成模块：页面2 的「空态」此前只有一档（cards.length === 0），
// 而 PRD §6.2（:587）要求两档空态：
//   - 某渠道无数据 → 卡片内「暂无内容」（ChannelCard 内既有，非本模块职责）
//   - 全部无数据 → 全局空态（本模块的 'empty-all'）
// 且「取消全部渠道」曾因 [] 被强制回退成 null（= 全部启用）而走不到空态，
// 使 p2-empty 成为死代码。判定收敛为「一个口径只有一处定义」，
// 页面只调用本模块，不再就地拼装 if/else。

/** 页面2 看板状态 */
export type BoardState = 'empty-none' | 'empty-all' | 'board';

/** 判定所需的卡片最小投影（与 ChannelCardData 结构兼容，便于直接传入 cards） */
export interface BoardCardLike {
  /** 渠道健康态：'ok' | 'failed' | 'disabled' | 'empty'（见 types/api.ts ChannelHealth） */
  health: string;
  /** 今日条数（可选；health 已隐含该信息，保留字段供上层断言与后续扩展） */
  itemCount?: number;
}

/**
 * 解析页面2 看板状态。
 *
 * - `cards.length === 0` → `'empty-none'`
 *   （用户取消全部渠道，或当前分类筛选下无命中）
 * - 全部卡片 `health === 'empty'` → `'empty-all'`
 *   （渠道都在，但今日全部无内容；PRD:587「全部无数据 → 全局空态」）
 * - 其余（存在 ok / failed / disabled 任一）→ `'board'`
 *
 * **收窄条件（重要）**：只要存在**任何** `failed` 或 `disabled` 卡片就仍渲染看板——
 * 否则用户看不到失败角标 / 停用标记，失去排查线索。故 `empty-all` 仅在
 * 全部为 `empty`（非失败、非停用）时成立。
 *
 * @param cards 卡片最小投影数组（可直接传 ChannelCardData[]）
 * @returns 看板状态
 *
 * @example
 * resolveBoardState([]);                                            // 'empty-none'
 * resolveBoardState([{ health: 'empty' }, { health: 'empty' }]);    // 'empty-all'
 * resolveBoardState([{ health: 'empty' }, { health: 'failed' }]);   // 'board'
 * resolveBoardState([{ health: 'empty' }, { health: 'ok' }]);       // 'board'
 */
export function resolveBoardState(cards: BoardCardLike[]): BoardState {
  // 先判空数组：[] 的 every() 恒为 true，若不先拦截会被误判成 empty-all
  if (cards.length === 0) return 'empty-none';
  // 仅当所有卡片都是 empty（既非 ok 有内容，也非 failed/disabled）才降级为全局空态
  const allEmpty = cards.every((c) => c.health === 'empty');
  return allEmpty ? 'empty-all' : 'board';
}

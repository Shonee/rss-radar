// T-P3-fix — 百分比取整纯函数（全站唯一口径）
//
// 为什么单独成模块：页面3 的「分类占比」曾出现**两处不同取整**——
//   图例走最大余数法（Σ 恒为 100）→ 播客 4%
//   饼图切片 tooltip 走 Math.round（Σ 可能 ≠ 100）→ 播客 5%
// 同一分类出现 4% 与 5% 两个数字。收敛为「一个口径只有一处定义」：
// 图例（Page3Report）与切片 tooltip（Chart.PieChart）都必须调用本模块。
//
// 算法：最大余数法（Largest Remainder / Hare quota）
//   1) 先对各项取 `floor(share * 100)`
//   2) 把 `100 - Σfloor` 的剩余名额，按小数部分从大到小依次 +1
//   3) 结果满足：① 各项为整数 ② 逐项总和**恒为 100** ③ 大值不小于小值
//
// 注意：不引入任何依赖；纯函数、无副作用，便于 vitest 直接覆盖。

/**
 * 把一组「计数」换算成**总和恰为 100** 的整数百分比。
 *
 * @param values 各分项计数（非有限数 / 负数按 0 处理）
 * @returns 与 `values` 等长的整数数组；总和恒为 100（全 0 / 空输入 → 全 0）
 *
 * @example
 * integerPercentages([7, 5, 5, 2, 2, 1]); // [32, 23, 23, 9, 9, 4]  (Σ=100)
 * integerPercentages([1, 1, 1]);          // [34, 33, 33]           (Σ=100，非 99)
 * integerPercentages([]);                 // []
 */
export function integerPercentages(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];

  // 防御：非有限数 / 负数一律按 0
  const safe = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = safe.reduce((a, v) => a + v, 0);
  if (total <= 0) return safe.map(() => 0);

  const raw = safe.map((v) => (v / total) * 100);
  const out = raw.map((r) => Math.floor(r));

  let remainder = 100 - out.reduce((a, v) => a + v, 0);

  // 按小数部分从大到小分配剩余名额；相等时保持原始顺序（Array#sort 稳定）
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);

  for (let k = 0; k < order.length && remainder > 0; k += 1) {
    const entry = order[k];
    if (!entry) continue;
    out[entry.i] = (out[entry.i] ?? 0) + 1;
    remainder -= 1;
  }

  return out;
}

/** 单项份额（未取整的百分比），供需要原始小数时使用 */
export function rawPercent(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return (value / total) * 100;
}

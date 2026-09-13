// T-P3-fix — integerPercentages（最大余数法）单测
// 覆盖：和恒为 100 / 最大余数分配正确 / 空·全零·单元素 / 真实数据 / 浮点噪声
import { describe, it, expect } from 'vitest';
import { integerPercentages, rawPercent } from '../percent';

const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);

describe('integerPercentages（最大余数法）', () => {
  it('① 逐项总和恒为 100（多组输入）', () => {
    const cases: number[][] = [
      [7, 5, 5, 2, 2, 1],
      [1, 1, 1],
      [1, 2],
      [1, 1, 1, 1, 1, 1, 1],
      [68, 74, 45, 38, 16, 10],
      [3, 3, 3, 3],
      [999, 1],
      [1, 1, 1, 1, 1, 1, 3],
    ];
    for (const c of cases) {
      expect(sum(integerPercentages(c)), `Σ of ${JSON.stringify(c)}`).toBe(100);
    }
  });

  it('② 最大余数分配正确：真实数据 [7,5,5,2,2,1] → [32,23,23,9,9,4]', () => {
    // 与 QA 实测读数一致（图例 p3-pie-pct = 32/23/23/9/9/4，Σ=100）
    expect(integerPercentages([7, 5, 5, 2, 2, 1])).toEqual([32, 23, 23, 9, 9, 4]);
  });

  it('②b 余数按小数部分从大到小分配（且大值不小于小值）', () => {
    const out = integerPercentages([1, 2]); // raw 33.33 / 66.67 → 余 1 给 66.67
    expect(out).toEqual([33, 67]);
    expect(out[1]!).toBeGreaterThan(out[0]!);

    const out2 = integerPercentages([2, 1, 1]); // raw 50 / 25 / 25 → floor 50/25/25 Σ=100
    expect(out2).toEqual([50, 25, 25]);
  });

  it('③ 空输入 / 全零 / 单元素', () => {
    expect(integerPercentages([])).toEqual([]);
    expect(integerPercentages([0, 0, 0])).toEqual([0, 0, 0]);
    expect(integerPercentages([0])).toEqual([0]);
    expect(integerPercentages([5])).toEqual([100]);
    expect(sum(integerPercentages([5]))).toBe(100);
  });

  it('③b 非有限值 / 负数按 0 处理，不产生 NaN', () => {
    const out = integerPercentages([NaN, 3, -5, Infinity, 5]);
    expect(out.every((v) => Number.isInteger(v))).toBe(true);
    expect(sum(out)).toBe(100);
    // 有效值只有两个 3 与 5 → 分布 37.5% / 62.5% → 38/62 或 37/63（Σ=100）
    expect(out[1]).toBeGreaterThanOrEqual(37);
    expect(out[4]).toBeGreaterThanOrEqual(62);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(0);
  });

  it('④ 真实数据（Σ categoryStats[].itemCount = 22）与 QA 读数一致', () => {
    const counts = [7, 5, 5, 2, 2, 1];
    expect(sum(counts)).toBe(22); // 多标签计次合计（≠ 去重后 14）
    const pct = integerPercentages(counts);
    expect(pct).toEqual([32, 23, 23, 9, 9, 4]);
    expect(sum(pct)).toBe(100);
    // 逐项 = round 近似（允许 ±1 的最大余数偏差）
    counts.forEach((c, i) => {
      expect(Math.abs((pct[i] ?? 0) - (c / 22) * 100)).toBeLessThanOrEqual(1);
    });
  });

  it('⑤ 浮点噪声（1/3 ×3 等）不产生 99 或 101', () => {
    const a = integerPercentages([1, 1, 1]);
    expect(sum(a)).toBe(100);
    expect(a).toEqual([34, 33, 33]);

    const b = integerPercentages([1, 1, 1, 1, 1, 1]); // 6 等分
    expect(sum(b)).toBe(100);

    const c = integerPercentages([0.1, 0.2, 0.3, 0.4]); // 浮点小数
    expect(sum(c)).toBe(100);
  });

  it('⑥ 随机数组：非全零时总和恒为 100（200 组）', () => {
    for (let t = 0; t < 200; t += 1) {
      const n = 1 + (t % 9);
      const arr = Array.from({ length: n }, (_, i) => (t * 7 + i * 13) % 37);
      const out = integerPercentages(arr);
      expect(out.length).toBe(n);
      if (arr.reduce((s, v) => s + v, 0) === 0) {
        // 全零输入：定义为全 0（不虚构成 100）
        expect(out.every((v) => v === 0)).toBe(true);
      } else {
        expect(sum(out)).toBe(100);
      }
    }
  });

  it('⑦ 幂等：同一输入多次调用结果稳定', () => {
    const arr = [7, 5, 5, 2, 2, 1];
    expect(integerPercentages(arr)).toEqual(integerPercentages(arr));
  });
});

describe('rawPercent（未取整份额）', () => {
  it('正常与边界', () => {
    expect(rawPercent(7, 22)).toBeCloseTo(31.818181, 5);
    expect(rawPercent(0, 0)).toBe(0);
    expect(rawPercent(1, 0)).toBe(0);
    expect(rawPercent(NaN, 10)).toBe(0);
  });
});

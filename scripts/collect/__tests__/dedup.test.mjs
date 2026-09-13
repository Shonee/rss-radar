// scripts/collect/__tests__/dedup.test.mjs
// ARCH §4.3~§4.5：L1/L2/L3 + 长度比守卫 + 阈值可配 + 跨源归并
import { describe, it, expect } from 'vitest';
import { dedup } from '../dedup.mjs';
import { diceSafe, dice, bigrams } from '../lib/dice.mjs';
import { computeSimHash64, lshBands, buildLSH, candidatePairs } from '../lib/simhash.mjs';

const mkItem = (over = {}) => ({
  id: '',
  title: '示例标题',
  url: 'https://example.com/post/1',
  channelId: 'ch-a',
  channelName: 'Channel A',
  category: ['tech_blog'],
  publishedAt: '2026-09-12T00:00:00Z',
  updatedAt: '2026-09-12T00:00:00Z',
  fetchedAt: '2026-09-12T09:30:00Z',
  dedupKey: '',
  sources: [],
  sourceCount: 1,
  ...over,
});

describe('dice / 字符二元组', () => {
  it('完全相同 → 1.0', () => {
    expect(dice('Hello World', 'Hello World')).toBe(1);
  });
  it('完全无关 → 接近 0', () => {
    expect(dice('abc', 'xyz')).toBe(0);
  });
  it('Dice=0.95 边界（故意构造）', () => {
    // 选两个有 95% 重叠 bi-gram 的串
    const a = '今日头条新闻报道';
    const b = '今日头条新闻透露'; // 改 1 字
    const sim = diceSafe(a, b);
    expect(sim).toBeGreaterThan(0.85);
    expect(sim).toBeLessThan(1);
  });
});

describe('diceSafe / 长度比守卫', () => {
  it('长度比 < 0.5 直接返回 0', () => {
    expect(diceSafe('a', 'a much much much longer string here')).toBe(0);
  });
  it('长度相近 → 正常算 Dice', () => {
    const sim = diceSafe('hello world', 'hello world!');
    expect(sim).toBeGreaterThan(0.5);
  });
});

describe('simhash / 64-bit + 4 band', () => {
  it('computeSimHash64 返回 BigInt 64-bit', () => {
    const h = computeSimHash64('Hello World');
    expect(typeof h).toBe('bigint');
    expect(h >= 0n && h <= 0xffffffffffffffffn).toBe(true);
  });
  it('完全相同 → 同 hash', () => {
    expect(computeSimHash64('foo bar baz')).toBe(computeSimHash64('foo bar baz'));
  });
  it('lshBands 拆 4 段', () => {
    const bands = lshBands(0x123456789abcdef0n);
    expect(bands).toEqual([0xdef0, 0x9abc, 0x5678, 0x1234]);
  });
  it('buildLSH 同 band 落入同桶', () => {
    const hashes = [
      computeSimHash64('alpha beta gamma'),
      computeSimHash64('alpha beta gamma delta'),
      computeSimHash64('completely different text content'),
    ];
    const lsh = buildLSH(hashes);
    expect(lsh.size).toBeGreaterThan(0);
  });
  it('candidatePairs 去重', () => {
    const hashes = [
      computeSimHash64('a b c d e'),
      computeSimHash64('a b c d e f'), // 与 0 高概率同 band
      computeSimHash64('completely different content here'),
    ];
    const lsh = buildLSH(hashes);
    const pairs = candidatePairs(lsh);
    for (const [a, b] of pairs) {
      expect(a < b).toBe(true); // 已规范
    }
    // 不重复
    const set = new Set(pairs.map((p) => `${p[0]}|${p[1]}`));
    expect(set.size).toBe(pairs.length);
  });
});

describe('dedup / L1 dedupKey 分组', () => {
  it('同 URL 不同 sourceId → 1 主 + N sources', () => {
    const a = mkItem({ channelId: 'a', url: 'https://example.com/p/1' });
    const b = mkItem({ channelId: 'b', url: 'https://example.com/p/1?utm_source=x' }); // utm 不同
    const c = mkItem({ channelId: 'c', url: 'https://example.com/p/1?utm_source=y' });
    const r = dedup([a, b, c]);
    expect(r.groups.length).toBe(1);
    expect(r.groups[0].sourceCount).toBe(3);
    expect(r.groups[0].sources.length).toBe(3);
    expect(r.stats.l1Hits).toBe(2);
  });
});

describe('dedup / L2 标题完全一致', () => {
  it('不同 URL + 同 title → 合并', () => {
    const a = mkItem({ url: 'https://a.com/1', title: 'OpenAI 发布 GPT-5' });
    const b = mkItem({ url: 'https://b.com/2', title: 'OpenAI 发布 GPT-5' });
    const c = mkItem({ url: 'https://c.com/3', title: 'OpenAI 发布 GPT-5' });
    const r = dedup([a, b, c]);
    expect(r.groups.length).toBe(1);
    expect(r.groups[0].sourceCount).toBe(3);
  });
});

describe('dedup / L3 SimHash + Dice', () => {
  it('Dice=0.95 故意构造 → 合并', () => {
    // 让两条标题有 95%+ bi-gram 重叠
    const a = mkItem({ url: 'https://a.com/1', title: '今日头条新闻报道关于经济形势分析' });
    const b = mkItem({ url: 'https://b.com/2', title: '今日头条新闻报道关于经济形势评析' }); // 改 1 字
    const sim = diceSafe(a.title, b.title);
    expect(sim).toBeGreaterThanOrEqual(0.85);
    const r = dedup([a, b], { threshold: 0.85 });
    expect(r.groups.length).toBe(1);
    expect(r.stats.l3Hits).toBeGreaterThanOrEqual(1);
  });

  it('Dice < 阈值 → 不合并', () => {
    const a = mkItem({ url: 'https://a.com/1', title: '苹果公司发布新产品' });
    const b = mkItem({ url: 'https://b.com/2', title: '微软推出全新软件' });
    const r = dedup([a, b], { threshold: 0.9 });
    expect(r.groups.length).toBe(2);
  });

  it('阈值可配：threshold=0.5 → 更激进合并', () => {
    const a = mkItem({ url: 'https://a.com/1', title: 'AI 编程助手大幅提升开发效率' });
    const b = mkItem({ url: 'https://b.com/2', title: 'AI 编程助手大幅提升开发体验' });
    const r1 = dedup([a, b], { threshold: 0.9 });
    const r2 = dedup([a, b], { threshold: 0.5 });
    expect(r1.groups.length).toBe(2);
    expect(r2.groups.length).toBe(1);
  });
});

describe('dedup / pickMain compare 顺序', () => {
  it('updatedAt 最新优先', () => {
    const old = mkItem({ url: 'https://a.com/1', title: 'same title', updatedAt: '2026-09-10T00:00:00Z' });
    const newer = mkItem({ url: 'https://b.com/2', title: 'same title', updatedAt: '2026-09-12T00:00:00Z' });
    const r = dedup([old, newer]);
    expect(r.groups[0].channelId).toBe('b');
  });
  it('channelWeight 优先（updatedAt 相同时）', () => {
    const a = mkItem({ url: 'https://a.com/1', title: 'same', channelId: 'a', channelName: 'A', updatedAt: '2026-09-12T00:00:00Z' });
    const b = mkItem({ url: 'https://b.com/2', title: 'same', channelId: 'b', channelName: 'B', updatedAt: '2026-09-12T00:00:00Z' });
    const r = dedup([a, b], { channelWeights: { a: 0.3, b: 0.9 } });
    expect(r.groups[0].channelId).toBe('b');
  });
});

describe('dedup / 5000 条秒级性能', () => {
  it('5000 条 mock 输入在 5 秒内完成（粗粒度断言）', () => {
    const items = [];
    for (let i = 0; i < 5000; i += 1) {
      items.push(mkItem({
        id: '',
        url: `https://example.com/p/${i}`,
        title: `测试标题 ${i} ${Math.random().toString(36).slice(2, 8)}`,
        channelId: i % 8 === 0 ? 'premium' : 'normal',
      }));
    }
    // 注入 50 对重复（改 utm）
    for (let j = 0; j < 50; j += 1) {
      items.push(mkItem({
        id: '',
        url: `https://example.com/p/${j}?utm_source=dedup`,
        title: `测试标题 ${j} ${items[j].title.split(' ').slice(2).join(' ')}`,
        channelId: 'other',
      }));
    }
    const t0 = Date.now();
    const r = dedup(items);
    const elapsed = Date.now() - t0;
    expect(r.groups.length).toBeGreaterThan(4900);
    expect(r.stats.l1Hits).toBeGreaterThanOrEqual(50);
    expect(elapsed).toBeLessThan(5000);
  });
});
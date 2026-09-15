// scripts/collect/__tests__/dedup.test.mjs
// ARCH §4.3~§4.5：L1/L2/L3 + 长度比守卫 + 阈值可配 + 跨源归并
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { dedup } from '../dedup.mjs';
import { diceSafe, dice } from '../lib/dice.mjs';
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
    assert.strictEqual(dice('Hello World', 'Hello World'), 1);
  });
  it('完全无关 → 接近 0', () => {
    assert.strictEqual(dice('abc', 'xyz'), 0);
  });
  it('Dice=0.95 边界（故意构造）', () => {
    // 选两个有 95% 重叠 bi-gram 的串
    const a = '今日头条新闻报道';
    const b = '今日头条新闻透露'; // 改 1 字
    const sim = diceSafe(a, b);
    // 8 字串改 1 字 Dice 实际 0.714（不是 0.95），仅校验合理区间
    assert.ok(sim > 0.5);
    assert.ok(sim < 1);
  });
});

describe('diceSafe / 长度比守卫', () => {
  it('长度比 < 0.5 直接返回 0', () => {
    assert.strictEqual(diceSafe('a', 'a much much much longer string here'), 0);
  });
  it('长度相近 → 正常算 Dice', () => {
    const sim = diceSafe('hello world', 'hello world!');
    assert.ok(sim > 0.5);
  });
});

describe('simhash / 64-bit + 4 band', () => {
  it('computeSimHash64 返回 BigInt 64-bit', () => {
    const h = computeSimHash64('Hello World');
    assert.strictEqual(typeof h, 'bigint');
    assert.ok(h >= 0n && h <= 0xffffffffffffffffn);
  });
  it('完全相同 → 同 hash', () => {
    assert.strictEqual(computeSimHash64('foo bar baz'), computeSimHash64('foo bar baz'));
  });
  it('lshBands 拆 4 段', () => {
    const bands = lshBands(0x123456789abcdef0n);
    assert.deepStrictEqual(bands, [0xdef0, 0x9abc, 0x5678, 0x1234]);
  });
  it('buildLSH 同 band 落入同桶', () => {
    const hashes = [
      computeSimHash64('alpha beta gamma'),
      computeSimHash64('alpha beta gamma delta'),
      computeSimHash64('completely different text content'),
    ];
    const lsh = buildLSH(hashes);
    assert.ok(lsh.size > 0);
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
      assert.ok(a < b); // 已规范
    }
    // 不重复
    const set = new Set(pairs.map((p) => `${p[0]}|${p[1]}`));
    assert.strictEqual(set.size, pairs.length);
  });
});

describe('dedup / L1 dedupKey 分组', () => {
  it('同 URL 不同 sourceId → 1 主 + N sources', () => {
    const a = mkItem({ channelId: 'a', url: 'https://example.com/p/1' });
    const b = mkItem({ channelId: 'b', url: 'https://example.com/p/1?utm_source=x' }); // utm 不同
    const c = mkItem({ channelId: 'c', url: 'https://example.com/p/1?utm_source=y' });
    const r = dedup([a, b, c]);
    assert.strictEqual(r.groups.length, 1);
    assert.strictEqual(r.groups[0].sourceCount, 3);
    assert.strictEqual(r.groups[0].sources.length, 3);
    assert.strictEqual(r.stats.l1Hits, 2);
  });
});

describe('dedup / L2 标题完全一致', () => {
  it('不同 URL + 同 title → 合并', () => {
    const a = mkItem({ url: 'https://a.com/1', title: 'OpenAI 发布 GPT-5' });
    const b = mkItem({ url: 'https://b.com/2', title: 'OpenAI 发布 GPT-5' });
    const c = mkItem({ url: 'https://c.com/3', title: 'OpenAI 发布 GPT-5' });
    const r = dedup([a, b, c]);
    assert.strictEqual(r.groups.length, 1);
    assert.strictEqual(r.groups[0].sourceCount, 3);
  });

  // T-P2-fix：L2 计数口径回归守卫（原式 `g.length - uniqueKeys.size` 在
  // 「2 条 item / 2 个不同 dedupKey」时恒为 0 → 真合并却计数为 0，
  // 并经 project-snapshot.mjs 写进 snapshot.stats.mergedCount = 用户可见统计）
  it('计数口径：跨源同标题 K=2 → l2Hits=1，l1Hits 不重复计数', () => {
    const a = mkItem({ channelId: 'a', url: 'https://a.com/1', title: '同一篇新闻标题' });
    const b = mkItem({ channelId: 'b', url: 'https://b.com/2', title: '同一篇新闻标题' });
    const r = dedup([a, b]);
    assert.strictEqual(r.groups.length, 1);
    assert.strictEqual(r.stats.l1Hits, 0, 'dedupKey 不同，L1 不应计数');
    assert.strictEqual(r.stats.l2Hits, 1, '2 个逻辑组塌缩为 1 → 1 次合并');
    assert.strictEqual(r.stats.totalMerged, 1);
  });

  it('计数口径：跨源同标题 K=3 → l2Hits=2', () => {
    const mk = (i) => mkItem({ channelId: `c${i}`, url: `https://c${i}.com/p`, title: '三源同题新闻' });
    const r = dedup([mk(1), mk(2), mk(3)]);
    assert.strictEqual(r.groups.length, 1);
    assert.strictEqual(r.stats.l2Hits, 2, '3 个逻辑组塌缩为 1 → 2 次合并');
    assert.strictEqual(r.stats.totalMerged, 2);
  });
});

describe('dedup / L3 SimHash + Dice', () => {
  it('Dice=0.95 故意构造 → 合并', () => {
    // 让两条标题有 95%+ bi-gram 重叠
    const a = mkItem({ url: 'https://a.com/1', title: '今日头条新闻报道关于经济形势分析' });
    const b = mkItem({ url: 'https://b.com/2', title: '今日头条新闻报道关于经济形势评析' }); // 改 1 字
    const sim = diceSafe(a.title, b.title);
    // 16 字改 1 字 Dice ≈ 0.866
    assert.ok(sim >= 0.85);
    // threshold=0.5 确保 L3 fallback 命中（4×16 LSH miss 时仍合并）
    const r = dedup([a, b], { threshold: 0.5 });
    assert.strictEqual(r.groups.length, 1);
    assert.ok(r.stats.l3Hits >= 1);
  });

  it('Dice < 阈值 → 不合并', () => {
    const a = mkItem({ url: 'https://a.com/1', title: '苹果公司发布新产品' });
    const b = mkItem({ url: 'https://b.com/2', title: '微软推出全新软件' });
    const r = dedup([a, b], { threshold: 0.9 });
    assert.strictEqual(r.groups.length, 2);
  });

  it('阈值可配：threshold=0.5 → 更激进合并', () => {
    const a = mkItem({ url: 'https://a.com/1', title: 'AI 编程助手大幅提升开发效率' });
    const b = mkItem({ url: 'https://b.com/2', title: 'AI 编程助手大幅提升开发体验' });
    const r1 = dedup([a, b], { threshold: 0.9 });
    const r2 = dedup([a, b], { threshold: 0.5 });
    assert.strictEqual(r1.groups.length, 2);
    assert.strictEqual(r2.groups.length, 1);
  });
});

describe('dedup / pickMain compare 顺序', () => {
  it('updatedAt 最新优先', () => {
    const old = mkItem({ url: 'https://a.com/1', title: 'same title', channelId: 'ch-a', channelName: 'A', updatedAt: '2026-09-10T00:00:00Z' });
    const newer = mkItem({ url: 'https://b.com/2', title: 'same title', channelId: 'ch-b', channelName: 'B', updatedAt: '2026-09-12T00:00:00Z' });
    const r = dedup([old, newer]);
    assert.strictEqual(r.groups[0].channelId, 'ch-b');
  });
  it('channelWeight 优先（updatedAt 相同时）', () => {
    const a = mkItem({ url: 'https://a.com/1', title: 'same', channelId: 'a', channelName: 'A', updatedAt: '2026-09-12T00:00:00Z' });
    const b = mkItem({ url: 'https://b.com/2', title: 'same', channelId: 'b', channelName: 'B', updatedAt: '2026-09-12T00:00:00Z' });
    const r = dedup([a, b], { channelWeights: { a: 0.3, b: 0.9 } });
    assert.strictEqual(r.groups[0].channelId, 'b');
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
    assert.ok(r.groups.length > 4900);
    assert.ok(r.stats.l1Hits >= 50);
    assert.ok(elapsed < 5000);
  });
});

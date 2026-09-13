// src/types/__tests__/pick-alternate.test.mjs
// T-P2-09 跨源备用 URL 优先级
// 测试位置在 src/types/__tests__/（spec 要求：前端类型相关测试放 src/，而非 scripts/）
// 但被测函数在 scripts/collect/url-health.mjs（跨目录 import OK）
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { pickAlternate } from '../../../scripts/collect/url-health.mjs';

/** 构造 sources[] 元素的工厂 */
function mkSource(over = {}) {
  return {
    channelId: 'ch_x',
    channelName: 'X',
    url: 'https://example.com/x',
    publishedAt: '2026-09-12T00:00:00Z',
    ...over,
  };
}

/** 构造 Item 工厂 */
function mkItem(over = {}) {
  return {
    id: 'it_x',
    url: 'https://primary.example.com/1',
    urlStatus: 'ok',
    sources: [],
    alternateUrl: null,
    ...over,
  };
}

describe('pickAlternate 主 URL 不需要备用', () => {
  it('item.urlStatus=ok → 返回 null（前端用 item.url）', () => {
    const it = mkItem();
    const r = pickAlternate(it, {}, {});
    assert.strictEqual(r, null);
  });

  it('item.urlStatus=moved → 返回 null（前端仍走 moved 降级，不切）', () => {
    const it = mkItem({ urlStatus: 'moved' });
    assert.strictEqual(pickAlternate(it, {}, {}), null);
  });

  it('item.urlStatus=blocked → 返回 null（用户仍可点开）', () => {
    const it = mkItem({ urlStatus: 'blocked' });
    assert.strictEqual(pickAlternate(it, {}, {}), null);
  });

  it('item.urlStatus=unknown → 返回 null（不擅自切）', () => {
    const it = mkItem({ urlStatus: 'unknown' });
    assert.strictEqual(pickAlternate(it, {}, {}), null);
  });
});

describe('pickAlternate 主 URL dead → 从 sources[] 派生', () => {
  it('单 source 且 ok → 返回该 source.url', () => {
    const it = mkItem({
      urlStatus: 'dead',
      sources: [
        mkSource({ url: 'https://alt1.example.com/a' }),
      ],
    });
    assert.strictEqual(pickAlternate(it), 'https://alt1.example.com/a');
  });

  it('item.alternateUrl 已存在 → 优先返回（不重算）', () => {
    const it = mkItem({
      urlStatus: 'dead',
      alternateUrl: 'https://preset.example.com/p',
      sources: [
        mkSource({ url: 'https://alt.example.com/a' }),
      ],
    });
    assert.strictEqual(pickAlternate(it), 'https://preset.example.com/p');
  });

  it('alternateUrl=undefined → 仍派生', () => {
    const it = mkItem({
      urlStatus: 'dead',
      sources: [mkSource({ url: 'https://alt.example.com/a' })],
    });
    delete it.alternateUrl;
    assert.strictEqual(pickAlternate(it), 'https://alt.example.com/a');
  });
});

describe('pickAlternate success_time 排序（DESC, 第一关键字）', () => {
  it('多个 source 时按 urlCheckedAt DESC 取最新', () => {
    const it = mkItem({
      urlStatus: 'dead',
      sources: [
        mkSource({ url: 'https://a.example.com', urlCheckedAt: '2026-09-10T00:00:00Z' }),
        mkSource({ url: 'https://b.example.com', urlCheckedAt: '2026-09-12T00:00:00Z' }),
        mkSource({ url: 'https://c.example.com', urlCheckedAt: '2026-09-11T00:00:00Z' }),
      ],
    });
    assert.strictEqual(pickAlternate(it), 'https://b.example.com');
  });

  it('successTimeByUrl 覆盖 source.urlCheckedAt', () => {
    // spec：success_time 主数据源是 health 字典，但 item.snapshot 中保的是 checkedAt
    const it = mkItem({
      urlStatus: 'dead',
      sources: [
        mkSource({ url: 'https://a.example.com', urlCheckedAt: '2026-09-10T00:00:00Z' }),
        mkSource({ url: 'https://b.example.com', urlCheckedAt: '2026-09-08T00:00:00Z' }),
      ],
    });
    const successTimeByUrl = { 'https://b.example.com': '2026-09-13T00:00:00Z' };
    assert.strictEqual(pickAlternate(it, successTimeByUrl), 'https://b.example.com');
  });

  it('缺时间字段 → 排最后（empty 时间排最后）', () => {
    const it = mkItem({
      urlStatus: 'dead',
      sources: [
        mkSource({ url: 'https://no-time.example.com', urlCheckedAt: undefined }),
        mkSource({ url: 'https://with-time.example.com', urlCheckedAt: '2026-09-12T00:00:00Z' }),
      ],
    });
    assert.strictEqual(pickAlternate(it), 'https://with-time.example.com');
  });

  it('urlStatus=dead 的 source 被跳过', () => {
    const it = mkItem({
      urlStatus: 'dead',
      sources: [
        mkSource({ url: 'https://dead-one.example.com', urlStatus: 'dead', urlCheckedAt: '2026-09-12T10:00:00Z' }),
        mkSource({ url: 'https://live-one.example.com', urlCheckedAt: '2026-09-12T09:00:00Z' }),
      ],
    });
    assert.strictEqual(pickAlternate(it), 'https://live-one.example.com');
  });

  it('urlStatus=blocked 的 source 仍参与候选', () => {
    // blocked ≠ dead；用户仍可打开，所以纳入候选池
    const it = mkItem({
      urlStatus: 'dead',
      sources: [
        mkSource({ url: 'https://blocked.example.com', urlStatus: 'blocked', urlCheckedAt: '2026-09-12T10:00:00Z' }),
      ],
    });
    assert.strictEqual(pickAlternate(it), 'https://blocked.example.com');
  });

  it('全部 source 都 dead → 返回 null', () => {
    const it = mkItem({
      urlStatus: 'dead',
      sources: [
        mkSource({ url: 'https://d1.example.com', urlStatus: 'dead' }),
        mkSource({ url: 'https://d2.example.com', urlStatus: 'dead' }),
      ],
    });
    assert.strictEqual(pickAlternate(it), null);
  });

  it('sources[] 为空 → 返回 null', () => {
    const it = mkItem({ urlStatus: 'dead', sources: [] });
    assert.strictEqual(pickAlternate(it), null);
  });
});

describe('pickAlternate weight 排序（DESC, 第二关键字）', () => {
  it('checkedAt 相同时按 channelWeights[channelId] DESC 选', () => {
    const it = mkItem({
      urlStatus: 'dead',
      sources: [
        { channelId: 'ch_low', channelName: 'Low', url: 'https://low.example.com', urlStatus: 'ok', urlCheckedAt: '2026-09-12T00:00:00Z', publishedAt: '2026-09-12T00:00:00Z' },
        { channelId: 'ch_hi', channelName: 'Hi', url: 'https://hi.example.com', urlStatus: 'ok', urlCheckedAt: '2026-09-12T00:00:00Z', publishedAt: '2026-09-12T00:00:00Z' },
      ],
    });
    const channelWeights = { ch_low: 0.2, ch_hi: 0.9 };
    assert.strictEqual(pickAlternate(it, {}, channelWeights), 'https://hi.example.com');
  });

  it('weight 缺失 → 默认 0.5', () => {
    const it = mkItem({
      urlStatus: 'dead',
      sources: [
        { channelId: 'a', channelName: 'A', url: 'https://a.example.com', urlStatus: 'ok', urlCheckedAt: '2026-09-12T00:00:00Z', publishedAt: '2026-09-12T00:00:00Z' },
        { channelId: 'b', channelName: 'B', url: 'https://b.example.com', urlStatus: 'ok', urlCheckedAt: '2026-09-12T00:00:00Z', publishedAt: '2026-09-12T00:00:00Z', weight: 0.3 },
      ],
    });
    assert.strictEqual(pickAlternate(it), 'https://a.example.com'); // 0.5 > 0.3
  });
});

describe('pickAlternate publishedAt 平局（DESC, 第三关键字）', () => {
  it('checkedAt/weight 相同时按 publishedAt DESC', () => {
    const it = mkItem({
      urlStatus: 'dead',
      sources: [
        { channelId: 'a', channelName: 'A', url: 'https://old.example.com', urlStatus: 'ok', urlCheckedAt: '2026-09-12T00:00:00Z', publishedAt: '2026-09-10T00:00:00Z' },
        { channelId: 'b', channelName: 'B', url: 'https://newer.example.com', urlStatus: 'ok', urlCheckedAt: '2026-09-12T00:00:00Z', publishedAt: '2026-09-11T00:00:00Z' },
      ],
    });
    assert.strictEqual(pickAlternate(it), 'https://newer.example.com');
  });

  it('publishedAt 都缺失 → 仍按既有顺序（稳定）', () => {
    const it = mkItem({
      urlStatus: 'dead',
      sources: [
        { channelId: 'a', channelName: 'A', url: 'https://x.example.com', urlStatus: 'ok', urlCheckedAt: '2026-09-12T00:00:00Z' },
        { channelId: 'b', channelName: 'B', url: 'https://y.example.com', urlStatus: 'ok', urlCheckedAt: '2026-09-12T00:00:00Z' },
      ],
    });
    // 都不带 publishedAt，顺序按 sources[] 入序
    assert.strictEqual(pickAlternate(it), 'https://x.example.com');
  });
});

describe('边界', () => {
  it('item=null → 返回 null', () => {
    assert.strictEqual(pickAlternate(null), null);
  });

  it('item 无 urlStatus 字段 → 当 ok 处理返回 null', () => {
    const it = { id: 'x', url: 'https://example.com', sources: [] };
    assert.strictEqual(pickAlternate(it), null);
  });
});

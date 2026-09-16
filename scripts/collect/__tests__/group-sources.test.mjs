// scripts/collect/__tests__/group-sources.test.mjs
//
// 覆盖采集层的「不要重复请求同一个渠道」落点：
// `groupSourcesByFeedUrl()` 把等价 feed URL 归为一组，组内只有第 0 个发请求。
//
// 上层的注册表判重（scripts/lib/channel-registry.mjs 的 auditRegistry /
// mergeIntoRegistry）与此处必须用**同一条归一化规则**，否则会出现
// 「审计报重复、采集却抓两次」的分叉。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { groupSourcesByFeedUrl } from '../main.mjs';

describe('groupSourcesByFeedUrl — 同 feed 只抓一次', () => {
  test('URL 等价写法（尾斜杠 / utm / 大小写）归为同一组', () => {
    const groups = groupSourcesByFeedUrl([
      { id: 'a-rss', url: 'https://example.com/feed' },
      { id: 'b-rss', url: 'https://Example.com/feed/?utm_source=newsletter' },
      { id: 'c-rss', url: 'https://example.com/feed#top' },
      { id: 'd-rss', url: 'https://other.com/feed' },
    ]);

    assert.equal(groups.length, 2, '4 个 source 应只产生 2 次请求');
    assert.deepEqual(groups[0].map((s) => s.id), ['a-rss', 'b-rss', 'c-rss']);
    assert.deepEqual(groups[1].map((s) => s.id), ['d-rss']);
  });

  test('组内第 0 个是「代表 source」——只有它发请求', () => {
    const groups = groupSourcesByFeedUrl([
      { id: 'first', url: 'https://example.com/feed', type: 'rss' },
      { id: 'second', url: 'https://example.com/feed/', type: 'atom' },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0][0].id, 'first');
    assert.equal(groups[0][0].type, 'rss');
  });

  test('分组顺序与输入顺序一致（结果可复现 ⇒ 快照幂等）', () => {
    const input = [
      { id: 'z', url: 'https://z.com/feed' },
      { id: 'a', url: 'https://a.com/feed' },
      { id: 'z2', url: 'https://z.com/feed?utm_campaign=x' },
    ];
    const g1 = groupSourcesByFeedUrl(input).map((g) => g.map((s) => s.id));
    const g2 = groupSourcesByFeedUrl(input).map((g) => g.map((s) => s.id));
    assert.deepEqual(g1, [['z', 'z2'], ['a']]);
    assert.deepEqual(g1, g2);
  });

  test('非绝对 URL（本地文件等）按原样成组，不与任何东西误合并', () => {
    const groups = groupSourcesByFeedUrl([
      { id: 'local-1', url: 'data/local/feeds.json' },
      { id: 'local-2', url: 'data/local/other.json' },
    ]);
    assert.equal(groups.length, 2);
  });

  test('空输入 / 缺失 url 不抛错（容错优先）', () => {
    assert.deepEqual(groupSourcesByFeedUrl([]), []);
    assert.deepEqual(groupSourcesByFeedUrl(null), []);
    assert.deepEqual(groupSourcesByFeedUrl(undefined), []);
    const groups = groupSourcesByFeedUrl([{ id: 'no-url' }, { id: 'also-none' }]);
    assert.equal(groups.length, 2, '无 url 的 source 各自成组，不会互相误合并');
  });

  test('无重复时分组数等于 source 数（不产生额外开销）', () => {
    const sources = Array.from({ length: 34 }, (_, i) => ({
      id: `s-${i}`,
      url: `https://site-${i}.example.com/feed`,
    }));
    assert.equal(groupSourcesByFeedUrl(sources).length, 34);
  });
});

// scripts/collect/__tests__/normalize-date.test.mjs
//
// 背景：部分 feed 的 item 完全不带 pubDate/dc:date（实例：美团 tech.meituan.com/rss.xml，
// @vuepress/plugin-feed 生成，10 条 item 全部无日期字段），此前 normalizeItem 只能落到
// nowIso()（抓取时间），前端渠道看板把 7 月的文章全显示成「30 分钟前」。
// 修复：无 feed 日期时从 URL 提取真实发布日期（博客平台通用模式）。
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { dateFromUrl, normalizeItem } from '../normalize.mjs';

const source = { id: 's1', channelId: 'c1', type: 'rss', url: 'https://e.com/feed' };
const channel = { id: 'c1', name: 'C1', category: ['tech_blog'] };

describe('dateFromUrl', () => {
  it('路径段模式 /YYYY/MM/DD/（Hexo/Jekyll/WordPress）', () => {
    assert.equal(dateFromUrl('https://tech.meituan.com/2026/09/10/Agent-Evaluation.html'), '2026-09-10T00:00:00Z');
    assert.equal(dateFromUrl('https://e.com/blog/2026/1/5/hello'), '2026-01-05T00:00:00Z');
  });

  it('连字符模式 YYYY-MM-DD', () => {
    assert.equal(dateFromUrl('https://e.com/post-2026-07-12/hello'), '2026-07-12T00:00:00Z');
    assert.equal(dateFromUrl('https://e.com/p?id=2026-07-12&u=1'), '2026-07-12T00:00:00Z');
  });

  it('非真实日历日期返回 undefined', () => {
    assert.equal(dateFromUrl('https://e.com/2026/02/30/x'), undefined);
    assert.equal(dateFromUrl('https://e.com/2026/13/01/x'), undefined);
  });

  it('未来超过 1 天的日期拒绝（防误匹配 ID 片段）', () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    assert.equal(dateFromUrl(`https://e.com/${future.replaceAll('-', '/')}/x`), undefined);
  });

  it('无日期形态的 URL 返回 undefined', () => {
    assert.equal(dateFromUrl('https://e.com/posts/12345'), undefined);
    assert.equal(dateFromUrl(''), undefined);
    assert.equal(dateFromUrl(undefined), undefined);
  });
});

describe('normalizeItem 日期兜底接线', () => {
  it('feed 无日期 → 从 URL 提取（美团场景回归）', () => {
    const it = normalizeItem(
      { title: 'T', url: 'https://tech.meituan.com/2026/07/12/LongCat.html', guid: 'g1' },
      source,
      channel,
    );
    assert.equal(it.publishedAt, '2026-07-12T00:00:00Z');
    assert.equal(it.updatedAt, '2026-07-12T00:00:00Z');
    assert.equal(it.sources[0].publishedAt, '2026-07-12T00:00:00Z');
  });

  it('feed 有日期 → 优先 feed，URL 日期不参与', () => {
    const it = normalizeItem(
      {
        title: 'T',
        url: 'https://tech.meituan.com/2026/07/12/LongCat.html',
        guid: 'g1',
        publishedAt: '2026-09-15T01:00:00Z',
      },
      source,
      channel,
    );
    assert.equal(it.publishedAt, '2026-09-15T01:00:00Z');
  });

  it('无 feed 日期且 URL 亦无可提取日期 → 维持 nowIso 兜底', () => {
    const before = Date.now();
    const it = normalizeItem({ title: 'T', url: 'https://e.com/posts/12345', guid: 'g1' }, source, channel);
    const got = Date.parse(it.publishedAt);
    assert.ok(got >= before - 1000 && got <= Date.now() + 1000, 'publishedAt 应为当前抓取时刻');
  });

  it('URL 中非日历日期（2026-02-30）不被采纳 → 落回 nowIso', () => {
    const it = normalizeItem({ title: 'T', url: 'https://e.com/2026/02/30/x', guid: 'g1' }, source, channel);
    assert.ok(!Number.isNaN(Date.parse(it.publishedAt)), 'publishedAt 仍是合法时间（nowIso）');
    assert.notEqual(it.publishedAt, '2026-02-30T00:00:00Z');
  });
});

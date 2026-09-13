// scripts/notify/__tests__/template.test.mjs — 模板渲染单测
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12.4
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  renderDailyDigestMarkdown,
  renderRealtimeMarkdown,
  markdownToText,
  markdownToHtml,
  truncateTitle,
  truncateBody,
  MAX_TOP_N,
  TITLE_MAX,
  MAX_MESSAGE_LEN,
} from '../template.mjs';

function makeHotList(n) {
  return Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    id: `it_${i}`,
    title: `热点标题 ${i + 1}`,
    url: `https://example.com/${i + 1}`,
    hotScore: 0.9 - i * 0.01,
    sourceCount: (i % 3) + 1,
    channelNames: ['少数派', 'V2EX'],
  }));
}

const REPORT = {
  date: '2026-09-11',
  totalItems: 262,
  activeChannels: 11,
  categoryStats: [
    { category: 'ai', label: 'AI', itemCount: 88 },
    { category: 'tech_blog', label: '技术博客', itemCount: 51 },
    { category: 'news', label: '新闻', itemCount: 43 },
  ],
  hotList: makeHotList(3),
};

describe('日报模板', () => {
  test('渲染日期、概要数字、标题与链接', () => {
    const md = renderDailyDigestMarkdown({ report: REPORT, siteConfig: {} });
    assert.match(md, /^## 📡 RSS Radar 日报 · 2026-09-11（Asia\/Shanghai）/);
    assert.match(md, /\*\*概要\*\*：今日共采集 \*\*262\*\* 条，\*\*11\*\* 个渠道活跃，涉及 \*\*3\*\* 个分类。/);
    assert.match(md, /\*\*🔥 热点 Top 3\*\*/);
    assert.match(md, /1\. 热点标题 1（来源：少数派、V2EX｜热度 0\.90）https:\/\/example\.com\/1/);
    assert.match(md, /\*\*🔗 完整报告\*\*：/);
  });

  test('分类分布串格式：AI 88 · 技术博客 51 · 新闻 43', () => {
    const md = renderDailyDigestMarkdown({ report: REPORT, siteConfig: {} });
    assert.match(md, /\*\*📊 分类分布\*\*：AI 88 · 技术博客 51 · 新闻 43/);
  });

  test('30 条热点只渲染 Top 5', () => {
    const md = renderDailyDigestMarkdown({
      report: { ...REPORT, hotList: makeHotList(30) },
      siteConfig: {},
    });
    const numbered = md.match(/^\d+\.\s/gm) ?? [];
    assert.equal(numbered.length, MAX_TOP_N);
    assert.match(md, /\*\*🔥 热点 Top 5\*\*/);
    assert.doesNotMatch(md, /6\. 热点标题 6/);
  });

  test('超长标题截断为 60 字符 + 省略号', () => {
    const long = 'A'.repeat(120);
    const md = renderDailyDigestMarkdown({
      report: { ...REPORT, hotList: [{ title: long, url: 'u', hotScore: 0.5, channelNames: ['X'] }] },
      siteConfig: {},
    });
    assert.ok(md.includes(`${'A'.repeat(TITLE_MAX)}…`), '应包含 60 个 A + 省略号');
    assert.ok(!md.includes(`${'A'.repeat(TITLE_MAX + 1)}`), '不应出现第 61 个 A');
  });

  test('总长度上限：超长正文被截断到 MAX_MESSAGE_LEN 附近', () => {
    const bigCats = Array.from({ length: 200 }, (_, i) => ({ label: 'C'.repeat(30) + i, itemCount: i }));
    const md = renderDailyDigestMarkdown({ report: { ...REPORT, categoryStats: bigCats }, siteConfig: {} });
    assert.ok(md.length <= MAX_MESSAGE_LEN + 1, `长度应 <= ${MAX_MESSAGE_LEN + 1}，实际 ${md.length}`);
  });

  test('无热点时给出占位', () => {
    const md = renderDailyDigestMarkdown({ report: { ...REPORT, hotList: [] }, siteConfig: {} });
    assert.match(md, /（暂无热点）/);
  });
});

describe('实时模板', () => {
  test('渲染时间、来源/跨源/热度、为什么推、原文', () => {
    const items = [{
      id: 'it_x',
      title: '某条大新闻',
      url: 'https://example.com/x',
      hotScore: 0.91,
      sourceCount: 3,
      channelNames: ['V2EX', 'Hacker News', '少数派'],
    }];
    const md = renderRealtimeMarkdown({ items, trigger: { reason: '跨源 sourceCount=3 达阈值' }, time: '12:30' });
    assert.match(md, /^## ⚡ 实时热点 · 12:30/);
    assert.match(md, /\*\*某条大新闻\*\*（来源：V2EX、Hacker News、少数派｜跨源 3｜热度 0\.91）/);
    assert.match(md, /\*\*为什么推\*\*：跨源 sourceCount=3 达阈值/);
    assert.match(md, /\*\*原文\*\*：https:\/\/example\.com\/x/);
  });

  test('未给 reason 时按阈值自动生成', () => {
    const md = renderRealtimeMarkdown({
      items: [{ id: 'a', title: 'T', url: 'u', hotScore: 0.95, sourceCount: 4, channelNames: ['A'] }],
      trigger: { config: { realtime: { hotScoreThreshold: 0.8, sourceCountThreshold: 3 } } },
      time: '09:00',
    });
    assert.match(md, /跨源 sourceCount=4 达阈值\(3\)/);
    assert.match(md, /热度 hotScore=0\.95 达阈值\(0\.8\)/);
  });

  test('多条实时也只取 Top 5', () => {
    const md = renderRealtimeMarkdown({ items: makeHotList(20), trigger: {}, time: '10:00' });
    const bullets = md.match(/\*\*热点标题 \d+\*\*/g) ?? [];
    assert.equal(bullets.length, MAX_TOP_N);
  });

  test('无条目时占位', () => {
    const md = renderRealtimeMarkdown({ items: [], trigger: {}, time: '10:00' });
    assert.match(md, /（无触发条目）/);
  });
});

describe('渠道转换 + 截断工具', () => {
  test('truncateTitle：短标题不变，长标题截断', () => {
    assert.equal(truncateTitle('短'), '短');
    const long = 'X'.repeat(100);
    assert.equal(truncateTitle(long), `${'X'.repeat(60)}…`);
    assert.equal(truncateTitle(long).length, 61);
  });

  test('truncateBody：保持上限', () => {
    const s = 'Y'.repeat(MAX_MESSAGE_LEN + 500);
    assert.equal(truncateBody(s).length, MAX_MESSAGE_LEN + 1);
  });

  test('markdownToText：剥离标题/加粗标记', () => {
    const t = markdownToText('## 标题\n**加粗**\n[链接](https://e.com)');
    assert.equal(t, '标题\n加粗\n链接 (https://e.com)');
  });

  test('markdownToHtml：生成 h2/strong/a', () => {
    const html = markdownToHtml('## 标题\n**加粗** https://e.com', { title: 'S' });
    assert.match(html, /<h2>标题<\/h2>/);
    assert.match(html, /<strong>加粗<\/strong>/);
    assert.match(html, /<a href="https:\/\/e\.com">/);
    assert.match(html, /<title>S<\/title>/);
  });

  test('markdownToHtml：转义 HTML 特殊字符', () => {
    const html = markdownToHtml('a < b & c > d');
    assert.match(html, /a &lt; b &amp; c &gt; d/);
  });
});

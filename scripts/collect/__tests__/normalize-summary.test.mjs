// scripts/collect/__tests__/normalize-summary.test.mjs
//
// 背景：snapshot.schema.json 对 items[].summary 声明 maxLength=300，
// 描述写着「纯文本摘要，已去标签并截断(默认 ≤200 字符)」，但 normalize.mjs 此前
// **直接透传 raw.summary**——声明与实现脱节。
// 实测真实采集 79 条里 26 条超限（最长 3354 字），导致 smoke 第 3 步契约断言必然失败；
// 而该失败长期被「smoke 第 1 步 set -e 提前中止」掩盖，形成假绿。
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  sanitizeSummary,
  htmlToPlainText,
  normalizeItem,
  SCHEMA_SUMMARY_MAX,
  DEFAULT_SUMMARY_MAX_CHARS,
} from '../normalize.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');

describe('htmlToPlainText / sanitizeSummary', () => {
  it('去标签：文本保留，标签位置补空格', () => {
    assert.equal(htmlToPlainText('<p>hello <b>world</b></p>'), 'hello world');
  });

  it('去 script / style 的整段内容', () => {
    assert.equal(htmlToPlainText('a<script>var x=1</script>b<style>.c{}</style>d'), 'a b d');
  });

  it('解码命名实体与数字实体', () => {
    assert.equal(htmlToPlainText('A&amp;B &lt;x&gt; &quot;q&quot; &#39;s&#39;'), 'A&B <x> "q" \'s\'');
    assert.equal(htmlToPlainText('&#x4e2d;&#25991;'), '中文');
    assert.equal(htmlToPlainText('a&nbsp;b&hellip;'), 'a b…');
  });

  it('压缩空白并 trim', () => {
    assert.equal(htmlToPlainText('  a\n\n  b\t c  '), 'a b c');
  });

  it('空输入 → undefined（不写空串字段）', () => {
    assert.equal(sanitizeSummary(undefined), undefined);
    assert.equal(sanitizeSummary(null), undefined);
    assert.equal(sanitizeSummary('   '), undefined);
    assert.equal(sanitizeSummary('<p></p>'), undefined);
  });

  it('默认截断到 200', () => {
    assert.equal(sanitizeSummary('字'.repeat(500)).length, DEFAULT_SUMMARY_MAX_CHARS);
  });

  it('config 配更大值也收敛到 SCHEMA_SUMMARY_MAX（300）', () => {
    assert.equal(sanitizeSummary('字'.repeat(1000), 9999).length, SCHEMA_SUMMARY_MAX);
  });

  it('config 配非法值（0 / NaN / 负数）回落默认', () => {
    for (const bad of [0, NaN, -5, 'abc']) {
      assert.equal(
        sanitizeSummary('字'.repeat(500), bad).length,
        DEFAULT_SUMMARY_MAX_CHARS,
        `maxChars=${String(bad)} 应回落默认`,
      );
    }
  });

  it('未超限的短文本原样返回', () => {
    assert.equal(sanitizeSummary('短摘要'), '短摘要');
  });
});

describe('normalizeItem 摘要接线', () => {
  const raw = {
    title: 'T',
    url: 'https://e.com/1',
    summary: `<p>${'字'.repeat(400)}</p>`,
    publishedAt: '2026-09-15T01:00:00Z',
  };
  const source = { id: 's1', channelId: 'c1', type: 'rss', url: 'https://e.com/feed' };
  const channel = { id: 'c1', name: 'C1', category: ['news'] };

  it('不传 opts → 默认 200，且已去标签', () => {
    const it = normalizeItem(raw, source, channel);
    assert.equal(it.summary.length, DEFAULT_SUMMARY_MAX_CHARS);
    assert.ok(!it.summary.includes('<'), 'summary 不应残留标签');
  });

  it('opts.summaryMaxChars 生效（config 才不是 dead config）', () => {
    const it = normalizeItem(raw, source, channel, { summaryMaxChars: 50 });
    assert.equal(it.summary.length, 50);
  });

  it('contentSnippet 兜底路径同样被截断', () => {
    const it = normalizeItem(
      { ...raw, summary: undefined, contentSnippet: 'x'.repeat(900) },
      source,
      channel,
    );
    assert.equal(it.summary.length, DEFAULT_SUMMARY_MAX_CHARS);
  });
});

describe('与 snapshot schema 的契约锁', () => {
  it('SCHEMA_SUMMARY_MAX 必须等于 schema 里 items[].summary.maxLength', () => {
    const schema = JSON.parse(
      readFileSync(resolve(ROOT, 'docs/data-model/schema/snapshot.schema.json'), 'utf8'),
    );
    // 跟着 $ref 解析：properties.items.items.$ref → #/definitions/item
    const resolveRef = (doc, ref) =>
      ref.replace(/^#\//, '').split('/').reduce((node, key) => node?.[key], doc);
    const itemsNode = schema?.properties?.items?.items;
    const itemDef = itemsNode?.$ref ? resolveRef(schema, itemsNode.$ref) : itemsNode;
    const maxLength = itemDef?.properties?.summary?.maxLength;
    assert.equal(typeof maxLength, 'number', '未能从 snapshot.schema.json 取到 summary.maxLength');
    assert.equal(
      SCHEMA_SUMMARY_MAX,
      maxLength,
      '代码里的 SCHEMA_SUMMARY_MAX 与 snapshot.schema.json 已脱节，请同步',
    );
  });
});

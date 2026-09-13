// scripts/collect/__tests__/exclude.test.mjs
// ARCHITECTURE §11 — 排除引擎 7 个边界用例
import { describe, it, expect } from 'vitest';
import { evaluateItem, blockedChannels, explain } from '../exclude.mjs';

const mkItem = (over = {}) => ({
  id: 'it_test',
  title: '示例标题',
  url: 'https://example.com/post/1',
  summary: '示例摘要',
  channelId: 'ch-test',
  sourceId: 'src-test',
  category: ['tech_blog'],
  dedupKey: 'url:test',
  ...over,
});

describe('exclude / 关键词命中', () => {
  it('① 关键词命中：标题含「招聘」被排除', () => {
    const rules = [
      { id: 'r1', level: 'item', scope: 'global', type: 'keyword', value: ['招聘'], matchMode: 'contains', enabled: true },
    ];
    const r = evaluateItem(mkItem({ title: '某公司招聘前端' }), rules);
    expect(r.excluded).toBe(true);
    expect(r.hitRuleId).toBe('r1');
    expect(r.hitField).toMatch(/title/);
  });

  it('①b 关键词大小写无关（默认 caseSensitive=false）', () => {
    const rules = [
      { id: 'r1', level: 'item', scope: 'global', type: 'keyword', value: ['Hiring'], enabled: true },
    ];
    expect(evaluateItem(mkItem({ title: 'we are HIRING' }), rules).excluded).toBe(true);
  });

  it('①c 关键词 caseSensitive=true 时不命中', () => {
    const rules = [
      { id: 'r1', level: 'item', scope: 'global', type: 'keyword', value: ['Hiring'], caseSensitive: true, enabled: true },
    ];
    expect(evaluateItem(mkItem({ title: 'we are hiring' }), rules).excluded).toBe(false);
  });
});

describe('exclude / 域名通配符', () => {
  it('② 域名 contains：url host 含 ad.example 被排除', () => {
    const rules = [
      { id: 'r1', level: 'item', scope: 'global', type: 'domain', value: ['ad.example'], matchMode: 'contains', enabled: true },
    ];
    expect(evaluateItem(mkItem({ url: 'https://tracker.ad.example/click' }), rules).excluded).toBe(true);
  });

  it('②b 域名 equals：精确匹配被排除', () => {
    const rules = [
      { id: 'r1', level: 'item', scope: 'global', type: 'domain', value: ['spam.com'], matchMode: 'equals', enabled: true },
    ];
    expect(evaluateItem(mkItem({ url: 'https://spam.com/post' }), rules).excluded).toBe(true);
    expect(evaluateItem(mkItem({ url: 'https://www.spam.com/post' }), rules).excluded).toBe(false);
  });
});

describe('exclude / 标题正则', () => {
  it('③ 标题正则：用 re2 兼容语法命中标题', () => {
    const rules = [
      { id: 'r1', level: 'item', scope: 'global', type: 'title_regex', value: ['^show\\s*hn\\b', '^Ask\\s*HN'], matchMode: 'regex', enabled: true },
    ];
    expect(evaluateItem(mkItem({ title: 'Show HN: a thing' }), rules).excluded).toBe(true);
    expect(evaluateItem(mkItem({ title: 'Ask HN: how to ...' }), rules).excluded).toBe(true);
    expect(evaluateItem(mkItem({ title: 'Normal article' }), rules).excluded).toBe(false);
  });
});

describe('exclude / 分类排除', () => {
  it('④ 分类级：category=finance 被排除', () => {
    const rules = [
      { id: 'r1', level: 'category', scope: 'global', value: ['finance'], enabled: true },
    ];
    expect(evaluateItem(mkItem({ category: ['tech_blog', 'finance'] }), rules).excluded).toBe(true);
    expect(evaluateItem(mkItem({ category: ['tech_blog'] }), rules).excluded).toBe(false);
  });
});

describe('exclude / 整源停用', () => {
  it('⑤ blockedChannels 返回被 channel: scope 停用的 id 集合', () => {
    const rules = [
      { id: 'r1', level: 'channel', scope: 'channel:v2ex', enabled: true },
      { id: 'r2', level: 'channel', scope: 'channel:spam', enabled: true },
      { id: 'r3', level: 'channel', scope: 'channel:disabled', enabled: false }, // 不生效
    ];
    const set = blockedChannels(rules);
    expect(set.has('v2ex')).toBe(true);
    expect(set.has('spam')).toBe(true);
    expect(set.has('disabled')).toBe(false);
  });

  it('⑤b global channel scope：value 数组里的 id 全部停用', () => {
    const rules = [
      { id: 'r1', level: 'channel', scope: 'global', value: ['v2ex', 'hn'], enabled: true },
    ];
    const set = blockedChannels(rules);
    expect(set.has('v2ex')).toBe(true);
    expect(set.has('hn')).toBe(true);
  });
});

describe('exclude / hitCount 回填语义', () => {
  it('⑥ explain() 返回被哪条规则命中哪个字段', () => {
    const items = [
      mkItem({ id: 'it_a', url: 'https://example.com/1', title: 'normal article' }),
      mkItem({ id: 'it_b', url: 'https://example.com/2', title: 'we are hiring' }),
    ];
    const rules = [
      { id: 'r-hiring', level: 'item', scope: 'global', type: 'keyword', value: ['hiring'], enabled: true },
    ];
    const res = explain('it_b', items, rules);
    expect(res.found).toBe(true);
    expect(res.hitRuleId).toBe('r-hiring');
  });
});

describe('exclude / ReDoS 防护', () => {
  it('⑦ 危险正则被 safeRegex 拦截（长度超 256 字符直接拒）', () => {
    const huge = 'a?'.repeat(200) + 'a'.repeat(200); // > 256 字符
    const rules = [
      { id: 'r-bad', level: 'item', scope: 'global', type: 'title_regex', value: [huge], matchMode: 'regex', enabled: true },
    ];
    // 危险正则被构造函数拦截 → safeRegex 抛 → matchItem catch → 不命中
    const r = evaluateItem(mkItem({ title: 'any' }), rules);
    expect(r.excluded).toBe(false);
  });
});

describe('exclude / scope 维度', () => {
  it('scope=source:X 仅对指定 sourceId 生效', () => {
    const rules = [
      { id: 'r1', level: 'item', scope: 'source:special', type: 'keyword', value: ['forbidden'], enabled: true },
    ];
    expect(evaluateItem(mkItem({ sourceId: 'special', title: 'forbidden word' }), rules).excluded).toBe(true);
    expect(evaluateItem(mkItem({ sourceId: 'other', title: 'forbidden word' }), rules).excluded).toBe(false);
  });
});
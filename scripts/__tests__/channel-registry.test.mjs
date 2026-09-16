// scripts/__tests__/channel-registry.test.mjs
//
// 覆盖「渠道注册表单一事实源」的三条契约（见 lib/channel-registry.mjs 文件头）：
//   ① SSOT：外部清单一律并入 config/sources.json，不在别处维护第二份
//   ② 幂等键 = 归一化 feed URL（不是 id、不是名称）
//   ③ 合并幂等：同输入跑 N 次 == 跑 1 次
//
// 主理人 2026-09-16 拍板的原话里，「不要重复请求同一个渠道获取 rss 信息」是硬要求，
// 所以 URL 去重的用例是这份测试的重点。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeFeedUrl,
  feedKey,
  deriveChannelId,
  freeId,
  parseTags,
  auditRegistry,
  mergeIntoRegistry,
  guessFeedType,
  ID_RE,
} from '../lib/channel-registry.mjs';

// ---------------------------------------------------------------------------
// normalizeFeedUrl
// ---------------------------------------------------------------------------

describe('normalizeFeedUrl — 幂等键的构造', () => {
  test('大小写 / 尾斜杠 / fragment / 默认端口归一到同一形态', () => {
    const canonical = 'https://example.com/feed';
    assert.equal(normalizeFeedUrl('https://EXAMPLE.com/feed'), canonical);
    assert.equal(normalizeFeedUrl('https://example.com/feed/'), canonical);
    assert.equal(normalizeFeedUrl('https://example.com/feed#top'), canonical);
    assert.equal(normalizeFeedUrl('https://example.com:443/feed'), canonical);
    assert.equal(normalizeFeedUrl('http://example.com:80/feed'), 'http://example.com/feed');
  });

  test('剥离跟踪参数，但保留有语义的 query', () => {
    assert.equal(
      normalizeFeedUrl('https://example.com/feed?utm_source=rss&utm_medium=email'),
      'https://example.com/feed',
    );
    // 有语义的参数必须原样保留（只被重排顺序）—— 误删会导致抓错内容
    assert.equal(
      normalizeFeedUrl('https://www.52pojie.cn/forum.php?mod=guide&view=hot&rss=1'),
      'https://www.52pojie.cn/forum.php?mod=guide&rss=1&view=hot',
    );
  });

  test('query 按 key 字典序重排 ⇒ 写法不同但等价的两个 URL 落同一键', () => {
    const a = normalizeFeedUrl('https://example.com/f?b=2&a=1');
    const b = normalizeFeedUrl('https://example.com/f?a=1&b=2');
    assert.equal(a, b);
    assert.equal(feedKey('https://example.com/f?b=2&a=1'), feedKey('https://example.com/f?a=1&b=2'));
  });

  test('刻意不去 www / 不改写协议（可能是两个不同站点，也可能直接 404）', () => {
    assert.notEqual(
      normalizeFeedUrl('https://example.com/feed'),
      normalizeFeedUrl('https://www.example.com/feed'),
    );
    assert.equal(normalizeFeedUrl('http://example.com/feed'), 'http://example.com/feed');
  });

  test('非绝对 URL 原样返回；空/非法输入返回空串', () => {
    assert.equal(normalizeFeedUrl('data/local/feeds.json'), 'data/local/feeds.json');
    assert.equal(normalizeFeedUrl(''), '');
    assert.equal(normalizeFeedUrl(null), '');
    assert.equal(normalizeFeedUrl(undefined), '');
    assert.equal(normalizeFeedUrl('   '), '');
  });

  test('feedKey 稳定且对归一化等价写法一致；空输入返回空串', () => {
    assert.equal(feedKey('https://example.com/feed'), feedKey('https://example.com/feed/'));
    assert.match(feedKey('https://example.com/feed'), /^[0-9a-f]{16}$/);
    assert.equal(feedKey(''), '');
  });
});

// ---------------------------------------------------------------------------
// deriveChannelId / parseTags（自 sync-sources 下沉，行为必须逐字保持）
// ---------------------------------------------------------------------------

describe('deriveChannelId — 下沉后行为不变', () => {
  test('基本派生与 www / TLD 剥离', () => {
    assert.equal(deriveChannelId('https://www.appinn.com/'), 'appinn');
    assert.equal(deriveChannelId('https://www.example.org/'), 'example');
  });

  test('同域多博主靠 path 第一个有区分度的段区分', () => {
    assert.notEqual(
      deriveChannelId('https://blog.csdn.net/ByteDanceTech'),
      deriveChannelId('https://blog.csdn.net/ctrip_tech'),
    );
  });

  test('feed 词停用段不参与派生', () => {
    assert.equal(deriveChannelId('https://xclient.info/feed'), 'xclient');
    assert.equal(deriveChannelId('https://xclient.info/rss.xml'), 'xclient');
  });

  test('派生结果恒满足 id 正则', () => {
    for (const u of ['https://www.appinn.com/', 'https://blog.csdn.net/ByteDanceTech', 'https://exa mple!.com/']) {
      assert.match(deriveChannelId(u), ID_RE);
    }
  });
});

describe('parseTags — 下沉后行为不变', () => {
  test('JSON 数组 / Python repr / 已是数组三种形态', () => {
    assert.deepEqual(parseTags('["Mac","软件下载"]'), ['Mac', '软件下载']);
    assert.deepEqual(parseTags("['Mac', '软件下载']"), ['Mac', '软件下载']);
    assert.deepEqual(parseTags(['Mac', '软件下载']), ['Mac', '软件下载']);
  });

  test('解析不出 / 空 → null（调用方据此不写 tags）', () => {
    assert.equal(parseTags(''), null);
    assert.equal(parseTags('乱码 @#$%'), null);
    assert.equal(parseTags(null), null);
  });
});

describe('freeId', () => {
  test('冲突追加 -2/-3 并登记占用', () => {
    const taken = new Set(['foo']);
    assert.equal(freeId('bar', taken), 'bar');
    assert.equal(freeId('foo', taken), 'foo-2');
    assert.equal(freeId('foo', taken), 'foo-3');
    assert.ok(taken.has('foo-2'));
  });
});

describe('guessFeedType', () => {
  test('atom 后缀识别，其余默认 rss', () => {
    assert.equal(guessFeedType('https://a.com/atom.xml'), 'atom');
    assert.equal(guessFeedType('https://a.com/feed.atom'), 'atom');
    assert.equal(guessFeedType('https://a.com/feed'), 'rss');
  });
});

// ---------------------------------------------------------------------------
// auditRegistry
// ---------------------------------------------------------------------------

describe('auditRegistry — 一致性审计', () => {
  const clean = {
    channels: [
      // ⚠️ id 必须满足 schema 的 `^[a-z0-9][a-z0-9-]{1,63}$`（总长 ≥ 2）
      { id: 'cha', name: 'A', homepage: 'https://a.com/', category: ['tech_blog'], enabled: true },
      { id: 'chb', name: 'B', homepage: 'https://b.com/', category: ['news'], enabled: false },
    ],
    sources: [
      { id: 'cha-rss', channelId: 'cha', name: 'A', type: 'rss', url: 'https://a.com/feed', enabled: true },
      { id: 'chb-rss', channelId: 'chb', name: 'B', type: 'rss', url: 'https://b.com/feed', enabled: false },
    ],
  };

  test('干净注册表 → ok=true，计数正确', () => {
    const r = auditRegistry(clean);
    assert.equal(r.ok, true);
    assert.equal(r.counts.channels, 2);
    assert.equal(r.counts.sources, 2);
    assert.equal(r.counts.uniqueFeedUrls, 2);
    assert.equal(r.counts.enabledChannels, 1);
    assert.equal(r.counts.enabledSources, 1);
  });

  test('同一 feed 的等价写法被识别为重复（这就是「重复请求」的源头）', () => {
    const r = auditRegistry({
      channels: clean.channels,
      sources: [
        ...clean.sources,
        // 尾斜杠 + utm + 大小写差异 —— 人眼看着是两个，实际是同一个
        { id: 'a-rss-2', channelId: 'a', name: 'A dup', type: 'rss', url: 'https://A.com/feed/?utm_source=x' },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(r.problems.duplicateFeedUrls.length, 1);
    assert.ok(r.problems.duplicateFeedUrls[0].sourceIds.includes('cha-rss'));
  });

  test('孤儿 source / 空渠道 / 重复 id / 非法 id 都能查出', () => {
    const r = auditRegistry({
      channels: [
        { id: 'a', name: 'A', homepage: 'https://a.com/', category: ['tech_blog'] },
        { id: 'a', name: 'A dup', homepage: 'https://a2.com/', category: ['tech_blog'] },
        { id: 'ghost', name: '没人挂 source', homepage: 'https://g.com/', category: ['other'] },
        { id: 'BAD_ID', name: '非法 id', homepage: 'https://bad.com/', category: ['other'] },
      ],
      sources: [{ id: 'x', channelId: 'nope', name: 'X', type: 'rss', url: 'https://x.com/feed' }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.problems.orphanSources.length, 1);
    assert.ok(r.problems.emptyChannels.some((c) => c.channelId === 'ghost'));
    assert.ok(r.problems.duplicateChannelIds.some((c) => c.id === 'a'));
    assert.ok(r.problems.invalidIds.some((i) => i.id === 'BAD_ID'));
  });
});

// ---------------------------------------------------------------------------
// mergeIntoRegistry —— 幂等是这里的核心契约
// ---------------------------------------------------------------------------

const NOW = '2026-09-16T00:00:00Z';

function sampleIncoming() {
  return [
    {
      name: '酷壳',
      feedUrl: 'https://coolshell.cn/feed',
      homepage: 'https://coolshell.cn/',
      category: ['tech_blog'],
      tags: ['活着的个人独立博客'],
      origin: 'garss',
      originRef: 'S137',
    },
    {
      name: '云风的 BLOG',
      feedUrl: 'https://blog.codingnow.com/atom.xml',
      homepage: 'https://blog.codingnow.com/',
      category: ['tech_blog'],
      origin: 'garss',
      originRef: 'S001',
    },
    {
      name: '雪球话题',
      feedUrl: 'https://xueqiu.com/hots/topic/rss',
      homepage: 'https://xueqiu.com/',
      category: ['finance'],
      origin: 'garss',
      originRef: 'S200',
    },
  ];
}

const EMPTY = { schemaVersion: '1.0', generatedAt: NOW, channels: [], sources: [] };

describe('mergeIntoRegistry — 幂等合并', () => {
  test('★ 幂等：同输入跑两次，第二次全部 skipped，且注册表逐字节不变', () => {
    const opts = { now: NOW, batch: 'garss-2026-04', enabledCount: 1 };

    const first = mergeIntoRegistry(EMPTY, sampleIncoming(), opts);
    assert.equal(first.report.addedChannels.length, 3);
    assert.equal(first.report.addedSources.length, 3);
    assert.equal(first.report.skipped.length, 0);

    const second = mergeIntoRegistry(first.config, sampleIncoming(), opts);
    assert.deepEqual(second.report.addedChannels, []);
    assert.deepEqual(second.report.addedSources, []);
    assert.equal(second.report.skipped.length, 3);
    assert.ok(second.report.skipped.every((s) => s.reason === 'duplicate-feed-url'));
    // 逐字节等价 —— 这是「可反复重跑」的前提
    assert.deepEqual(second.config, first.config);
  });

  test('★ URL 唯一：同一 feed 的等价写法（尾斜杠 / utm / 大小写）判为重复', () => {
    const first = mergeIntoRegistry(EMPTY, [sampleIncoming()[0]], { now: NOW });
    const again = mergeIntoRegistry(first.config, [
      { name: '酷壳（换个写法）', feedUrl: 'https://Coolshell.cn/feed/?utm_source=newsletter' },
    ], { now: NOW });

    assert.deepEqual(again.report.addedSources, []);
    assert.equal(again.report.skipped.length, 1);
    assert.equal(again.report.skipped[0].reason, 'duplicate-feed-url');
    assert.equal(again.report.skipped[0].existingSourceId, first.config.sources[0].id);
  });

  test('全量导入但只开前 N 个（放量策略），且只对本次新增计数', () => {
    const r = mergeIntoRegistry(EMPTY, sampleIncoming(), { now: NOW, enabledCount: 2 });
    assert.equal(r.config.channels.filter((c) => c.enabled).length, 2);
    assert.equal(r.config.sources.filter((s) => s.enabled).length, 2);
    // channel 与 source 的 enabled 必须一致，否则采集侧与展示侧口径分叉
    for (const ch of r.config.channels) {
      const srcs = r.config.sources.filter((s) => s.channelId === ch.id);
      assert.ok(srcs.every((s) => s.enabled === ch.enabled));
    }

    // 再跑一批新的（已有 3 个），enabledCount 只数新来的
    const more = mergeIntoRegistry(r.config, [
      { name: '新站', feedUrl: 'https://new.example.com/feed', homepage: 'https://new.example.com/' },
    ], { now: NOW, enabledCount: 2 });
    assert.equal(more.report.addedChannels.length, 1);
    assert.equal(more.config.channels.find((c) => c.homepage === 'https://new.example.com/').enabled, true);
    // 上一轮已启用的两个不受影响
    assert.equal(more.config.channels.filter((c) => c.enabled).length, 3);
  });

  test('不修改入参（便于 dry-run / 回滚）', () => {
    const base = JSON.parse(JSON.stringify(EMPTY));
    const snapshot = JSON.parse(JSON.stringify(base));
    mergeIntoRegistry(base, sampleIncoming(), { now: NOW });
    assert.deepEqual(base, snapshot);
  });

  test('同 homepage 复用已有 channel（一个渠道可挂多个 feed）', () => {
    const existing = {
      schemaVersion: '1.0',
      channels: [{
        id: 'appinn', name: '小众软件', homepage: 'https://www.appinn.com/',
        category: ['other'], enabled: true, createdAt: NOW, updatedAt: NOW,
      }],
      sources: [],
    };
    const r = mergeIntoRegistry(existing, [
      { name: '小众软件（主站 feed）', feedUrl: 'https://www.appinn.com/feed/', homepage: 'https://www.appinn.com/' },
    ], { now: NOW });

    assert.deepEqual(r.report.addedChannels, []);          // 没有新建 channel
    assert.equal(r.config.channels.length, 1);
    assert.equal(r.config.sources.length, 1);
    assert.equal(r.config.sources[0].channelId, 'appinn'); // 挂到已有渠道上
  });

  test('id 冲突时追加后缀，不覆盖已有条目', () => {
    const existing = {
      schemaVersion: '1.0',
      channels: [{
        id: 'example', name: '已有', homepage: 'https://example.com/',
        category: ['other'], enabled: true, createdAt: NOW, updatedAt: NOW,
      }],
      sources: [],
    };
    const r = mergeIntoRegistry(existing, [
      { name: '另一个 example', feedUrl: 'https://example.net/feed', homepage: 'https://example.net/' },
    ], { now: NOW });

    assert.equal(r.config.channels.length, 2);
    assert.equal(r.config.channels[0].id, 'example');   // 已有的不动
    assert.equal(r.config.channels[1].id, 'example-2'); // 新的让位
  });

  test('溯源字段被写入，使「重跑只覆盖我生成的」成为可能', () => {
    const r = mergeIntoRegistry(EMPTY, sampleIncoming(), { now: NOW, batch: 'garss-2026-04' });
    for (const s of r.config.sources) {
      assert.equal(s.origin, 'garss');
      assert.equal(s.importBatch, 'garss-2026-04');
      assert.ok(s.originRef);
    }
    for (const c of r.config.channels) {
      assert.equal(c.origin, 'garss');
      assert.equal(c.importBatch, 'garss-2026-04');
    }
    // 原始标签落到 tags（自由标签），不污染受控 category
    const cools = r.config.channels.find((c) => c.name === '酷壳');
    assert.deepEqual(cools.tags, ['活着的个人独立博客']);
    assert.deepEqual(cools.category, ['tech_blog']);
  });

  test('缺 feedUrl 的条目被跳过而非写入空 source', () => {
    const r = mergeIntoRegistry(EMPTY, [
      { name: '没有地址' },
      { name: '', feedUrl: '' },
      sampleIncoming()[0],
    ], { now: NOW });

    assert.equal(r.config.sources.length, 1);
    assert.equal(r.report.skipped.length, 2);
    assert.ok(r.report.skipped.every((s) => s.reason === 'missing-feed-url'));
  });

  test('合并产物自身通过一致性审计（无重复 URL / 无孤儿 / 无非法 id）', () => {
    const r = mergeIntoRegistry(EMPTY, sampleIncoming(), { now: NOW, enabledCount: 2 });
    const audit = auditRegistry(r.config);
    assert.equal(audit.ok, true, JSON.stringify(audit.problems));
  });

  test('合并结果满足 sources.schema.json 的必填面（防落盘被 ajv 拦下）', () => {
    const r = mergeIntoRegistry(EMPTY, sampleIncoming(), { now: NOW });
    for (const c of r.config.channels) {
      for (const k of ['id', 'name', 'homepage', 'category', 'enabled', 'createdAt', 'updatedAt']) {
        assert.ok(c[k] !== undefined, `channel 缺 ${k}`);
      }
      assert.match(c.id, ID_RE);
    }
    for (const s of r.config.sources) {
      for (const k of ['id', 'channelId', 'name', 'type', 'url', 'enabled', 'createdAt', 'updatedAt']) {
        assert.ok(s[k] !== undefined, `source 缺 ${k}`);
      }
      assert.match(s.id, ID_RE);
      assert.ok(['rss', 'atom', 'json_feed', 'local_json', 'local_csv', 'feishu_bitable', 'notion_db', 'generic_api'].includes(s.type));
    }
  });
});

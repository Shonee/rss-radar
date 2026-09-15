// scripts/collect/__tests__/connectors-integration.test.mjs
// T-P2-07 集成测试：rss/atom/json_feed + feishu-bitable + notion-db + generic-api
// 用 globalThis 原生 fetch + 自建 mock handler 模拟外部响应（不打真实网络）
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// 顶部一次性 import：触发全部 connector 自动注册（索引导入副作用）
import '../connectors/index.mjs';
import * as registry from '../connectors/registry.mjs';
import { _resetTokenCache } from '../connectors/feishu-bitable.mjs';
import { parseJsonFeed } from '../connectors/feed-base.mjs';
import { normalizeItem } from '../normalize.mjs';

// rss-parser 是 ESM-only npm 依赖，沙箱无 npm install 时加载会抛 ERR_MODULE_NOT_FOUND
let RSS_PARSER_OK = true;
try {
  await import('rss-parser');
} catch (_e) {
  RSS_PARSER_OK = false;
}

/** 简单的 mock fetch handler */
function installMock(handler) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const key = typeof url === 'string' ? url : url.url;
    return handler(key, opts);
  };
  return () => {
    globalThis.fetch = orig;
  };
}

const RSS_XML = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>测试 RSS</title>
    <item>
      <title>Test item 1</title>
      <link>https://example.com/1</link>
      <guid>https://example.com/1</guid>
      <pubDate>Mon, 01 Sep 2026 00:00:00 GMT</pubDate>
      <description>First test item.</description>
    </item>
  </channel>
</rss>`;

const ATOM_XML = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>测试 Atom</title>
  <entry>
    <title>Atom item 1</title>
    <link href="https://example.com/a1"/>
    <id>urn:atom:1</id>
    <updated>2026-09-02T00:00:00Z</updated>
    <summary>Atom entry summary.</summary>
  </entry>
</feed>`;

const JSON_FEED = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: '测试 JSON Feed',
  language: 'zh',
  items: [
    {
      id: 'json-1',
      url: 'https://example.com/j1',
      title: 'JSON Feed item 1',
      content_text: 'JF body.',
      date_published: '2026-09-03T00:00:00Z',
      author: { name: 'Tester' },
    },
  ],
});

describe('feed-rss / feed-atom / feed-json 独立 connector', () => {
  it('registry 已注册 rss/atom/json_feed', () => {
    const types = registry.listTypes();
    assert.ok(types.includes('rss'), 'rss 已注册');
    assert.ok(types.includes('atom'), 'atom 已注册');
    assert.ok(types.includes('json_feed'), 'json_feed 已注册');
    assert.equal(typeof registry.get('rss').run, 'function');
    assert.equal(typeof registry.get('atom').run, 'function');
    assert.equal(typeof registry.get('json_feed').run, 'function');
  });

  it('feed-rss: 跑通（依赖 rss-parser, 沙箱时跳过）', { skip: !RSS_PARSER_OK ? 'rss-parser 不在沙箱' : false }, async () => {
    const restore = installMock(async (url) => {
      if (url.includes('rss.example/')) {
        return new Response(RSS_XML, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
      }
      return new Response('', { status: 404 });
    });
    try {
      const c = registry.get('rss');
      const r = await c.run({ url: 'https://rss.example/feed.xml' });
      assert.equal(r.httpStatus, 200);
      assert.equal(r.items.length, 1);
      assert.equal(r.items[0].title, 'Test item 1');
      assert.equal(r.items[0].url, 'https://example.com/1');
    } finally {
      restore();
    }
  });

  it('feed-atom: 跑通（依赖 rss-parser, 沙箱时跳过）', { skip: !RSS_PARSER_OK ? 'rss-parser 不在沙箱' : false }, async () => {
    const restore = installMock(async (url) => {
      if (url.includes('atom.example/')) {
        return new Response(ATOM_XML, { status: 200, headers: { 'content-type': 'application/atom+xml' } });
      }
      return new Response('', { status: 404 });
    });
    try {
      const c = registry.get('atom');
      const r = await c.run({ url: 'https://atom.example/feed.xml' });
      assert.equal(r.httpStatus, 200);
      assert.equal(r.items.length, 1);
      assert.equal(r.items[0].title, 'Atom item 1');
    } finally {
      restore();
    }
  });

  it('feed-json: 跑通（无 rss-parser 依赖）', async () => {
    const restore = installMock(async (url) => {
      if (url.includes('json.example/')) {
        return new Response(JSON_FEED, { status: 200, headers: { 'content-type': 'application/feed+json' } });
      }
      return new Response('', { status: 404 });
    });
    try {
      const c = registry.get('json_feed');
      const r = await c.run({ url: 'https://json.example/feed.json' });
      assert.equal(r.httpStatus, 200);
      assert.equal(r.items.length, 1);
      assert.equal(r.items[0].title, 'JSON Feed item 1');
      assert.equal(r.items[0].author, 'Tester');
    } finally {
      restore();
    }
  });

  it('parseJsonFeed: 直接函数测试', () => {
    const f = parseJsonFeed(JSON_FEED);
    assert.equal(f.title, '测试 JSON Feed');
    assert.equal(f.items.length, 1);
    assert.equal(f.items[0].link, 'https://example.com/j1');
  });

  it('parseJsonFeed: 缺 items[] 抛错', () => {
    assert.throws(() => parseJsonFeed(JSON.stringify({ title: 'x' })), /缺少 items/);
  });
});

describe('feishu-bitable connector', () => {
  beforeEach(() => _resetTokenCache());

  it('registry 已注册 feishu_bitable', () => {
    assert.equal(typeof registry.get('feishu_bitable').run, 'function');
  });

  it('跑通：tenant_access_token + page_token 翻页（3 页 → 第 3 页 has_more=false）', async () => {
    const tokenCalls = [];
    const listPages = new Map([
      [1, { has_more: true, next_page_token: 'pg2', items: [{ record_id: 'r1', fields: { 标题: 'T1', 链接: 'https://x.com/1', 发布时间: 1724899200000 } }] }],
      [2, { has_more: true, next_page_token: 'pg3', items: [{ record_id: 'r2', fields: { 标题: 'T2', 链接: 'https://x.com/2', 发布时间: 1725235200000 } }] }],
      [3, { has_more: false, items: [{ record_id: 'r3', fields: { 标题: 'T3', 链接: 'https://x.com/3', 发布时间: 1725321600000 } }] }],
    ]);
    let pageIdx = 0;
    const restore = installMock(async (url) => {
      if (url.includes('/auth/v3/tenant_access_token')) {
        tokenCalls.push(url);
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 't-1', expire: 7200 }), { status: 200 });
      }
      if (url.includes('/bitable/v1/')) {
        pageIdx += 1;
        const body = listPages.get(pageIdx);
        return new Response(JSON.stringify({ code: 0, data: body }), { status: 200 });
      }
      return new Response('', { status: 404 });
    });
    try {
      const c = registry.get('feishu_bitable');
      const r = await c.run({
        url: 'https://open.feishu.cn/open-apis/bitable/v1/apps/app1/tables/tb1/records',
        auth: { appId: 'cli_x', appSecret: 'sec' },
      });
      assert.equal(r.items.length, 3);
      assert.equal(r.items[0].title, 'T1');
      assert.match(r.items[0].publishedAt, /^2024-08-29T/);
      assert.equal(tokenCalls.length, 1);
    } finally {
      restore();
    }
  });

  it('source.auth 缺失抛错', async () => {
    const c = registry.get('feishu_bitable');
    await assert.rejects(c.run({ url: 'https://x.com', auth: {} }), /缺失/);
  });
});

describe('notion-db connector', () => {
  it('registry 已注册 notion_db', () => {
    assert.equal(typeof registry.get('notion_db').run, 'function');
  });

  it('跑通：properties 解包 + start_cursor 翻页', async () => {
    const pages = [
      {
        id: 'page-1', url: 'https://notion.so/page-1',
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'First Page' }] },
          URL: { type: 'url', url: 'https://example.com/n1' },
          摘要: { type: 'rich_text', rich_text: [{ plain_text: 'First summary.' }] },
          Date: { type: 'date', date: { start: '2026-09-05T00:00:00Z' } },
          Author: { type: 'people', people: [{ name: 'Alice' }] },
        },
      },
      {
        id: 'page-2', url: 'https://notion.so/page-2',
        properties: {
          Name: { type: 'title', title: [{ plain_text: 'Second Page' }] },
          URL: { type: 'url', url: 'https://example.com/n2' },
          摘要: { type: 'rich_text', rich_text: [{ plain_text: 'Second summary.' }] },
          Date: { type: 'date', date: { start: '2026-09-06T00:00:00Z' } },
        },
      },
    ];
    // notional: pages.length=2, 第 1 次返回 [page-1] + has_more=true, 第 2 次返回 [page-2] + has_more=false
    let callNum = 0;
    const restore = installMock(async () => {
      callNum += 1;
      const has_more = callNum === 1;
      const resp = {
        results: has_more ? [pages[0]] : [pages[1]],
        has_more,
        next_cursor: has_more ? 'cur-next' : null,
      };
      return new Response(JSON.stringify(resp), { status: 200 });
    });
    try {
      const c = registry.get('notion_db');
      const r = await c.run({
        url: 'https://api.notion.com/v1/databases/db1/query',
        auth: { token: 'ntn_xyz' },
      });
      assert.equal(r.items.length, 2);
      assert.equal(r.items[0].title, 'First Page');
      assert.equal(r.items[1].author, undefined);
      assert.equal(r.items[0].publishedAt, '2026-09-05T00:00:00.000Z');
    } finally {
      restore();
    }
  });

  it('401 抛错', async () => {
    const restore = installMock(async () => new Response('unauthorized', { status: 401 }));
    try {
      const c = registry.get('notion_db');
      await assert.rejects(c.run({ url: 'https://api.notion.com/v1/databases/db1/query', auth: { token: 'bad' } }), /401/);
    } finally {
      restore();
    }
  });
});

describe('generic-api connector: 4 种 pagination + 解析', () => {
  it('registry 已注册 generic_api', () => {
    assert.equal(typeof registry.get('generic_api').run, 'function');
  });

  it('pagination=none + fieldMapping 字符串', async () => {
    const restore = installMock(async () => new Response(JSON.stringify({
      data: [{ id: 'g1', title: 'G item 1', url: 'https://g.com/1', published_at: '2026-09-07T00:00:00Z' }],
    }), { status: 200 }));
    try {
      const c = registry.get('generic_api');
      const r = await c.run({
        url: 'https://api.example.com/items',
        auth: { kind: 'none' },
        pagination: { kind: 'none' },
        itemListPath: ['data'],
        fieldMapping: { id: 'id', title: 'title', url: 'url', publishedAt: 'published_at' },
      });
      assert.equal(r.items.length, 1);
      assert.equal(r.items[0].title, 'G item 1');
    } finally {
      restore();
    }
  });

  it('pagination=page + startAt=0', async () => {
    let call = 0;
    const restore = installMock(async () => {
      call += 1;
      return new Response(JSON.stringify({
        meta: { total: 30 },
        data: call === 1
          ? Array.from({ length: 20 }, (_, i) => ({ id: `p1-${i}`, title: `p1 ${i}`, url: `https://g.com/p1-${i}` }))
          : Array.from({ length: 10 }, (_, i) => ({ id: `p2-${i}`, title: `p2 ${i}`, url: `https://g.com/p2-${i}` })),
      }), { status: 200 });
    });
    try {
      const c = registry.get('generic_api');
      const r = await c.run({
        url: 'https://api.example.com/items',
        auth: { kind: 'none' },
        pagination: { kind: 'page', size: 20, startAt: 0, paramName: 'page', sizeParamName: 'per_page', totalPath: ['meta', 'total'] },
        itemListPath: ['data'],
        fieldMapping: { id: 'id', title: 'title', url: 'url' },
      });
      assert.equal(r.items.length, 30);
      assert.equal(call, 2);
    } finally {
      restore();
    }
  });

  it('pagination=offset', async () => {
    let call = 0;
    const restore = installMock(async () => {
      call += 1;
      const data = call === 1
        ? Array.from({ length: 10 }, (_, i) => ({ id: `o-${i}`, title: `o ${i}`, url: `https://g.com/o-${i}` }))
        : Array.from({ length: 5 }, (_, i) => ({ id: `o2-${i}`, title: `o2 ${i}`, url: `https://g.com/o2-${i}` }));
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    try {
      const c = registry.get('generic_api');
      const r = await c.run({
        url: 'https://api.example.com/items',
        auth: { kind: 'none' },
        pagination: { kind: 'offset', offsetParam: 'offset', limitParam: 'limit', limit: 10 },
        fieldMapping: { id: 'id', title: 'title', url: 'url' },
      });
      assert.equal(r.items.length, 15);
      assert.equal(call, 2);
    } finally {
      restore();
    }
  });

  it('pagination=cursor', async () => {
    let call = 0;
    const restore = installMock(async (url) => {
      call += 1;
      const u = new URL(url);
      const cursor = u.searchParams.get('cursor');
      if (!cursor) {
        return new Response(JSON.stringify({
          data: [{ id: 'c1', title: 'c item', url: 'https://g.com/c1' }],
          next_cursor: 'cur-next',
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [], next_cursor: null }), { status: 200 });
    });
    try {
      const c = registry.get('generic_api');
      const r = await c.run({
        url: 'https://api.example.com/items',
        auth: { kind: 'none' },
        pagination: { kind: 'cursor', cursorParam: 'cursor', responsePath: ['next_cursor'] },
        fieldMapping: { id: 'id', title: 'title', url: 'url' },
      });
      assert.equal(r.items.length, 1);
      assert.equal(call, 2);
    } finally {
      restore();
    }
  });

  it('pagination=link_header', async () => {
    let call = 0;
    const restore = installMock(async () => {
      call += 1;
      const items = [{ id: `l-${call}`, title: `l ${call}`, url: `https://g.com/l-${call}` }];
      const headers = call === 1
        ? { 'content-type': 'application/json', 'link': '<https://api.example.com/items?p=2>; rel="next"' }
        : { 'content-type': 'application/json' };
      return new Response(JSON.stringify({ data: items }), { status: 200, headers });
    });
    try {
      const c = registry.get('generic_api');
      const r = await c.run({
        url: 'https://api.example.com/items',
        auth: { kind: 'none' },
        pagination: { kind: 'link_header', headerName: 'Link' },
        fieldMapping: { id: 'id', title: 'title', url: 'url' },
      });
      assert.equal(r.items.length, 2);
      assert.equal(call, 2);
    } finally {
      restore();
    }
  });

  it('pagination=link_header + 自定义 relNext', async () => {
    let call = 0;
    const restore = installMock(async () => {
      call += 1;
      const items = [{ id: `r-${call}`, title: `r ${call}`, url: `https://g.com/r-${call}` }];
      const headers = call === 1
        ? { 'content-type': 'application/json', 'x-nav': '<https://api.example.com/items?p=2>; rel="next-page"' }
        : { 'content-type': 'application/json' };
      return new Response(JSON.stringify({ data: items }), { status: 200, headers });
    });
    try {
      const c = registry.get('generic_api');
      const r = await c.run({
        url: 'https://api.example.com/items',
        auth: { kind: 'none' },
        pagination: { kind: 'link_header', headerName: 'X-Nav', relNext: 'next-page' },
        fieldMapping: { id: 'id', title: 'title', url: 'url' },
      });
      assert.equal(r.items.length, 2, `relNext 未生效：call=${call}`);
      assert.equal(call, 2);
    } finally {
      restore();
    }
  });

  // ⚠️ 契约漂移的**可执行证据**（背景见 docs/SOURCES.md §6）：
  // generic_api 读「顶层 fieldMapping.<内部字段> = 路径」，**不读** {mode,map}。
  // 用错形状时映射被静默忽略、标题退化为 (untitled) —— 由 npm run validate 的语义守卫在配置期拦截。
  it('形状陷阱：generic_api 用 {mode,map} → 映射被忽略，title=(untitled)', async () => {
    const restore = installMock(async () => new Response(
      JSON.stringify({ data: [{ id: 'a', title: '真实标题', url: 'https://g.com/a' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    try {
      const c = registry.get('generic_api');
      const r = await c.run({
        url: 'https://api.example.com/items',
        auth: { kind: 'none' },
        fieldMapping: { mode: 'jsonpath', map: { title: 'title', url: 'url' } },
      });
      assert.equal(r.items.length, 1);
      assert.equal(
        r.items[0].title,
        '(untitled)',
        '若此处不再是 (untitled)，说明连接器改了读取形状——请同步 docs/SOURCES.md §6 与 validate-schema.mjs 的语义守卫',
      );

      // 端到端：用户最终看到的标题确实不是「真实标题」
      const normalized = normalizeItem(
        r.items[0],
        { id: 'demo-api', channelId: 'demo', type: 'generic_api', url: 'https://api.example.com/items' },
        { id: 'demo', name: 'Demo', category: ['news'] },
      );
      assert.notEqual(normalized.title, '真实标题');
      assert.equal(
        normalized.title,
        '(untitled)',
        '映射被忽略后落库标题必须是 (untitled)，不能是 [object Object]',
      );
    } finally {
      restore();
    }
  });

  it('auth=bearer 用 env 拿 token', async () => {
    process.env.MY_TEST_TOKEN = 'tok-from-env';
    let bearer = null;
    const restore = installMock(async (url, opts) => {
      bearer = opts.headers?.Authorization ?? null;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    try {
      const c = registry.get('generic_api');
      await c.run({
        url: 'https://api.example.com/items',
        auth: { kind: 'bearer', tokenEnv: 'MY_TEST_TOKEN' },
        pagination: { kind: 'none' },
      });
      assert.equal(bearer, 'Bearer tok-from-env');
    } finally {
      delete process.env.MY_TEST_TOKEN;
      restore();
    }
  });

  it('auth=bearer 但 env 缺失抛错', async () => {
    delete process.env.MISSING_TOKEN;
    const c = registry.get('generic_api');
    await assert.rejects(
      c.run({ url: 'https://api.example.com/items', auth: { kind: 'bearer', tokenEnv: 'MISSING_TOKEN' }, pagination: { kind: 'none' } }),
      /未设置/,
    );
  });

  it('unknown pagination.kind 抛错', async () => {
    const c = registry.get('generic_api');
    await assert.rejects(
      c.run({ url: 'https://x.com', auth: { kind: 'none' }, pagination: { kind: 'rubbish' } }),
      /未知 pagination.kind/,
    );
  });
});

describe('registry 总览', () => {
  it('全部 type 已注册（无重名）', () => {
    const types = registry.listTypes();
    for (const t of ['rss', 'atom', 'json_feed', 'feishu_bitable', 'notion_db', 'generic_api', 'local_json', 'local_csv']) {
      assert.ok(types.includes(t), `${t} 已注册`);
    }
    assert.equal(new Set(types).size, types.length, '无重名');
  });
});

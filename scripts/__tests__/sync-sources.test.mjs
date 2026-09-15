// scripts/__tests__/sync-sources.test.mjs
//
// 锁定 scripts/sync-sources.mjs 的纯函数与端到端流程。
//
// 🚫 严禁真实网络访问：所有飞书 API 调用都通过 monkey-patch globalThis.fetch 拦截，
// 返回构造好的响应（token + records）。
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parseBitableUrl,
  deriveChannelId,
  parseTags,
  mapRecordsToConfig,
  fetchRecords,
  main,
} from '../sync-sources.mjs';
import { validateData } from '../validate-schema.mjs';

const DEFAULT_URL =
  'https://ginvh09pnwq.feishu.cn/base/IBNMbVJUuaKcgasQwMKc4eamnad?table=tblqLc4E03M5Uoh3&view=vewoYD3rcM';

// ----------------------------------------------------------------------------
// parseBitableUrl
// ----------------------------------------------------------------------------
describe('parseBitableUrl', () => {
  test('正确拆出 app_token / table_id', () => {
    const { appToken, tableId } = parseBitableUrl(DEFAULT_URL);
    assert.equal(appToken, 'IBNMbVJUuaKcgasQwMKc4eamnad');
    assert.equal(tableId, 'tblqLc4E03M5Uoh3');
  });

  test('带 --url 风格的 query 顺序也能解析', () => {
    const { appToken, tableId } = parseBitableUrl(
      'https://x.feishu.cn/base/AbC123?view=vvv&table=tblXYZ',
    );
    assert.equal(appToken, 'AbC123');
    assert.equal(tableId, 'tblXYZ');
  });
});

// ----------------------------------------------------------------------------
// deriveChannelId
// ----------------------------------------------------------------------------
describe('deriveChannelId', () => {
  test('https://www.appinn.com/ → appinn', () => {
    assert.equal(deriveChannelId('https://www.appinn.com/'), 'appinn');
  });

  test('含 . 的 host 转成合法 id', () => {
    const id = deriveChannelId('https://blog.daliansky.net/');
    assert.match(id, /^[a-z0-9][a-z0-9-]{1,63}$/);
  });

  test('非法字符被替换', () => {
    const id = deriveChannelId('https://exa mple!.com/');
    assert.match(id, /^[a-z0-9][a-z0-9-]{1,63}$/);
  });

  test('长度合规（至少 2 字符）', () => {
    const id = deriveChannelId('https://ab.com/');
    assert.match(id, /^[a-z0-9][a-z0-9-]{1,63}$/);
  });

  test('www. 前缀被去掉', () => {
    const id = deriveChannelId('https://www.example.org/');
    assert.equal(id, 'example');
  });

  test('同域多博主：path 段参与派生，结果互不相等（T-P6-03 核心回归护栏）', () => {
    const a = deriveChannelId('https://blog.csdn.net/ByteDanceTech');
    const b = deriveChannelId('https://blog.csdn.net/ctrip_tech');
    assert.notEqual(a, b, '同一 host 不同 path 必须派生出不同 id');
    assert.match(a, /^[a-z0-9][a-z0-9-]{1,63}$/);
    assert.match(b, /^[a-z0-9][a-z0-9-]{1,63}$/);
  });

  test('通用 feed 段不参与派生（/feed、/feed.xml、/rss → 仅 host）', () => {
    assert.equal(deriveChannelId('https://xclient.info/feed'), 'xclient');
    assert.equal(deriveChannelId('https://xclient.info/feed.xml'), 'xclient');
    assert.equal(deriveChannelId('https://xclient.info/rss'), 'xclient');
  });

  test('全部样本均满足 channel id 正则 ^[a-z0-9][a-z0-9-]{1,63}$', () => {
    const samples = [
      'https://www.appinn.com/',
      'https://blog.daliansky.net/',
      'https://tech.meituan.com/',
      'https://weekly.pychina.org/',
      'https://iui.su/',
      'https://blog.csdn.net/ByteDanceTech',
      'https://blog.csdn.net/ctrip_tech',
      'https://xclient.info/feed',
      'https://exa mple!.com/',
      'https://ab.com/',
    ];
    for (const s of samples) {
      const id = deriveChannelId(s);
      assert.match(id, /^[a-z0-9][a-z0-9-]{1,63}$/, `样本 ${s} → "${id}" 不合法`);
    }
  });
});

// ----------------------------------------------------------------------------
// parseTags
// ----------------------------------------------------------------------------
describe('parseTags', () => {
  test('JSON 数组', () => {
    assert.deepEqual(parseTags('["Mac","软件下载"]'), ['Mac', '软件下载']);
  });

  test('Python repr 单引号', () => {
    assert.deepEqual(parseTags("['Mac', '软件下载']"), ['Mac', '软件下载']);
  });

  test('空字符串 → null', () => {
    assert.equal(parseTags(''), null);
  });

  test('乱码 → null', () => {
    assert.equal(parseTags('乱码 @#$%'), null);
  });

  test('已是数组 → 直接复用', () => {
    assert.deepEqual(parseTags(['Mac', '软件下载']), ['Mac', '软件下载']);
  });
});

// ----------------------------------------------------------------------------
// mapRecordsToConfig
// ----------------------------------------------------------------------------
describe('mapRecordsToConfig', () => {
  const empty = { schemaVersion: '1.0', generatedAt: '2026-01-01T00:00:00Z', channels: [], sources: [] };

  test('单条记录 → 1 channel + 1 source，字段齐全', () => {
    const rec = {
      record_id: 'r1',
      fields: {
        RSS地址: 'https://ex.com/feed',
        标题: 'Ex',
        网站地址: 'https://ex.com/',
        状态: '',
        标签: '["Mac","软件下载"]',
        描述: '一个示例源',
      },
    };
    const { config, report } = mapRecordsToConfig([rec], empty);
    assert.equal(report.newChannels, 1);
    assert.equal(report.newSources, 1);
    const ch = config.channels[0];
    const src = config.sources[0];
    assert.equal(ch.id, 'ex');
    assert.equal(ch.category[0], 'other');
    assert.equal(ch.name, 'Ex');
    assert.equal(ch.homepage, 'https://ex.com/');
    assert.equal(ch.enabled, true);
    assert.equal(ch.displayLimit, 10);
    assert.equal(ch.icon, 'E');
    assert.equal(ch.language, 'zh-CN');
    assert.equal(ch.weight, 0.5);
    assert.deepEqual(ch.tags, ['Mac', '软件下载']);
    assert.equal(ch.description, '一个示例源');
    assert.equal(src.id, 'ex-rss');
    assert.equal(src.channelId, 'ex');
    assert.equal(src.type, 'rss');
    assert.equal(src.url, 'https://ex.com/feed');
    assert.equal(src.interval, 30);
  });

  test('去重：新记录 url 与已有 source url 相同（含尾斜杠差异）→ skipped，不新增', () => {
    const existing = {
      schemaVersion: '1.0',
      generatedAt: '2026-01-01T00:00:00Z',
      channels: [],
      sources: [{ id: 's1', channelId: 'c1', url: 'https://example.com/feed/' }],
    };
    const rec = {
      record_id: 'r1',
      fields: { RSS地址: 'https://example.com/feed', 标题: 'T', 网站地址: 'https://example.com/' },
    };
    const { config, report } = mapRecordsToConfig([rec], existing);
    assert.equal(report.skipped, 1);
    assert.equal(report.newSources, 0);
    assert.equal(config.sources.length, 1);
  });

  test("状态='失效' → channel 与 source 均 enabled=false，且计入 disabled", () => {
    const rec = {
      record_id: 'r1',
      fields: {
        RSS地址: 'https://dead.com/feed',
        标题: 'Dead',
        网站地址: 'https://dead.com/',
        状态: '失效',
      },
    };
    const { config, report } = mapRecordsToConfig([rec], empty);
    assert.equal(config.channels[0].enabled, false);
    assert.equal(config.sources[0].enabled, false);
    assert.equal(report.disabled, 1);
  });

  test('状态为空 → 按启用', () => {
    const rec = {
      record_id: 'r1',
      fields: { RSS地址: 'https://alive.com/feed', 标题: 'Alive', 网站地址: 'https://alive.com/' },
    };
    const { report } = mapRecordsToConfig([rec], empty);
    assert.equal(report.disabled, 0);
  });

  test('多记录同 homepage → 复用同一 channel，不重复建', () => {
    const r1 = {
      record_id: '1',
      fields: { RSS地址: 'https://a.com/rss1', 标题: 'A1', 网站地址: 'https://a.com/' },
    };
    const r2 = {
      record_id: '2',
      fields: { RSS地址: 'https://a.com/rss2', 标题: 'A2', 网站地址: 'https://a.com/' },
    };
    const { config, report } = mapRecordsToConfig([r1, r2], empty);
    assert.equal(config.channels.length, 1, '应只建 1 个 channel');
    assert.equal(config.sources.length, 2);
    assert.equal(config.sources[0].channelId, config.sources[1].channelId);
    assert.equal(report.newChannels, 1);
    assert.equal(report.newSources, 2);
  });

  test('同 homepage 但已存在于既有 channel → 复用，不新建', () => {
    const existing = {
      schemaVersion: '1.0',
      generatedAt: '2026-01-01T00:00:00Z',
      channels: [
        {
          id: 'appinn',
          name: '小众软件',
          homepage: 'https://www.appinn.com/',
          category: ['other'],
          enabled: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      sources: [],
    };
    const rec = {
      record_id: 'r1',
      fields: { RSS地址: 'https://www.appinn.com/newfeed', 标题: '小众软件新源', 网站地址: 'https://www.appinn.com/' },
    };
    const { config, report } = mapRecordsToConfig([rec], existing);
    assert.equal(report.newChannels, 0, '应复用既有 channel，不新建');
    assert.equal(config.channels.length, 1);
    assert.equal(config.sources[0].channelId, 'appinn');
  });

  test('复用分支保真度：第二条记录带 标签 时，复用出的 channel 补齐 tags（不覆盖既有）', () => {
    const existing = {
      schemaVersion: '1.0',
      generatedAt: '2026-01-01T00:00:00Z',
      channels: [
        {
          id: 'appinn',
          name: '小众软件',
          homepage: 'https://www.appinn.com/',
          category: ['other'],
          enabled: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      sources: [],
    };
    const rec = {
      record_id: 'r1',
      fields: {
        RSS地址: 'https://www.appinn.com/newfeed',
        标题: '小众软件新源',
        网站地址: 'https://www.appinn.com/',
        标签: '["Mac","软件下载"]',
        描述: '一个补充说明',
      },
    };
    const { config, report } = mapRecordsToConfig([rec], existing);
    assert.equal(report.newChannels, 0, '应复用既有 channel');
    const ch = config.channels[0];
    assert.deepEqual(ch.tags, ['Mac', '软件下载'], '复用分支应补齐 tags');
    assert.equal(ch.description, '一个补充说明', '复用分支应补齐 description');
  });

  test('复用分支保真度：既有 channel 已有 tags 时不被覆盖', () => {
    const existing = {
      schemaVersion: '1.0',
      generatedAt: '2026-01-01T00:00:00Z',
      channels: [
        {
          id: 'appinn',
          name: '小众软件',
          homepage: 'https://www.appinn.com/',
          category: ['other'],
          tags: ['既有标签'],
          enabled: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      sources: [],
    };
    const rec = {
      record_id: 'r1',
      fields: {
        RSS地址: 'https://www.appinn.com/newfeed',
        标题: '小众软件新源',
        网站地址: 'https://www.appinn.com/',
        标签: '["新标签"]',
      },
    };
    const { config } = mapRecordsToConfig([rec], existing);
    assert.deepEqual(config.channels[0].tags, ['既有标签'], '既有 tags 不应被新记录覆盖');
  });

  test('channel id 冲突且 homepage 不同 → 追加 -2', () => {
    const existing = {
      schemaVersion: '1.0',
      generatedAt: '2026-01-01T00:00:00Z',
      channels: [
        {
          id: 'example',
          name: 'E1',
          homepage: 'https://example.com/',
          category: ['other'],
          enabled: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      sources: [],
    };
    const rec = {
      record_id: 'r1',
      fields: { RSS地址: 'https://other.org/feed', 标题: 'O', 网站地址: 'https://other.org/' },
    };
    // other.org 派生 id = 'other'，与既有 'example' 不冲突；这里改为制造冲突：用 example.org 派生
    const rec2 = {
      record_id: 'r2',
      fields: { RSS地址: 'https://example.net/feed', 标题: 'E2', 网站地址: 'https://example.net/' },
    };
    const { config, report } = mapRecordsToConfig([rec2], existing);
    // example.net → 派生 'example'，与既有 homepage=example.com 不同 → 追加后缀
    assert.ok(config.channels.some((c) => c.id === 'example-2'), `期望追加 -2，实际 ${JSON.stringify(config.channels.map((c) => c.id))}`);
    assert.equal(report.newChannels, 1);
  });

  test('source.id 冲突 → 追加 -2', () => {
    const existing = {
      schemaVersion: '1.0',
      generatedAt: '2026-01-01T00:00:00Z',
      channels: [],
      sources: [{ id: 'ex-rss', channelId: 'ex', url: 'https://old.com/feed' }],
    };
    const rec = {
      record_id: 'r1',
      fields: { RSS地址: 'https://ex.com/feed', 标题: 'Ex', 网站地址: 'https://ex.com/' },
    };
    const { config } = mapRecordsToConfig([rec], existing);
    assert.equal(config.sources[1].id, 'ex-rss-2');
  });

  test('.atom / .atom.xml 结尾判定为 atom 类型', () => {
    const r1 = {
      record_id: '1',
      fields: { RSS地址: 'https://x.com/feed.atom', 标题: 'A', 网站地址: 'https://x.com/' },
    };
    const r2 = {
      record_id: '2',
      fields: { RSS地址: 'https://y.com/atom.xml', 标题: 'B', 网站地址: 'https://y.com/' },
    };
    const { config } = mapRecordsToConfig([r1, r2], empty);
    assert.equal(config.sources[0].type, 'atom');
    assert.equal(config.sources[1].type, 'atom');
  });

  test('生成的候选配置能被 ajv 校验通过', () => {
    const rec = {
      record_id: '1',
      fields: {
        RSS地址: 'https://ex.com/feed',
        标题: 'Ex',
        网站地址: 'https://ex.com/',
        标签: '["Mac","软件"]',
        描述: 'desc',
      },
    };
    const { config } = mapRecordsToConfig([rec], empty);
    const errors = validateData('sources', config);
    assert.deepEqual(errors, [], `期望校验通过，实际：${JSON.stringify(errors)}`);
  });
});

// ----------------------------------------------------------------------------
// fetchRecords（monkey-patch，无真实网络）
// ----------------------------------------------------------------------------
describe('fetchRecords（拦截网络）', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('翻页：has_more 时继续请求下一页', async () => {
    let calls = 0;
    globalThis.fetch = async (url, opts) => {
      calls += 1;
      if (String(url).includes('/auth/v3/tenant_access_token')) {
        return {
          json: async () => ({ code: 0, tenant_access_token: 'TOK', expire: 7200 }),
        };
      }
      // records 请求
      const hasMore = calls === 2; // 第一次 records 调用 has_more=true
      return {
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            has_more: hasMore,
            next_page_token: hasMore ? 'P2' : undefined,
            items: [
              { record_id: `rec-${calls}`, fields: { RSS地址: `https://e.com/${calls}`, 标题: `T${calls}`, 网站地址: 'https://e.com/' } },
            ],
          },
        }),
      };
    };
    const records = await fetchRecords('app', 'secret', 'appTok', 'tbl');
    assert.equal(records.length, 2, '两页应合并出 2 条');
    assert.equal(calls, 3, '1 次 token + 2 次 records');
  });
});

// ----------------------------------------------------------------------------
// main 端到端（dry-run，monkey-patch，不落盘）
// ----------------------------------------------------------------------------
describe('main 端到端（dry-run，不落盘）', () => {
  let originalFetch;
  let originalEnv;
  let stdoutChunks;
  let originalWrite;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = { ...process.env };
    stdoutChunks = [];
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      stdoutChunks.push(chunk);
      return true;
    };
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    process.stdout.write = originalWrite;
  });

  test('dry-run 下不写盘、返回 0，且 JSON 汇总含新增项', async () => {
    const before = readFileSync;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/auth/v3/tenant_access_token')) {
        return { json: async () => ({ code: 0, tenant_access_token: 'TOK', expire: 7200 }) };
      }
      return {
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            has_more: false,
            items: [
              {
                record_id: 'fb-1',
                fields: {
                  RSS地址: 'https://feishu.example/feed',
                  标题: '飞书示例',
                  网站地址: 'https://feishu.example/',
                  标签: '["Mac"]',
                },
              },
            ],
          },
        }),
      };
    };
    process.env.FEISHU_APP_ID = 'cli_test';
    process.env.FEISHU_APP_SECRET = 'secret_test';

    const code = await main(['--json', '--url', DEFAULT_URL]);

    assert.equal(code, 0, 'dry-run 应返回 0');
    const out = stdoutChunks.join('');
    const summary = JSON.parse(out);
    assert.equal(summary.newSources, 1);
    assert.equal(summary.newChannels, 1);
    assert.equal(summary.skipped, 0);
    // 不应触发写盘相关输出
    assert.doesNotMatch(out, /已写入/);
    // 确认没有真实读盘副作用（这里只验证未抛错、未写盘）
    void before;
  });

  test('缺少凭证 → 返回非 0', async () => {
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    const code = await main([]);
    assert.notEqual(code, 0);
  });
});

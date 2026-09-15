// scripts/__tests__/validate-source-shapes.test.mjs
//
// 锁定 scripts/validate-schema.mjs 的语义守卫 checkSourceShapes。
//
// 背景（见 docs/SOURCES.md §6）：fieldMapping / auth / pagination 存在两套**真实并存**的形状，
// sources.schema.json 已放宽以兼容两边。放宽之后，「形状用错连接器」的写法依然能通过 JSON Schema，
// 但会被连接器**静默忽略** → 标题退化为 (untitled)。语义守卫是唯一能拦截它的防线，
// 所以这里必须把「能拦」与「不误伤」两个方向都钉死。
//
// 同时锁定 --check 子命令的参数解析（曾因解构多跳一位导致恒打印 usage）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkSourceShapes } from '../validate-schema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 造一个最小合法 sources 配置 */
function cfg(sources) {
  return {
    schemaVersion: '1.0',
    generatedAt: '2026-09-15T00:00:00Z',
    channels: [
      {
        id: 'demo',
        name: 'Demo',
        homepage: 'https://example.com/',
        category: ['news'],
        enabled: true,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      },
    ],
    sources,
  };
}

/** 造一条最小合法 source */
function src(type, extra) {
  return {
    // id 必须匹配 ^[a-z0-9][a-z0-9-]{1,63}$ → 把 type 里的下划线换成连字符
    id: `demo-${String(type).replace(/_/g, '-')}`,
    channelId: 'demo',
    name: `Demo ${type}`,
    type,
    url: 'https://example.com/feed',
    enabled: true,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...extra,
  };
}

/** 把配置落到临时文件后走真实 CLI，返回 { code, out } */
function runCli(data) {
  const dir = mkdtempSync(join(tmpdir(), 'rr-shape-'));
  const file = join(dir, 'sources.json');
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  const r = spawnSync(
    process.execPath,
    ['scripts/validate-schema.mjs', '--check', file, 'sources'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('checkSourceShapes / 不误伤合法形状', () => {
  test('连接器真实形状（4 种 type）→ 0 错误', () => {
    const data = cfg([
      // generic_api：顶层 fieldMapping + pagination.kind + auth.kind + method/itemListPath
      src('generic_api', {
        method: 'GET',
        itemListPath: ['data', 'items'],
        auth: { kind: 'bearer', tokenEnv: 'DEMO_TOKEN' },
        pagination: { kind: 'cursor', cursorParam: 'cursor', responsePath: ['data', 'next_cursor'] },
        fieldMapping: { id: 'id', title: 'title', url: 'url', publishedAt: 'published_at' },
      }),
      // feishu_bitable：顶层 fieldMapping + auth.{appId,appSecret} + params
      src('feishu_bitable', {
        auth: { appId: 'cli_xxx', appSecret: 'SECRET' },
        params: { page_size: 200 },
        fieldMapping: { title: ['fields', '标题'], url: ['fields', '链接'] },
      }),
      // notion_db：顶层 fieldMapping（含数字下标）+ auth.token + body/pageSize
      src('notion_db', {
        auth: { token: 'ntn_xxx' },
        body: { filter: { property: 'Status' } },
        pageSize: 100,
        fieldMapping: { title: ['properties', 'Name', 'title', 0, 'plain_text'] },
      }),
      // local_json / local_csv：{itemsPath,map,...}
      src('local_json', {
        fieldMapping: {
          itemsPath: '$[*]',
          map: { title: '$.t', url: '$.u' },
          typeCoercion: { publishedAt: 'date' },
          defaults: { language: 'zh-CN' },
        },
      }),
      src('local_csv', { fieldMapping: { map: { title: '标题', url: '链接' } } }),
      // rss：不带任何映射
      src('rss', {}),
    ]);
    assert.deepEqual(checkSourceShapes(data), []);
  });

  test('sources 为空 / 缺失 → 0 错误', () => {
    assert.deepEqual(checkSourceShapes({ sources: [] }), []);
    assert.deepEqual(checkSourceShapes({}), []);
    assert.deepEqual(checkSourceShapes(null), []);
  });
});

describe('checkSourceShapes / 拦截静默损坏写法', () => {
  const cases = [
    {
      name: 'generic_api 用 {mode,map}（会被静默忽略 → title=(untitled)）',
      source: src('generic_api', {
        fieldMapping: { mode: 'jsonpath', map: { title: '$.title', url: '$.url' } },
      }),
      expectKeyword: 'semantic',
    },
    {
      name: 'feishu_bitable 用 {mode,map}',
      source: src('feishu_bitable', { fieldMapping: { mode: 'table', map: { title: '标题' } } }),
      expectKeyword: 'semantic',
    },
    {
      name: 'notion_db 用 {mode,map}',
      source: src('notion_db', { fieldMapping: { mode: 'table', map: { title: 'Name' } } }),
      expectKeyword: 'semantic',
    },
    {
      name: 'local_json 用顶层 title/url（该连接器只读 map）',
      source: src('local_json', { fieldMapping: { title: '$.t', url: '$.u' } }),
      expectKeyword: 'semantic',
    },
    {
      name: 'generic_api 用 pagination.strategy（应写 kind）',
      source: src('generic_api', { pagination: { strategy: 'cursor', cursorParam: 'c' } }),
      expectKeyword: 'semantic',
    },
    {
      name: 'generic_api 用 auth.type/ref（应写 kind）',
      source: src('generic_api', { auth: { type: 'env', ref: 'DEMO_TOKEN' } }),
      expectKeyword: 'semantic',
    },
    {
      name: 'feishu_bitable 的 fieldMapping 值写成字符串（只接受路径数组）',
      source: src('feishu_bitable', { fieldMapping: { title: '标题' } }),
      expectKeyword: 'semantic',
    },
    {
      name: 'notion_db 的 fieldMapping 值写成字符串（只接受路径数组）',
      source: src('notion_db', { fieldMapping: { title: 'Name' } }),
      expectKeyword: 'semantic',
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const errors = checkSourceShapes(cfg([c.source]));
      assert.ok(errors.length >= 1, `期望至少 1 个错误，实际 ${errors.length}`);
      assert.ok(
        errors.some((e) => e.keyword === c.expectKeyword),
        `期望含 keyword=${c.expectKeyword}，实际 ${JSON.stringify(errors)}`,
      );
      // 错误信息必须指出具体 source，便于定位
      assert.ok(
        errors.some((e) => e.instancePath.includes('demo-')),
        '错误应带上出现问题的 source id',
      );
    });
  }

  test('generic_api 两处都写错 → 至少 2 个错误（不互相吞掉）', () => {
    const errors = checkSourceShapes(
      cfg([
        src('generic_api', {
          auth: { type: 'env', ref: 'X' },
          pagination: { strategy: 'page' },
          fieldMapping: { mode: 'jsonpath', map: { title: 'x' } },
        }),
      ]),
    );
    assert.ok(errors.length >= 3, `期望 >=3，实际 ${errors.length}: ${JSON.stringify(errors)}`);
  });

  test('generic_api 的字符串路径合法（单层键语义），不误报', () => {
    const errors = checkSourceShapes(
      cfg([src('generic_api', { fieldMapping: { title: 'title', url: 'url', id: 'id' } })]),
    );
    assert.deepEqual(errors, []);
  });
});

describe('CLI --check 参数解析（曾因解构多跳一位恒打印 usage）', () => {
  test('合法连接器形状 → exit 0', () => {
    const { code, out } = runCli(
      cfg([
        src('generic_api', {
          method: 'GET',
          auth: { kind: 'none' },
          pagination: { kind: 'none' },
          fieldMapping: { title: 'title', url: 'url' },
        }),
      ]),
    );
    assert.equal(code, 0, `期望 exit 0，实际 ${code}\n${out}`);
    assert.match(out, /校验通过/);
  });

  test('写错形状 → exit 1 且提示静默损坏风险', () => {
    const { code, out } = runCli(
      cfg([src('generic_api', { fieldMapping: { mode: 'jsonpath', map: { title: 't' } } })]),
    );
    assert.equal(code, 1, `期望 exit 1，实际 ${code}\n${out}`);
    assert.match(out, /untitled/);
  });

  test('模板形状不被误伤：内联 fixture（连接器真实形状）→ exit 0', () => {
    const { code, out } = runCli(
      cfg([
        src('local_json', {
          fieldMapping: { itemsPath: '$[*]', map: { title: '$.t', url: '$.u' } },
        }),
        src('feishu_bitable', { fieldMapping: { title: ['fields', '标题'] } }),
        src('notion_db', { fieldMapping: { title: ['properties', 'Name', 'title', 0, 'plain_text'] } }),
        src('generic_api', {
          auth: { kind: 'none' },
          pagination: { kind: 'none' },
          fieldMapping: { title: 'title' },
        }),
      ]),
    );
    assert.equal(code, 0, `期望 exit 0，实际 ${code}\n${out}`);
  });
});

// 文档资产防漂移：示例配置必须与连接器真实形状一致，否则读者会照着错的抄。
describe('文档示例资产 docs/data-model/examples/sources.example.json', () => {
  test('通过 JSON Schema + 语义守卫（exit 0）', () => {
    const r = spawnSync(
      process.execPath,
      ['scripts/validate-schema.mjs', '--check', 'docs/data-model/examples/sources.example.json', 'sources'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, `示例文件漂移了：\n${r.stdout}${r.stderr}`);
  });
});

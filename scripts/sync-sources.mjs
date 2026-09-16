// scripts/sync-sources.mjs
//
// 飞书多维表格「RSS 源清单注册表」→ config/sources.json 增量同步（T-P6-02）。
//
// 设计动机（见任务背景）：rss_private 用一张飞书多维表格当「源清单注册表」，人在表里维护
// RSS 地址清单，脚本只负责拉全表 + 增量同步到本地文件。rss-radar 既有 feishu_bitable 连接器
// 是把飞书表当**内容源**读文章，本脚本则是把飞书表当**源清单**——每条记录 = 1 个 channel + 1 个 source。
//
// 鉴权 / 分页**直接照抄** scripts/collect/connectors/feishu-bitable.mjs 的模式：
//   - token：POST /open-apis/auth/v3/tenant_access_token/internal，body {app_id, app_secret}
//   - 分页：GET /bitable/v1/apps/{app_token}/tables/{table_id}/records?page_size=200[&page_token=...]
//
// 🔒 安全红线：app_id / app_secret 只能从环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET 读取，
//    绝不硬编码、绝不写进任何被提交的文件（参考 rss_private/feishu_bitable_utils.py 曾明文硬编码的教训）。
//
// CLI：
//   node scripts/sync-sources.mjs                 # 默认 dry-run（只报告不落盘）
//   node scripts/sync-sources.mjs --write         # 校验通过才真的改 config/sources.json
//   node scripts/sync-sources.mjs --json          # 额外输出机器可读的汇总 JSON（便于 CI/测试断言）
//   node scripts/sync-sources.mjs --url <bitable_url>   # 覆盖飞书表地址
//
// 飞书表列（中文列名）：RSS地址 / record_id / 创建时间 / 更新时间 / 标题 / 状态 / 网站地址 / 标签 / 描述
//
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
// 渠道 id 派生 / 标签解析 / feed URL 归一化统一收敛到 scripts/lib/channel-registry.mjs。
// 同一个概念有两份实现，是清单类项目最典型的漂移源 —— 两处规则一旦分叉，
// 「同一渠道判成两个」或「两个渠道判成一个」都会静默发生。
import {
  deriveChannelId,
  parseTags,
  freeId,
  normalizeFeedUrl,
  normalizeHomepage,
  deriveHomepageFromFeed,
  hostOf,
} from './lib/channel-registry.mjs';

// 保持既有导出面（scripts/__tests__/sync-sources.test.mjs 直接测这两个函数）
export { deriveChannelId, parseTags };

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCES_PATH = resolve(ROOT, 'config/sources.json');
const SCHEMA_PATH = resolve(ROOT, 'docs/data-model/schema/sources.schema.json');

/** 兜底默认表地址（URL 不是秘密，可硬编码；但 app_id/app_secret 不行） */
const DEFAULT_BITABLE_URL =
  'https://ginvh09pnwq.feishu.cn/base/IBNMbVJUuaKcgasQwMKc4eamnad?table=tblqLc4E03M5Uoh3&view=vewoYD3rcM';

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const TOKEN_TTL_MS = 110 * 60 * 1000; // 110 分钟（保守 < 2h）

const PAGE_SIZE = 200;
const CATEGORY_FALLBACK = 'other';
const CHANNEL_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

// ----------------------------------------------------------------------------
// 类型（JSDoc，便于阅读；.mjs 不在 tsc 范围内）
// ----------------------------------------------------------------------------

/**
 * @typedef {Object} BitableRecord
 * @property {string} [record_id]
 * @property {{ [k: string]: any }} [fields]
 */

/**
 * @typedef {Object} SourcesConfig
 * @property {string} schemaVersion
 * @property {string} generatedAt
 * @property {Array<Object>} [channels]
 * @property {Array<Object>} [sources]
 * @property {Array<Object>} [categories]
 */

// ----------------------------------------------------------------------------
// 飞书字段解包（照抄 feishu-bitable.mjs：{text,name,link} 嵌套 → 裸值）
// ----------------------------------------------------------------------------

/**
 * 解包飞书字段值（{type, value} / {text} / {link} / {name} 嵌套结构）。
 * @param {any} v
 * @returns {any}
 */
export function unwrapFeishuValue(v) {
  if (v == null) return undefined;
  if (typeof v !== 'object') return v;
  if ('text' in v) return v.text;
  if ('name' in v) return v.name;
  if ('link' in v) return v.link;
  if (Array.isArray(v) && v.length > 0) return unwrapFeishuValue(v[0]);
  if (typeof v === 'object' && 'value' in v) return unwrapFeishuValue(v.value);
  return v;
}

/** 取飞书记录的某个中文字段（自动解包嵌套） */
function field(rec, name) {
  const v = rec?.fields?.[name];
  return unwrapFeishuValue(v);
}

// ----------------------------------------------------------------------------
// URL 解析工具
// ----------------------------------------------------------------------------

/**
 * 从飞书表 URL 解析 app_token / table_id。
 * 形如：https://<host>/base/<app_token>?table=<table_id>&view=...
 * @param {string} url
 * @returns {{ appToken: string, tableId: string }}
 */
export function parseBitableUrl(url) {
  const u = new URL(url);
  const appToken = u.pathname.split('/').filter(Boolean).pop();
  const tableId = u.searchParams.get('table');
  if (!appToken || !tableId) {
    throw new Error(`无法从 URL 解析出 app_token / table_id：${url}`);
  }
  return { appToken, tableId };
}

// ⬇️ stripTrailingSlash / hostOf / originOf 三个**本地实现已删除**，统一收敛到 lib：
//    - URL 比较 → lib 的 `normalizeHomepage`（实体键：去协议 + 去 www + 去尾斜杠）
//    - host 提取 → lib 的 `hostOf`
//    - 主页兜底 → lib 的 `deriveHomepageFromFeed`（原来的 `originOf(rssUrl)` 会把
//      整个路径丢掉，是「同站不同栏目压成一条渠道」的根因）
//    这正是本文件顶部那段注释所警告的「同一个概念有两份实现，是清单类项目最
//    典型的漂移源」—— 本地那份已清除。

// ----------------------------------------------------------------------------
// channel id 派生
// ----------------------------------------------------------------------------
//
// ⬇️ pathSegmentsOf / FEED_STOPWORDS / deriveChannelId 的实现已下沉到
//    scripts/lib/channel-registry.mjs（本文件顶部 import + re-export）。
//    保留此处小节标题只为让 diff 易读；导出面与行为完全不变。


// ----------------------------------------------------------------------------
// 标签容错解析（JSON 数组 / Python repr 单引号）
// ----------------------------------------------------------------------------
//
// ⬇️ parseTags 的实现已下沉到 scripts/lib/channel-registry.mjs
//    （本文件顶部 import + re-export）。行为与导出面完全不变。


// ----------------------------------------------------------------------------
// 记录 → 候选 config 纯函数（可单测、可复用）
// ----------------------------------------------------------------------------

/**
 * 把飞书记录数组映射成「旧 config + 增量」的候选 config + 统计报告。
 *
 * 映射（每条记录 → 1 channel + 1 source）：
 *   - channel.category = ['other']
 *   - channel.id 由网站地址 host 派生；与已有 channel id 冲突且 homepage 不同 → 追加 -2/-3；
 *     已有 channel homepage 相同 → 复用（不新建）
 *   - source.id = `${channelId}-rss`（冲突追加 -2/-3）
 *   - 去重：RSS地址 已存在于任一 source.url（尾部 / 归一化）→ 跳过计 skipped
 *
 * @param {BitableRecord[]} records
 * @param {SourcesConfig} [existingConfig]
 * @param {{ now?: string }} [options]
 * @returns {{ config: SourcesConfig, report: { newChannels: number, newSources: number, skipped: number, disabled: number, newChannelIds: string[], newSourceIds: string[] } }}
 */
export function mapRecordsToConfig(records, existingConfig = { channels: [], sources: [] }, options = {}) {
  const now = options.now || new Date().toISOString();
  const existingChannels = Array.isArray(existingConfig.channels) ? existingConfig.channels : [];
  const existingSources = Array.isArray(existingConfig.sources) ? existingConfig.sources : [];

  // 去重键统一用 channel-registry 的 normalizeFeedUrl（与导入管线同一条规则）——
  // 只用「去尾斜杠」会漏掉 `?utm_source=x`、query 顺序、默认端口等等价写法，
  // 结果就是同一个渠道被当成两个，进而被重复请求。
  const existingSourceUrls = new Set(
    existingSources.map((s) => normalizeFeedUrl(s.url)).filter(Boolean),
  );
  const channels = existingChannels.slice();
  const sources = existingSources.slice();

  const newChannelIds = [];
  const newSourceIds = [];
  let skipped = 0;
  let disabled = 0;

  /** 在占位 sources 里找一个空闲的 source id */
  function freeSourceId(base) {
    const taken = new Set(sources.map((s) => s.id));
    if (!taken.has(base)) return base;
    let n = 2;
    let id = `${base}-${n}`;
    while (taken.has(id)) {
      n += 1;
      id = `${base}-${n}`;
    }
    return id;
  }

  for (const rec of Array.isArray(records) ? records : []) {
    const rssUrl = field(rec, 'RSS地址');
    if (!rssUrl) continue; // 没有 RSS 地址无法生成 source，跳过

    // 去重：与已有 source.url（归一化）或本次新生成的重复 → 跳过
    const normRss = normalizeFeedUrl(rssUrl);
    if (normRss && existingSourceUrls.has(normRss)) {
      skipped += 1;
      continue;
    }
    if (normRss && sources.some((s) => normalizeFeedUrl(s.url) === normRss)) {
      skipped += 1;
      continue;
    }

    const title = field(rec, '标题') || '';
    const siteUrl = field(rec, '网站地址') || '';
    const status = field(rec, '状态') || '';
    const enabled = status !== '失效'; // 空状态按启用
    const tagsRaw = field(rec, '标签');
    const description = field(rec, '描述') || '';

    // 主页兜底统一走 lib（栏目级，不是裸 host）；判重也用实体键归一化 ——
    // 于是 http/https、www/非 www 的同一实体不会再被判成两条渠道。
    const homepage = siteUrl || deriveHomepageFromFeed(rssUrl) || rssUrl;
    const host = hostOf(homepage) || homepage;

    // 1) 同一实体 → 复用已有 channel（不新建）
    let channel = channels.find((c) => normalizeHomepage(c.homepage) === normalizeHomepage(homepage));
    let reused = false;
    let channelId;
    if (channel) {
      reused = true;
      channelId = channel.id;
    } else {
      // 2) 由 host 派生 id，并保证在 channels 中唯一（冲突追加 -2/-3）
      channelId = deriveChannelId(homepage);
      if (channels.some((c) => c.id === channelId)) {
        let n = 2;
        while (channels.some((c) => c.id === `${channelId}-${n}`)) n += 1;
        channelId = `${channelId}-${n}`;
      }
    }

    if (!reused) {
      const iconChar = (title || host || '?').trim().charAt(0);
      channel = {
        id: channelId,
        name: title || host,
        homepage,
        category: [CATEGORY_FALLBACK],
        enabled,
        displayLimit: 10,
        icon: iconChar,
        language: 'zh-CN',
        weight: 0.5,
        createdAt: now,
        updatedAt: now,
      };
      const tags = parseTags(tagsRaw);
      if (tags && tags.length) channel.tags = tags;
      if (description) channel.description = description;
      channels.push(channel);
      newChannelIds.push(channelId);
    } else {
      // 复用既有 channel：仅在既有字段缺失时补上 tags / description，不覆盖既有值（保真度）
      const tags = parseTags(tagsRaw);
      if (tags && tags.length && !channel.tags) channel.tags = tags;
      if (description && !channel.description) channel.description = description;
    }

    if (!enabled) disabled += 1;

    const isAtom = /\.atom$/i.test(rssUrl) || /atom\.xml$/i.test(rssUrl);
    const source = {
      id: freeSourceId(`${channelId}-rss`),
      channelId,
      name: title || host,
      type: isAtom ? 'atom' : 'rss',
      url: rssUrl,
      enabled,
      language: 'zh-CN',
      interval: 30,
      createdAt: now,
      updatedAt: now,
    };
    sources.push(source);
    newSourceIds.push(source.id);
  }

  const config = {
    ...existingConfig,
    schemaVersion: existingConfig.schemaVersion || '1.0',
    generatedAt: now,
    channels,
    sources,
  };

  return {
    config,
    report: {
      newChannels: newChannelIds.length,
      newSources: newSourceIds.length,
      skipped,
      disabled,
      newChannelIds,
      newSourceIds,
    },
  };
}

// ----------------------------------------------------------------------------
// 飞书 API 客户端（鉴权 + 翻页，照抄 feishu-bitable.mjs 的缓存与分页模式）
// ----------------------------------------------------------------------------

const _tokenCache = new Map();

/**
 * 获取 tenant_access_token（按 tokenUrl::appId 维度缓存）。
 * @param {string} appId
 * @param {string} appSecret
 * @returns {Promise<string>}
 */
export async function getTenantAccessToken(appId, appSecret) {
  if (!appId || !appSecret) {
    throw new Error('sync-sources: 缺少 appId / appSecret');
  }
  const cacheKey = `${TOKEN_URL}::${appId}`;
  const now = Date.now();
  const hit = _tokenCache.get(cacheKey);
  if (hit && hit.expiresAt > now + 60000) return hit.token;

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await r.json();
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`sync-sources: 获取 tenant_access_token 失败: code=${data.code} msg=${data.msg}`);
  }
  const token = data.tenant_access_token;
  const ttl = (data.expire ?? 7200) * 1000;
  _tokenCache.set(cacheKey, { token, expiresAt: now + Math.min(ttl, TOKEN_TTL_MS) });
  return token;
}

/**
 * 拉取表里全部记录（自动翻页）。
 * @param {string} appId
 * @param {string} appSecret
 * @param {string} appToken
 * @param {string} tableId
 * @returns {Promise<BitableRecord[]>}
 */
export async function fetchRecords(appId, appSecret, appToken, tableId) {
  const token = await getTenantAccessToken(appId, appSecret);
  const items = [];
  let pageToken;
  do {
    const params = new URLSearchParams({ page_size: String(PAGE_SIZE) });
    if (pageToken) params.set('page_token', pageToken);
    const url =
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params.toString()}`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
    if (r.status >= 400) throw new Error(`sync-sources: feishu bitable HTTP ${r.status}`);
    const data = await r.json();
    if (data.code !== 0) throw new Error(`sync-sources: feishu bitable: ${data.msg ?? data.code}`);
    for (const it of data.data?.items ?? []) items.push(it);
    pageToken = data.data?.has_more ? data.data?.next_page_token : null;
  } while (pageToken);
  return items;
}

// ----------------------------------------------------------------------------
// ajv 校验（复用仓库已有的 ajv + ajv-formats，与 validate-schema.mjs 同款）
// ----------------------------------------------------------------------------

let _validator = null;
function compileSchema() {
  if (_validator) return _validator;
  const ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  _validator = ajv.compile(schema);
  return _validator;
}

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------

/** @returns {{ write: boolean, json: boolean, url: string | undefined }} */
function parseArgs(argv) {
  const out = { write: false, json: false, url: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    else if (a === '--json') out.json = true;
    else if (a === '--dry-run') {
      /* 默认即 dry-run，显式声明无害 */
    } else if (a === '--url') out.url = argv[++i];
    else if (a.startsWith('--url=')) out.url = a.slice('--url='.length);
  }
  return out;
}

function printReport(report, json) {
  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          newChannels: report.newChannels,
          newSources: report.newSources,
          skipped: report.skipped,
          disabled: report.disabled,
          newChannelIds: report.newChannelIds,
          newSourceIds: report.newSourceIds,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  console.error(`新增 channel：${report.newChannels}`);
  console.error(`新增 source ： ${report.newSources}`);
  console.error(`跳过去重   ： ${report.skipped}`);
  console.error(`被禁用     ： ${report.disabled}`);
  if (report.newChannelIds.length) console.error(`新增 channel id：${report.newChannelIds.join(', ')}`);
  if (report.newSourceIds.length) console.error(`新增 source id ： ${report.newSourceIds.join(', ')}`);
}

/**
 * CLI 主流程。
 * @param {string[]} [argv]
 * @returns {Promise<number>} 退出码
 */
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    console.error(
      '❌ 缺少飞书凭证：请设置环境变量 FEISHU_APP_ID 与 FEISHU_APP_SECRET（切勿硬编码到脚本/仓库）。',
    );
    return 2;
  }

  const bitableUrl = args.url || process.env.FEISHU_SOURCES_BITABLE_URL || DEFAULT_BITABLE_URL;
  const { appToken, tableId } = parseBitableUrl(bitableUrl);

  const existing = existsSync(SOURCES_PATH)
    ? JSON.parse(readFileSync(SOURCES_PATH, 'utf8'))
    : { schemaVersion: '1.0', channels: [], sources: [] };

  const records = await fetchRecords(appId, appSecret, appToken, tableId);
  const { config, report } = mapRecordsToConfig(records, existing);

  // 落盘安全：先用 ajv 校验，校验通过才 --write；校验失败则 exit 非 0、不写盘
  const validate = compileSchema();
  const valid = validate(config);
  if (!valid) {
    console.error('❌ 候选配置未通过 schema 校验，已中止（未写盘）：');
    for (const e of validate.errors ?? []) {
      console.error(`  • ${e.instancePath || '/'} ${e.message}`);
    }
    return 1;
  }

  printReport(report, args.json);

  if (args.write) {
    writeFileSync(SOURCES_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
    console.error(
      `✅ 已写入 ${SOURCES_PATH}（新增 channel ${report.newChannels} / source ${report.newSources}，跳过 ${report.skipped}）`,
    );
  } else {
    console.error('（dry-run，未写盘；加 --write 才落盘）');
  }
  return 0;
}

// 仅在「作为 CLI 直接运行」时执行；被 import（如单测）时只导出函数，不跑流程也不 exit。
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`❌ sync-sources 失败：${err?.stack || err}`);
      process.exit(1);
    },
  );
}

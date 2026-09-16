#!/usr/bin/env node
// scripts/import-channels.mjs — 外部渠道清单 → config/sources.json 的**幂等导入管线**
//
// ── 这份脚本要兑现的契约（主理人 2026-09-16 拍板） ────────────────────────
//
//   「只需要做好最终一致性，即需要在项目中维护最终的一版实际使用的 rss 数据，
//     所有其他渠道 + 导入的都要最终落到这里，一定做好一致性和重复问题的处理，
//     不要重复请求同一个渠道获取 rss 信息。」
//
// 翻译成四条可执行约束：
//
//   ① **SSOT**：`config/sources.json` 是唯一权威。garss / OPML / 注册表导出
//      都只是「输入」，最终必须收敛到它。本脚本只写这一个文件。
//   ② **幂等键 = 归一化 feed URL**（`scripts/lib/channel-registry.mjs` 的
//      `normalizeFeedUrl`）。同 URL 出现两次 = 必然重复请求，一律合并。
//   ③ **幂等重跑**：同一份输入跑 N 次结果逐字节一致。靠三件事保证 ——
//      归一化后落盘、`--now` 可固定时间戳、`mergeIntoRegistry` 只增不改。
//   ④ **放量安全**：`--enable N` 只对**本次新增**的前 N 个开闸，且这 N 个
//      必须来自**健康的那批**（否则「先开 60 个」会开出一堆死链）。
//
// ── 四阶段流水线（每阶段都有门禁） ───────────────────────────────────────
//
//   阶段 0 解析  garssInfo.json / subscriptions.json / 注册表导出 / OPML
//   阶段 1 清洗  丢内网地址与 RSSHub 路径型、URL 归一化、批内去重
//   阶段 2 分类  19 个中文自由词 → 已启用的 8 个受控 CategoryKey（fail-closed）
//   阶段 3 体检  复用 scripts/collect/url-health.mjs 的六态机
//   阶段 4 落盘  默认 dry-run；`--write` 才改 config/sources.json，且先过 ajv
//
// ── 用法 ─────────────────────────────────────────────────────────────────
//
//   node scripts/import-channels.mjs --from garss          # dry-run，看报告
//   node scripts/import-channels.mjs --from garss --write  # 真写
//   node scripts/import-channels.mjs --file x.opml --write # 其他格式
//   node scripts/import-channels.mjs --from garss --help
//
// 只读导入（不动配置）：默认就是 dry-run，只有显式 `--write` 才会落盘。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  normalizeFeedUrl,
  normalizeHomepage,
  deriveHomepageFromFeed,
  mergeIntoRegistry,
  auditRegistry,
  guessFeedType,
} from './lib/channel-registry.mjs';
import { checkUrls } from './collect/url-health.mjs';
import { DEFAULT_UA } from './collect/lib/http.mjs';
import { validateData } from './validate-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCES_PATH = resolve(ROOT, 'config/sources.json');
const DEFAULT_GARSS_DIR = '/Users/dushouxin/WorkSpace/github/garss';
const DEFAULT_RSSHUB_BASE = 'https://rsshub.app';

// ---------------------------------------------------------------------------
// 阶段 2 的映射表：garss 的 19 个中文自由词 → 已启用的 8 个受控分类
// ---------------------------------------------------------------------------
//
// 为什么只映射到**已启用的 8 类**，而不是像 DESIGN §4.4 建议的那样启用
// `product_design` / `video` / `social` 预留位？
//
// 因为 README 写死了一条纪律：**新增分类必须四处同步**
// （`config/categories.json` → `config/keyword-rules.json` →
//   `sources.schema.json#/definitions/categoryKey` → `src/types/models.ts`）。
// 而 `config/categories.json` 是前端筛选 chip 的数据源 —— 往里塞一个没注册的
// key，筛选器就会渲染出无标签的空 chip。
//
// 「导入渠道」和「扩分类」是两件事，不该在一批里揉。原始中文分类不丢：
// 它落进 `tags[]`（受控分类驱动筛选，自由标签保留可检索性），
// 将来若要启用 `product_design`，按 tags 反查即可精准搬迁。
export const GARSS_CATEGORY_MAP = Object.freeze({
  活着的个人独立博客: 'tech_blog',
  科技类: 'tech_blog',
  IT团队博客: 'tech_blog',
  软件工具: 'tech_blog',
  设计类: 'tech_blog',
  数码: 'tech_blog',
  内容平台: 'news',
  互联网类: 'news',
  公司官方新闻: 'news',
  金融类: 'finance',
  Telegram优质频道RSS订阅: 'other',
  影视资源: 'other',
  资源类: 'other',
  摄影: 'other',
  生活类: 'other',
  游戏: 'other',
  学习类: 'other',
  学术类: 'other',
  未分类: 'other',
});

/** 已启用的受控分类（`config/categories.json` 为准；本表是它的镜像，由单测锁一致） */
export const ENABLED_CATEGORIES = Object.freeze([
  'tech_blog', 'ai', 'news', 'dev_community', 'podcast', 'newsletter', 'finance', 'other',
]);

/** garss 把「用户自己的订阅」和「RSSHub 官方文档目录」混在一个文件里 */
const RSSHUB_DOC_PREFIX = 'RSSHub 文档';

/**
 * Docker 内网 / 本机地址。这些是 garss 自建 RSSHub 实例的 route，
 * **直搬进 rss-radar 必然 100% 失败**（公网 DNS 解析不到 `rsshub` 这个主机）。
 */
const INTERNAL_HOST_RE = /^(?:rsshub|localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|rsshub\.v2fy\.com)$/i;

/** 清洗阶段被丢弃的原因（报告里逐条给理由，不静默吞） */
export const CLEAN_REASONS = Object.freeze({
  MISSING_URL: 'missing-feed-url',
  INVALID_URL: 'invalid-url',
  UNSUPPORTED_PROTOCOL: 'unsupported-protocol',
  INTERNAL_DROPPED: 'internal-rsshub-dropped',
  DUPLICATE_IN_BATCH: 'duplicate-in-batch',
  UNKNOWN_CATEGORY: 'unknown-category-mapped-to-other',
});

// ---------------------------------------------------------------------------
// 阶段 0：解析适配器（纯函数，可单测）
// ---------------------------------------------------------------------------

/**
 * garss 的 `garssInfo.json` —— 主理人**实际在用**的那份清单。
 * 形状：`{ garssInfo: [{ sourceId, category, title, description, xmlUrl }] }`
 *
 * @param {any} json
 * @returns {RawCandidate[]}
 */
export function parseGarssInfo(json) {
  const arr = json?.garssInfo;
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => ({
    originRef: str(r?.sourceId),
    name: str(r?.title) || str(r?.sourceId),
    feedUrl: str(r?.xmlUrl),
    rawCategory: str(r?.category),
    description: str(r?.description),
  }));
}

/**
 * garss-studio 的 `storage/subscriptions.json` —— 全量 3398 条。
 *
 * ⚠️ 其中 **3123 条是「RSSHub 文档 / *」目录项**（`enabled:false`），
 * 它们是 RSSHub 官方路由文档，绝大多数需要自建实例才能用，**不是可直接采集的
 * feed URL**。默认只取 `enabled:true` 的 275 条（= 主理人真正在用的集合）。
 *
 * @param {any} json
 * @param {{ onlyEnabled?: boolean, includeRsshubCatalog?: boolean }} [opts]
 * @returns {RawCandidate[]}
 */
export function parseGarssSubscriptions(json, opts = {}) {
  const arr = Array.isArray(json) ? json : (json?.subscriptions || json?.data || json?.list);
  if (!Array.isArray(arr)) return [];
  const onlyEnabled = opts.onlyEnabled !== false;
  const includeCatalog = opts.includeRsshubCatalog === true;

  return arr
    .filter((r) => {
      if (onlyEnabled && r?.enabled !== true) return false;
      const cat = str(r?.category);
      if (!includeCatalog && cat.startsWith(RSSHUB_DOC_PREFIX)) return false;
      return true;
    })
    .map((r) => ({
      originRef: str(r?.id),
      name: str(r?.name) || str(r?.id),
      // routePath 是绝对 URL；routeTemplate 可能是 RSSHub 模板（含 /:param 占位），不可直接抓
      feedUrl: str(r?.routePath),
      rawCategory: str(r?.category),
      description: str(r?.description),
    }));
}

/**
 * 本仓库 `export-channels.mjs` 产出的注册表导出（`rss-radar/channel-registry`）。
 * 这是「导出 → 导入 → 再导出」幂等门禁的回灌入口，也是**备份还原**入口。
 *
 * 两条要点：
 *   ① 一个渠道可能挂**多条 feed**，所以按 `feeds[]` 展开成多条候选 ——
 *      只读单个 `feedUrl` 会把多源渠道还原成单源，属于静默丢数据。
 *   ② 导出里带 `id` / `weight` / `displayLimit` / `icon` / `enabled` 等
 *      **派生字段**。这些本来是 merge 时算出来的，还原时必须靠 `_preset`
 *      原样带回去，否则回灌出来的注册表与导出对不上（逐字节幂等就成了空话）。
 *
 * @param {any} json
 * @returns {RawCandidate[]}
 */
export function parseRegistryExport(json) {
  const arr = json?.channels;
  if (!Array.isArray(arr)) return [];

  const out = [];
  for (const c of arr) {
    const channelPreset = {
      id: str(c?.id) || undefined,
      icon: str(c?.icon) || undefined,
      weight: typeof c?.weight === 'number' ? c.weight : undefined,
      displayLimit: Number.isInteger(c?.displayLimit) ? c.displayLimit : undefined,
      enabled: typeof c?.enabled === 'boolean' ? c.enabled : undefined,
      language: str(c?.language) || undefined,
      importBatch: str(c?.importBatch) || undefined,
    };
    const base = {
      name: str(c?.name),
      rawCategory: Array.isArray(c?.category) ? c.category.join(',') : str(c?.category),
      description: str(c?.description),
      homepage: str(c?.homepage) || undefined,
      _presetCategory: Array.isArray(c?.category) ? c.category.slice() : undefined,
      _presetTags: Array.isArray(c?.tags) ? c.tags.slice() : undefined,
      // 渠道级溯源（不是 feed 级 —— feed 级走 _preset.sourceOrigin*）
      // ⚠️ 字段名必须是 `origin`：cleanCandidates 从 `item.origin` 读它并转存为
      //    `_origin`。这里若写 `_origin`，会被 cleanCandidates 用 item.origin（undefined）
      //    覆盖掉 —— 实测踩到过（渠道级 origin 在往返中静默丢失，而 originRef /
      //    importBatch 因为走 `_preset` 而安然无恙，很容易被误判为"导出丢字段"）。
      origin: str(c?.origin) || undefined,
      originRef: str(c?.originRef) || undefined,
    };

    // 优先按 feeds[] 展开；缺失则退回单条 feedUrl（兼容只有 feedUrl 的旧导出）
    const feeds = Array.isArray(c?.feeds) && c.feeds.length > 0
      ? c.feeds
      : (c?.feedUrl ? [{ url: c.feedUrl }] : []);

    for (const f of feeds) {
      out.push({
        ...base,
        // ⚠️ 候选的 `name` 是**渠道名**，不是 feed 名。
        // merge 用它来命名 channel；feed 自己的名字走 preset.name 去命名 source。
        // 这里若填 feed 名，多源渠道的渠道名会被最后一条 feed 覆盖掉（实测踩过）。
        name: base.name,
        feedUrl: str(f?.url) || str(c?.feedUrl),
        _preset: {
          ...channelPreset,
          sourceId: str(f?.id) || undefined,
          interval: Number.isInteger(f?.interval) ? f.interval : undefined,
          // ★ 源开关独立于渠道开关：配置里存在「渠道开着、其中某条 feed 关着」的合法状态。
          //   这里若写进 `enabled` 会把渠道一起关掉（实测踩过，32 个渠道错了 2 个）。
          sourceEnabled: typeof f?.enabled === 'boolean' ? f.enabled : undefined,
          name: str(f?.name) || undefined,
          language: str(f?.language) || channelPreset.language,
          sourceOrigin: str(f?.origin) || undefined,
          sourceOriginRef: str(f?.originRef) || undefined,
          sourceImportBatch: str(f?.importBatch) || undefined,
          lastStatus: str(f?.lastStatus) || undefined,
          lastFetchAt: str(f?.lastFetchAt) || undefined,
          lastError: str(f?.lastError) || undefined,
        },
      });
    }
  }
  return out;
}

/**
 * 容错 OPML 解析（标准格式，便于将来接其他 RSS 阅读器的导出）。
 * 不引 XML 依赖：OPML 的形状足够规整，手写扫描比拖一个库更可控。
 *
 * @param {string} xml
 * @returns {RawCandidate[]}
 */
export function parseOpml(xml) {
  if (typeof xml !== 'string' || !xml.includes('<outline')) return [];
  const out = [];
  const stack = [];
  const tagRe = /<(\/?)outline\b([^>]*?)(\/?)>/gi;
  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    const isClose = m[1] === '/';
    const attrs = parseAttrs(m[2] || '');
    const selfClosing = m[3] === '/';
    if (isClose) {
      stack.pop();
      continue;
    }
    const xmlUrl = attrs.xmlurl || attrs.xmlUrl;
    const label = attrs.title || attrs.text || '';
    if (xmlUrl) {
      out.push({
        originRef: attrs['rssradar:id'] || '',
        name: label || hostFallback(xmlUrl),
        feedUrl: xmlUrl,
        rawCategory: stack[stack.length - 1] || attrs.category || '',
        description: attrs.description || '',
      });
      if (!selfClosing) stack.push(label);
    } else if (!selfClosing) {
      stack.push(label);
    }
  }
  return out;
}

function parseAttrs(s) {
  const attrs = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(s)) !== null) attrs[m[1].toLowerCase()] = decodeXml(m[2]);
  return attrs;
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function hostFallback(u) {
  try { return new URL(u).hostname; } catch { return u; }
}

/**
 * 按内容 + 文件名猜格式。**内容优先**：同一个 `.json` 可能是 garssInfo
 * 也可能是本仓库的注册表导出，看结构比看扩展名可靠。
 *
 * @param {string} text
 * @param {string} fileName
 * @returns {'garss-info'|'garss-subscriptions'|'registry-export'|'opml'|'unknown'}
 */
export function detectFormat(text, fileName = '') {
  const name = String(fileName).toLowerCase();
  if (name.endsWith('.opml') || /<opml\b/i.test(text)) return 'opml';
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return 'unknown';
  }
  if (Array.isArray(json?.garssInfo)) return 'garss-info';
  if (json?.format === 'rss-radar/channel-registry' || Array.isArray(json?.channels)) {
    return 'registry-export';
  }
  if (Array.isArray(json)) return 'garss-subscriptions';
  if (Array.isArray(json?.subscriptions)) return 'garss-subscriptions';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// 阶段 1：清洗
// ---------------------------------------------------------------------------

/**
 * 渠道主页的**唯一**解析处。
 *
 * 为什么要在清洗阶段就把它定死，而不是留给 `mergeIntoRegistry` 自己的兜底？
 *
 * 因为「本轮开哪 60 个渠道」是按**主页**分组来选取的（同主页的多个 feed 共用一个
 * 渠道，只占一个名额）。选取处与合并处若各算一次，规则一旦漂移，就会出现
 * 「说好开 60 个、实际只开了 37 个」这种静默偏差 —— 已实测踩到过。
 * 定死一次，两边读同一个字段，漂移的可能性直接归零。
 *
 * 兜底值由 `deriveHomepageFromFeed` 统一给出（栏目级，而非裸 host），两边**共用
 * 同一个纯函数**，所以"定死"是结构上的，不靠约定。
 *
 * @param {string} explicit      输入里显式给的主页
 * @param {string} normalizedUrl 归一化后的 feed URL
 * @param {string|null} rewrittenUrl 若由 RSSHub 路径改写而来，则是改写后的 URL
 * @returns {string}
 */
function resolveHomepage(explicit, normalizedUrl, rewrittenUrl) {
  if (explicit) return explicit;
  // RSSHub 改写地址：`rsshub.app` 已在 HOSTED_FEED_HOSTS 里，本函数与内核走的是
  // 同一条规则，因此这里直接返回改写后的完整 URL。从前"65 条 route 会全部落到
  // https://rsshub.app、塌成一个名叫 rsshub 的巨型渠道"的隐患，现在统一由清单
  // 兜住 —— 将来换自建实例域名，只需往清单加一条，不必回来改这里。
  if (rewrittenUrl) return rewrittenUrl;
  // 唯一兜底处：从 feed URL 推断**栏目级**主页（旧实现用 originOf 丢掉整个路径，
  // 导致同站不同栏目 / 托管站不同刊物被压成一条渠道）。判据与 mergeIntoRegistry
  // 共用同一个纯函数，避免"选取处与合并处各算一次、规则漂移"。
  return deriveHomepageFromFeed(normalizedUrl) || normalizedUrl;
}

/**
 * 清洗候选集。**纯函数**：不发请求、不读文件，便于单测穷举边界。
 *
 * 顺序即优先级 —— 先判「能不能用」，再归一化，最后批内去重（保留首个）。
 *
 * @param {RawCandidate[]} raw
 * @param {{ rsshubBase?: string, dropInternal?: boolean }} [opts]
 *   `dropInternal` **缺省为 true**：Docker 内网地址（`http://rsshub:1200/...`）
 *   是 garss 自建实例的路由，公网 DNS 解析不到，直搬必然 100% 失败。
 *   传 `false`（CLI 的 `--keep-internal`）才改写成公共实例并纳入体检。
 * @returns {{ kept: CleanCandidate[], dropped: Array<{name:string,feedUrl:string,reason:string,originRef?:string}> }}
 */
export function cleanCandidates(raw, opts = {}) {
  const rsshubBase = (opts.rsshubBase ?? DEFAULT_RSSHUB_BASE).replace(/\/+$/, '');
  const dropInternal = opts.dropInternal !== false;

  const kept = [];
  const dropped = [];
  const seen = new Map(); // 归一化 URL → 首个候选名（用于报告「和谁重了」）

  for (const item of Array.isArray(raw) ? raw : []) {
    const name = str(item?.name);
    const originRef = str(item?.originRef);
    let url = str(item?.feedUrl);

    if (!url) {
      dropped.push({ name, feedUrl: '', reason: CLEAN_REASONS.MISSING_URL, originRef });
      continue;
    }

    // —— RSSHub 路径型 / 内网地址 → 丢弃，或改写成公共实例 ——
    const rewritten = rewriteRsshubUrl(url, rsshubBase);
    if (rewritten) {
      if (dropInternal) {
        dropped.push({ name, feedUrl: url, reason: CLEAN_REASONS.INTERNAL_DROPPED, originRef });
        continue;
      }
      url = rewritten.url;
    }

    // —— 只接受绝对 http(s) ——
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      dropped.push({ name, feedUrl: url, reason: CLEAN_REASONS.INVALID_URL, originRef });
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      dropped.push({ name, feedUrl: url, reason: CLEAN_REASONS.UNSUPPORTED_PROTOCOL, originRef });
      continue;
    }

    const normalized = normalizeFeedUrl(url);
    if (!normalized) {
      dropped.push({ name, feedUrl: url, reason: CLEAN_REASONS.INVALID_URL, originRef });
      continue;
    }

    // —— 批内去重：同归一化 URL 只留首个 ——
    if (seen.has(normalized)) {
      dropped.push({
        name,
        feedUrl: normalized,
        reason: CLEAN_REASONS.DUPLICATE_IN_BATCH,
        originRef,
        duplicateOf: seen.get(normalized),
      });
      continue;
    }
    seen.set(normalized, name || normalized);

    kept.push({
      originRef,
      name: name || hostFallback(normalized),
      feedUrl: normalized,
      // 主页在清洗阶段定死，见 resolveHomepage 的说明
      homepage: resolveHomepage(str(item?.homepage), normalized, rewritten ? normalized : null),
      rawCategory: str(item?.rawCategory),
      description: str(item?.description),
      // 溯源：改写自 RSSHub 路径型的，来源就是 rsshub-doc，不是 garss 原生 feed
      fromRsshubRewrite: rewritten ? true : undefined,
      _presetCategory: item?._presetCategory,
      _presetTags: item?._presetTags,
      // 恢复备份用：原样带回 id / weight / enabled 等派生字段
      _preset: item?._preset,
      _origin: str(item?.origin) || undefined,
    });
  }

  return { kept, dropped };
}

/**
 * 把 RSSHub 形态的地址改写成公共实例下的绝对 URL。
 *
 * 命中三种形态：
 *   ① `http://rsshub:1200/iplay/home`      → `https://rsshub.app/iplay/home`
 *   ② `/1point3acres/section/379/hot`      → `https://rsshub.app/1point3acres/section/379/hot`
 *   ③ 任意 host 在 INTERNAL_HOST_RE 里的地址
 *
 * 刻意**只改写主机，不动路径** —— 路径是 RSSHub 的路由契约，改了就抓错内容。
 *
 * @returns {{ url: string, kind: 'internal'|'path-only' } | null} 未命中返回 null
 */
export function rewriteRsshubUrl(url, rsshubBase = DEFAULT_RSSHUB_BASE) {
  const base = String(rsshubBase).replace(/\/+$/, '');

  // 形态 ②：纯路径
  if (url.startsWith('/')) {
    return { url: base + url, kind: 'path-only' };
  }

  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!INTERNAL_HOST_RE.test(u.hostname)) return null;

  const path = u.pathname + u.search;
  return { url: base + (path.startsWith('/') ? path : `/${path}`), kind: 'internal' };
}

// ---------------------------------------------------------------------------
// 阶段 2：分类映射（fail-closed）
// ---------------------------------------------------------------------------

/**
 * 原始中文分类 → 受控 CategoryKey。
 * **未命中不猜**：落到 `other` 并记 `unknown`，让报告把「待人工归类」的清单吐出来。
 *
 * @param {string} rawCategory
 * @returns {{ category: string[], tags: string[], known: boolean }}
 */
export function mapCategory(rawCategory) {
  const raw = str(rawCategory).trim();
  if (!raw) return { category: ['other'], tags: [], known: false };

  // 允许逗号分隔的多分类（注册表导出是数组，join 过）
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const mapped = [];
  for (const p of parts) {
    const key = GARSS_CATEGORY_MAP[p];
    if (key) {
      if (!mapped.includes(key)) mapped.push(key);
    } else if (ENABLED_CATEGORIES.includes(p)) {
      // 已经是受控 key（回灌注册表导出时会走到这里）
      if (!mapped.includes(p)) mapped.push(p);
    }
  }

  const known = mapped.length > 0;
  if (!known) return { category: ['other'], tags: [raw], known: false };
  // 原始分类名进 tags[]：受控分类驱动筛选，自由标签保留可检索性
  return { category: mapped, tags: [raw], known: true };
}

// ---------------------------------------------------------------------------
// 放量排序：防止单一分类在前 60 个里刷屏
// ---------------------------------------------------------------------------

/**
 * 按主分类轮转交错。
 *
 * 为什么必须做这件事？garss 里 `活着的个人独立博客` 一类就占 129/281（46%）。
 * 若按原顺序取前 60，开出来的将**几乎全是个人博客**，热榜会被单一品类刷屏，
 * 而且「先开 60 个」的多样性验证价值归零。
 *
 * 轮转保证：前 N 个尽可能覆盖所有分类，比例均衡。
 *
 * @template {{ category: string[] }} T
 * @param {T[]} items  每项需已含 `category` 字段
 * @returns {T[]} 新数组（不改入参）
 */
export function orderForRollout(items) {
  const buckets = new Map();
  for (const it of items) {
    const key = (Array.isArray(it.category) && it.category[0]) || 'other';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(it);
  }
  const keys = [...buckets.keys()];
  const out = [];
  let drained = false;
  while (!drained) {
    drained = true;
    for (const k of keys) {
      const q = buckets.get(k);
      if (q.length > 0) {
        out.push(q.shift());
        drained = false;
      }
    }
  }
  return out;
}

/**
 * 把注册表里**已存在**的 source.url 收敛到规范形态。
 *
 * ── 为什么必须做 ──────────────────────────────────────────────────────
 *
 * 「不要重复请求同一个渠道」的充要条件是 URL 唯一，而 URL 唯一的判据是
 * `normalizeFeedUrl`。可历史遗留的 `config/sources.json` 里存在非规范形态：
 *
 *     https://www.appinn.com/feed/          ← 带尾斜杠
 *     https://iui.su/feed/
 *     ...forum.php?mod=guide&view=hot&rss=1 ← query 未按 key 排序
 *
 * 存储形态 ≠ 去重键形态，意味着**同一个源的两种写法可以同时躺在配置里而
 * 谁都不报警**。导入管线每次跑都会把新条目写成规范形态，老条目却不会动，
 * 于是两份口径永久并存 —— 这正是主理人要求消灭的「一致性 / 重复问题」。
 *
 * ── 为什么安全 ────────────────────────────────────────────────────────
 *
 * `normalizeFeedUrl` 只做**语义等价**的改写（小写 host、去默认端口、去 fragment、
 * 剥跟踪参数、query 字典序重排、去尾斜杠），不猜协议、不猜 www。
 * 它改的是同一个资源，不会抓错内容。
 *
 * ── 冲突即报警，不静默合并 ────────────────────────────────────────────
 *
 * 若两条来源归一化后撞成同一个 URL，那就是**真的重复**，交给调用方报出去让人处理，
 * 绝不在这里悄悄删掉一条。宁可报警，不可乱删。
 *
 * @param {Object} config 注册表（**就地修改**）
 * @returns {{ changed: Array<{id:string,from:string,to:string}>, conflicts: Array<{url:string,ids:string[]}> }}
 */
export function canonicalizeSourceUrls(config) {
  const sources = Array.isArray(config?.sources) ? config.sources : [];

  // 先建全量索引：归一化后撞车要能判出来，不能只看「改过的那几条」
  const seen = new Map();
  const conflicts = [];
  for (const s of sources) {
    const n = normalizeFeedUrl(s?.url);
    if (!n) continue;
    if (seen.has(n) && seen.get(n) !== s.id) {
      conflicts.push({ url: n, ids: [seen.get(n), s.id] });
    } else if (!seen.has(n)) {
      seen.set(n, s.id);
    }
  }

  const changed = [];
  for (const s of sources) {
    const before = s?.url;
    const after = normalizeFeedUrl(before);
    if (!after || after === before) continue;
    // 撞车的条目保持原样，避免把两条来源改成同一个 URL 制造出新的重复
    if (conflicts.some((c) => c.ids.includes(s.id))) continue;
    s.url = after;
    changed.push({ id: s.id, from: before, to: after });
  }

  return { changed, conflicts };
}

/**
 * 按「主页」把候选分成三组，供放量决策使用。
 *
 * 为什么不能直接把 `enabledCount` 丢给 `mergeIntoRegistry`？
 * 因为它数的是**条目**，而一个渠道可以挂多个 feed（同主页的不同 feed 共用一个
 * channel）。实测：名额给 60，实际只开出 **37** 个渠道 —— 另外 23 个名额被
 * 「同一渠道的第 2、3 个 feed」吃掉了。用户要的是「先开 60 个渠道」，不是
 * 「先开 60 个 feed」。
 *
 * 三组的语义：
 *   - `chosen`    **新建**渠道，占放量名额，落 `enabled: true`
 *   - `rideAlong` 主页**已存在于现有注册表**（如 V2EX 加第二个 feed）。
 *                 这类不占名额 —— 渠道早就有了，它的开/关是人工决定，
 *                 导入不该擅自翻动。它们的新 source 跟随该渠道当前状态。
 *   - `rest`      本轮没名额，停用留档
 *
 * @template {{ homepage: string, feedUrl: string }} T
 * @param {T[]} items   交错排序后的候选
 * @param {number} n    要开闸的**新渠道**数
 * @param {Set<string>} [existingHomepages] 现有注册表里的主页（已归一化）
 * @returns {{ chosen: T[], rideAlong: T[], rest: T[] }}
 */
export function selectRollout(items, n, existingHomepages = new Set()) {
  const list = Array.isArray(items) ? items : [];
  if (!Number.isInteger(n) || n <= 0) return { chosen: [], rideAlong: [], rest: list.slice() };

  const seen = new Set(); // 本次已入选的新主页
  const chosen = [];
  const rideAlong = [];
  const rest = [];

  for (const it of list) {
    const key = normalizeHomepage(it.homepage) || it.homepage || it.feedUrl;
    if (existingHomepages.has(key)) {
      rideAlong.push(it); // 已有渠道：不占名额，不擅自开关
    } else if (seen.has(key)) {
      chosen.push(it); // 本轮已选中的新渠道：同主页其余 feed 一起开
    } else if (seen.size < n) {
      seen.add(key);
      chosen.push(it);
    } else {
      rest.push(it);
    }
  }
  return { chosen, rideAlong, rest };
}

/**
 * 后置放量：把 `chosen` 里的主页对应的渠道**及其全部 source**打开，
 * 让 `rideAlong` 的新 source 跟随其所属渠道的当前开关。
 *
 * 为什么不交给 `mergeIntoRegistry` 的 `enabledCount` 一步到位？
 * 因为它的计数器是「按条目递增」的全局状态，而我们要的是「按主页分组」的
 * 精确控制：同一渠道的多条 feed 必须同开同关，且已有渠道不能被导入擅自翻动。
 * 放在这里显式做，规则一眼可见，也不用再和 merge 的计数器语义博弈。
 *
 * @param {Object} config 已合并好的注册表（**就地修改**）
 * @param {{ chosen: Array, rideAlong: Array }} groups
 * @returns {string[]} 被打开的渠道 id
 */
export function enableRollout(config, { chosen = [], rideAlong = [] } = {}) {
  const channels = config.channels || [];
  const sources = config.sources || [];
  const byHomepage = new Map();
  for (const c of channels) {
    const h = normalizeHomepage(c.homepage);
    if (h && !byHomepage.has(h)) byHomepage.set(h, c);
  }

  const enabledIds = new Set();
  for (const it of chosen) {
    const key = normalizeHomepage(it.homepage) || it.homepage || it.feedUrl;
    const ch = byHomepage.get(key);
    if (!ch) continue;
    ch.enabled = true;
    for (const s of sources) if (s.channelId === ch.id) s.enabled = true;
    enabledIds.add(ch.id);
  }

  // 搭车的：不改变渠道开关，只让新挂上去的 source 跟渠道保持一致
  for (const it of rideAlong) {
    const key = normalizeHomepage(it.homepage) || it.homepage || it.feedUrl;
    const ch = byHomepage.get(key);
    if (!ch) continue;
    const state = ch.enabled !== false;
    for (const s of sources) if (s.channelId === ch.id) s.enabled = state;
  }

  return [...enabledIds];
}

// ---------------------------------------------------------------------------
// 阶段 3：体检
// ---------------------------------------------------------------------------

/** feed 内容的特征标记。命中任一即认为「这确实是个 feed」 */
const FEED_MARKERS = ['<rss', '<feed', '<rdf:rdf', 'jsonfeed.org/version'];

/** 纯函数：判定一段响应文本是否像 feed（单测直接喂字符串） */
export function sniffFeedMarker(text) {
  if (typeof text !== 'string' || !text) return false;
  const head = text.slice(0, 8192).toLowerCase();
  return FEED_MARKERS.some((m) => head.includes(m));
}

/**
 * 对候选 URL 做健康检查。复用采集端同一套六态机，避免两套判定标准漂移。
 *
 * ⚠️ `checkUrls` 的 `max` 缺省是 **200**，候选超过 200 会被静默截断 —— 必须显式传入。
 *
 * @param {Array<{feedUrl:string}>} candidates
 * @param {{ _fetch?: Function, concurrency?: number, sniff?: boolean }} [opts]
 * @returns {Promise<{ byUrl: Map<string, {status:string, httpStatus?:number, latencyMs?:number, error?:string}>, stats: object, truncated: number }>}
 */
export async function runHealth(candidates, opts = {}) {
  const urls = candidates.map((c) => c.feedUrl);
  if (urls.length === 0) {
    return { byUrl: new Map(), stats: { total: 0 }, truncated: 0 };
  }

  const { records, stats } = await checkUrls(urls, {
    concurrency: opts.concurrency ?? 4,
    perHostIntervalMs: opts.perHostIntervalMs ?? 1000,
    timeoutMs: opts.timeoutMs ?? 10000,
    max: urls.length, // ← 必须显式给，见上
    _fetch: opts._fetch,
  });

  const byUrl = new Map();
  for (const rec of records) byUrl.set(rec.url, rec);
  return { byUrl, stats, truncated: stats.overflow ?? 0 };
}

/**
 * 深度嗅探：对状态 ok/moved 的 URL 拉前面几 KB，看是不是真的 feed。
 *
 * ⚠️ **实测结论：这只是「参考信号」，不能当硬门禁。**
 * 2026-09-16 拿 30 个已知真实 feed 做对照实验，三种 UA（无 UA / 采集端 bot UA /
 * 浏览器 UA）的「非 feed」比例分别是 10 / 11 / 12（差异不显著），但**逐条对比有
 * 23/30 出现分歧**，且分歧散乱 —— 连 `ruanyifeng.com/blog/atom.xml` 这种铁定
 * 是 feed 的地址都会在某些轮次被判 ✗。说明这个信号主要被**网络抖动**（超时、
 * 连接重置、限流）主导，而不是站点策略。
 *
 * 所以调用方只拿它做两件事：**给放量排序加权**、**输出人工复核清单**。
 * 拿它去排除候选，会误杀大量真实可用的源。
 *
 * UA 刻意用**采集端的那一个**（`DEFAULT_UA`），而不是体检用的浏览器 UA ——
 * 这样嗅到的成败才等于「采集时真实会遇到的情况」。
 *
 * @param {string[]} urls
 * @param {{ _fetch?: Function, timeoutMs?: number, concurrency?: number,
 *            retries?: number, userAgent?: string }} [opts]
 * @returns {Promise<Map<string, {isFeed:boolean, httpStatus?:number, attempts:number, error?:string}>>}
 */
export async function sniffUrls(urls, opts = {}) {
  const doFetch = opts._fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const retries = Number.isInteger(opts.retries) ? opts.retries : 2;
  const userAgent = opts.userAgent ?? DEFAULT_UA;
  const byUrl = new Map();

  const queue = urls.slice();
  const concurrency = opts.concurrency ?? 4;
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, Math.max(queue.length, 1)); i += 1) {
    workers.push((async () => {
      for (;;) {
        const url = queue.shift();
        if (!url) return;
        let last = { isFeed: false, attempts: 0 };
        for (let attempt = 1; attempt <= retries; attempt += 1) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeoutMs);
          const startedAt = Date.now();
          let timedOut = false;
          try {
            const res = await doFetch(url, {
              signal: ctrl.signal, redirect: 'follow',
              headers: { 'User-Agent': userAgent, Accept: '*/*' },
            });
            const text = (await res.text()).slice(0, 8192);
            last = { isFeed: sniffFeedMarker(text), httpStatus: res.status, attempts: attempt };
            // 一次成功就定案（内容已经拿到，重试不会带来额外信息）
            break;
          } catch (err) {
            timedOut = ctrl.signal.aborted;
            last = { isFeed: false, attempts: attempt, error: String(err?.message || err).slice(0, 200) };
          } finally {
            clearTimeout(timer);
          }
          // **quick retry**（与 src/services/dataClient.ts 同一原则）：
          // 只重试「快速失败」（连接被拒 / DNS 失败 / 瞬时重置），
          // **超时不重试** —— 慢站点重试一次就是再等一整个 timeout，
          // 最坏情况把总耗时翻倍，而它下次大概率还是慢。
          const elapsed = Date.now() - startedAt;
          if (timedOut || elapsed >= 1000) break;
        }
        byUrl.set(url, last);
      }
    })());
  }
  await Promise.all(workers);
  return byUrl;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function str(v) {
  return typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim());
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function nowIsoFixed() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 健康状态是否够格被「开闸」 */
const ENABLEABLE_STATUS = new Set(['ok', 'moved']);

async function loadInput(opts) {
  // ① 显式文件
  if (opts.file) {
    const text = await readFile(resolve(opts.file), 'utf8');
    return { text, fileName: basename(opts.file), format: detectFormat(text, opts.file) };
  }
  // ② --from garss：按优先级挑数据源
  if (opts.from === 'garss') {
    const dir = opts.garssDir || DEFAULT_GARSS_DIR;
    const infoPath = join(dir, 'garssInfo.json');
    const subPath = join(dir, 'garss-studio/storage/subscriptions.json');

    if ((opts.dataset === 'subscriptions' || opts.dataset === 'subscriptions-all') && existsSync(subPath)) {
      return { text: await readFile(subPath, 'utf8'), fileName: 'subscriptions.json', format: 'garss-subscriptions' };
    }
    if (existsSync(infoPath)) {
      return { text: await readFile(infoPath, 'utf8'), fileName: 'garssInfo.json', format: 'garss-info' };
    }
    if (existsSync(subPath)) {
      return { text: await readFile(subPath, 'utf8'), fileName: 'subscriptions.json', format: 'garss-subscriptions' };
    }
    throw new Error(`在 ${dir} 下找不到 garssInfo.json 或 garss-studio/storage/subscriptions.json`);
  }
  throw new Error('必须指定 --file <path> 或 --from garss');
}

function parseByFormat(text, format, opts) {
  switch (format) {
    case 'garss-info': return parseGarssInfo(JSON.parse(text));
    case 'garss-subscriptions':
      return parseGarssSubscriptions(JSON.parse(text), {
        onlyEnabled: opts.dataset !== 'subscriptions-all',
        includeRsshubCatalog: opts.includeRsshubCatalog === true,
      });
    case 'registry-export': return parseRegistryExport(JSON.parse(text));
    case 'opml': return parseOpml(text);
    default: throw new Error('无法识别的输入格式（支持 garssInfo.json / subscriptions.json / 注册表导出 / OPML）');
  }
}

export async function mainCli(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  const startedAt = Date.now();
  const now = opts.now || nowIsoFixed();
  const batch = opts.batch || `garss-${now.slice(0, 7)}`;

  // ---- 阶段 0：解析 ----
  const input = await loadInput(opts);
  if (input.format === 'unknown') {
    throw new Error(`无法识别的输入格式：${input.fileName}`);
  }
  const raw = parseByFormat(input.text, input.format, opts);
  // 回灌本仓库自己的导出 = 还原备份。这个判定影响两处关键行为：
  //   ① 不跑放量逻辑（开关已在 preset 里）
  //   ② 不重排（channel id 由创建顺序决定，重排会让 id 对不上）
  const isRestore = input.format === 'registry-export';
  console.log(`[0/4] 解析  ${input.fileName}（${input.format}）→ ${raw.length} 条原始候选${isRestore ? '  [还原模式]' : ''}`);

  // ---- 阶段 1：清洗 ----
  const { kept, dropped } = cleanCandidates(raw, {
    rsshubBase: opts.rsshubBase,
    dropInternal: opts.dropInternal,
  });
  const dropStats = countBy(dropped, (d) => d.reason);
  console.log(`[1/4] 清洗  保留 ${kept.length} / 丢弃 ${dropped.length}  ${fmtCounts(dropStats)}`);

  // ---- 阶段 2：分类映射 ----
  const mapped = kept.map((c) => {
    const m = c._presetCategory && c._presetCategory.length > 0
      ? { category: c._presetCategory.slice(), tags: c._presetTags || [], known: true }
      : mapCategory(c.rawCategory);
    return {
      ...c,
      category: m.category,
      tags: m.tags,
      categoryKnown: m.known,
    };
  });
  const unknownCats = [...new Set(mapped.filter((m) => !m.categoryKnown).map((m) => m.rawCategory))].filter(Boolean);
  console.log(`[2/4] 分类  已映射 ${mapped.length - mapped.filter((m) => !m.categoryKnown).length} / 未命中 ${mapped.filter((m) => !m.categoryKnown).length}${unknownCats.length ? `（${unknownCats.join(' / ')}）` : ''}`);
  console.log(`      分类分布  ${fmtCounts(countBy(mapped, (m) => m.category[0]))}`);

  // ---- 阶段 3：体检 ----
  let healthByUrl = new Map();
  let healthStats = null;
  let sniffed = new Map();
  if (opts.skipHealth) {
    console.log('[3/4] 体检  已跳过（--skip-health）→ 全部按 unknown 处理');
  } else {
    process.stdout.write(`[3/4] 体检  ${mapped.length} 个 URL 探测中`);
    const t = setInterval(() => process.stdout.write('.'), 3000);
    try {
      const h = await runHealth(mapped, opts);
      healthByUrl = h.byUrl;
      healthStats = h.stats;
      if (h.truncated > 0) console.log(`\n      ⚠️  有 ${h.truncated} 个 URL 未被检查（超出 max）`);
    } finally {
      clearInterval(t);
      process.stdout.write('\n');
    }
    console.log(`      结果  ${fmtCounts(pickStats(healthStats))}`);

    if (opts.sniff) {
      const okUrls = mapped
        .filter((c) => ENABLEABLE_STATUS.has(healthByUrl.get(c.feedUrl)?.status))
        .map((c) => c.feedUrl);
      if (okUrls.length > 0) {
        process.stdout.write(`      深度嗅探 ${okUrls.length} 个（参考信号，不作过滤门禁）`);
        const st = setInterval(() => process.stdout.write('.'), 3000);
        try {
          sniffed = await sniffUrls(okUrls, opts);
        } finally {
          clearInterval(st);
          process.stdout.write('\n');
        }
        const notFeed = [...sniffed.values()].filter((v) => !v.isFeed).length;
        const exhausted = [...sniffed.values()].filter((v) => !v.isFeed && v.error).length;
        console.log(`      未识别为 feed ${notFeed} 个（其中 ${exhausted} 个是请求失败，非站点策略）`);
        console.log(`      ↳ 仅用于排序加权与人工复核，不排除任何候选（见 sniffUrls 注释）`);
      }
    }
  }

  // ---- 分组：够格开闸的 vs 仅供留档的 ----
  //
  // 判定只看 URL 状态机（ok / moved）。**刻意不看 feed 嗅探结果** ——
  // 实测证明那个信号被网络抖动主导，拿它当门禁会误杀真实可用的源。
  const eligible = [];
  const ineligible = [];
  for (const c of mapped) {
    const h = healthByUrl.get(c.feedUrl);
    const status = h?.status ?? 'unknown';
    const pass = opts.skipHealth ? true : ENABLEABLE_STATUS.has(status);
    const entry = { ...c, _health: { status: opts.skipHealth ? 'unknown' : status, httpStatus: h?.httpStatus, latencyMs: h?.latencyMs } };
    if (opts.skipHealth) entry._health.status = 'unknown';
    (pass ? eligible : ineligible).push(entry);
  }

  // 放量排序：先让「嗅探确认像 feed」的排到各自分类的前面（稳定排序，不打乱同组内原序），
  // 再按分类交错。这样名额既优先给到质量信号最好的候选，又保持品类多样性。
  const sniffRank = (c) => (sniffed.size === 0 ? 0 : (sniffed.get(c.feedUrl)?.isFeed ? 0 : 1));
  const eligibleRanked = [...eligible].sort((a, b) => sniffRank(a) - sniffRank(b));

  // 还原模式保序；放量导入才按分类交错（见 orderForRollout 注释）
  const eligibleOrdered = isRestore ? eligible : orderForRollout(eligibleRanked);
  const ineligibleOrdered = isRestore ? ineligible : orderForRollout(ineligible);

  // ---- 阶段 4：合并 + 落盘 ----
  const existing = JSON.parse(await readFile(SOURCES_PATH, 'utf8'));
  const beforeAudit = auditRegistry(existing);

  const enableCount = opts.enable == null ? 60 : opts.enable;
  const existingHomepages = new Set(
    (existing.channels || [])
      .map((c) => normalizeHomepage(c.homepage))
      .filter(Boolean),
  );
  // 回灌导出 = 还原备份，不是放量导入：开关已在 preset 里带回，不能再跑一遍放量覆盖
  const { chosen, rideAlong, rest } = isRestore
    ? { chosen: [], rideAlong: [], rest: eligibleOrdered }
    : selectRollout(eligibleOrdered, enableCount, existingHomepages);

  const toIncoming = (c) => ({
    name: c.name,
    homepage: c.homepage,
    feedUrl: c.feedUrl,
    category: c.category,
    tags: c.tags,
    description: c.description,
    // 恢复备份时沿用导出里的 origin；garss 导入则按是否经 RSSHub 改写区分
    origin: c.fromRsshubRewrite ? 'rsshub-doc' : (c._origin || opts.origin || 'garss'),
    originRef: c.originRef || undefined,
    feedType: guessFeedType(c.feedUrl),
    preset: c._preset,
  });

  // 全部以 enabledCount:0 并入（一律先落成停用），开闸交给下面的 enableRollout 显式做。
  // 这样「开几个」的决策只有一处，不依赖 merge 内部那个按条目递增的计数器。
  const passA = mergeIntoRegistry(
    existing,
    [...chosen, ...rideAlong, ...rest].map(toIncoming),
    { now, batch, enabledCount: 0 },
  );
  const passB = mergeIntoRegistry(passA.config, ineligibleOrdered.map(toIncoming), {
    now, batch, enabledCount: 0,
  });

  const merged = passB.config;

  // 还原模式：把导出里的「渠道清单版本」也一并还原。
  // 否则 mergeIntoRegistry 会把它刷成 now，导出 → 导入 → 再导出 就不可能逐字节相同。
  if (isRestore) {
    const meta = safeParse(input.text);
    if (meta?.generatedAt) merged.generatedAt = meta.generatedAt;
  }

  // 放量：chosen 的渠道连同其全部 source 一起打开；rideAlong 跟随既有渠道状态
  const enabledChannelIds = enableRollout(merged, { chosen, rideAlong });

  // 健康状态写回（对齐 sources schema 的 lastStatus 语义）
  applyHealthToConfig(merged, healthByUrl, opts.skipHealth);

  // SSOT 收敛：把历史遗留的非规范 URL 拉齐到「去重键形态」。
  // 不做这一步，老条目与去重键就永久两套口径 —— 见 canonicalizeSourceUrls 注释。
  const canon = opts.noNormalize ? { changed: [], conflicts: [] } : canonicalizeSourceUrls(merged);

  const addedChannels = [...passA.report.addedChannels, ...passB.report.addedChannels];
  const addedSources = [...passA.report.addedSources, ...passB.report.addedSources];
  const skipped = [...passA.report.skipped, ...passB.report.skipped];
  const afterAudit = auditRegistry(merged);
  const enabledNewCount = enabledChannelIds.length;

  const report = {
    format: 'rss-radar/import-report',
    version: 1,
    batch,
    importedAt: now,
    input: { file: input.fileName, format: input.format, rawCount: raw.length },
    pipeline: {
      parsed: raw.length,
      cleaned: kept.length,
      dropped: dropped.length,
      dropReasons: dropStats,
      unknownCategory: unknownCats,
    },
    health: opts.skipHealth ? { skipped: true } : { ...pickStats(healthStats), sniffed: sniffed.size },
    // 嗅探只作参考，不进判定；未识别为 feed 的单独列出供人工复核
    sniffNotFeed: [...sniffed.entries()]
      .filter(([, v]) => !v.isFeed)
      .map(([url, v]) => ({ url, attempts: v.attempts, httpStatus: v.httpStatus, error: v.error })),
    p0: {
      eligible: eligible.length,
      ineligible: ineligible.length,
      enableBudget: enableCount,
      rideAlong: rideAlong.length,
      deferred: rest.length,
    },
    merge: {
      addedChannels: addedChannels.length,
      addedSources: addedSources.length,
      skipped: skipped.length,
      skipReasons: countBy(skipped, (s) => s.reason),
      newChannelIds: addedChannels,
    },
    auditBefore: { ok: beforeAudit.ok, counts: beforeAudit.counts, problems: nonEmptyProblems(beforeAudit.problems) },
    auditAfter: { ok: afterAudit.ok, counts: afterAudit.counts, problems: nonEmptyProblems(afterAudit.problems) },
    counts: {
      channelsBefore: existing.channels?.length ?? 0,
      sourcesBefore: existing.sources?.length ?? 0,
      channelsAfter: merged.channels?.length ?? 0,
      sourcesAfter: merged.sources?.length ?? 0,
      enabledChannelsAfter: merged.channels?.filter((c) => c.enabled !== false).length ?? 0,
      enabledSourcesAfter: merged.sources?.filter((s) => s.enabled !== false).length ?? 0,
    },
    // 本轮放量打开的新渠道（人工复核名单）
    enabledNow: enabledChannelIds,
    canonicalized: canon.changed,
    urlConflicts: canon.conflicts,
    dropped: dropped.slice(0, 200),
    skipped: skipped.slice(0, 200),
  };

  // ---- ajv 门禁：写盘前必须过 ----
  const errors = validateData('sources', merged);
  if (errors.length > 0) {
    report.schemaErrors = errors.slice(0, 20);
    console.error('\n❌ 合并结果未通过 sources schema 校验，拒绝写盘：');
    for (const e of report.schemaErrors) console.error(`   ${e.instancePath} ${e.message}`);
  }

  const outPath = resolve(opts.out || join(ROOT, 'tmp', `import-report-${batch}.json`));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  // ---- 打印摘要 ----
  console.log(`[4/4] 合并`);
  console.log(`      渠道  ${report.counts.channelsBefore} → ${report.counts.channelsAfter}  （新增 ${addedChannels.length}）`);
  console.log(`      源    ${report.counts.sourcesBefore} → ${report.counts.sourcesAfter}  （新增 ${addedSources.length}）`);
  console.log(`      开闸  新增渠道中启用 ${enabledNewCount} 个（名额 ${enableCount}，健康候选 ${eligible.length} 条 feed）`);
  if (skipped.length > 0) console.log(`      跳过  ${skipped.length}  ${fmtCounts(report.merge.skipReasons)}`);
  if (canon.changed.length > 0) {
    console.log(`      收敛  ${canon.changed.length} 条历史 URL 拉齐到去重键形态（如 ${canon.changed[0].from} → ${canon.changed[0].to}）`);
  }
  if (canon.conflicts.length > 0) {
    console.log(`      🔴 URL 撞车 ${canon.conflicts.length} 组：归一化后指向同一地址，需人工裁决（未自动合并）`);
    for (const c of canon.conflicts.slice(0, 5)) console.log(`         ${c.url}  ←  ${c.ids.join(' / ')}`);
  }
  if (!afterAudit.ok) {
    console.log(`      ⚠️  一致性审计：${fmtCounts(nonEmptyProblems(afterAudit.problems))}`);
  }
  console.log(`      报告  ${outPath}`);

  if (opts.write && errors.length === 0) {
    await writeFile(SOURCES_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    console.log(`\n✅ 已写入 config/sources.json（${((Date.now() - startedAt) / 1000).toFixed(1)}s）`);
  } else if (opts.write && errors.length > 0) {
    console.log('\n🚫 未写入（schema 校验未通过）');
    return 1;
  } else {
    console.log(`\n🔎 dry-run —— 未改动任何文件。加 --write 才会写入 config/sources.json`);
  }
  return 0;
}

/** 把健康检查结果写回 config 的对应 source（对齐 sources schema 的 lastStatus/lastError） */
function applyHealthToConfig(config, healthByUrl, skipHealth) {
  if (skipHealth) return;
  const bySourceId = new Map((config.sources || []).map((s) => [s.id, s]));
  for (const s of bySourceId.values()) {
    const rec = healthByUrl.get(normalizeFeedUrl(s.url));
    if (!rec) continue;
    s.lastFetchAt = rec.urlCheckedAt || s.lastFetchAt;
    s.lastStatus = rec.status === 'pendingDead' ? 'pendingDead' : rec.status;
    if (rec.error) s.lastError = String(rec.error).slice(0, 300);
    else delete s.lastError;
  }
}

function pickStats(stats) {
  if (!stats) return {};
  return {
    total: stats.total, checked: stats.checked,
    ok: stats.ok, moved: stats.moved, blocked: stats.blocked,
    dead: stats.dead, pendingDead: stats.pendingDead, unknown: stats.unknown,
  };
}

function countBy(arr, fn) {
  const m = {};
  for (const x of arr) {
    const k = fn(x) || '(none)';
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function fmtCounts(m) {
  const e = Object.entries(m || {}).filter(([, v]) => v > 0);
  return e.length === 0 ? '' : e.map(([k, v]) => `${k}=${v}`).join(' ');
}

/** auditRegistry().problems（{kind: arr[]}）→ {kind: n}，只留非空的 */
function nonEmptyProblems(problems) {
  const out = {};
  for (const [k, v] of Object.entries(problems || {})) {
    if (Array.isArray(v) && v.length > 0) out[k] = v.length;
  }
  return out;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--help': case '-h': o.help = true; break;
      case '--from': o.from = next(); break;
      case '--file': o.file = next(); break;
      case '--garss-dir': o.garssDir = next(); break;
      case '--dataset': o.dataset = next(); break;
      case '--rsshub-base': o.rsshubBase = next(); break;
      case '--origin': o.origin = next(); break;
      case '--batch': o.batch = next(); break;
      case '--now': o.now = next(); break;
      case '--enable': o.enable = Number(next()); break;
      case '--out': o.out = next(); break;
      case '--concurrency': o.concurrency = Number(next()); break;
      case '--write': o.write = true; break;
      case '--skip-health': o.skipHealth = true; break;
      case '--no-normalize': o.noNormalize = true; break;
      case '--sniff': o.sniff = true; break;
      case '--drop-internal': o.dropInternal = true; break;
      case '--keep-internal': o.dropInternal = false; break;
      case '--include-rsshub-catalog': o.includeRsshubCatalog = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`未知参数：${a}（--help 看用法）`);
    }
  }
  return o;
}

function printHelp() {
  console.log(`
将外部渠道清单幂等导入 config/sources.json。

用法
  node scripts/import-channels.mjs --from garss [选项]
  node scripts/import-channels.mjs --file <path> [选项]

输入
  --from garss              从 garss 仓库读（默认取 garssInfo.json = 281 条）
  --garss-dir <dir>         garss 仓库位置（默认 ${DEFAULT_GARSS_DIR}）
  --dataset <name>          garss-info（默认）| subscriptions（仅 enabled 的 275 条）
                            | subscriptions-all（全量 3398，含 RSSHub 文档目录）
  --file <path>             任意 garssInfo / subscriptions / 注册表导出 / OPML

清洗
  --rsshub-base <url>       内网 RSSHub 地址改写到的公共实例（默认 ${DEFAULT_RSSHUB_BASE}）
  --keep-internal           保留内网 RSSHub 地址（改写为公共实例后一起体检）；
                            默认**丢弃** —— 它们是 garss 自建实例的路由，公网抓不到
  --include-rsshub-catalog  连「RSSHub 文档 / *」目录项一起导入（不推荐）

体检
  --skip-health             跳过 URL 健康检查（快，但无法区分死活）
  --sniff                   额外拉正文确认「确实是 feed」（非 feed 形态不开闸）
  --concurrency <n>         并发数（默认 4）

放量
  --enable <n>              本次新增里启用前 n 个（默认 60；0 = 全部停用）
  --batch <name>            导入批次名（默认 garss-<YYYY-MM>）

落盘
  --write                   真正写入 config/sources.json（默认 dry-run）
  --no-normalize            跳过「历史 URL 收敛」（默认会把已有条目的 URL 拉齐到去重键形态）
  --out <path>              导入报告落点（默认 tmp/import-report-<batch>.json）
  --now <iso>               固定生成时间（幂等断言可复现）
`);
}

// 仅在「作为 CLI 直接运行」时执行；被 import（单测）时只导出函数
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  mainCli().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(`❌ ${err?.message || err}`);
    process.exitCode = 1;
  });
}

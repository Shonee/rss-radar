// normalize.mjs — 接入器输出 → 内部 Item 归一化
// ARCHITECTURE §3 映射表 + data-model §4.1 字段字典
import { keyOf, buildId } from './lib/dedup-key.mjs';
import { nowIso } from './lib/time.mjs';

/**
 * 摘要的**契约硬上限**，与 docs/data-model/schema/snapshot.schema.json 的
 * `items[].summary.maxLength`（300）保持一致。超过它，产物就会被
 * `npm run validate` / smoke 的契约断言判定违规（真实发生过：79 条里 26 条超 300，
 * 最长 3354 字）。config 的 analysis.summaryMaxChars 若配得更大，按此值收敛。
 */
export const SCHEMA_SUMMARY_MAX = 300;

/** 默认截断长度，对应 config/site-config.json → analysis.summaryMaxChars */
export const DEFAULT_SUMMARY_MAX_CHARS = 200;

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', middot: '·',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function codePointOr(cp, fallback) {
  try {
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * HTML → 纯文本：去 script/style、去标签、解码实体、压缩空白。
 * RSS 的 description/contentSnippet 常带标签与实体，直接入库会既超长又脏。
 */
export function htmlToPlainText(input) {
  return String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => codePointOr(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d) => codePointOr(Number(d), m))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 摘要归一化：去标签 + 解码 + 压缩空白 + 按 maxChars 截断。
 * data-model 的 schema 对此字段的描述是「纯文本摘要，已去标签并截断(默认 ≤200 字符)」，
 * 但此前这里是直接透传 `raw.summary`——声明与实现脱节（同类问题见 relNext / persistSourceHealth）。
 * @param {unknown} rawText 原始摘要（可能含 HTML）
 * @param {number} [maxChars] 期望截断长度（来自 config），会被 SCHEMA_SUMMARY_MAX 收敛
 * @returns {string|undefined} 空文本返回 undefined，避免写入空串字段
 */
export function sanitizeSummary(rawText, maxChars = DEFAULT_SUMMARY_MAX_CHARS) {
  if (rawText === undefined || rawText === null) return undefined;
  const text = htmlToPlainText(rawText);
  if (!text) return undefined;
  const n = Number(maxChars);
  const cap = Math.min(
    Number.isFinite(n) && n > 0 ? Math.trunc(n) : DEFAULT_SUMMARY_MAX_CHARS,
    SCHEMA_SUMMARY_MAX,
  );
  return text.length > cap ? text.slice(0, cap) : text;
}

/**
 * 把单条原始条目归一化为内部 Item
 * @param {Object} raw 任意接入器输出
 * @param {Object} source 配置（source.id / source.channelId / source.type / source.url）
 * @param {Object} channel 配置（channel.id / channel.name / channel.category）
 * @param {Object} [opts] 归一化选项（`opts.summaryMaxChars` 摘要截断长度）
 * @returns {Object} 归一化后的 Item（最小字段集）
 */
export function normalizeItem(raw, source, channel, opts = {}) {
  const publishedAt = toIsoUtc(raw.publishedAt || raw.pubDate || raw.updated || raw.date);
  const updatedAt = toIsoUtc(raw.updatedAt || raw.updated || raw.publishedAt) ?? publishedAt;
  const url = raw.url || raw.link || '';
  const title = String(raw.title ?? '(untitled)').slice(0, 512);
  const dedupKey = keyOf({ url, guid: raw.guid, sourceId: source.id, title });
  return {
    id: buildId(dedupKey),
    guid: raw.guid || url,
    title,
    url,
    summary: sanitizeSummary(raw.summary || raw.contentSnippet, opts.summaryMaxChars),
    author: raw.author || undefined,
    channelId: channel.id,
    channelName: channel.name,
    category: channel.category ?? ['other'],
    publishedAt: publishedAt ?? nowIso(),
    updatedAt: updatedAt ?? publishedAt ?? nowIso(),
    fetchedAt: nowIso(),
    sourceUrl: source.url,
    sourceType: source.type,
    tags: raw.tags ?? undefined,
    dedupKey,
    duplicateOf: null,
    sourceCount: 1,
    sources: [
      {
        channelId: channel.id,
        channelName: channel.name,
        url,
        publishedAt: publishedAt ?? undefined,
      },
    ],
    isNew: true,
    language: raw.language ?? channel.language ?? undefined,
    mediaType: raw.mediaType ?? 'article',
  };
}

function toIsoUtc(d) {
  if (!d) return undefined;
  if (typeof d === 'string') {
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return undefined;
    return x.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return undefined;
}
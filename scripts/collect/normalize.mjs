// normalize.mjs — 接入器输出 → 内部 Item 归一化
// ARCHITECTURE §3 映射表 + data-model §4.1 字段字典
import { buildDedupKey, buildId } from './lib/dedup-key.mjs';
import { nowIso } from './lib/time.mjs';

/**
 * 把单条原始条目归一化为内部 Item
 * @param {Object} raw 任意接入器输出
 * @param {Object} source 配置（source.id / source.channelId / source.type / source.url）
 * @param {Object} channel 配置（channel.id / channel.name / channel.category）
 * @returns {Object} 归一化后的 Item（最小字段集）
 */
export function normalizeItem(raw, source, channel) {
  const publishedAt = toIsoUtc(raw.publishedAt || raw.pubDate || raw.updated || raw.date);
  const updatedAt = toIsoUtc(raw.updatedAt || raw.updated || raw.publishedAt) ?? publishedAt;
  const url = raw.url || raw.link || '';
  const title = String(raw.title ?? '(untitled)').slice(0, 512);
  const dedupKey = buildDedupKey({ url, guid: raw.guid, sourceId: source.id, title });
  return {
    id: buildId(dedupKey),
    guid: raw.guid || url,
    title,
    url,
    summary: raw.summary || raw.contentSnippet || undefined,
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
// connectors/feed.mjs — rss / atom / json_feed 三合一（rss-parser）
// ARCHITECTURE §3.2 + IMPLEMENTATION §3.1 — 一个 connector 三种 type 共享解析层
import Parser from 'rss-parser';
import { fetchText } from '../lib/http.mjs';

const parser = new Parser({
  timeout: 15000,
  customFields: {
    feed: ['language'],
    item: [
      ['author', 'author'],
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'creator'],
    ],
  },
  headers: {
    'User-Agent': 'rss-radar-bot/1.0 (+https://github.com/<owner>/rss-radar)',
  },
});

/**
 * 拉取并解析 RSS/Atom/JSON Feed
 * @param {Object} source 配置
 * @returns {Promise<{items: Object[], httpStatus: number, etag?: string, lastModified?: string}>}
 */
export async function run(source) {
  const res = await fetchText(source.url, {
    timeoutMs: 15000,
    etag: source.etag,
    lastModified: source.lastModified,
  });
  if (res.status === 304) {
    return { items: [], httpStatus: 304, etag: source.etag, lastModified: source.lastModified, notModified: true };
  }
  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status} for ${source.url}`);
  }
  // rss-parser 接受 XML / JSON Feed string（自动判别）
  const feed = await parser.parseString(res.body);
  const items = (feed.items ?? []).map((it) => ({
    title: it.title || '(untitled)',
    url: it.link || it.guid || '',
    guid: it.guid || it.link || '',
    summary: it.contentSnippet || stripHtmlShort(it.content),
    author: it.creator || it.author || undefined,
    publishedAt: it.pubDate || it.isoDate,
    updatedAt: it.pubDate || it.isoDate,
    language: feed.language || source.language,
  }));
  return { items, httpStatus: res.status, etag: res.etag, lastModified: res.lastModified };
}

function stripHtmlShort(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** 该 connector 同时支持 rss / atom / json_feed */
export const types = ['rss', 'atom', 'json_feed'];
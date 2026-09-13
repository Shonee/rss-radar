// scripts/collect/connectors/feed-rss.mjs
// RSS 2.0 / RDF 独立 connector（ARCHITECTURE §3.2 + T-P2-07 feed 拆分）
import { fetchText } from '../lib/http.mjs';
import { parseRssXml, mapRssItem } from './feed-base.mjs';
import { register } from './registry.mjs';

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
  const feed = await parseRssXml(res.body);
  const items = (feed.items ?? []).map((it) => mapRssItem(it, feed.language || source.language));
  return { items, httpStatus: res.status, etag: res.etag, lastModified: res.lastModified };
}

// 主动注册（也通过 connectors/index.mjs 二次注册兼容）
register('rss', { run });

// scripts/collect/connectors/feed-json.mjs
// JSON Feed v1.1 (feed.json.org) 独立 connector
import { fetchText } from '../lib/http.mjs';
import { parseJsonFeed, mapRssItem } from './feed-base.mjs';
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
  const feed = parseJsonFeed(res.body);
  const items = (feed.items ?? []).map((it) => mapRssItem(it, feed.language || source.language));
  return { items, httpStatus: res.status, etag: res.etag, lastModified: res.lastModified };
}

register('json_feed', { run });

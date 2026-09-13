// scripts/collect/connectors/notion-db.mjs
// Notion Database connector（ARCHITECTURE §3.3 + T-P2-07）
//
// 鉴权：Bearer + Notion-Version 头（固定 2022-06-28）
// 分页：start_cursor / has_more / next_cursor（每次返回 ≤ 100）
// 属性解包：type 决定 value 容器（title/rich_text/number/date/url/people/relation…）
//
// 必需 source 配置：
//   {
//     type: 'notion_db',
//     url: 'https://api.notion.com/v1/databases/<db_id>/query',
//     auth: { token: 'ntn_xxx' or process.env.NOTION_TOKEN },
//     body: {  // 可选：query body
//       filter: {...},
//       sorts: [...],
//     },
//     fieldMapping: {
//       id: ['id'],
//       title: ['properties', 'Name', 'title', 0, 'plain_text'],
//       url: ['properties', 'URL', 'url'],
//       summary: ['properties', '摘要', 'rich_text', 0, 'plain_text'],
//       publishedAt: ['properties', '日期', 'date', 'start'],
//       author: ['properties', '作者', 'people', 0, 'name'],
//     },
//   }

import { register } from './registry.mjs';
import { fetchText } from '../lib/http.mjs';

const NOTION_VERSION = '2022-06-28';

function defaultFieldMapping() {
  return {
    id: ['id'],
    title: ['properties', 'Name', 'title'],
    url: ['properties', 'URL', 'url'],
    summary: ['properties', '摘要', 'rich_text'],
    publishedAt: ['properties', 'Date', 'date'],
    author: ['properties', 'Author', 'people'],
  };
}

function pickField(obj, path) {
  if (!Array.isArray(path) || path.length === 0) return undefined;
  let cur = obj;
  for (const k of path) {
    if (cur == null) return undefined;
    if (typeof k === 'number') {
      cur = Array.isArray(cur) ? cur[k] : undefined;
    } else {
      cur = cur[k];
    }
  }
  return cur;
}

/** Notion 属性值 → 内部 raw 字段值 */
function unwrapNotionValue(v) {
  if (v == null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) {
    if (v.length === 0) return undefined;
    return v.map(unwrapNotionValue).filter((x) => x != null).join(' ');
  }
  if (typeof v !== 'object') return String(v);
  // 容器型 (title/rich_text 数组形式)
  if ('plain_text' in v) return v.plain_text;
  if ('text' in v && 'plain_text' in v.text) return v.text.plain_text;
  if ('name' in v) return v.name;
  if ('email' in v) return v.email;
  if ('url' in v) return v.url;
  if ('start' in v) return v.start;
  if ('end' in v) return v.end;
  if ('number' in v) return v.number;
  if ('checkbox' in v) return v.checkbox;
  return undefined;
}

export async function run(source) {
  if (!source.auth?.token) {
    throw new Error('notion-db: source.auth.token 缺失');
  }
  const token = source.auth.token;
  const fieldMapping = { ...defaultFieldMapping(), ...(source.fieldMapping ?? {}) };

  const items = [];
  let startCursor;
  let httpStatus = 200;
  do {
    const body = JSON.stringify({
      ...(source.body ?? {}),
      start_cursor: startCursor,
      page_size: source.pageSize ?? 100,
    });
    // 用 fetch 直接调（POST + JSON body）
    const res = await fetch(source.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body,
    });
    httpStatus = res.status;
    if (res.status === 401) throw new Error('notion-db: 鉴权失败 401');
    if (res.status >= 400) throw new Error(`notion-db HTTP ${res.status}`);
    const data = await res.json();

    for (const page of data.results ?? []) {
      const item = {
        guid: pickField(page, fieldMapping.id) ?? page.id,
        title: unwrapNotionValue(pickField(page, fieldMapping.title)) ?? '(untitled)',
        url: unwrapNotionValue(pickField(page, fieldMapping.url)) ?? page.url ?? '',
        summary: unwrapNotionValue(pickField(page, fieldMapping.summary)),
        author: unwrapNotionValue(pickField(page, fieldMapping.author)),
        publishedAt: unwrapNotionValue(pickField(page, fieldMapping.publishedAt)),
      };
      if (typeof item.publishedAt === 'string') {
        // ISO 8601 → 标准化
        const d = new Date(item.publishedAt);
        if (!Number.isNaN(d.getTime())) item.publishedAt = d.toISOString();
      }
      if (item.url) items.push(item);
    }
    startCursor = data.has_more ? data.next_cursor : null;
  } while (startCursor);

  return { items, httpStatus };
}

register('notion_db', { run });

// scripts/collect/connectors/generic-api.mjs
// 通用 REST API connector（ARCHITECTURE §3.3 + T-P2-07）
//
// 声明式：fieldMapping + pagination（4 种策略）+ auth（Bearer/HMAC/None）
//
// 必需 source 配置：
//   {
//     type: 'generic_api',
//     url: 'https://api.example.com/v1/...',
//     method: 'GET',                   // 默认 GET
//     auth: { kind: 'bearer', tokenEnv: 'MY_TOKEN' },  // 或 { kind: 'none' }
//     headers: {},                       // 可选附加
//     pagination: {
//       kind: 'page',  // 'none' | 'page' | 'offset' | 'cursor' | 'link_header'
//       paramName: 'page',
//       size: 20,
//       sizeParamName: 'per_page',
//       startAt: 1,
//       totalPath: ['meta', 'total'],
//     } 或
//     pagination: { kind: 'offset', offsetParam: 'offset', limitParam: 'limit' } 或
//     pagination: { kind: 'cursor', cursorParam: 'cursor', responsePath: ['data', 'next_cursor'] } 或
//     pagination: { kind: 'link_header', headerName: 'Link', relNext: 'next' } 或
//     pagination: { kind: 'none' } ,
//     itemListPath: ['data', 'items'],  // 默认 'data'
//     fieldMapping: {                   // 必需
//       id: 'id',
//       title: 'title',
//       url: 'url',
//       summary: 'summary',
//       publishedAt: 'published_at',
//       author: 'author',
//     },
//   }

import { register } from './registry.mjs';

const defaultPageSize = 20;

function defaultPagination() {
  return { kind: 'none' };
}

function defaultItemListPath() {
  return ['data'];
}

function pickValue(obj, path) {
  if (typeof path === 'string') return obj?.[path];
  if (!Array.isArray(path) || path.length === 0) return obj;
  let cur = obj;
  for (const k of path) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

function resolveAuth(auth) {
  if (!auth || auth.kind === 'none' || !auth.kind) return {};
  if (auth.kind === 'bearer') {
    const token = auth.tokenEnv ? process.env[auth.tokenEnv] : auth.token;
    if (!token) throw new Error(`generic-api: env ${auth.tokenEnv} 未设置`);
    return { Authorization: `Bearer ${token}` };
  }
  if (auth.kind === 'api_key') {
    const v = auth.valueEnv ? process.env[auth.valueEnv] : auth.value;
    if (!v) throw new Error(`generic-api: env ${auth.valueEnv} 未设置`);
    return { [auth.headerName ?? 'X-Api-Key']: v };
  }
  throw new Error(`generic-api: 未知 auth.kind=${auth.kind}`);
}

function buildUrl(base, qs) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(qs)) {
    if (v != null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/** 解析 Link header (RFC 5988) 找 rel="next" 的 URL */
function parseLinkHeader(link) {
  if (!link) return null;
  const parts = link.split(',').map((s) => s.trim());
  for (const p of parts) {
    const m = p.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (m && m[2] === 'next') return m[1];
  }
  return null;
}

export async function run(source) {
  const pagination = source.pagination ?? defaultPagination();
  const itemListPath = source.itemListPath ?? defaultItemListPath();
  const fieldMapping = source.fieldMapping ?? {};

  const authHeaders = resolveAuth(source.auth);
  const baseHeaders = { Accept: 'application/json', ...authHeaders, ...(source.headers ?? {}) };

  const items = [];
  let cursorState = null;
  let pageIndex = 0;
  let httpStatus = 200;
  let done = false;

  while (!done) {
    let url = source.url;
    let extraQs = {};

    if (pagination.kind === 'none') {
      done = true;
    } else if (pagination.kind === 'page') {
      const size = pagination.size ?? defaultPageSize;
      pageIndex += 1;
      const p = pageIndex + (pagination.startAt ?? 1) - 1;
      extraQs[pagination.paramName ?? 'page'] = p;
      extraQs[pagination.sizeParamName ?? 'per_page'] = size;
    } else if (pagination.kind === 'offset') {
      const o = pageIndex * (pagination.limit ?? defaultPageSize) + (pagination.startAt ?? 0);
      extraQs[pagination.offsetParam ?? 'offset'] = o;
      extraQs[pagination.limitParam ?? 'limit'] = pagination.limit ?? defaultPageSize;
      pageIndex = pageIndex + 1;
    } else if (pagination.kind === 'cursor') {
      if (cursorState) extraQs[pagination.cursorParam ?? 'cursor'] = cursorState;
    } else if (pagination.kind === 'link_header') {
      // 不额外加 qs，全靠解析响应 header
    } else {
      throw new Error(`generic-api: 未知 pagination.kind=${pagination.kind}`);
    }

    const fullUrl = Object.keys(extraQs).length > 0 ? buildUrl(url, extraQs) : url;
    const res = await fetch(fullUrl, {
      method: source.method ?? 'GET',
      headers: baseHeaders,
      body: source.body ? JSON.stringify(source.body) : undefined,
    });
    httpStatus = res.status;
    if (res.status === 401) throw new Error('generic-api: 鉴权失败 401');
    if (res.status >= 400) throw new Error(`generic-api HTTP ${res.status}`);

    // 1) 取 items 列表
    let data;
    try {
      data = await res.json();
    } catch {
      data = await res.text();
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { /* 留空 object */ }
      }
    }

    const list = pickValue(data, itemListPath);
    if (Array.isArray(list)) {
      for (const row of list) items.push(mapRow(row, fieldMapping));
    }

    // 2) 决定下一页
    if (pagination.kind === 'none') done = true;
    else if (pagination.kind === 'page') {
      const total = pagination.totalPath ? pickValue(data, pagination.totalPath) : undefined;
      const size = pagination.size ?? defaultPageSize;
      if (typeof total === 'number' && pageIndex * size >= total) done = true;
      else if (!Array.isArray(list) || list.length < size) done = true;
    } else if (pagination.kind === 'offset') {
      const limit = pagination.limit ?? defaultPageSize;
      if (!Array.isArray(list) || list.length < limit) done = true;
    } else if (pagination.kind === 'cursor') {
      const nextCursor = pickValue(data, pagination.responsePath ?? ['next_cursor']);
      if (!nextCursor) done = true;
      else cursorState = nextCursor;
    } else if (pagination.kind === 'link_header') {
      const nextUrl = parseLinkHeader(res.headers.get(pagination.headerName ?? 'Link'));
      if (!nextUrl) done = true;
      else source.url = nextUrl;
    }
  }

  return { items, httpStatus };
}

function mapRow(row, fieldMapping) {
  function pick(path) {
    return pickValue(row, path);
  }
  return {
    guid: pick(fieldMapping.id) ?? undefined,
    title: pick(fieldMapping.title) ?? '(untitled)',
    url: pick(fieldMapping.url) ?? '',
    summary: pick(fieldMapping.summary),
    author: pick(fieldMapping.author),
    publishedAt: pick(fieldMapping.publishedAt),
  };
}

register('generic_api', { run });

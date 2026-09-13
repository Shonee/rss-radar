// scripts/collect/connectors/feishu-bitable.mjs
// 飞书多维表格（Bitable v2）connector（ARCHITECTURE §3.3 + T-P2-07）
//
// 鉴权：tenant_access_token（缓存 110 分钟 ≤ 2h，ARCH §3.7）
// 分页：page_token 翻页（has_more + page_token；page_size ≤ 500）
// 字段解包：type → value 嵌套结构按字段类型规则化
//
// 必需 source 配置：
//   {
//     type: 'feishu_bitable',
//     url: 'https://open.feishu.cn/open-apis/bitable/v1/apps/<app_token>/tables/<table_id>/records',
//     auth: {
//       appId: 'cli_xxx',                // 实际值从 .env / GitHub Secrets
//       appSecret: 'SECRET',
//       tokenType: 'tenant_access_token',
//       tokenUrl: 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
//     },
//     params: { page_size: 200 },        // 可选
//     fieldMapping: {                    // 可选：声明式字段映射（defaults 已含合理映射）
//       id: ['record_id'],
//       title: ['fields', '标题'],
//       url: ['fields', '链接'],
//       summary: ['fields', '摘要'],
//       publishedAt: ['fields', '发布时间'],
//       author: ['fields', '作者'],
//     },
//   }
//
// 鉴权 ref 解析：`process.env.FEISHU_APP_ID` / `FEISHU_APP_SECRET` 等通过
// config/notify.json 或 .env 注入；本模块不直接读 secrets（仅用 source.auth.*）
//
// 本地化方案：source.auth.{appId,appSecret} 也可以写直接值（本地 .env 注入）
import { register } from './registry.mjs';

const TOKEN_TTL_MS = 110 * 60 * 1000; // 110 分钟（保守 < 2h）

/**
 * token 缓存（按 tokenUrl:appId 维度）
 */
const _tokenCache = new Map();

async function getTenantAccessToken(auth) {
  if (!auth || !auth.appId || !auth.appSecret) {
    throw new Error('feishu-bitable: source.auth.appId / appSecret 缺失');
  }
  const cacheKey = `${auth.tokenUrl ?? 'default'}::${auth.appId}`;
  const now = Date.now();
  const hit = _tokenCache.get(cacheKey);
  if (hit && hit.expiresAt > now + 60000) return hit.token;

  const body = JSON.stringify({ app_id: auth.appId, app_secret: auth.appSecret });
  // 直接 fetch（POST + JSON body）—— 不绕 http.mjs（fetchText 不支持 method）
  const r = await fetch(auth.tokenUrl ?? 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
  });
  const data = await r.json();
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`feishu-bitable: 获取 tenant_access_token 失败: code=${data.code} msg=${data.msg}`);
  }
  const token = data.tenant_access_token;
  const ttl = (data.expire ?? 7200) * 1000;
  _tokenCache.set(cacheKey, { token, expiresAt: now + Math.min(ttl, TOKEN_TTL_MS) });
  return token;
}

/** 默认字段映射（bitable record_id + 常见字段名） */
function defaultFieldMapping() {
  return {
    id: ['record_id'],
    title: ['fields', '标题'],
    url: ['fields', '链接'],
    summary: ['fields', '摘要'],
    publishedAt: ['fields', '发布时间'],
    author: ['fields', '作者'],
  };
}

/** 按 path 数组从 obj 取字段；path 含 'fields' 时进入 fields 容器 */
function pickField(obj, path) {
  if (!Array.isArray(path) || path.length === 0) return undefined;
  let cur = obj;
  for (const k of path) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** 解包飞书字段值（{type, value} 嵌套） */
function unwrapFeishuValue(v) {
  if (v == null) return undefined;
  if (typeof v !== 'object') return v;
  if ('text' in v) return v.text;
  if ('name' in v) return v.name;
  if ('link' in v) return v.link;
  if (Array.isArray(v) && v.length > 0) {
    // 数组首项取 unwrap
    return unwrapFeishuValue(v[0]);
  }
  if (typeof v === 'object' && 'value' in v) return unwrapFeishuValue(v.value);
  return v;
}

export async function run(source) {
  const token = await getTenantAccessToken(source.auth);
  const baseUrl = source.url;
  const params = new URLSearchParams({
    page_size: String(source.params?.page_size ?? 200),
    ...(source.params?.user_id_type ? { user_id_type: source.params.user_id_type } : {}),
  });
  const fieldMapping = { ...defaultFieldMapping(), ...(source.fieldMapping ?? {}) };

  const items = [];
  let pageToken;
  let httpStatus = 200;
  do {
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${params.toString()}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
    httpStatus = r.status;
    if (r.status >= 400) throw new Error(`feishu-bitable HTTP ${r.status}`);
    const data = await r.json();
    if (data.code !== 0) throw new Error(`feishu-bitable: ${data.msg ?? data.code}`);
    for (const rec of data.data?.items ?? []) {
      const item = {
        guid: pickField(rec, fieldMapping.id) ?? rec.record_id,
        title: unwrapFeishuValue(pickField(rec, fieldMapping.title)) ?? '(untitled)',
        url: unwrapFeishuValue(pickField(rec, fieldMapping.url)) ?? '',
        summary: unwrapFeishuValue(pickField(rec, fieldMapping.summary)),
        author: unwrapFeishuValue(pickField(rec, fieldMapping.author)),
        publishedAt: unwrapFeishuValue(pickField(rec, fieldMapping.publishedAt)),
      };
      // 时间戳 → ISO 字符串
      if (typeof item.publishedAt === 'number') {
        item.publishedAt = new Date(item.publishedAt).toISOString();
      }
      if (item.url) items.push(item);
    }
    pageToken = data.data?.has_more ? data.data?.next_page_token : null;
  } while (pageToken);
  return { items, httpStatus };
}

register('feishu_bitable', { run });

/** 测试用：清 token 缓存 */
export function _resetTokenCache() {
  _tokenCache.clear();
}

// connectors/local-json.mjs — 本地 JSON 文件（jsonpath 字段映射）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 读取本地 JSON 文件并按 fieldMapping.itemsPath 抽出条目数组
 * @param {Object} source 配置（含 url 相对仓库根、fieldMapping）
 */
export async function run(source) {
  const abs = resolve(process.cwd(), source.url);
  const raw = JSON.parse(readFileSync(abs, 'utf8'));
  const itemsPath = source.fieldMapping?.itemsPath ?? '$[*]';
  const list = resolveJsonPath(raw, itemsPath);
  const map = source.fieldMapping?.map ?? {};
  const items = list.map((row) => {
    const out = { ...row };
    for (const [internal, ext] of Object.entries(map)) {
      out[internal] = readJsonPath(row, ext);
    }
    // 类型转换
    const tc = source.fieldMapping?.typeCoercion ?? {};
    for (const [k, t] of Object.entries(tc)) {
      if (t === 'date') out[k] = new Date(out[k]);
    }
    // 兜底
    const defaults = source.fieldMapping?.defaults ?? {};
    return { ...defaults, ...out };
  });
  return { items, httpStatus: 200 };
}

/**
 * 支持极简 jsonpath：
 *   $.data.list[*] → 切到 list 后取所有元素
 *   $.items[*]
 *   $[*]
 * 语法只解析 key 段 + [*]，不做 filter / wildcard。
 */
function resolveJsonPath(root, expr) {
  let path = expr.replace(/^\$\.?/, '').trim();
  const segments = path.split('.').filter(Boolean);
  let cur = root;
  for (const seg of segments) {
    if (seg.endsWith('[*]')) {
      const key = seg.slice(0, -3);
      cur = cur?.[key];
      if (!Array.isArray(cur)) return [];
      return cur;
    }
    cur = cur?.[seg];
  }
  return Array.isArray(cur) ? cur : cur ? [cur] : [];
}

function readJsonPath(root, expr) {
  const segments = expr.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let cur = root;
  for (const seg of segments) cur = cur?.[seg];
  return cur;
}

export const types = ['local_json'];
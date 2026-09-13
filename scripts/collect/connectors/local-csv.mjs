// connectors/local-csv.mjs — 本地 CSV 文件（header 字段映射 + papaparse）
// papaparse 通过 dynamic import（沙箱无 npm install 时不阻断 connector 注册）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let _papaPromise = null;
async function getPapa() {
  if (!_papaPromise) {
    _papaPromise = import('papaparse').then((m) => m.default || m);
  }
  return _papaPromise;
}

/**
 * @param {Object} source 配置（含 url 相对仓库根、fieldMapping.map）
 */
export async function run(source) {
  const abs = resolve(process.cwd(), source.url);
  const text = readFileSync(abs, 'utf8');
  const Papa = await getPapa();
  const { data: rows } = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const map = source.fieldMapping?.map ?? {};
  const items = rows.map((row) => {
    const out = {};
    for (const [internal, col] of Object.entries(map)) {
      out[internal] = row[col];
    }
    if (out.publishedAt) out.publishedAt = new Date(out.publishedAt);
    return out;
  });
  return { items, httpStatus: 200 };
}

export const types = ['local_csv'];
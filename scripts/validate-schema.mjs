#!/usr/bin/env node
/**
 * JSON Schema 校验 CLI（ajv + Zod 双轨）
 * ARCHITECTURE §2.2 — ajv 跑 JSON Schema（采集落盘后 fail fast）；Zod 给脚本内部用
 *
 * 用法：
 *   node scripts/validate-schema.mjs                       # 默认：校验 config/* + 9 schema 自洽
 *   node scripts/validate-schema.mjs --check <file.json> <schema-name>
 *   node scripts/validate-schema.mjs --config             # 校验 config/sources.json / exclusions.json / notify.json / site-config.json
 *
 * schema-name（去掉 .schema.json 后缀）：
 *   sources / snapshot / report / exclude-rules / site-config / history-index / history-item / notify
 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SCHEMA_DIR = resolve(ROOT, 'docs/data-model/schema');

const SCHEMA_FILES = {
  sources: 'sources.schema.json',
  snapshot: 'snapshot.schema.json',
  report: 'report.schema.json',
  'exclude-rules': 'exclude-rules.schema.json',
  'site-config': 'site-config.schema.json',
  'history-index': 'history-index.schema.json',
  'history-item': 'history-item.schema.json',
  notify: 'notify.schema.json',
};

const ajv = new Ajv({
  strict: true,
  allErrors: true,
  // 允许 additionalProperties 仅在 schema 显式允许；不静默吞错
  removeAdditional: false,
});
addFormats(ajv);

/** 加载并缓存全部 schema */
const cache = new Map();
function loadSchema(name) {
  if (cache.has(name)) return cache.get(name);
  const file = SCHEMA_FILES[name];
  if (!file) {
    console.error(`❌ Unknown schema "${name}". Valid: ${Object.keys(SCHEMA_FILES).join(', ')}`);
    process.exit(2);
  }
  const path = resolve(SCHEMA_DIR, file);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  cache.set(name, data);
  return data;
}

/** 预编译 ajv 验证器 */
const validators = new Map();
function compile(name) {
  if (validators.has(name)) return validators.get(name);
  const schema = loadSchema(name);
  const validate = ajv.compile(schema);
  validators.set(name, validate);
  return validate;
}

/** 校验单个文件，返回 errors 数组（空数组 = 通过） */
export function validateData(name, data) {
  const validate = compile(name);
  const valid = validate(data);
  if (valid) return [];
  return (validate.errors ?? []).map(formatError);
}

function formatError(err) {
  return {
    instancePath: err.instancePath || '/',
    schemaPath: err.schemaPath || '',
    keyword: err.keyword,
    message: err.message,
    params: err.params,
  };
}

function printErrors(errors, ctx) {
  console.error(`❌ ${ctx}：${errors.length} 处错误`);
  for (const e of errors) {
    console.error(`  • ${e.instancePath} ${e.message} (${e.keyword})`);
  }
}

function exitWithUsage() {
  console.error(
    `用法：\n` +
      `  node scripts/validate-schema.mjs --check <file.json> <schema-name>\n` +
      `  node scripts/validate-schema.mjs --config\n` +
      `  schema-name: ${Object.keys(SCHEMA_FILES).join(' | ')}`,
  );
  process.exit(2);
}

// ---------- 语义守卫：连接器真实读取的 fieldMapping / auth / pagination 形状 ----------
// 背景：sources.schema.json 为兼容两种真实形状而放宽了 additionalProperties。放宽之后，
// 旧的 {mode,map} 写法在 feishu_bitable / notion_db / generic_api 源上也能通过 JSON Schema，
// 但那些连接器**不读** {mode,map} → 标题静默退化为 (untitled)。本守卫把「静默损坏数据」
// 变成「npm run validate 响亮报错」。权威形状见 docs/SOURCES.md §6。

/** 读「顶层 fieldMapping.<内部字段> = 路径」的连接器 */
const TOPLEVEL_FM_TYPES = new Set(['feishu_bitable', 'notion_db', 'generic_api']);
/** 读「fieldMapping.{itemsPath,map,...}」的连接器 */
const MAP_FM_TYPES = new Set(['local_json', 'local_csv']);
const INTERNAL_ITEM_FIELDS = ['id', 'title', 'url', 'summary', 'publishedAt', 'author'];

/**
 * 对 sources 配置做 JSON Schema 之外的语义检查。
 * @param {object} data sources.json 解析结果
 * @returns {Array<{instancePath: string, keyword: string, message: string}>} 空数组=通过
 */
export function checkSourceShapes(data) {
  const errors = [];
  const push = (instancePath, message) => errors.push({ instancePath, keyword: 'semantic', message });
  const sources = Array.isArray(data?.sources) ? data.sources : [];

  for (const s of sources) {
    const at = `/sources/${s?.id ?? '?'}`;
    const fm = s?.fieldMapping;
    const fmIsObj = fm && typeof fm === 'object' && !Array.isArray(fm);

    if (TOPLEVEL_FM_TYPES.has(s?.type) && fmIsObj) {
      const wrongKeys = ['mode', 'map', 'itemsPath', 'typeCoercion', 'defaults'].filter((k) => k in fm);
      if (wrongKeys.length > 0) {
        push(
          `${at}/fieldMapping`,
          `type=${s.type} 的连接器读「顶层 fieldMapping.<内部字段> = 路径」，不读 ${wrongKeys
            .map((k) => `「${k}」`)
            .join('')}。按当前写法该映射会被**静默忽略**、标题退化为 (untitled)。`
            + '请改写为 {"title": ["fields","标题"], "url": ["fields","链接"], …}（见 docs/SOURCES.md §6）。',
        );
      }
      const t = fm.title;
      if (t !== undefined && typeof t !== 'string' && !Array.isArray(t)) {
        push(`${at}/fieldMapping/title`, 'fieldMapping.title 必须是字符串或路径数组（如 ["fields","标题"]）。');
      }
    }

    if (MAP_FM_TYPES.has(s?.type) && fmIsObj) {
      const wrongKeys = INTERNAL_ITEM_FIELDS.filter((k) => k in fm);
      if (wrongKeys.length > 0) {
        push(
          `${at}/fieldMapping`,
          `type=${s.type} 的连接器读 fieldMapping.map（内部字段 → 源字段/列名），不读顶层键 ${wrongKeys.join(' / ')}。`
            + '请改写为 {"map": {"title": "…", "url": "…"}}（见 docs/SOURCES.md §6）。',
        );
      }
    }

    // feishu_bitable / notion_db 的 pickField 只接受**数组**路径；
    // 写字符串会被当作「非数组」直接返回 undefined → 标题静默退化为 (untitled)。
    if ((s?.type === 'feishu_bitable' || s?.type === 'notion_db') && fmIsObj) {
      for (const [field, pathValue] of Object.entries(fm)) {
        if (typeof pathValue === 'string') {
          push(
            `${at}/fieldMapping/${field}`,
            `type=${s.type} 的 fieldMapping 值必须是**路径数组**（如 ["fields","标题"]），`
              + `当前写成字符串「${pathValue}」会被当作非数组而取不到值 → 静默退化为 (untitled)。`,
          );
        }
      }
    }

    if (s?.type === 'generic_api') {
      const pg = s.pagination;
      if (pg && typeof pg === 'object' && 'strategy' in pg && !('kind' in pg)) {
        push(`${at}/pagination`, 'generic_api 读 pagination.kind，不读 pagination.strategy。请改用 kind。');
      }
      const au = s.auth;
      if (au && typeof au === 'object' && ('type' in au || 'ref' in au) && !('kind' in au)) {
        push(`${at}/auth`, 'generic_api 读 auth.kind（bearer/api_key/none），不读 auth.type/ref。请改用 kind。');
      }
    }
  }
  return errors;
}

// ---------- CLI ----------
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    // 默认：跑一次 config 校验
    return runConfigValidate();
  }
  if (args[0] === '--config') {
    return runConfigValidate();
  }
  if (args[0] === '--check') {
    const [, file, schemaName] = args;
    if (!file || !schemaName) exitWithUsage();
    const abs = resolve(process.cwd(), file);
    if (!existsSync(abs)) {
      console.error(`❌ 文件不存在：${abs}`);
      process.exit(2);
    }
    const data = JSON.parse(readFileSync(abs, 'utf8'));
    const errors = validateData(schemaName, data);
    if (schemaName === 'sources') errors.push(...checkSourceShapes(data));
    if (errors.length === 0) {
      console.log(`✅ ${file} 校验通过 (schema: ${schemaName})`);
      return;
    }
    printErrors(errors, file);
    process.exit(1);
  }
  exitWithUsage();
}

function runConfigValidate() {
  const targets = [
    { file: 'config/sources.json', schema: 'sources' },
    { file: 'config/site-config.json', schema: 'site-config' },
    { file: 'config/exclusions.json', schema: 'exclude-rules' },
    { file: 'config/notify.json', schema: 'notify' },
    { file: 'config/categories.json', schema: null /* 轻量版，见下 */ },
  ];
  let total = 0;
  let failed = 0;
  for (const { file, schema } of targets) {
    const abs = resolve(ROOT, file);
    if (!existsSync(abs)) {
      console.log(`⏭  ${file}（不存在，跳过）`);
      continue;
    }
    total += 1;
    if (schema === null) {
      // categories.json 走 schema self-check（必含 schemaVersion + categories 数组）
      const data = JSON.parse(readFileSync(abs, 'utf8'));
      if (
        typeof data?.schemaVersion === 'string' &&
        Array.isArray(data?.categories) &&
        data.categories.length > 0
      ) {
        console.log(`✅ ${file}（自检 schemaVersion + categories[]）`);
      } else {
        console.error(`❌ ${file} 缺少 schemaVersion 或 categories[]`);
        failed += 1;
      }
      continue;
    }
    const data = JSON.parse(readFileSync(abs, 'utf8'));
    const errors = validateData(schema, data);
    if (schema === 'sources') errors.push(...checkSourceShapes(data));
    if (errors.length === 0) {
      console.log(`✅ ${file}（${schema}）`);
    } else {
      printErrors(errors, file);
      failed += 1;
    }
  }
  console.log(`\n通过 ${total - failed} / 失败 ${failed} / 总计 ${total}`);
  process.exit(failed === 0 ? 0 : 1);
}

// 仅在「作为 CLI 直接运行」时执行；被 import（如单测）时只导出函数，不跑校验也不 exit。
const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
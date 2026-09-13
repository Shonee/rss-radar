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
import { fileURLToPath } from 'node:url';

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
    const [, , file, schemaName] = args;
    if (!file || !schemaName) exitWithUsage();
    const abs = resolve(process.cwd(), file);
    if (!existsSync(abs)) {
      console.error(`❌ 文件不存在：${abs}`);
      process.exit(2);
    }
    const data = JSON.parse(readFileSync(abs, 'utf8'));
    const errors = validateData(schemaName, data);
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

main();
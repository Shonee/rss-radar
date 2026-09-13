#!/usr/bin/env node
/**
 * Smoke-test v2：脚本产物契约断言
 * ARCHITECTURE §6.7 / PRD §6.3
 *
 * 检查项：
 *  1. snapshot.json 存在且符合 schema
 *  2. Σ stats.sources[].itemCount == stats.itemsAfterDedup
 *  3. Σ stats.sources[].itemCount for ok=true <= stats.sourceOk * MAX
 *  4. snapshot.items[].id 全部唯一
 *  5. snapshot.items[].url 全部非空
 *  6. 每条 item 至少有 1 个 category
 *  7. 时间字段均为 ISO 8601 UTC（YYYY-MM-DDTHH:mm:ssZ）
 *  8. 故意篡改 totalItems → smoke 应失败
 *
 * 用法：
 *   node scripts/smoke/snapshot-contract.mjs                       # 默认 tmp/today/snapshot-<today>.json
 *   node scripts/smoke/snapshot-contract.mjs --file <path.json>     # 指定文件
 *   node scripts/smoke/snapshot-contract.mjs --tamper totalItems     # 故意篡改后断言
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { todayLocal } from '../collect/lib/time.mjs';

const ROOT = resolve(import.meta.dirname || new URL('.', import.meta.url).pathname, '..', '..');

const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);

function loadSnapshotSchema() {
  const path = resolve(ROOT, 'docs/data-model/schema/snapshot.schema.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function findSnapshot(argFile) {
  if (argFile) return resolve(process.cwd(), argFile);
  const date = todayLocal();
  const defaultPath = resolve(ROOT, 'tmp/today/snapshot-' + date + '.json');
  if (existsSync(defaultPath)) return defaultPath;
  // fallback: public/data/today/snapshot.json（demo 数据）
  const demoPath = resolve(ROOT, 'public/data/today/snapshot.json');
  if (existsSync(demoPath)) return demoPath;
  throw new Error('未找到 snapshot 文件。请先跑 npm run collect:once 或指定 --file <path>');
}

function assert(cond, msg) {
  if (cond) {
    console.log('  ✅ ' + msg);
  } else {
    console.error('  ❌ ' + msg);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  let argFile = null;
  let tamper = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--file') argFile = args[++i];
    else if (a === '--tamper') tamper = args[++i];
  }

  const file = findSnapshot(argFile);
  console.log('[smoke] snapshot = ' + file);
  const data = JSON.parse(readFileSync(file, 'utf8'));

  // 1. schema 校验
  console.log('\n[1] schema 校验');
  const validate = ajv.compile(loadSnapshotSchema());
  if (validate(data)) {
    console.log('  ✅ 通过 snapshot.schema.json');
  } else {
    console.error('  ❌ schema 校验失败：');
    for (const err of validate.errors ?? []) {
      console.error('     • ' + (err.instancePath || '/') + ' ' + err.message);
    }
    process.exit(1);
  }

  // 2. Σ sources[].itemCount == stats.itemsAfterDedup
  console.log('\n[2] stats 恒等');
  const sumBySources = (data.stats.sources ?? []).reduce((s, x) => s + (x.itemCount || 0), 0);
  assert(
    sumBySources === data.stats.itemsAfterDedup,
    `Σ stats.sources[].itemCount (${sumBySources}) == stats.itemsAfterDedup (${data.stats.itemsAfterDedup})`,
  );
  assert(
    (data.stats.sourceOk ?? 0) + (data.stats.sourceFailed ?? 0) === (data.stats.sourceTotal ?? 0),
    `sourceOk (${data.stats.sourceOk}) + sourceFailed (${data.stats.sourceFailed}) == sourceTotal (${data.stats.sourceTotal})`,
  );

  // 3. id 唯一
  console.log('\n[3] 字段完整性');
  const ids = new Set();
  let dup = 0;
  for (const it of data.items ?? []) {
    if (ids.has(it.id)) dup += 1;
    ids.add(it.id);
  }
  assert(dup === 0, `items[].id 全部唯一（重复 ${dup} 条）`);
  let emptyUrl = 0;
  for (const it of data.items ?? []) if (!it.url) emptyUrl += 1;
  assert(emptyUrl === 0, `items[].url 全部非空（${emptyUrl} 条空 url）`);
  let noCat = 0;
  for (const it of data.items ?? []) if (!Array.isArray(it.category) || it.category.length === 0) noCat += 1;
  assert(noCat === 0, `每条 item 至少 1 个 category（${noCat} 条无 category）`);

  // 4. ISO 8601 UTC
  console.log('\n[4] 时间字段 ISO 8601 UTC');
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  let badTime = 0;
  for (const it of data.items ?? []) {
    if (!ISO.test(it.publishedAt) || !ISO.test(it.updatedAt) || !ISO.test(it.fetchedAt)) badTime += 1;
  }
  assert(badTime === 0, `items[].publishedAt/updatedAt/fetchedAt 均为 ISO 8601 UTC（${badTime} 条不合格）`);

  // 5. 故意篡改 → smoke 应失败
  console.log('\n[5] 篡改检测');
  if (tamper) {
    const copy = JSON.parse(JSON.stringify(data));
    if (tamper === 'totalItems') {
      copy.stats.itemsAfterDedup = (copy.stats.itemsAfterDedup ?? 0) + 999;
    } else if (tamper === 'duplicateId') {
      if (copy.items.length >= 2) copy.items[1].id = copy.items[0].id;
    } else if (tamper === 'badUrl') {
      if (copy.items.length >= 1) copy.items[0].url = '';
    } else {
      console.error('未知 tamper 类型：' + tamper);
      process.exit(2);
    }
    const ok = validate(copy);
    const sumBySources2 = (copy.stats.sources ?? []).reduce((s, x) => s + (x.itemCount || 0), 0);
    if (ok && sumBySources2 === copy.stats.itemsAfterDedup) {
      console.error('  ❌ 篡改 ' + tamper + ' 未被检出（bug）');
      process.exit(1);
    }
    console.log('  ✅ 篡改 ' + tamper + ' 被检出（schema 或恒等断言失败）');
  } else {
    console.log('  ⏭  跳过（未指定 --tamper）');
  }

  console.log('\n🎉 smoke-test v2 PASS');
}

main();
// 前端运行时校验包装：把 ajv 校验导出为 TS-friendly 异步函数
// P1 阶段仅给 build-time 预校验使用；P3 完整运行时校验再扩展
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import sourcesSchema from '../../docs/data-model/schema/sources.schema.json';
import snapshotSchema from '../../docs/data-model/schema/snapshot.schema.json';
import reportSchema from '../../docs/data-model/schema/report.schema.json';
import excludeRulesSchema from '../../docs/data-model/schema/exclude-rules.schema.json';
import siteConfigSchema from '../../docs/data-model/schema/site-config.schema.json';
import historyIndexSchema from '../../docs/data-model/schema/history-index.schema.json';
import historyItemSchema from '../../docs/data-model/schema/history-item.schema.json';
import notifySchema from '../../docs/data-model/schema/notify.schema.json';

const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);

const schemas = {
  sources: sourcesSchema,
  snapshot: snapshotSchema,
  report: reportSchema,
  excludeRules: excludeRulesSchema,
  siteConfig: siteConfigSchema,
  historyIndex: historyIndexSchema,
  historyItem: historyItemSchema,
  notify: notifySchema,
} as const;

export type SchemaName = keyof typeof schemas;

export interface ValidationError {
  instancePath: string;
  message: string;
  keyword: string;
  params?: Record<string, unknown>;
}

/** ajv 编译产物类型（ValidateFunction） */
type ValidateFn = ReturnType<typeof ajv.compile>;

const validators = new Map<SchemaName, ValidateFn>();

/**
 * 取（或编译并缓存）指定 schema 的校验函数
 * @throws 未知 schema 名
 */
function compile(name: SchemaName): ValidateFn {
  const cached = validators.get(name);
  if (cached) return cached;
  const schema = schemas[name];
  if (!schema) throw new Error(`Unknown schema: ${name}`);
  const v: ValidateFn = ajv.compile(schema);
  validators.set(name, v);
  return v;
}

export function validate(name: SchemaName, data: unknown): ValidationError[] {
  const v = compile(name);
  if (v(data)) return [];
  return (v.errors ?? []).map((e) => ({
    instancePath: e.instancePath || '/',
    message: e.message || 'invalid',
    keyword: e.keyword,
    params: e.params,
  }));
}

export function assertValid(name: SchemaName, data: unknown): void {
  const errs = validate(name, data);
  if (errs.length > 0) {
    throw new Error(
      `Schema validation failed for ${name}: ${errs.length} errors. First: ${errs[0]?.instancePath} ${errs[0]?.message}`,
    );
  }
}
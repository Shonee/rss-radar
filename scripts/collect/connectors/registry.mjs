// connectors/registry.mjs — 连接器注册表（ARCHITECTURE §10）
//
// TODO(P2 契约待裁决)：docs/data-model/schema/sources.schema.json 中声明的
//   `fieldMapping` / `auth` / `pagination` 形状与各连接器（generic-api.mjs /
//   feishu-bitable.mjs / notion-db.mjs / local-*.mjs）实际消费的字段不完全一致。
//   这是 P2 的**契约级**决定（谁对齐谁），尚未拍板 —— 本轮**不改行为**，
//   仅在此挂 TODO 备查。裁决前请勿单方面修改任一侧形状。
const registry = new Map();

/** 注册一个连接器 */
export function register(type, connector) {
  if (registry.has(type)) {
    throw new Error(`connector type "${type}" already registered`);
  }
  if (!connector || typeof connector.run !== 'function') {
    throw new Error(`connector for "${type}" must implement run()`);
  }
  registry.set(type, connector);
}

/** 获取一个连接器；不存在抛错 */
export function get(type) {
  const c = registry.get(type);
  if (!c) throw new Error(`unknown source.type "${type}"`);
  return c;
}

/** 列出已注册的所有 type */
export function listTypes() {
  return Array.from(registry.keys()).sort();
}

/** 重置（仅供测试用） */
export function _reset() {
  registry.clear();
}
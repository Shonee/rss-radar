// connectors/registry.mjs — 连接器注册表（ARCHITECTURE §10）
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
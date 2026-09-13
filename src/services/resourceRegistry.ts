// T-P3-01 前端基础设施 — 模块级资源缓存（in-flight 去重 + 60s TTL）
//
// 选择说明（二选一，此处选「模块级 in-flight promise 缓存 + TTL」而非 Context+useReducer）：
//   - 页面内 useSnapshot() / useReport() 会同时读取同一份 loadLatest()，若不缓存会重复发请求；
//   - 模块级 Map 以 key 去重，in-flight 期间复用同一 promise，settled 后 60s 内复用结果；
//   - 相比 Context 少一层 Provider 与重渲染，且天然跨组件共享，符合「避免过度依赖」的决策。

export const DEFAULT_TTL_MS = 60_000;

interface CacheEntry<T> {
  promise: Promise<T>;
  value?: T;
  error?: Error;
  settled: boolean;
  ts: number;
}

const registry = new Map<string, CacheEntry<unknown>>();

/**
 * 取缓存或发起加载。
 * @param key 资源键（如 'latest' / 'history-index'）
 * @param loader 真正发起请求的函数
 * @param ttlMs 命中有效期，默认 60s
 * @param force true 时忽略已有缓存，强制重新加载
 */
export function getCached<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
  force = false,
): Promise<T> {
  const now = Date.now();
  const existing = registry.get(key) as CacheEntry<T> | undefined;

  if (existing && !force) {
    if (!existing.settled) return existing.promise; // in-flight 去重
    if (existing.error === undefined && now - existing.ts < ttlMs) {
      return Promise.resolve(existing.value as T);
    }
  }

  const entry: CacheEntry<T> = {
    promise: undefined as unknown as Promise<T>,
    settled: false,
    ts: now,
  };
  entry.promise = loader().then(
    (value) => {
      entry.value = value;
      entry.error = undefined;
      entry.settled = true;
      entry.ts = Date.now();
      return value;
    },
    (err: unknown) => {
      entry.error = err instanceof Error ? err : new Error(String(err));
      entry.settled = true;
      entry.ts = Date.now();
      throw entry.error;
    },
  );
  // 防止缓存的 promise 在被复用前产生 unhandledRejection
  entry.promise.catch(() => undefined);
  registry.set(key, entry);
  return entry.promise;
}

/** 只读窥视（不触发加载） */
export function peekCached<T>(key: string): T | undefined {
  const entry = registry.get(key) as CacheEntry<T> | undefined;
  return entry?.settled && entry.error === undefined ? entry.value : undefined;
}

/** 失效：不传 key 清空全部 */
export function invalidateResource(key?: string): void {
  if (key === undefined) registry.clear();
  else registry.delete(key);
}

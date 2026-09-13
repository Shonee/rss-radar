// T-P3-01 前端基础设施 — 通用异步资源 hook（封装 loading / error / stale / source / reload）
//
// 选择说明：采用「模块级 in-flight promise 缓存 + 60s TTL」（见 services/resourceRegistry.ts），
// 而非 Context + useReducer —— 页面内多处调用同一 key（如 useSnapshot / useReport 共享
// 'latest'）时只发一次请求，且无需 Provider。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataSource } from '../types';
import { getCached, invalidateResource } from '../services/resourceRegistry';

/** resourceRegistry 中承载 loadLatest() 的键 */
export const LATEST_KEY = 'latest';
/** resourceRegistry 中承载 history-index 的键 */
export const HISTORY_INDEX_KEY = 'history-index';
/** resourceRegistry 中承载 archive-index 的键 */
export const ARCHIVE_INDEX_KEY = 'archive-index';

export interface ResourceLike {
  stale?: boolean;
  source?: DataSource;
}

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  source: DataSource | null;
  reload: () => void;
}

/**
 * 泛型资源 hook。
 * @param key 缓存键
 * @param loader 发起加载的函数（会经缓存去重）
 */
export function useResource<T extends ResourceLike>(
  key: string,
  loader: () => Promise<T>,
): ResourceState<T> {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: true,
    error: null,
  });

  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const mountedRef = useRef(true);

  const load = useCallback(
    (force: boolean): void => {
      setState((prev) => ({ data: prev.data, loading: true, error: null }));
      getCached<T>(key, () => loaderRef.current(), undefined, force)
        .then((data) => {
          if (mountedRef.current) setState({ data, loading: false, error: null });
        })
        .catch((err: unknown) => {
          if (mountedRef.current) {
            setState({
              data: null,
              loading: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
    },
    [key],
  );

  useEffect(() => {
    mountedRef.current = true;
    load(false);
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const reload = useCallback((): void => {
    invalidateResource(key);
    load(true);
  }, [key, load]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    stale: state.data?.stale === true,
    source: state.data?.source ?? null,
    reload,
  };
}

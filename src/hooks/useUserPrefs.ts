// T-P3-01 前端基础设施 — useUserPrefs（localStorage 持久化的用户偏好）
//
// 纯读写逻辑在 prefsStorage.ts（便于无 React 环境的单测）。

import { useCallback, useMemo, useState } from 'react';
import {
  type SortKey,
  type UserPrefs,
  getDefaultStorage,
  mergeDefaults,
  readPrefs,
  resetPrefs,
  writePref,
} from './prefsStorage';

export interface UseUserPrefsResult {
  prefs: UserPrefs;
  setPref: <K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) => void;
  setChannels: (channels: string[] | null) => void;
  setSort: (sort: SortKey) => void;
  setCardLimit: (limit: number) => void;
  reset: () => void;
}

export interface UseUserPrefsOptions {
  defaults?: Partial<UserPrefs>;
  /** 测试注入：覆盖 window.localStorage */
  storage?: ReturnType<typeof getDefaultStorage>;
}

export function useUserPrefs(options: UseUserPrefsOptions = {}): UseUserPrefsResult {
  const storage = useMemo(
    () => (options.storage !== undefined ? options.storage : getDefaultStorage()),
    [options.storage],
  );
  const defaults = useMemo(() => mergeDefaults(options.defaults), [options.defaults]);
  const [prefs, setPrefs] = useState<UserPrefs>(() => readPrefs(storage, defaults));

  const setPref = useCallback(
    <K extends keyof UserPrefs>(key: K, value: UserPrefs[K]): void => {
      writePref(key, value, storage);
      setPrefs((prev) => ({ ...prev, [key]: value }));
    },
    [storage],
  );

  const setChannels = useCallback(
    (channels: string[] | null): void => setPref('channels', channels),
    [setPref],
  );
  const setSort = useCallback((sort: SortKey): void => setPref('sort', sort), [setPref]);
  const setCardLimit = useCallback((limit: number): void => setPref('cardLimit', limit), [setPref]);

  const reset = useCallback((): void => {
    resetPrefs(storage);
    setPrefs({ ...defaults });
  }, [storage, defaults]);

  return { prefs, setPref, setChannels, setSort, setCardLimit, reset };
}

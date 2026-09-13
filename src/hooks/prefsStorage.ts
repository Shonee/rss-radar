// T-P3-01 前端基础设施 — 用户偏好持久化（纯函数，便于单测；hook 包装见 useUserPrefs.ts）
//
// localStorage key 前缀统一 `rss-radar:`。容错要求（IMPLEMENTATION_PLAN T-P3-01）：
//   - localStorage 不可用（file:// / 隐私模式）→ 回落默认值，不抛异常
//   - 单个 key 的 JSON 损坏 → 仅该字段回落默认值，其余保留

export type SortKey = 'updatedAt' | 'publishedAt';

export interface UserPrefs {
 /** display.cardLimit */
  cardLimit: number;
  page1BatchSize: number;
  sort: SortKey;
  /** null = 全部渠道 */
  channels: string[] | null;
  /** MVP 单主题，仅存储不使用 */
  theme: 'light';
}

export const PREFS_PREFIX = 'rss-radar:';

export const DEFAULT_PREFS: UserPrefs = {
  cardLimit: 10,
  page1BatchSize: 20,
  sort: 'updatedAt',
  channels: null,
  theme: 'light',
};

export const PREF_KEYS = {
  cardLimit: `${PREFS_PREFIX}display.cardLimit`,
  page1BatchSize: `${PREFS_PREFIX}page1BatchSize`,
  sort: `${PREFS_PREFIX}sort`,
  channels: `${PREFS_PREFIX}channels`,
  theme: `${PREFS_PREFIX}theme`,
} as const;

/** localStorage 的最小结构（便于测试注入假实现） */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 合并自定义默认值 */
export function mergeDefaults(overrides?: Partial<UserPrefs>): UserPrefs {
  return { ...DEFAULT_PREFS, ...(overrides ?? {}) };
}

/** 读取全部偏好；任何异常均回落默认值 */
export function readPrefs(
  storage: StorageLike | null | undefined,
  defaults: UserPrefs = DEFAULT_PREFS,
): UserPrefs {
  const out: UserPrefs = { ...defaults };
  if (!storage) return out;

  const readRaw = (key: string): string | null => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };

  const cardLimit = readRaw(PREF_KEYS.cardLimit);
  if (cardLimit !== null) {
    const n = Number(cardLimit);
    if (Number.isFinite(n) && n > 0) out.cardLimit = Math.floor(n);
  }

  const batch = readRaw(PREF_KEYS.page1BatchSize);
  if (batch !== null) {
    const n = Number(batch);
    if (Number.isFinite(n) && n > 0) out.page1BatchSize = Math.floor(n);
  }

  const sort = readRaw(PREF_KEYS.sort);
  if (sort === 'updatedAt' || sort === 'publishedAt') out.sort = sort;

  try {
    const channels = readRaw(PREF_KEYS.channels);
    if (channels !== null) {
      const parsed: unknown = JSON.parse(channels);
      if (parsed === null) {
        out.channels = null;
      } else if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        out.channels = parsed.length > 0 ? (parsed as string[]) : null;
      }
    }
  } catch {
    out.channels = defaults.channels; // 仅该字段回落
  }

  const theme = readRaw(PREF_KEYS.theme);
  if (theme === 'light') out.theme = 'light';

  return out;
}

/** 写入单个偏好；写入失败（配额 / 禁用）静默忽略 */
export function writePref<K extends keyof UserPrefs>(
  key: K,
  value: UserPrefs[K],
  storage: StorageLike | null | undefined,
): void {
  if (!storage) return;
  const raw = key === 'channels' ? JSON.stringify(value) : String(value);
  try {
    storage.setItem(PREF_KEYS[key], raw);
  } catch {
    /* 忽略 */
  }
}

/** 清除全部偏好 */
export function resetPrefs(storage: StorageLike | null | undefined): void {
  if (!storage) return;
  for (const key of Object.values(PREF_KEYS)) {
    try {
      storage.removeItem(key);
    } catch {
      /* 忽略 */
    }
  }
}

/** 获取可用 localStorage（不可用返回 null，不抛异常） */
export function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probe = `${PREFS_PREFIX}__probe__`;
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

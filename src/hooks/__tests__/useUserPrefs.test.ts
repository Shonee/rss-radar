// T-P3-01 — useUserPrefs 持久化逻辑单测
//
// 纯读写逻辑位于 ../prefsStorage.ts（便于无 React 环境断言）；
// useUserPrefs() 仅做 React 包装。

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PREFS,
  PREF_KEYS,
  getDefaultStorage,
  readPrefs,
  resetPrefs,
  writePref,
} from '../prefsStorage';
import type { StorageLike } from '../prefsStorage';

class MemoryStorage implements StorageLike {
  store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error('SecurityError: localStorage disabled');
  }
  setItem(): void {
    throw new Error('SecurityError');
  }
  removeItem(): void {
    throw new Error('SecurityError');
  }
}

describe('prefsStorage — 默认值', () => {
  it('storage 为 null 时返回默认值', () => {
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(readPrefs(undefined)).toEqual(DEFAULT_PREFS);
  });

  it('空 storage 返回默认值', () => {
    expect(readPrefs(new MemoryStorage())).toEqual(DEFAULT_PREFS);
  });
});

describe('prefsStorage — 写入后读回', () => {
  it('各字段写入并读回', () => {
    const s = new MemoryStorage();
    writePref('cardLimit', 20, s);
    writePref('page1BatchSize', 40, s);
    writePref('sort', 'publishedAt', s);
    writePref('channels', ['v2ex', 'sspai'], s);
    writePref('theme', 'light', s);

    const prefs = readPrefs(s);
    expect(prefs.cardLimit).toBe(20);
    expect(prefs.page1BatchSize).toBe(40);
    expect(prefs.sort).toBe('publishedAt');
    expect(prefs.channels).toEqual(['v2ex', 'sspai']);
    expect(prefs.theme).toBe('light');
  });

  it('写空 channels 数组 → 读回 null（= 全部）', () => {
    const s = new MemoryStorage();
    writePref('channels', [], s);
    expect(readPrefs(s).channels).toBeNull();
  });
});

describe('prefsStorage — 容错', () => {
  it('channels JSON 损坏 → 仅该字段回落，其余保留', () => {
    const s = new MemoryStorage();
    s.setItem(PREF_KEYS.cardLimit, '20');
    s.setItem(PREF_KEYS.channels, '{not valid json');
    const prefs = readPrefs(s);
    expect(prefs.cardLimit).toBe(20); // 保留
    expect(prefs.channels).toBeNull(); // 回落
  });

  it('非法数值 → 回落默认', () => {
    const s = new MemoryStorage();
    s.setItem(PREF_KEYS.cardLimit, 'abc');
    s.setItem(PREF_KEYS.page1BatchSize, '-5');
    const prefs = readPrefs(s);
    expect(prefs.cardLimit).toBe(DEFAULT_PREFS.cardLimit);
    expect(prefs.page1BatchSize).toBe(DEFAULT_PREFS.page1BatchSize);
  });

  it('localStorage 抛异常 → 回落默认，不抛', () => {
    const bad = new ThrowingStorage();
    expect(() => readPrefs(bad)).not.toThrow();
    expect(readPrefs(bad)).toEqual(DEFAULT_PREFS);
    expect(() => writePref('cardLimit', 5, bad)).not.toThrow();
    expect(() => resetPrefs(bad)).not.toThrow();
  });

  it('resetPrefs 清空已写入字段', () => {
    const s = new MemoryStorage();
    writePref('cardLimit', 5, s);
    resetPrefs(s);
    expect(readPrefs(s)).toEqual(DEFAULT_PREFS);
  });

  it('getDefaultStorage 在无 window 环境返回 null（node 测试环境）', () => {
    expect(getDefaultStorage()).toBeNull();
  });
});

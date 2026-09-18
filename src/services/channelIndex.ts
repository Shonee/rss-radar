import type { Item } from '../types';

/**
 * 一次遍历构建渠道条目索引，避免页面2为每个渠道重复 filter 全量快照。
 * 返回的每个数组已按最近更新时间倒序，调用方可直接映射渲染。
 */
export function indexItemsByChannel(items: readonly Item[]): Map<string, Item[]> {
  const indexed = new Map<string, Item[]>();
  for (const item of items) {
    if (item.duplicateOf) continue;
    const bucket = indexed.get(item.channelId);
    if (bucket) bucket.push(item);
    else indexed.set(item.channelId, [item]);
  }
  for (const bucket of indexed.values()) {
    bucket.sort((a, b) => {
      const av = a.updatedAt || a.publishedAt || '';
      const bv = b.updatedAt || b.publishedAt || '';
      if (av !== bv) return av < bv ? 1 : -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  return indexed;
}

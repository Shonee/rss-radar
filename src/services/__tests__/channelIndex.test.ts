import { describe, expect, it } from 'vitest';
import { indexItemsByChannel } from '../channelIndex';
import type { Item } from '../../types';

function item(id: string, channelId: string, updatedAt: string, duplicateOf?: string): Item {
  return {
    id,
    title: id,
    url: `https://example.com/${id}`,
    channelId,
    channelName: channelId,
    category: [],
    publishedAt: updatedAt,
    updatedAt,
    ...(duplicateOf ? { duplicateOf } : {}),
  } as unknown as Item;
}

describe('indexItemsByChannel', () => {
  it('一次构建渠道索引并过滤重复条目', () => {
    const indexed = indexItemsByChannel([
      item('old', 'a', '2026-09-01T00:00:00Z'),
      item('new', 'a', '2026-09-02T00:00:00Z'),
      item('duplicate', 'a', '2026-09-03T00:00:00Z', 'new'),
      item('other', 'b', '2026-09-01T00:00:00Z'),
    ]);
    expect(indexed.get('a')?.map((entry) => entry.id)).toEqual(['new', 'old']);
    expect(indexed.get('b')?.map((entry) => entry.id)).toEqual(['other']);
    expect(indexed.has('missing')).toBe(false);
  });
});

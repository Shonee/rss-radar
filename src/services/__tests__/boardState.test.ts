// T-P3-fix — resolveBoardState（页面2 看板状态判定）单测
// 覆盖：无卡片 / 全 empty / 含 ok / 含 failed / 含 disabled / 混合 / 单元素 / 大数据
import { describe, it, expect } from 'vitest';
import { resolveBoardState, type BoardCardLike } from '../boardState';

const cards = (...health: string[]): BoardCardLike[] => health.map((h) => ({ health: h }));

describe('resolveBoardState（页面2 看板状态）', () => {
  it('① 无卡片 → empty-none（取消全部渠道 / 分类筛选无命中）', () => {
    expect(resolveBoardState([])).toBe('empty-none');
  });

  it('② 全部 empty → empty-all（PRD:587 全部无数据 → 全局空态）', () => {
    expect(resolveBoardState(cards('empty'))).toBe('empty-all');
    expect(resolveBoardState(cards('empty', 'empty', 'empty'))).toBe('empty-all');
    expect(resolveBoardState(cards(...Array.from({ length: 8 }, () => 'empty')))).toBe('empty-all');
  });

  it('③ 含 ok（有内容）→ board（不降级，即使其余为空）', () => {
    expect(resolveBoardState(cards('ok'))).toBe('board');
    expect(resolveBoardState(cards('empty', 'empty', 'ok'))).toBe('board');
  });

  it('④ 含 failed → board（保留失败角标，失去排查线索是更严重的回归）', () => {
    expect(resolveBoardState(cards('failed'))).toBe('board');
    // 收窄条件：全 empty + 1 个 failed 仍要看板，不能吞掉失败线索
    expect(resolveBoardState(cards('empty', 'empty', 'failed'))).toBe('board');
  });

  it('⑤ 含 disabled → board（停用渠道仍需可见其停用标记）', () => {
    expect(resolveBoardState(cards('disabled'))).toBe('board');
    expect(resolveBoardState(cards('empty', 'disabled'))).toBe('board');
  });

  it('⑥ 混合 ok/failed/disabled/empty → board（非全 empty 即看板）', () => {
    expect(resolveBoardState(cards('ok', 'failed', 'disabled', 'empty'))).toBe('board');
    expect(resolveBoardState(cards('failed', 'disabled'))).toBe('board');
  });

  it('⑦ 仅认 health 字段：itemCount 不影响判定（health 已隐含含量信息）', () => {
    // 契约：健康态由上游（Page2 的 health 计算）决定，本函数不二次推断内容量
    expect(resolveBoardState([{ health: 'ok', itemCount: 0 }])).toBe('board');
    expect(resolveBoardState([{ health: 'empty', itemCount: 0 }])).toBe('empty-all');
    expect(resolveBoardState([{ health: 'empty' }, { health: 'ok', itemCount: 3 }])).toBe('board');
  });
});

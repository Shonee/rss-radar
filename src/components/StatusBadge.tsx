// T-P3-02 公共组件库 — 状态徽标
//
// ARCHITECTURE §15.4 硬要求：「文案与图标集中在此文件一处定义」，便于后续调整。
// 所有页面（1/2/4）统一使用同一套 urlStatus → 徽标的映射。

import Chip from '@mui/material/Chip';
import type { UrlStatus } from '../types';
import type { ChannelHealth } from '../types/api';
import { tokens } from '../theme/tokens';

export type StatusKind =
  | 'new'
  | 'sources'
  | 'dead'
  | 'source-dead'
  | 'moved'
  | 'blocked'
  | 'fetch-failed'
  | 'disabled'
  | 'empty';

export interface StatusMeta {
  /** 展示文案 */
  label: string;
  /** 前置图标（Unicode，集中定义） */
  symbol: string;
  bg: string;
  fg: string;
  border: string;
}

/** 全站唯一的文案 / 图标来源 */
export const STATUS_META: Record<StatusKind, StatusMeta> = {
  new: { label: 'NEW', symbol: '', bg: tokens.primary.weak, fg: tokens.primary.active, border: tokens.primary.weak2 },
  sources: { label: '源', symbol: '＋', bg: tokens.gray[100], fg: tokens.gray[700], border: tokens.gray[200] },
  dead: { label: '已失效', symbol: '×', bg: tokens.semantic.dangerBg, fg: tokens.semantic.dangerText, border: tokens.semantic.dangerBorder },
  'source-dead': { label: '原链接已失效', symbol: '⚠', bg: tokens.semantic.warningBg, fg: tokens.semantic.warningText, border: tokens.semantic.warningBorder },
  moved: { label: '已迁移', symbol: '↗', bg: tokens.semantic.infoBg, fg: tokens.semantic.infoText, border: tokens.semantic.infoBorder },
  blocked: { label: '可能需验证', symbol: '⚠', bg: tokens.semantic.warningBg, fg: tokens.semantic.warningText, border: tokens.semantic.warningBorder },
  'fetch-failed': { label: '抓取失败', symbol: '✕', bg: tokens.semantic.dangerBg, fg: tokens.semantic.dangerText, border: tokens.semantic.dangerBorder },
  disabled: { label: '停用', symbol: '⏸', bg: tokens.gray[100], fg: tokens.gray[500], border: tokens.gray[200] },
  empty: { label: '无数据', symbol: '–', bg: tokens.gray[100], fg: tokens.gray[500], border: tokens.gray[200] },
};

/** urlStatus → 徽标（ok / 缺省返回 null 表示无感知） */
export function urlStatusToKind(status: UrlStatus, hasAlternate: boolean): StatusKind | null {
  if (status === 'dead') return hasAlternate ? 'source-dead' : 'dead';
  if (status === 'moved') return 'moved';
  if (status === 'blocked') return 'blocked';
  return null;
}

/** 渠道健康状态 → 徽标（ok 返回 null） */
export function healthToKind(health: ChannelHealth): StatusKind | null {
  if (health === 'failed') return 'fetch-failed';
  if (health === 'disabled') return 'disabled';
  if (health === 'empty') return 'empty';
  return null;
}

export interface StatusBadgeProps {
  kind: StatusKind;
  /** kind === 'sources' 时用于计算「＋N 源」 */
  count?: number;
  title?: string;
  onClick?: () => void;
  expanded?: boolean;
  testId?: string;
}

export default function StatusBadge({
  kind,
  count,
  title,
  onClick,
  expanded,
  testId,
}: StatusBadgeProps) {
  const meta = STATUS_META[kind];
  let text = meta.label;
  if (kind === 'sources' && typeof count === 'number') {
    text = `${Math.max(count - 1, 0)} 源`;
  }
  const label = meta.symbol ? `${meta.symbol} ${text}` : text;
  const clickable = typeof onClick === 'function';

  return (
    <Chip
      data-testid={testId ?? 'status-badge'}
      data-status-kind={kind}
      size="small"
      label={label}
      title={title}
      onClick={onClick}
      aria-expanded={clickable ? expanded === true : undefined}
      sx={{
        bgcolor: meta.bg,
        color: meta.fg,
        border: `1px solid ${meta.border}`,
        fontWeight: 500,
        cursor: clickable ? 'pointer' : 'default',
      }}
    />
  );
}

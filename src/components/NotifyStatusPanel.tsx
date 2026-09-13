// T-P3-02 公共组件库 — 通知状态面板（折叠 / 只读）
//
// ARCHITECTURE §12 硬约束：**只读、无任何触发发送的按钮**。

import { useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import type { NotifyStats } from '../types/api';
import { tokens } from '../theme/tokens';
import { formatAbsolute, formatRelative } from '../services/time';

export interface NotifyStatusPanelProps {
  stats: NotifyStats;
  defaultOpen?: boolean;
  testId?: string;
}

export default function NotifyStatusPanel({
  stats,
  defaultOpen = false,
  testId = 'notify-panel',
}: NotifyStatusPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Box
      data-testid={testId}
      data-component="notify-panel"
      sx={{
        border: `1px solid ${tokens.surface.border}`,
        borderRadius: tokens.radius.md,
        bgcolor: tokens.surface.surface,
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen((v) => !v);
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 1.5,
          cursor: 'pointer',
        }}
      >
        <Typography sx={{ fontWeight: 600, fontSize: tokens.fs.base }}>通知状态</Typography>
        <IconButton size="small" aria-expanded={open} aria-label={open ? '收起' : '展开'} tabIndex={-1}>
          {open ? '⌃' : '⌄'}
        </IconButton>
      </Box>

      {open && (
        <Box data-testid="notify-panel-body" sx={{ px: 1.5, pb: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 3, fontSize: tokens.fs.sm, color: tokens.surface.text2 }}>
            <span>
              上次发送：
              <strong style={{ color: tokens.surface.text }}>
                {stats.lastSentAt
                  ? `${formatRelative(stats.lastSentAt)}（${formatAbsolute(stats.lastSentAt)}）`
                  : '暂无'}
              </strong>
            </span>
            <span>
              成功 <strong style={{ color: tokens.semantic.success }}>{stats.successCount}</strong>
              {' / '}
              失败 <strong style={{ color: tokens.semantic.danger }}>{stats.failureCount}</strong>
            </span>
            <span>
              启用渠道 <strong>{stats.enabledChannels}</strong>
            </span>
          </Box>

          {stats.records.length > 0 && (
            <Box sx={{ mt: 1, fontSize: tokens.fs.xs, color: tokens.surface.text3 }}>
              {stats.records.slice(0, 5).map((r) => (
                <Box key={r.id} sx={{ py: 0.25 }}>
                  {formatRelative(r.sentAt)} · {r.channelId} · {r.event} ·{' '}
                  {r.success ? '成功' : `失败${r.error ? `（${r.error}）` : ''}`}
                </Box>
              ))}
            </Box>
          )}

          <Typography sx={{ mt: 1, fontSize: tokens.fs.xs, color: tokens.surface.text3 }}>
            仅展示状态，不支持在网页端触发发送（避免静态站泄露通知凭证）。
          </Typography>
        </Box>
      )}
    </Box>
  );
}

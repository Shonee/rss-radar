// T-P3-02 公共组件库 — 空态
import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import { tokens } from '../theme/tokens';

export interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
}

export default function EmptyState({
  title = '暂无数据',
  description,
  action,
  testId = 'empty-state',
}: EmptyStateProps) {
  return (
    <Box
      data-testid={testId}
      data-component="empty-state"
      sx={{
        textAlign: 'center',
        py: 6,
        px: 3,
        color: tokens.surface.text2,
        border: `1px dashed ${tokens.surface.border}`,
        borderRadius: tokens.radius.md,
      }}
    >
      <Box sx={{ fontSize: tokens.fs['2xl'], mb: 1, color: tokens.surface.text3 }} aria-hidden>
        ∅
      </Box>
      <Box sx={{ fontWeight: 600, fontSize: tokens.fs.lg, color: tokens.surface.text }}>{title}</Box>
      {description && (
        <Box sx={{ mt: 1, fontSize: tokens.fs.sm, lineHeight: tokens.lh.base }}>{description}</Box>
      )}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  );
}

// T-P3-02 公共组件库 — 异常态黄条（抓取失败 warning / 数据延迟 info）
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import { tokens } from '../theme/tokens';

export interface AlertBarProps {
  severity: 'warning' | 'info';
  children: ReactNode;
  testId?: string;
}

export default function AlertBar({ severity, children, testId = 'alert-bar' }: AlertBarProps) {
  return (
    <Box data-testid={testId} data-component="alert-bar" data-severity={severity} sx={{ mb: 1 }}>
      <Alert
        severity={severity}
        sx={{
          border: `1px solid ${
            severity === 'warning' ? tokens.semantic.warningBorder : tokens.semantic.infoBorder
          }`,
        }}
      >
        {children}
      </Alert>
    </Box>
  );
}

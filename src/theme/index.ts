// T-P3-01 前端基础设施 — MUI 主题（浅色单模式，对齐 prototype/assets/css/tokens.css）
//
// 决策 D10 = MVP 浅色主题单模式（与 prototype 一致）。本文件取代旧 src/theme.ts
// （旧文件误用 dark + 紫色主色，已删除）。

import { createTheme } from '@mui/material/styles';
import { tokens } from './tokens';

// 允许 `import { tokens, categoryColor } from '../theme'`
export * from './tokens';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: tokens.primary.main,
      dark: tokens.primary.active,
      light: tokens.primary.hover,
      contrastText: tokens.primary.on,
    },
    secondary: {
      main: tokens.chart[3],
      contrastText: tokens.primary.on,
    },
    success: { main: tokens.semantic.success, contrastText: tokens.primary.on },
    warning: { main: tokens.semantic.warning, contrastText: tokens.primary.on },
    error: { main: tokens.semantic.danger, contrastText: tokens.primary.on },
    info: { main: tokens.semantic.info, contrastText: tokens.primary.on },
    background: {
      default: tokens.surface.bg,
      paper: tokens.surface.surface,
    },
    text: {
      primary: tokens.surface.text,
      secondary: tokens.surface.text2,
      disabled: tokens.surface.text3,
    },
    divider: tokens.surface.border,
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: tokens.font.sans,
    fontSize: 14,
    h1: { fontSize: tokens.fs['3xl'], fontWeight: 700, lineHeight: String(tokens.lh.tight) },
    h2: { fontSize: tokens.fs['2xl'], fontWeight: 600, lineHeight: String(tokens.lh.tight) },
    h3: { fontSize: tokens.fs.xl, fontWeight: 600, lineHeight: String(tokens.lh.snug) },
    body1: { fontSize: tokens.fs.base, lineHeight: String(tokens.lh.base) },
    body2: { fontSize: tokens.fs.sm, lineHeight: String(tokens.lh.base) },
    button: { textTransform: 'none', fontWeight: 500 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: tokens.surface.bg,
          color: tokens.surface.text,
          fontFamily: tokens.font.sans,
        },
        a: { color: 'inherit' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: tokens.shadow[1],
          border: `1px solid ${tokens.surface.border}`,
          borderRadius: tokens.radius.md,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: tokens.shadow[1],
          border: `1px solid ${tokens.surface.border}`,
          borderRadius: tokens.radius.md,
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', boxShadow: 'none', fontWeight: 500 },
        sizeSmall: { fontSize: tokens.fs.sm },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontSize: tokens.fs.xs, height: 22, borderRadius: tokens.radius.full },
        sizeSmall: { fontSize: tokens.fs.xs, height: 20 },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: { backgroundImage: 'none', backgroundColor: tokens.surface.surface },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none', fontSize: tokens.fs.base, minHeight: 40 },
      },
    },
  },
});

export default theme;

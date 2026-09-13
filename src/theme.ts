// MUI 主题（与 prototype/tokens.css 对齐）
// ARCHITECTURE §2.2 — D9 MVP 不做 PWA，D10 MVP 单主题
import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7c5cff' },
    secondary: { main: '#34c759' },
    error: { main: '#ff453a' },
    warning: { main: '#ffb020' },
    background: { default: '#0f1216', paper: '#171b21' },
    text: {
      primary: '#e6e8eb',
      secondary: '#9aa3ad',
      disabled: '#6b7380',
    },
    divider: '#262c36',
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", sans-serif',
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#0f1216',
          color: '#e6e8eb',
        },
      },
    },
  },
});
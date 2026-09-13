import type { Config } from 'tailwindcss';

// ARCHITECTURE §2.2 — MUI 与 Tailwind preflight 兼容：关闭 preflight，由 MUI 的 CssBaseline 提供 normalize
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // 与 prototype tokens 对齐
        bg: '#0f1216',
        surface: '#171b21',
        'surface-2': '#1f242c',
        border: '#262c36',
        'text-1': '#e6e8eb',
        'text-2': '#9aa3ad',
        'text-3': '#6b7380',
        brand: '#7c5cff',
        ok: '#34c759',
        warn: '#ffb020',
        danger: '#ff453a',
      },
    },
  },
  plugins: [],
};

export default config;
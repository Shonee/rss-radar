import type { Config } from 'tailwindcss';

// ARCHITECTURE §2.2 — MUI 与 Tailwind preflight 兼容：关闭 preflight，由 MUI 的 CssBaseline 提供 normalize
// T-P3-01/02 — 色值全部改为浅色主题（对齐 prototype/assets/css/tokens.css，与 src/theme/tokens.ts 同源）
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // 语义化表面 / 文本 / 描边（浅色）
        bg: '#f6f7f9', // --color-bg (gray-50)
        surface: '#ffffff', // --color-surface (gray-0)
        'surface-2': '#eef0f3', // --color-surface-2 (gray-100)
        'surface-sunken': '#f6f7f9', // --color-surface-sunken
        'surface-hover': '#fafbfc', // --color-surface-hover (gray-25)
        border: '#e3e6ea', // --color-border (gray-200)
        'border-strong': '#cfd4da', // --color-border-strong (gray-300)
        'text-1': '#1f2329', // --color-text (gray-900)
        'text-2': '#5a6169', // --color-text-2 (gray-600)
        'text-3': '#8a9199', // --color-text-3 (gray-500)
        // 品牌 / 语义色（浅色）
        brand: '#2f6bff', // --color-primary
        'brand-hover': '#2557d6',
        'brand-weak': '#eaf0ff',
        ok: '#16a34a', // --color-success
        warn: '#c77700', // --color-warning
        'warn-bg': '#fff6e5',
        'warn-border': '#f0c778',
        'warn-text': '#7a4a00',
        danger: '#d92d20', // --color-danger
        'danger-bg': '#fdecea',
        'danger-border': '#f3b4ae',
        'danger-text': '#8a1c14',
        info: '#0b8ac9', // --color-info
        'info-bg': '#e5f4fb',
        'info-border': '#b3e0f2',
        'info-text': '#075985',
      },
    },
  },
  plugins: [],
};

export default config;

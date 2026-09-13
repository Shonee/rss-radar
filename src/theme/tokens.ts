// T-P3-02 公共组件库 — 设计令牌（1:1 对齐 prototype/assets/css/tokens.css）
//
// 唯一来源约定：颜色 / 间距 / 字号 / 圆角 / 阴影全部取自此处，
// 组件与页面严禁硬编码色值，只能用 tokens.* 或 Tailwind 里由 tokens 派生的语义类。
// 主题：浅色（light），color-scheme: light，主色 #2f6bff。

import type { CategoryKey } from '../types/models';

export const tokens = {
  /** 品牌主色三态 + 弱色 + on-primary */
  primary: {
    main: '#2f6bff',
    hover: '#2557d6',
    active: '#1e46b0',
    weak: '#eaf0ff',
    weak2: '#d6e2ff',
    on: '#ffffff',
  },

  /** 中性灰阶 12 档 */
  gray: {
    0: '#ffffff',
    25: '#fafbfc',
    50: '#f6f7f9',
    100: '#eef0f3',
    200: '#e3e6ea',
    300: '#cfd4da',
    400: '#aab1b8',
    500: '#8a9199',
    600: '#5a6169',
    700: '#3d434a',
    800: '#262b31',
    900: '#1f2329',
  },

  /** 语义色（success / warning / danger / info 各含 base / bg / border / text） */
  semantic: {
    success: '#16a34a',
    successBg: '#e8f8ee',
    warning: '#c77700',
    warningBg: '#fff6e5',
    warningBgStrong: '#ffefd1',
    warningBorder: '#f0c778',
    warningText: '#7a4a00',
    danger: '#d92d20',
    dangerBg: '#fdecea',
    dangerBorder: '#f3b4ae',
    dangerText: '#8a1c14',
    info: '#0b8ac9',
    infoBg: '#e5f4fb',
    infoBorder: '#b3e0f2',
    infoText: '#075985',
  },

  /** 排行榜名次色（bg + text） */
  rank: {
    1: { bg: '#ffe1e1', text: '#c62828' },
    2: { bg: '#ffeccf', text: '#b26a00' },
    3: { bg: '#e5f3ff', text: '#0b6ba8' },
  },

  /** 渐变 / 图表端点 */
  chart: {
    heroFrom: '#f2f6ff',
    progressTo: '#6f9bff',
    1: '#2f6bff',
    2: '#f57c00',
    3: '#00897b',
  },

  /** 语义化 surface / border / text */
  surface: {
    bg: '#f6f7f9',
    surface: '#ffffff',
    surface2: '#eef0f3',
    sunken: '#f6f7f9',
    hover: '#fafbfc',
    border: '#e3e6ea',
    borderStrong: '#cfd4da',
    text: '#1f2329',
    text2: '#5a6169',
    text3: '#8a9199',
    textInverse: '#ffffff',
  },

  /** 分类色（对齐 docs/data-model/examples/sources.example.json） */
  cat: {
    tech_blog: '#7b1fa2',
    tech_media: '#1976d2',
    ai: '#00897b',
    dev_community: '#f57c00',
    product_design: '#c2185b',
    news: '#455a64',
    opensource: '#388e3c',
    podcast: '#6d4c41',
    video: '#e53935',
    security: '#5d4037',
    other: '#757575',
  },

  /** 间距刻度 */
  space: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px',
    12: '48px',
  },

  /** 字号刻度 */
  fs: {
    xs: '12px',
    sm: '13px',
    base: '14px',
    md: '15px',
    lg: '16px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '30px',
    metric: '30px',
  },

  /** 行高 */
  lh: {
    tight: 1.3,
    snug: 1.45,
    base: 1.6,
    loose: 1.75,
  },

  /** 字重 */
  fw: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  /** 圆角 6 档 */
  radius: {
    xs: '4px',
    sm: '6px',
    md: '10px',
    lg: '14px',
    xl: '20px',
    full: '999px',
  },

  /** 阴影 4 档 */
  shadow: {
    1: '0 1px 2px rgba(16, 24, 40, .06)',
    2: '0 2px 8px rgba(16, 24, 40, .08)',
    3: '0 8px 24px rgba(16, 24, 40, .12)',
    4: '0 16px 48px rgba(16, 24, 40, .18)',
  },

  /** 层级 z-index 5 档 */
  z: {
    base: 0,
    sticky: 100,
    dropdown: 500,
    drawerScrim: 900,
    drawer: 1000,
    toast: 2000,
  },

  /** 版式 */
  font: {
    sans:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    mono:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },

  contentMax: '1320px',
  headerH: '60px',

  /** 过渡 2 档 */
  transition: {
    fast: '120ms ease',
    base: '200ms ease',
  },
} as const;

/**
 * 13 个 CategoryKey → 颜色。
 *
 * tokens.css 只列出 11 个 `--cat-*`；缺的 `newsletter` / `finance` 无专属
 * 品牌色，用 `--gray-600` 系补齐；`other` 用 `--cat-other`。
 */
export const CATEGORY_COLORS: Record<CategoryKey, string> = {
  tech_blog: tokens.cat.tech_blog,
  tech_media: tokens.cat.tech_media,
  ai: tokens.cat.ai,
  dev_community: tokens.cat.dev_community,
  product_design: tokens.cat.product_design,
  news: tokens.cat.news,
  opensource: tokens.cat.opensource,
  podcast: tokens.cat.podcast,
  video: tokens.cat.video,
  security: tokens.cat.security,
  other: tokens.cat.other,
  newsletter: tokens.gray[600],
  finance: tokens.gray[600],
};

/** 取分类色；未知 key 回落 gray-600，保证永不为空。 */
export function categoryColor(key: CategoryKey): string {
  return CATEGORY_COLORS[key] ?? tokens.gray[600];
}

export type Tokens = typeof tokens;

// T-P3-02 公共组件库 — 分类元数据（label 来源 config/categories.json；色值统一走 tokens）
import categoriesJson from '../../config/categories.json';
import type { CategoryKey } from '../types/models';
import { categoryColor } from '../theme/tokens';

const FALLBACK_LABELS: Record<CategoryKey, string> = {
  tech_blog: '技术博客',
  tech_media: '技术媒体',
  ai: 'AI',
  news: '新闻资讯',
  dev_community: '开发者社区',
  podcast: '播客',
  newsletter: 'Newsletter',
  finance: '金融',
  other: '其他',
  product_design: '产品设计',
  video: '视频',
  security: '安全',
  opensource: '开源',
};

function buildLabels(): Record<CategoryKey, string> {
  const out: Record<CategoryKey, string> = { ...FALLBACK_LABELS };
  const raw = (categoriesJson as { categories?: Array<{ key?: unknown; label?: unknown }> }).categories;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item) continue;
      const key = item.key;
      const label = item.label;
      if (typeof key === 'string' && typeof label === 'string' && key in out) {
        out[key as CategoryKey] = label;
      }
    }
  }
  return out;
}

export const CATEGORY_LABELS: Record<CategoryKey, string> = buildLabels();

export function categoryLabel(key: CategoryKey): string {
  return CATEGORY_LABELS[key] ?? key;
}

export interface CategoryMeta {
  key: CategoryKey;
  label: string;
  color: string;
}

export function categoryMeta(key: CategoryKey): CategoryMeta {
  return { key, label: categoryLabel(key), color: categoryColor(key) };
}

export const CATEGORY_META: CategoryMeta[] = (Object.keys(CATEGORY_LABELS) as CategoryKey[]).map(
  (key) => categoryMeta(key),
);

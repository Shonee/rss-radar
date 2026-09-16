// T-P3-02 公共组件库 — 数据延迟 / 可能非最新横幅（黄色）
//
// 判定口径见 ARCHITECTURE §6.3.3：now - generatedAt > 60 分钟 → 顶部黄条。
import Alert from '@mui/material/Alert';
import type { DataSource } from '../types';

export interface StaleBannerProps {
  /** 数据来源（raw / fastly / gcore / jsdelivr / local） */
  source?: DataSource | null;
  /** 最近一次数据生成时刻（ISO） */
  generatedAt?: string | null;
  testId?: string;
}

const SOURCE_LABEL: Record<DataSource, string> = {
  raw: '源站',
  fastly: 'CDN（Fastly）',
  gcore: 'CDN（Gcore）',
  jsdelivr: 'CDN（jsDelivr）',
  local: '本地缓存',
};

export default function StaleBanner({
  source,
  generatedAt,
  testId = 'stale-banner',
}: StaleBannerProps) {
  const from = source ? SOURCE_LABEL[source] : '本地缓存';
  return (
    <Alert data-testid={testId} data-component="stale-banner" severity="warning">
      数据可能非最新（来源：{from}
      {generatedAt ? `，生成于 ${generatedAt}` : ''}）。
    </Alert>
  );
}

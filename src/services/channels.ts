// 渠道清单口径的唯一来源（T-P6-05）
// 背景：P6 首次引入停用渠道（iao-su, enabled:false）后，页面1 与页面2 各自从
// config/sources.json 派生渠道数，导致「共 N 个渠道」口径分叉（32 vs 31）。
import channelsManifest from 'virtual:rss-radar-channels-ui';

/** 配置中的渠道原始形状（页面消费的最小字段集） */
export interface RawChannel {
  id: string;
  name: string;
  homepage: string;
  category: string[];
  enabled?: boolean;
  icon?: string;
}

/** 全量渠道（含 enabled:false 的停用渠道） */
export const ALL_CHANNELS = channelsManifest as unknown as RawChannel[];

/**
 * 启用渠道 —— 所有面向用户的「共 N 个渠道」类口径的**唯一**来源。
 * 停用渠道不参与采集（不会产出任何条目），因此不计入。
 */
export const ENABLED_CHANNELS: RawChannel[] = ALL_CHANNELS.filter((c) => c.enabled !== false);

/** 启用渠道 id 集合（快速判定某个渠道是否启用） */
export const ENABLED_CHANNEL_IDS: ReadonlySet<string> = new Set(ENABLED_CHANNELS.map((c) => c.id));

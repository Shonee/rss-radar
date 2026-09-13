// scripts/collect/connectors/feed.mjs
// 兼容性 barrel：T-P2-07 起 rss/atom/json_feed 已拆为独立 connector
// 本文件保留仅作向后兼容 —— 实际注册由 feed-rss / feed-atom / feed-json 完成
// 主入口（connectors/index.mjs）不应再 register() rss/atom/json_feed

export { run } from './feed-rss.mjs'; // 默认导出 RSS（兼容旧调用方）
export const types = ['rss', 'atom', 'json_feed'];

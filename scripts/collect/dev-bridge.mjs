// scripts/collect/dev-bridge.mjs — 占位入口（主流程已合入 index.mjs）
// P1 dev bridge 行为：collect 后自动 copy 到 public/data/today/ + 维护 latest 软链
// 本文件仅作为未来若 dev bridge 与 collect 解耦时的扩展点（P3）
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const DEV_BRIDGE_README = `
dev bridge 行为说明：
- 跑 npm run collect:once 后，scripts/collect/index.mjs 会自动：
  1. 写 tmp/today/snapshot-YYYY-MM-DD.json（不进 deploy 分支）
  2. 复制到 public/data/today/snapshot-YYYY-MM-DD.json
  3. 在 public/data/today/latest.json 创建软链 → snapshot-<当日>.json
- npm run dev 时，Vite 把 public/ 暴露在 /data/ 路径
- 前端 src/pages/Page1HotStream.tsx fetch './data/today/snapshot.json' 即拿到当天数据
`;

if (process.argv[1] && process.argv[1].endsWith('dev-bridge.mjs')) {
  // 显式跑 dev-bridge.mjs 时只打印说明
  console.log(DEV_BRIDGE_README);
}
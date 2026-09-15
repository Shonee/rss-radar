#!/usr/bin/env node
/**
 * 采集器 CLI 入口（P2 完整版：ARCHITECTURE §3.7 / §6.7）
 *
 * 真实业务逻辑见 ./main.mjs，本文件仅做 CLI 参数识别 + --help 早退出。
 *
 * 用法：
 *   node scripts/collect/index.mjs --once
 *   node scripts/collect/index.mjs --only <source-id>
 *   node scripts/collect/index.mjs --only <source-id> --dry-run
 *   node scripts/collect/index.mjs --help
 *
 * 行为：
 *   --only 过滤 source.id
 *   --dry-run 仅打印归一化后的 Item[]，不写盘
 *   --skip-health 跳过 URL 健康检查（不回写 sources.json 的 lastStatus）
 *   --allow-partial-success 部分失败时仍以 0 退出（供 Actions 发布成功产物）
 *   --out <dir> 自定义输出根目录（默认 tmp/deploy，P1 行为兼容）
 *   全部 enabled 源全跑；任意源失败不阻断整体（allSettled 语义）
 *   退出码：0=全部 ok；1=全部失败；2=部分失败
 *
 * 设计：先识别 --help/-h 在模块顶部直接退出，避免 lazy import connectors
 * 之前的 rss-parser 解析错误（npm install 未跑时也能跑 --help）。
 */

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log([
    '用法：node scripts/collect/index.mjs [options]',
    '',
    '选项：',
    '  --once               跑一次全部 enabled 源（默认也是 --once 行为）',
    '  --only <source-id>   只跑指定 source.id',
    '  --dry-run            仅打印 Item[]，不写盘',
    '  --skip-health        跳过 URL 健康检查（不回写 sources.json 的 lastStatus）',
    '  --allow-partial-success  部分失败时仍以 0 退出（供 Actions 发布成功产物）',
    '  --out <dir>          输出根目录（默认 tmp/deploy）',
    '  --help, -h           显示帮助',
  ].join('\n'));
  process.exit(0);
}

const { main } = await import('./main.mjs');
main().catch((err) => {
  console.error('[collect] fatal:', err);
  process.exit(2);
});

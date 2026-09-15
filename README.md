# RSS Radar

> 把散落在各处的 RSS 源，汇聚成一份每天更新的信息雷达与热点报告。

[![阶段](https://img.shields.io/badge/P3-frontend%2Bnotify-blue)]() [![Node >=20](https://img.shields.io/badge/node-%3E%3D20-green)]() [![TS strict](https://img.shields.io/badge/TS-strict-blue)]()

## 一句话

RSS Radar = **多源 RSS 采集 → 去重聚合 → 当天报告**，纯静态前端 + GitHub Actions 自动化调度。可部署到 GitHub Pages 或 Cloudflare Pages（Direct Upload）。

## 功能页面

站点共四个页面，均为纯前端渲染，数据来自构建期内联 + 运行时 fetch 双轨加载的当日快照与报告。

- **页面1 · 聚合热榜流**：把当日全部来源的条目按热度排序铺成一条流，支持按渠道、分类、时间窗筛选；顶部状态条展示启用渠道数与当日条目数。桌面端 ≥1024px 时左侧为 248px 粘性筛选栏，窄屏折叠进顶部筛选抽屉。
- **页面2 · 渠道看板**：以卡片形式逐个渠道展示采集健康度（成功 / 失败 / 停用）、条数与来源构成；可展开配置抽屉调整该渠道的启停与偏好。
- **页面3 · 分析报告**：当日快照的结构化分析——总量、渠道占比、分类分布、热点条目排行，百分比全站统一用最大余数法取整（Σ 恒 100）。
- **页面4 · 历史趋势与回看**：按月归档读取历史快照，对比多条趋势曲线并逐日回看当日榜单。

> 本地联调时可用 `npm run seed:history` 生成历史数据，供页面4 使用。实机截图位于 `docs/qa/screenshots/`，不在本文档内联展示（避免加载缓慢）。

## 5 分钟快速开始

```bash
# 1. 克隆与安装
git clone <your-fork>/rss-radar && cd rss-radar
npm install --registry=https://registry.npmmirror.com

# 2. 跑一次采集
#    产物：tmp/deploy/today/{events-<date>.ndjson,snapshot-<date>.json,report-<date>.json,latest.json}
#    dev bridge 会同步复制到 public/data/today/，供本地页面读取
npm run collect:once

# 3.（可选）生成本地历史数据，供页面4 联调
npm run seed:history

# 4. 启动 dev server，浏览器打开 http://localhost:5173/#/
npm run dev
```

> 路由用 `HashRouter`，所以地址带 `#/`：`http://localhost:5173/#/`（页面1）、`#/channels`、`#/report`、`#/history`、`#/about`。

### ⚠️ 安装依赖必须指定 registry

| 源 | 状态 |
|---|---|
| `registry.npmjs.org`（官方） | ✅ 通（约 859ms） |
| `registry.npmmirror.com`（淘宝） | ✅ 通（约 0.3s，更快，推荐） |

所以统一用：

```bash
npm install --registry=https://registry.npmmirror.com
```

不想每次敲参数，写进**用户级** `~/.npmrc` 即可一劳永逸：

```bash
npm config set registry https://registry.npmmirror.com --location=user
```

> **注意**：不要把 registry 写进项目级 `.npmrc` 并入库——CI（GitHub Actions）在境外，走淘宝源反而更慢。仓库内保持不指定 registry，由各执行环境自行决定。

**为什么重要**：P1~P2 阶段一直误以为「沙箱无 npm install」，因此绕路走了 dynamic import + 手写降级实现。装了依赖后 `ajv` / `rss-parser` / `papaparse` / TypeScript 全部可用，立刻暴露出 4 个被掩盖的 latent bug（schema enum 漂移、ajv strictRequired 崩溃、strict 类型错误）。**P3 起一律装依赖后真跑 `npm run dev` / `build` / `typecheck` / `test`，不要再走静态路线。**

## 目录结构（速览）

| 路径 | 作用 |
|---|---|
| `src/` | 前端 React + MUI + Tailwind 源码（5 条路由，见下） |
| `src/pages/` | 页面1 聚合热榜 / 页面2 渠道看板 / 页面3 分析报告 / 页面4 历史趋势与回看 / 关于 |
| `src/components/` | 公共组件库（ItemCard / ChannelCard / Chart / NotifyStatusPanel / …） |
| `src/hooks/` | `useSnapshot` / `useReport` / `useHistory` / `useNotifyStats` / `useUserPrefs` … |
| `src/services/` | `dataClient` / `historyClient` / `notifyStatsClient` / `hotScore` / `time` |
| `src/types/` | 数据模型 TS 类型（据 schema 手写） |
| `scripts/collect/` | 采集器：连接器（8 种 type）+ 排除 + 去重 + 归一化 + 编排 |
| `scripts/notify/` | 通知模块：4 渠道适配器 + 模板 + 节流幂等 |
| `scripts/dev/` | 本地开发辅助（`seed-history.mjs`） |
| `scripts/validate-schema.mjs` | ajv 校验 config / schema |
| `scripts/smoke/` | smoke-test：产物契约断言 + e2e 管线 |
| `config/` | 站点默认配置（sources / exclusions / notify / site-config / …；当前 11 个 RSS 渠道） |
| `docs/` | PRD / ARCHITECTURE / 数据模型 / 实施计划 / 本套使用文档 |

更详细的目录解释见 [`docs/ARCHITECTURE.md` §8](./docs/ARCHITECTURE.md)。

## 5 条路由与代码分割

前端 5 条路由（`src/App.tsx`）：

| 路由 | 页面 |
|---|---|
| `/` | 页面1 聚合热榜（底部含只读「通知状态」面板） |
| `/channels` | 页面2 渠道看板 |
| `/report` | 页面3 分析报告（只做当天） |
| `/history` | 页面4 历史趋势与回看 |
| `/about` | 关于（通知配置说明 + 数据来源） |

- **主题**：**浅色单主题**（架构决策 D10；`src/theme/index.ts`，`palette.mode: 'light'`）。P1 原型曾误用 dark + 紫色主色，已在 `5e8eebc` 纠正。
- **路由级代码分割**：页面1 与外壳静态导入（首屏关键路径），页面2/3/4/关于用 `React.lazy` 懒加载，各自独立 chunk；MUI / React / Router 由 `vite.config.ts` 的 `manualChunks` 拆到 vendor chunk。当前 `npm run build` 产物主 chunk（`index-*.js`）约 **43 kB**（gzip ≈ 16 kB）。

## 常用脚本（`package.json` 全集）

```bash
# 开发与构建
npm run dev          # 启动 vite dev server（0.0.0.0:5173）
npm run build        # tsc -b && vite build → dist/
npm run preview      # 预览构建产物（0.0.0.0:4173）
npm run typecheck    # tsc -b --noEmit

# 测试（npm test = node:test + vitest 两套）
npm test             # = npm run test:node && npm run test:vitest
npm run test:node    # node --test（collect / smoke / notify / hooks 的 .test.mjs）
npm run test:vitest  # vitest run（前端 services / hooks 的单测）
npm run test:watch   # node --test --watch
npm run test:e2e     # node scripts/smoke/e2e-pipeline.mjs（mock fixture 全管线）

# 校验与采集
npm run smoke        # bash scripts/smoke/run.sh（collect → validate → 产物契约断言）
npm run validate     # ajv 校验 config/*.json
npm run collect      # node scripts/collect/index.mjs
npm run collect:once # node scripts/collect/index.mjs --once（跑一次全部 enabled 源）
npm run seed:history # node scripts/dev/seed-history.mjs（本地历史数据种子，幂等）
```

### 本地历史数据：`npm run seed:history`

项目上线初期没有真实历史数据，页面4（历史趋势与回看）无法验证。`npm run seed:history` **走与线上完全相同的采集管线**（`appendEvents → projectSnapshot → analyzeSnapshot → writeReport → rolloverIfNewDay`）模拟 N 天（默认 3）数据，产出与 `deploy` 分支一致的历史数据布局：

```
public/data/history/
├─ history-index.json          # 滚动 days[]（多天聚合）
├─ archive-index.json          # 年度归档元数据（演示 >1 年只读态）
└─ YYYY/MM/
   ├─ items.ndjson             # 月度精简行
   ├─ snapshot-<date>.json     # 按天归档快照
   └─ report-<date>.json       # 按天报告
```

**幂等**：每次运行先清空 staging 与目标 `history/` 再整体重建，重复运行结果一致，不产生脏数据。

```bash
npm run seed:history              # 3 天
node scripts/dev/seed-history.mjs --days 7   # 7 天
```

## 6 个 workflow（**P4 已创建**）

> `.github/workflows/` 下 6 个文件均已随 P4 创建。触发段默认「只手动、不自动」（`push:` 注释 + 保留 `workflow_dispatch` + job `if` 守卫），详见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)。
> ⚠️ **尚未真实触发验证**：代码未 push 到远程仓库，Actions 与各部署目标均未真跑过（见「已知限制」）。

| Workflow | 触发条件 | 用途 |
|---|---|---|
| `collect.yml` | cron `7 * * * *` + `workflow_dispatch`；提交带 `[skip ci]`，当天 amend / 跨天新建 | 每小时跑采集，结果写 `deploy` 分支 |
| `notify.yml` | cron `3 0 * * *`（≈ 08:03 Asia/Shanghai）+ `workflow_dispatch` | 每日日报 + 实时热点阈值触发，写 `stats/notify-*.json` |
| `archive.yml` | cron `23 0 1 1 *`（每年 1/1）+ `workflow_dispatch` | 年度归档 |
| `deploy-gh-pages.yml` | `push:` 默认注释 + `workflow_dispatch` | 手动部署到 GitHub Pages |
| `deploy-cf-pages.yml` | `push:` 默认注释 + `workflow_dispatch`；`cloudflare/wrangler-action@v3`（生产固定 commit SHA） | 手动 Direct Upload 到 CF Pages |
| `keepalive.yml` | 每周一次 | trivial commit 防 Actions 休眠 |

## 数据契约

数据模型 JSON Schema 在 [`docs/data-model/schema/`](./docs/data-model/schema/)，对应 examples 在 [`docs/data-model/examples/`](./docs/data-model/examples/)。

### CategoryKey 启用集 vs 预留集

`CategoryKey` 共 **13 个合法取值**（schema 与 TS 枚举已对齐，定义在 `sources.schema.json#/definitions/categoryKey`，TS 侧见 `src/types/models.ts`）：

| 分组 | 取值 | 状态 |
|---|---|---|
| **MVP 启用集（8 类）** | `tech_blog` / `ai` / `news` / `dev_community` / `podcast` / `newsletter` / `finance` / `other` | `config/categories.json` + `config/keyword-rules.json` 已启用，前端会真实渲染 |
| **预留扩展位（5 类）** | `tech_media` / `product_design` / `video` / `security` / `opensource` | schema 合法但当前无渠道使用；新增渠道时需同步扩 `config/categories.json` |

**为什么是 13 而不是 8 或 11**（P2-B.2 决断）：

- `newsletter` / `finance` 原本只在 config 侧启用、**不在 schema enum 中** → `config/sources.json` 的 `ruanyifeng-weekly` 渠道带 `newsletter` 分类时 ajv 直接报错
- 修法选的是**扩 enum 而非删 config 值**，理由是：`scripts/collect/classify.mjs` 读 `config/keyword-rules.json`，其中 `newsletter` 规则（周报/周刊/weekly/Newsletter 等关键词）**会在运行时把条目打上 `newsletter` 分类**——只删 `sources.json` 里的一个值并不能阻止它再次出现，属于治标
- 扩 enum 是**向后兼容**方向（放宽约束不会让已有数据失效）；收紧 config 则需要重新打标已有数据
- 现在 schema enum、TS 枚举、`categories.json`、`keyword-rules.json` 四处已完全一致

新增分类的正确姿势：改 `config/categories.json` → 改 `config/keyword-rules.json` → 改 `sources.schema.json#/definitions/categoryKey` → 改 `src/types/models.ts` 的 `CategoryKey`，四处同步。

### L1~L5 去重分级

按 `docs/ARCHITECTURE.md §4.3`，去重引擎 L1~L5 分级中：

- **L1 精确**（同 dedupKey）、**L2 标题完全一致**、**L3 标题相似**（SimHash + Dice 0.9）已实现（`scripts/collect/dedup.mjs`）
- **L4 跨源同文章** 通过 `sourceCount ≥ 2` 体现（`buildMain` 派发 `sources[]`）
- **L5 关键词 Jaccard 主题重合**：**当前仍未实现**（`scripts/collect/dedup.mjs` 中仅保留说明注释，未产出 L5 标记）。这与 README 早期「推迟到 P3」的说法一致——P3 已落地前端与通知，L5 仍为未实现项。

### report.categoryStats 多分类计次语义

`report-<date>.json` 的 `categoryStats[].itemCount` 走**多分类计次**——一条 item 同时属 `tech_blog` + `ai` 时，每个分类各计 1 次（与 L4 跨源数 `sourceCount` 维度独立互补）。因此：

- `Σ categoryStats[].itemCount ≥ totalItems`（multi-label 自然放大）
- 一条 item 属 N 个分类时，贡献 N 次计数
- 想知道「去重后条目数」请用 `report.totalItems`；想知道「某分类下条数总和」用 `categoryStats[].itemCount`

实现见 `scripts/collect/analyze.mjs`；schema 描述见 `docs/data-model/schema/report.schema.json`；语义留痕见 `docs/ARCHITECTURE.md §5`。

## 深入文档

| 主题 | 文档 |
|---|---|
| 完整使用流程（第一次配置 → 日常使用 → 排障） | [`docs/USAGE.md`](./docs/USAGE.md) |
| 如何接入新源 / 新增来源类型 | [`docs/SOURCES.md`](./docs/SOURCES.md) |
| 如何启用通知（邮箱 / 飞书 / 钉钉 / 企业微信） | [`docs/NOTIFY.md`](./docs/NOTIFY.md) |
| 如何部署（本地 / GitHub Pages / Cloudflare Pages） | [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) |
| 架构设计 | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) |
| 实施计划 | [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) |
| 数据模型 | [`docs/data-model/README.md`](./docs/data-model/README.md) |

## 已知限制（截至 P4）

- **P2 已完成**：SimHash + Dice L3 去重、事件流 NDJSON 双写、跨天 rollover、月度 NDJSON、报告生成、URL 健康检查
- **P3 已完成**：前端 5 条路由（4 页面 + 关于）、通知模块（4 渠道适配器 + 模板 + 节流幂等）、`seed:history` 历史种子
- **P4 进度**：6 个 GitHub Actions workflow 已随 P4 创建（见上「6 个 workflow」），但**尚未真实触发验证**——代码未 push 到远程仓库，Actions 与各部署目标均未真跑；`docs/VERIFICATION.md` / `docs/CONTRIBUTING.md` 已补齐；部署端到端仍待 P5 验证
- **L5 关键词 Jaccard 主题重合**：仍未实现（见上文「L1~L5 去重分级」）
- **通知真实发送尚未验证**：4 个渠道在 `config/notify.json` 中**全部 `enabled:false`**；`notify.yml` 已创建但仅做过本地 dry-run 与 mock 单测，未真发

## License

MIT

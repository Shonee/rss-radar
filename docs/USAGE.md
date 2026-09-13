# RSS Radar 使用指南（完整使用流程）

> 本文档最后与代码同步于 commit `8b9eab8`。
>
> 目标读者：第一次接触本项目、想把它跑起来并长期使用的人。**照着走一遍即可跑通**。
> 相关文档：[`SOURCES.md`](./SOURCES.md)（接入新源）、[`NOTIFY.md`](./NOTIFY.md)（启用通知）、[`DEPLOYMENT.md`](./DEPLOYMENT.md)（部署）。

---

## 0. 前置要求

| 项 | 要求 |
|---|---|
| Node.js | **>= 20**（`package.json` 的 `engines.node`） |
| 包管理器 | npm（仓库用 `package-lock.json`） |
| 网络 | 能访问官方 npm 源 / 淘宝源；采集时需要访问各 RSS 源站 |

> ⚠️ 本机若默认 npm 源是内网镜像 `npmmirror.leoao-inc.com`，它会 **502**，`npm install` 会失败。**必须**按下方命令显式指定 registry。

---

## 1. 第一次配置

### 1.1 克隆与安装

```bash
git clone <your-fork>/rss-radar && cd rss-radar
npm install --registry=https://registry.npmmirror.com
```

装完可顺手校验一下配置资产：

```bash
npm run validate
# 期望输出：通过 5 / 失败 0 / 总计 5
```

### 1.2 认识 `config/sources.json`

这个文件是**全站权威源清单**，分两段：

- `channels[]`：**逻辑内容发布方**（页面2 卡片 + 页面3 分类的基本单位）。字段：`id / name / homepage / category[] / enabled / displayLimit / icon / language / weight …`
- `sources[]`：**采集配置**（每条 = 一次「去哪里拿数据」）。字段：`id / channelId / name / type / url / enabled / interval / auth / fieldMapping / pagination …`

一个 `Channel` 可挂多个 `Source`（多渠道备份）。**一个源能不能被采集，取决于 `source.enabled` 与 `channel.enabled` 两者都开启**。

> 现有 8 个渠道、8 个源（全部是 `rss` / `atom`）。字段完整说明见 [`SOURCES.md`](./SOURCES.md)。

### 1.3 改一个源 / 启停一个源

- **停用某个源**：把 `sources[]` 里该条的 `"enabled"` 改为 `false`。
- **停用整个渠道**：把 `channels[]` 里该条的 `"enabled"` 改为 `false`（其下的 Source 也不再采集）。
- **新增源**：见 [`SOURCES.md`](./SOURCES.md) 的「零代码加一个源」，一般只改 `config/sources.json`。

### 1.4 本地跑一次采集，验证能通

```bash
npm run collect:once
```

它做这些事（实现见 `scripts/collect/main.mjs`）：

1. 跑一次全部 `enabled` 源（`--only <source-id>` 可只跑一个，`--dry-run` 只打印不写盘）；
2. 产出到 **`tmp/deploy/today/`**：`events-<date>.ndjson`（当天事件流）、`snapshot-<date>.json`（投影快照）、`report-<date>.json`（当天报告）、`latest.json`（指针）；
3. **dev bridge**：把快照复制到 `public/data/today/snapshot-<date>.json`，并刷新 `public/data/today/latest.json`；
4. URL 健康检查：把结果回写到 `config/sources.json` 的 `lastStatus` / `lastError`（`--skip-health` 可跳过）。

退出码：`0` = 全部 ok；`1` = 全部失败；`2` = 部分失败（单源失败不阻断整体）。

> ⚠️ 采集会**改写 `config/sources.json` 的 `lastStatus` / `lastFetchAt` 等字段**（属采集产物的一部分）。若你不想让工作区变脏，用 `npm run collect:once -- --skip-health`。

### 1.5 起 dev server 看页面

```bash
npm run dev
```

浏览器打开 **http://localhost:5173/#/**（`HashRouter`，地址带 `#/`）。

5 条路由：`#/`（页面1 聚合热榜流）、`#/channels`（页面2 渠道看板）、`#/report`（页面3 分析报告）、`#/history`（页面4 历史趋势与回看）、`#/about`（关于）。

---

## 2. 本地数据从哪来（关键）

页面读取的本地数据**全部来自 `public/data/`**，由脚本产出、不入库（`.gitignore` 已忽略，仅保留 demo `snapshot.json`）：

| 页面 | 读取位置 | 由谁产出 |
|---|---|---|
| 页面1 聚合热榜流 | `public/data/today/{latest.json,snapshot.json,snapshot-<date>.json,report-<date>.json}` | `npm run collect:once`（dev bridge） |
| 页面2 渠道看板 | 同上（按渠道聚合） | 同上 |
| 页面3 分析报告 | `public/data/today/report-<date>.json` | 同上 |
| 页面4 历史趋势与回看 | `public/data/history/{history-index.json,archive-index.json,YYYY/MM/*}` | `npm run seed:history` |

### 2.1 生成历史数据（页面4 需要）

```bash
npm run seed:history            # 默认模拟 3 天，写入 public/data/
node scripts/dev/seed-history.mjs --days 7   # 模拟 7 天
```

- 它走**与线上相同的采集管线**（`appendEvents → projectSnapshot → analyzeSnapshot → writeReport → rolloverIfNewDay`），产出与 `deploy` 分支一致的历史数据布局；
- **幂等**：先清空 staging 与目标 `history/` 再整体重建，重复运行结果一致；
- 产出：`public/data/history/history-index.json`、`archive-index.json`、`YYYY/MM/items.ndjson`、`snapshot-<date>.json`、`report-<date>.json`。

---

## 3. 日常使用

### 3.1 更新本地数据

```bash
npm run collect:once   # 重新采集当天数据（覆盖/追加 tmp/deploy 与 public/data/today）
npm run seed:history   # 需要时重建历史数据
```

### 3.2 看本地报告与快照

采集产物直接是 JSON，可直接打开查看：

```bash
# 当天报告（热点榜 / 关键词 / 分类分布）
cat public/data/today/report-$(date +%F).json

# 当天投影快照（去重后的条目）
cat public/data/today/snapshot-$(date +%F).json

# 指针（含 date / generatedAt / 各文件路径 / commit）
cat public/data/today/latest.json
```

> 采集同时在 `tmp/deploy/today/` 留了同日文件；`public/data/today/` 是给前端 dev server 用的副本。

### 3.3 启停 / 修改源

编辑 `config/sources.json` 后重新采集：

```bash
# 只验证刚改的那一个源
npm run collect:once -- --only <source-id>

# 只打印归一化后的条目，不写盘
npm run collect:once -- --only <source-id> --dry-run
```

### 3.4 日常自检

```bash
npm run validate   # config 是否符合 schema
npm test           # node:test + vitest 两套单测
npm run smoke      # 采集 → 校验 → 产物契约断言
```

---

## 4. 部署到线上

见 [`DEPLOYMENT.md`](./DEPLOYMENT.md)：本地构建、GitHub Pages、Cloudflare Pages（Direct Upload）三套。

> ⚠️ 当前 `.github/workflows/` **尚未创建**，所以线上定时采集与自动部署**还没接线**（属 P4）。文档为「按架构设计的操作手册」，端到端**尚未验证**。

---

## 5. 启用通知（邮箱 / 飞书 / 钉钉 / 企业微信）

见 [`NOTIFY.md`](./NOTIFY.md)。要点：

- 通知在 **GitHub Actions 侧发送**；前端（页面1 底部的「通知状态」面板、关于页）**只读展示**，没有任何触发发送的入口；
- 密钥只存 **GitHub Secrets**，`config/notify.json` 里的 `refs.*` 只放**变量名**；
- 本地可先用 dry-run 预览消息与逐渠道判定：`node scripts/notify/main.mjs --dry-run --event dailyReport`。

---

## 6. 添加新源 / 新来源类型

见 [`SOURCES.md`](./SOURCES.md)。要点：

- **加一个具体源**：通常只改 `config/sources.json`（零代码）；
- **加一个「来源类型」**：写一个 connector 文件 + 在 `scripts/collect/connectors/index.mjs` 注册一行（+ 可选扩 schema enum）。

---

## 7. 排障

| 症状 | 排查 |
|---|---|
| 某个源没数据 | 先 `npm run collect:once -- --only <source-id> --dry-run`；再看 `config/sources.json` 里该源的 `lastStatus` / `lastError`（健康检查回写） |
| 采集整体失败 | 看命令输出里的 `[collect] summary ok=… err=…`；确认网络能访问源站 |
| config 校验报错 | `npm run validate`，按报错定位字段 |
| 页面无数据 / 白屏 | 确认已跑 `npm run collect:once`（页面1/2/3 依赖 `public/data/today/`）；页面4 依赖 `npm run seed:history` |
| 想跑全链路冒烟 | `npm run smoke`（采集 → 校验 → 产物契约断言） |
| 想跑 mock 全管线 e2e | `npm run test:e2e`（`node scripts/smoke/e2e-pipeline.mjs`） |
| 通知没发出 / 发错 | 看 `stats/notify-<ts>.json` 的逐渠道结果，与 `stats/notify-state.json`（详见 [`NOTIFY.md`](./NOTIFY.md) 排障节） |
| 线上采集没跑 | 见 [`DEPLOYMENT.md`](./DEPLOYMENT.md)；P4 未接线前 Actions 不会自动跑 |

> `stats/` 目录目前**尚不存在**，会在通知 / 采集真正运行时创建（属 `deploy` 分支的运行时产物）。

---

## 8. 命令速查

| 命令 | 作用 |
|---|---|
| `npm run dev` | 起 dev server（0.0.0.0:5173） |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run preview` | 预览构建产物（0.0.0.0:4173） |
| `npm run typecheck` | 类型检查（`tsc -b --noEmit`） |
| `npm test` | `test:node` + `test:vitest` |
| `npm run test:node` | node:test |
| `npm run test:vitest` | vitest |
| `npm run test:e2e` | mock 全管线 e2e |
| `npm run smoke` | 采集 → 校验 → 产物契约断言 |
| `npm run validate` | ajv 校验 config |
| `npm run collect` | 采集编排入口 |
| `npm run collect:once` | 跑一次全部 enabled 源 |
| `npm run seed:history` | 生成历史数据（页面4 用） |

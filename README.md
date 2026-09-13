# RSS Radar

> 把散落在各处的 RSS 源，汇聚成一份每天更新的信息雷达与热点报告。

[![P1 状态](https://img.shields.io/badge/P1-scaffold-blue)]() [![Node >=20](https://img.shields.io/badge/node-%3E%3D20-green)]() [![TS strict](https://img.shields.io/badge/TS-strict-blue)]()

## 一句话

RSS Radar = **多源 RSS 采集 → 去重聚合 → 当天报告**，纯静态前端 + GitHub Actions 自动化调度。可部署到 GitHub Pages 或 Cloudflare Pages（Direct Upload）。

## 5 分钟快速开始

```bash
# 1. 克隆与安装
git clone <your-fork>/rss-radar && cd rss-radar
npm ci

# 2. 跑一次采集（写入 ./tmp/today/snapshot-YYYY-MM-DD.json）
npm run collect:once

# 3. 启动 dev server，浏览器打开 http://localhost:5173/#/
npm run dev
```

## 目录结构（速览）

| 路径 | 作用 |
|---|---|
| `src/` | 前端 React + MUI + Tailwind 源码 |
| `src/types/` | 数据模型 TS 类型（9 份 schema 手写） |
| `scripts/collect/` | 采集器：连接器 + 排除 + 归一化 + 编排 |
| `scripts/validate-schema.mjs` | ajv 校验 9 份 schema |
| `scripts/smoke/` | smoke-test v2：产物契约断言 |
| `config/` | 站点默认配置（sources / exclusions / notify / …） |
| `docs/` | PRD / ARCHITECTURE / 数据模型 / 实施计划 |

更详细的目录解释见 [`docs/ARCHITECTURE.md` §8](./docs/ARCHITECTURE.md)。

## 6 个 workflow（P4 阶段出，P1 仅占位）

| Workflow | 职责 |
|---|---|
| `collect.yml` | 每 30 分钟跑一次采集，写 `deploy` 分支 |
| `notify.yml` | 每日 08:00 推送日报 + 实时热点阈值触发 |
| `archive.yml` | 每年 1/1 年度归档 → GitHub Release |
| `deploy-gh-pages.yml` | 手动触发，部署到 GitHub Pages |
| `deploy-cf-pages.yml` | 手动触发，Direct Upload 到 CF Pages |
| `keepalive.yml` | 每周 trivial commit 防 Actions 休眠 |

## 三个常用脚本

```bash
# 校验 9 份 config 是否符合 schema
npm run validate

# 跑 vitest（排除规则、URL 标准化等）
npm test

# 跑 smoke：collect → validate → 产物契约断言
npm run smoke
```

## 数据契约

数据模型 9 份 JSON Schema 在 [`docs/data-model/schema/`](./docs/data-model/schema/)，对应 examples 在 [`docs/data-model/examples/`](./docs/data-model/examples/)。

### CategoryKey 启用集 vs 预留集

`CategoryKey` 共 **13 个合法取值**（schema 与 TS 枚举已对齐，定义在 `sources.schema.json#/definitions/categoryKey`，TS 侧见 `src/types/models.ts`）：

| 分组 | 取值 | 状态 |
|---|---|---|
| **MVP 启用集（8 类）** | `tech_blog` / `ai` / `news` / `dev_community` / `podcast` / `newsletter` / `finance` / `other` | `config/categories.json` + `config/keyword-rules.json` 已启用，前端会真实渲染 |
| **预留扩展位（5 类）** | `tech_media` / `product_design` / `video` / `security` / `opensource` | schema 合法但当前无渠道使用；新增渠道时需同步扩 `config/categories.json` |

**为什么是 13 而不是 8 或 11**（P2-B.2 决断，此前此处标注「P3 二选一」）：

- `newsletter` / `finance` 原本只在 config 侧启用、**不在 schema enum 中** → `config/sources.json` 的 `ruanyifeng-weekly` 渠道带 `newsletter` 分类时 ajv 直接报错
- 修法选的是**扩 enum 而非删 config 值**，理由是：`scripts/collect/classify.mjs` 读 `config/keyword-rules.json`，其中 `newsletter` 规则（周报/周刊/weekly/Newsletter 等关键词）**会在运行时把条目打上 `newsletter` 分类**——只删 `sources.json` 里的一个值并不能阻止它再次出现，属于治标
- 扩 enum 是**向后兼容**方向（放宽约束不会让已有数据失效）；收紧 config 则需要重新打标已有数据
- 现在 schema enum、TS 枚举、`categories.json`、`keyword-rules.json` 四处已完全一致

新增分类的正确姿势：改 `config/categories.json` → 改 `config/keyword-rules.json` → 改 `sources.schema.json#/definitions/categoryKey` → 改 `src/types/models.ts` 的 `CategoryKey`，四处同步。

### L5 关键词 Jaccard 推迟到 P3

按 `docs/ARCHITECTURE.md §4.3`，去重引擎 L1~L5 分级中：

- **L1 精确**（同 dedupKey）、**L2 标题完全一致**、**L3 标题相似**（SimHash + Dice 0.9）已实现（`scripts/collect/dedup.mjs`）
- **L4 跨源同文章** 通过 `sourceCount ≥ 2` 体现（`buildMain` 派发 `sources[]`）
- **L5 推迟**：关键词 Jaccard 主题重合当前未实现，推迟到 P3 阶段（页面 4 主题聚合时）再实现

### report.categoryStats 多分类计次语义

`report-<date>.json` 的 `categoryStats[].itemCount` 走**多分类计次**——一条 item 同时属 `tech_blog` + `ai` 时，每个分类各计 1 次（与 L4 跨源数 `sourceCount` 维度独立互补）。因此：

- `Σ categoryStats[].itemCount ≥ totalItems`（multi-label 自然放大）
- 一条 item 属 N 个分类时，贡献 N 次计数
- 想知道「去重后条目数」请用 `report.totalItems`；想知道「某分类下条数总和」用 `categoryStats[].itemCount`

实现见 `scripts/collect/analyze.mjs`；schema 描述见 `docs/data-model/schema/report.schema.json`；语义留痕见 `docs/ARCHITECTURE.md §5`。

> 分类集口径已在 **P2-B.2** 决断完成（扩 enum 到 13 类），不再是待办。详见上文「CategoryKey 启用集 vs 预留集」。

## 已知限制（P1 范围外）

- **P2 才做**：SimHash + Dice L3 去重、事件流 NDJSON 双写、跨天 rollover、月度 NDJSON、报告生成、URL 健康检查
- **P3 才做**：完整 4 页面（页面2/3/4）+ 通知适配器
- **P4 才做**：6 个 GitHub Actions workflow + 部署到 GH Pages / CF Pages + 7 份 docs（USAGE/SOURCES/NOTIFY/DEPLOYMENT/…）
- **P5 才做**：端到端集成 + 回归 97 条断言移植
- **lastStatus=error 持久化缺失**（P1 QA 裁决 C）：当前 `scripts/collect/index.mjs` 把错误写进 `stats.sources[].error`（stdout/stderr），但**未回写到 `config/sources.json` 的 `lastStatus`/`lastError` 字段**；归 T-P2-B（URL 健康检查 / source metadata 持久化）一并接

## License

MIT
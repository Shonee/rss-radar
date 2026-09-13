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

`src/types/models.ts` 的 `CategoryKey` 是 **11 类 TypeScript 枚举**（news / tech_media / tech_blog / ai / dev_community / product_design / podcast / video / security / opensource / other），覆盖未来扩展位；而 `config/categories.json` 当前只列出 **8 类 MVP 启用集**（tech_blog / ai / news / dev_community / podcast / newsletter / finance / other）。

差异说明：

- `config/categories.json` = **当前实际启用的 8 类**（与 data-model README §2 中 P1 阶段固定命名一致）
- `src/types/models.ts` 的 11 类枚举 = **schema 允许值 + 未来扩展位**（含 tech_media / product_design / video / security / opensource 等未在 MVP 启用集里的类）
- `tech_media` / `product_design` / `video` / `security` / `opensource` 在 sources.schema.json 的 `channel.category` enum 中合法，但**当前 config 没有渠道用**；加入新渠道时需同步扩 `categories.json`
- `newsletter` / `finance` 在 config/categories.json 已启用但**不在 schema enum 中**（见 docs/ARCHITECTURE.md §2.4 解释：这是 v1.1 增项，未回填 schema，待 T-P2-XX 统一对齐）

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

P3 完整化时再做一次清理：要么 schema enum 收紧到 8 类，要么 config 展到 11 类，二选一。

## 已知限制（P1 范围外）

- **P2 才做**：SimHash + Dice L3 去重、事件流 NDJSON 双写、跨天 rollover、月度 NDJSON、报告生成、URL 健康检查
- **P3 才做**：完整 4 页面（页面2/3/4）+ 通知适配器
- **P4 才做**：6 个 GitHub Actions workflow + 部署到 GH Pages / CF Pages + 7 份 docs（USAGE/SOURCES/NOTIFY/DEPLOYMENT/…）
- **P5 才做**：端到端集成 + 回归 97 条断言移植
- **lastStatus=error 持久化缺失**（P1 QA 裁决 C）：当前 `scripts/collect/index.mjs` 把错误写进 `stats.sources[].error`（stdout/stderr），但**未回写到 `config/sources.json` 的 `lastStatus`/`lastError` 字段**；归 T-P2-B（URL 健康检查 / source metadata 持久化）一并接

## License

MIT
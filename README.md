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

## 已知限制（P1 范围外）

- **P2 才做**：SimHash + Dice L3 去重、事件流 NDJSON 双写、跨天 rollover、月度 NDJSON、报告生成、URL 健康检查
- **P3 才做**：完整 4 页面（页面2/3/4）+ 通知适配器
- **P4 才做**：6 个 GitHub Actions workflow + 部署到 GH Pages / CF Pages + 7 份 docs（USAGE/SOURCES/NOTIFY/DEPLOYMENT/…）
- **P5 才做**：端到端集成 + 回归 97 条断言移植

## License

MIT
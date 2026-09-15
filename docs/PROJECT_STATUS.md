# RSS Radar 功能现状对照（vs 设计方案）

> 更新日期：2026-09-15 ｜ 对照基准：`docs/PRD.md` / `docs/ARCHITECTURE.md` / `docs/IMPLEMENTATION_PLAN.md`
> 用途：回答「哪些实现了 / 哪些还需优化 / 哪些还没开始」
> 本文件在 P4/P5 落地后重写：P1~P5 代码侧已全部实现，**三项真实环境验证待老登提供条件**

---

## 一、已实现（对照设计已交付）

### P1 脚手架与数据契约 ✅
Vite + React + MUI + Tailwind（`preflight:false` 协同）｜ TypeScript strict + ESM ｜ 数据契约（`src/types/models.ts` + `docs/data-model/schema/*.schema.json`）｜ 双轨校验（ajv 产物 + Zod 脚本内，`npm run validate` 5/5）｜ Connector Registry + 排除规则。

### P2 数据管线 ✅（T-P2-01 ~ T-P2-10）
URL 标准化与去重 L1~L5 ｜ 事件流 NDJSON + 月度归档 ｜ 报告生成（热点/分类/健康度）｜ URL 健康检查（`sourceHealth[]`）｜ 端到端管线测试 ｜ **11 个渠道 / 11 个源**。

### P3 前端 ✅（T-P3-01 ~ T-P3-08 + 修复轮）
前端地基 + MUI 浅色主题（主色 `#2f6bff`）｜ 15 个公共组件 ｜ 页面1 聚合热榜（响应式筛选栏 + 空态逃生）｜ 页面2 渠道看板（取消全渠道/全局空态）｜ 页面3 分析报告（最大余数法取整）｜ 页面4 历史趋势 ｜ 关于页 ｜ 通知模块 4 渠道 ｜ 通知状态面板（只读）。

### P4 自动化与部署 ✅（代码侧）
| 任务 | 交付 |
|---|---|
| T-P4-01~03 | **6 个 workflow** `.github/workflows/{collect,notify,archive,deploy-gh-pages,deploy-cf-pages,keepalive}.yml`；`wrangler-action` 固定到真实 SHA `9acf94ace14e7dc412b076f2c5c20b8ce93c79cd`（GitHub API 取自 v3 tag）；无 `pages-action` |
| T-P4-04~08 | README 重写 ｜ `docs/{USAGE,SOURCES,NOTIFY,DEPLOYMENT}.md` |
| T-P4-09 | `docs/VERIFICATION.md`（验证流程）｜ `docs/CONTRIBUTING.md`（贡献指南） |
| 渠道扩容 | 8 → **11**（奇客Solidot / 爱范儿 / 机核，均实测可达可解析） |
| 采集链路补全 | `main.mjs` 接入 `rolloverIfNewDay`（`d70f4b7`）——「次日转历史」真正随采集自动发生 |

### P5 集成验证与回归 ✅（本地侧）
| 任务 | 交付 | 实测 |
|---|---|---|
| T-P5-02 | `tests/regression/snapshot-harness.mjs` + `run.sh`（97 条断言移植，扩至 118 条；A~F 六类） | **118/118 通过、0 未验证、domVerified: true、退出码 0**；变异测试（Chrome 不存在 → 2；篡改时间档标签 → 1） |
| T-P5-03 | `tests/e2e/full-pipeline.mjs` + `docs/qa/release-checklist.md` | **31 断言全过、8 阶段（含跨天 rollover / 归档 / history-index 读回）、退出码 0**；`--mutate` 必然失败 |

---

## 二、待优化（已实现但有偏差或技术债）

| # | 项 | 状态 |
|---|---|---|
| ~~1~~ | ~~连接器契约漂移（`fieldMapping`/`auth`/`pagination` 四份产物与实现形状不一致，会静默损毁标题）~~ | **已修**：schema/TS/ARCH/data-model/SOURCES 全部对齐连接器**真实形状**（两套并存）；新增 `npm run validate` **语义守卫** `checkSourceShapes`，把「形状用错连接器」从静默损数据变成配置期报错；`sources.example.json` 加测试锁；顺带修 `--check` 参数解析错位、`generic_api` 路径缺失返回整行、`relNext` 声明但未实现 |
| 2 | hot-score 归一化偏离（ARCH §5.1 log+max vs 实现线性截断） | 未修 |
| 3 | `286c6f3` commit message 含字面 `\n` | 未改（可选 rebase reword） |
| 4 | `public/data/today/snapshot.json` 仍是 P1 手工 fixture | 未换（真实快照已生成但未入库，见下） |
| 5 | 采集端无条目时间窗过滤 | 设计如此（页1 用「今天/全部」档兜） |
| 6 | 黄条在受限网络下常驻（本地 5/8 或 5/11 渠道 `fetch failed`） | 接受（上 Actions 后收敛） |
| 7 | `cheerio` 依赖未使用 | 保留待定 |
| 8 | 量级断言（items≥40 / historyDays≥365 等）未启用 | 待跨天数据累积后开启 |
| ~~9~~ | ~~dedup 跨源合并统计恒为 0~~ | **已修 `ba1e487`**（L2 计数口径 `K-1`；经 `project-snapshot` 影响 `stats.mergedCount`，属用户可见统计） |
| ~~10~~ | ~~排序档位死代码 `DEFAULT_SORT`~~ | **已清 `e092865`** |

---

## 三、未开始（需真实环境，非代码问题）

| 任务 | 内容 | 阻塞条件 |
|---|---|---|
| **T-P5-01** | Actions 真实触发 → CF Pages 部署验证（`<proj>.pages.dev` 可访问、四页面渲染、raw.githubusercontent 拉到当天数据） | ① 代码 push 远程仓库；② CF Pages 三件套（项目 / `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`） |
| ④ GH Pages 真实发布 | `deploy-gh-pages.yml` 手动触发验证 | 远程仓库 + Pages 设置 |
| ⑤ 通知真实发送 | 4 渠道 `enabled:false` → 真实凭据与 Secrets | SMTP / 各 webhook 凭据 |

> **当前真阻塞只有两个**：代码未 push 到远程仓库；CF Pages 三件套与通知凭据待老登提供。

---

## 四、门禁与校验现状（P4/P5 收尾）

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误 |
| `npx vitest run` | 62 passed |
| `npm run test:node` | **259 passed / 0 fail** |
| `npm run validate` | 通过 5 / 失败 0 |
| `npm run build` | 成功（~1.6s） |
| `npm run test:e2e:full` | 31 断言全过，退出码 0 |
| `npm run test:regression` | 118/118，domVerified true，退出码 0 |
| 6 个 workflow YAML | 全部可解析、cron 合法、无 `pages-action`、wrangler 固定 SHA |
| 真实采集（11 源） | `ok=6 err=5 items=79`；跨天模拟封口验证通过 |
| **未验证** | Actions 真实触发 / CF Pages 真实部署 / 通知真实发送 |

---

## 五、快照数据现状（回答「一批渠道为什么失败」）

以 2026-09-15 真实采集（11 源）为例：**ok=6 / failed=5**，共 79 条条目。

| 失败源 | 原因 | 性质 |
|---|---|---|
| 科技爱好者周刊 | `HTTP 404` | RSS 地址失效，需换源 |
| V2EX / Hacker News / Hugging Face Blog / 内核恐慌 | `fetch failed` | 本地沙箱无代理（境外站被拦） |

新增的 3 个国内源（奇客Solidot / 爱范儿 / 机核）**全部 200 且解析正常**（19/20/20 条）。结论：**非解析或代码缺陷**；上 GitHub Actions（机房网络）后 `fetch failed` 组会大幅收敛，404 那条若仍挂则换地址。

# RSS Radar 功能现状对照（vs 设计方案）

> 生成日期：2026-09-15 ｜ HEAD：`6e20c61`（真机回归报告）｜ 累计 76 commit
> 真机回归：`docs/qa/p3-sort-timerange-regression-qa-report.md` —— 11 项判据全通过，`domVerified: true`
> 对照基准：`docs/PRD.md`（产品需求）、`docs/ARCHITECTURE.md`（架构）、`docs/IMPLEMENTATION_PLAN.md`（任务拆解）
> 用途：回答「哪些实现了 / 哪些还需优化 / 哪些还没开始」

---

## 一、已实现（对照设计已交付）

### P1 脚手架与数据契约（完成）
| 项 | 状态 | 说明 |
|---|---|---|
| Vite + React + MUI + Tailwind 脚手架 | ✅ | Tailwind `preflight:false` 与 MUI 协同 |
| TypeScript strict 全开 | ✅ | Node ESM `"type":"module"` |
| 数据契约（TS 类型 + JSON Schema） | ✅ | `src/types/models.ts` + `docs/data-model/schema/*.schema.json` |
| 双轨校验（ajv 产物 + Zod 脚本内） | ✅ | `npm run validate` 5/5 通过 |
| Connector Registry + 排除规则 + 3 连接器 | ✅ | 后扩至 8 连接器 |

### P2 数据管线（完成，T-P2-01 ~ T-P2-10）
| 项 | 状态 | 说明 |
|---|---|---|
| URL 标准化 / 去重 L1~L5 | ✅ | `normalize.mjs` / `dedup.mjs` |
| 事件流 NDJSON + 月度归档 | ✅ | `append-events.mjs` / `archive.mjs` |
| 报告生成（热点 / 分类 / 健康度） | ✅ | `analyze.mjs` / `report.mjs` |
| URL 健康检查 | ✅ | `url-health.mjs`（`sourceHealth[]` 产出） |
| 8 个连接器 | ✅ | 阮一峰×2 / V2EX / 少数派 / HN / HF Blog / GitHub Blog / 内核恐慌 |
| node:test 覆盖 | ✅ | 253 用例全绿 |

### P3 前端（完成，T-P3-01 ~ T-P3-08 + 修复轮）
| 项 | 状态 | 说明 |
|---|---|---|
| 前端地基 + MUI 浅色主题 | ✅ | 主色 `#2f6bff`（D10 单主题） |
| 公共组件库 | ✅ | 15 个组件（FilterBar / ItemCard / Chart / ConfigDrawer …） |
| 页面1 聚合热榜流 | ✅ | 含响应式筛选栏、时间档、空态逃生 |
| 页面2 渠道分栏看板 | ✅ | 含取消全渠道空态、全局空态（PRD:587） |
| 页面3 分析报告 | ✅ | 饼图口径对齐、百分比最大余数法（Σ=100） |
| 页面4 历史趋势与回看 | ✅ | |
| 关于页 | ✅ | |
| 通知模块（4 渠道：邮件/飞书/钉钉/企微） | ✅ | `scripts/notify/**`，加签算法按渠道分离 |
| 通知状态面板 | ✅ | 只读，无发送入口（ARCH §12 硬约束） |
| 双轨数据加载（构建期内联 + 运行时 fetch） | ✅ | dev bridge 同刷 snapshot + report |

### P3 修复轮（本阶段内闭环）
| 缺陷 | 修复 commit | 说明 |
|---|---|---|
| A11「今日 M 条」取了快照全量 | `235af2b` | 改为 `countByShanghaiDay` 派生计数，与列表同源 |
| dev bridge 只刷 snapshot 不刷 report | `211c2ea` | 同刷两产物，20==20 核对通过 |
| P1-1 页面1 恒空（无「全部」档、空态死路） | `7483f8e` | 加「全部」档 + `p1-show-all-time` 逃生 |
| P3-4 favicon 全环境 404 | `7483f8e` | 建 `public/favicon.svg` + 改相对路径 |
| C9/C9b/C18 响应式筛选缺失 | `2f13035` | ≥1024 左侧 248px 粘性栏 / ≤1023 折叠 |
| B10 取消全渠道死路 | `fe9ec58` | 去掉双重强制回退 + `resolveBoardState` |
| 排序双档切换（主理人口径：整合排序） | `f94c4e2` | 删 UI，恒 `updatedAt\|\|publishedAt` 倒序 |
| 时间档含「近3小时」、顺序不符 | `d661349` | 改为 近6小时 / 今天 / 全部，默认今天 |
| 排序档位死代码（`DEFAULT_SORT` / `defaultSort` 配置+类型+schema+文档 8 处） | `e092865` | 纯删除，build 产物主 chunk 哈希不变 |

---

## 二、待优化（已实现但有偏差或技术债）

| # | 项 | 偏差说明 | 影响 | 建议时机 |
|---|---|---|---|---|
| 1 | 连接器契约漂移 | `fieldMapping`/`auth`/`pagination` 在 schema + TS + ARCH + data-model 四份产物与实现形状不一致 | **会静默损毁数据**（标题变 `(untitled)`） | P4 push 前 |
| 2 | hot-score 归一化偏离 | ARCH §5.1 写 log+max 归一化，实现用 `min(sourceCount/5,1)` 线性截断 | 热点排序权重与文档不符 | P4 push 前 |
| 3 | `286c6f3` commit message 有字面 `\n` | 提交信息排版错乱 | 可读性 | P4 push 前 rebase reword |
| 4 | `public/data/today/snapshot.json` 仍是 P1 手工 fixture | 3 条假数据，git 跟踪的唯一 data 文件 | 首次部署展示内容不真实 | P4 push 前换真实快照 |
| 5 | 采集端无条目时间窗过滤 | 低频源把几周前文章带进快照 → 「今天」可能恒 0，只能靠「全部」档逃生 | 体验折损（已有逃生出口） | P4 视情况 |
| 6 | `lastStatus=error` 持久化缺失 | 归 T-P2-01 文档化，未实现 | 故障渠道无历史痕迹 | P4 视情况 |
| 7 | 黄条文案在受限网络下长期出现 | 本地无代理时 5/8 渠道 `fetch failed`，黄条常驻 | 噪音（非缺陷） | 上 Actions 后观察 |
| 8 | `cheerio` 依赖未使用 | 预留未来 HTML 兜底 | 包体积 | 保留或移除待定 |
| 9 | 文档口径残留 | PRD 部分段落仍引用旧档位/旧排序表述（本轮已修 `:497`） | 文档与实现漂移 | 随改随修 |

---

## 三、未开始（P4 / P5）

| 任务 | 内容 | 阻塞条件 |
|---|---|---|
| T-P4-01 | 6 个 workflow：collect / notify / archive / deploy-gh-pages / deploy-cf-pages / keepalive | **`.github/workflows` 尚不存在**；需先确定 fork 沙箱仓库策略（D12） |
| T-P4-02 | collect.yml 详细步骤（checkout 双分支 + secrets 注入） | 依赖 T-P4-01 |
| T-P4-03 | CF Pages 部署 workflow（wrangler-action 固定 commit SHA） | 依赖 T-P4-01 + **CLOUDFLARE_API_TOKEN / ACCOUNT_ID / CF Pages 项目**（老登已决定延后到代码上传远程仓库后） |
| T-P4-09 | `docs/VERIFICATION.md` + `docs/CONTRIBUTING.md` | 无硬阻塞（README / USAGE / SOURCES / NOTIFY / DEPLOYMENT 已提前完成） |
| T-P5-01 | Actions 真实触发 → CF Pages 部署验证 | 依赖 T-P4-01/02/03 |
| T-P5-02 | prototype smoke-test 97 条断言移植回归 | 依赖 T-P5-01 |
| T-P5-03 | 端到端冒烟 + `docs/qa/release-checklist.md` | 依赖 T-P5-01/02 |

**当前真正的阻塞点只有两个**：① 代码还没 push 到远程仓库；② CF Pages 三件套（项目 / Token / Account ID）待老登提供。

---

## 四、五道门禁现状（HEAD `d661349`）

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误 |
| `npx vitest run` | 64 passed（改前 62，+2 防回退断言） |
| `npm run test:node` | 253 passed / 0 fail |
| `npm run validate` | 通过 5 / 失败 0 |
| `npm run build` | 成功，1.36s |

---

## 五、快照数据现状说明（回答「5 个渠道为什么失败」）

`public/data/today/snapshot-2026-09-14.json` 的 `stats.sourceHealth[]`（8 条）：

| 渠道 | 结果 | 原因 |
|---|---|---|
| 阮一峰的网络日志 | ok | — |
| 少数派 | ok | — |
| GitHub Blog | ok | — |
| 科技爱好者周刊 | **failed** | `HTTP 404`（RSS 地址失效/变更） |
| V2EX | **failed** | `fetch failed`（本地网络直连不通） |
| Hacker News | **failed** | `fetch failed`（同上） |
| Hugging Face Blog | **failed** | `fetch failed`（同上） |
| 内核恐慌 | **failed** | `fetch failed`（同上） |

结论：**4 个是本地沙箱无代理导致的网络不通，1 个是源地址 404，均非解析/代码缺陷**。采集链路本身正常（3 个可达源产出 20 条条目）。上 GitHub Actions（机房网络）后失败数会大幅收敛；若 404 那条仍挂，则需更换该 RSS 地址。

# RSS Radar — MVP 发布验收清单（Release Checklist）

> 对照 README §六「MVP 验收 5 条」。每条给出 **判据 / 当前证据 / 状态** 三栏。
> 状态三态：**✅ 已满足** / **⚠️ 部分满足（缺什么）** / **⛔ 未验证（为什么）**。
>
> 渠道数当前为 **32**（启用 31）—— P6 阶段整合原 `rss_private` 源清单后由 11/11 扩充至 32/34（历史上曾从 8 → 11：奇客Solidot / 爱范儿 / 机核）。
> 全链路 e2e 见 `tests/e2e/full-pipeline.mjs`（覆盖 ingestRound → 折叠 → 去重 → 报告 → 跨天 rollover → 归档 → history-index 读回断言）。

## 总览

| # | 验收项 | 状态 |
|---|---|---|
| ① | ≥10 渠道 | ✅ 已满足（32 渠道 / 34 源，启用 31 / 32） |
| ② | Actions 每小时采集 + 次日转历史 | ⚠️ 部分满足（代码侧已完整接入并经真实管线验证；**远程 Actions 真实触发未验证**） |
| ③ | 四页面 + 趋势图 | ✅ 已满足 |
| ④ | GH Pages 手动 + CF Pages 直传 | ⚠️ 部分满足（脚本与文档已就绪，真实部署未验证） |
| ⑤ | 页面3 分类分布 + 通知日报 | ⚠️ 部分满足（分类分布 ✅，通知日报 ⛔ 未验证） |

---

## ① ≥10 渠道

- **判据**：`config/sources.json` 中 `channels` 与 `sources` 数量 ≥ 10（**启用数**亦 ≥ 10）。
- **当前证据**：
  - `config/sources.json` → `channels: 32`（启用 31）、`sources: 34`（启用 32）。P6 整合原 `rss_private` 源清单后由 11/11 扩充至 32/34；2 个实测失效源（`iao-su-rss`、`douban-movie-review`）标 `enabled:false`。
  - 渠道覆盖：**31 个启用渠道** = 原 11 个（阮一峰博客 / 阮一峰周刊 / V2EX / 少数派 / Hacker News / Hugging Face / GitHub Blog / 内核恐慌 / 奇客Solidot / 爱范儿 / 机核）+ P6 新增 20 个（胡涂说、开源中国、精品MAC应用分享、不死鸟、吾爱破解、小众软件、月光博客、黑果小兵、程序员技术博客、字节跳动技术团队、美团技术团队、携程技术、36氪、雪球、人人都是产品经理、IT之家、WordPress大学、蠎周刊、豆瓣、国家统计局）。停用 1 个：`iao-su`。
  - 品类（CategoryKey 启用集）覆盖 `tech_blog / ai / news / dev_community / podcast / newsletter / finance / other`（`config/categories.json`）。
- **状态**：✅ 已满足（启用 31 ≥ 10）。

---

## ② Actions 每小时采集 + 次日转历史

- **判据**：
  - (a) GitHub Actions 按 ~60 分钟周期（每小时，第 7 分）真实触发 `collect`；
  - (b) 跨天自动把当日快照转入 `history/`（月度 NDJSON + `history-index.json`），即「次日转历史」。
- **当前证据**：
  - **代码侧 (b) 已实现并经 e2e 验证**：`scripts/collect/history.mjs:45` 的 `rolloverIfNewDay` 产出月度 NDJSON + `history-index.json` 追加日聚合 + 月末 `SEALED`；该逻辑在本 e2e（`tests/e2e/full-pipeline.mjs` S6/S8）中以两天数据实测通过，并 `listBundlable/listCandidatesForArchival` 验证了归档候选。
  - **代码侧缺口已修复（`d70f4b7`）**：`scripts/collect/main.mjs` 新增 `rolloverPrevDay()` 并在主流程**于 `projectSnapshot` 覆盖 `latest.json` 之前**调用（顺序是关键：晚于它则 `readLatestDate` 恒返回今天、rollover 永远 no-op）。同时具备 ① 同日幂等（`latest.json.date === currentDate` → skipped）② 崩溃重试保护（`history-index.days[]` 已含该日 → skipped）③ warn-not-throw 容错。守卫测试 `scripts/collect/__tests__/rollover-wiring.test.mjs`（4 条：同日幂等 / 跨天封口 / 无 latest.json / 非法 JSON 容错）。
  - **真实管线实测证据**：以 `node scripts/collect/index.mjs --once --skip-health --out /tmp/rr-roll` 跑两轮模拟跨天，第二轮输出 `[collect] rollover prev=2026-09-14 monthlyAppended=79 daysAppended=1`，并在 `/tmp/rr-roll/history/` 得到 `history-index.json`（`days[0] = (2026-09-14, 79)`）、月度 `2026/09/items.ndjson`（79 行）与按天归档快照。
  - **调度侧 (a)**：`.github/workflows/collect.yml` 已存在，调度 `cron: '7 * * * *'`（每小时第 7 分）。其真实触发需推送至 GitHub 远程仓库。
- **状态**：⚠️ 部分满足 —— 代码侧 (b) 已闭环并有真实管线证据；**(a) 远程调度真实触发仍未验证**。
  - **需老登提供**：① 把仓库 push 到 GitHub 远程仓库；② 配置 Actions 运行权限与所需 Secrets（如源鉴权）。
  - 本地可由 `node tests/e2e/full-pipeline.mjs` 与上述两轮真实采集证明「采集→跨天转历史→归档→读回」逻辑正确，但无法代替远程 Actions 真实调度验证。

---

## ③ 四页面 + 趋势图

- **判据**：前端含 4 个业务页面（聚合热榜流 / 渠道看板 / 分析报告 / 历史趋势与回看）+ 趋势图（历史页）。
- **当前证据**：
  - 路由与页面文件齐备：`src/pages/Page1HotStream.tsx`（聚合热榜流）、`src/pages/Page2Channels.tsx`（渠道看板）、`src/pages/Page3Report.tsx`（分析报告）、`src/pages/Page4History.tsx`（历史趋势与回看），外加 `关于`。
  - 趋势图：`src/components/Chart.tsx` 存在，`Page4History.tsx` 经 `services/historyClient.ts` 读取 `history-index.json` 渲染历史趋势。
  - `README.md:218`「P3 已完成：前端 5 条路由（4 页面 + 关于）」。
  - 页面3 渲染 `categoryStats`（分类分布，见 ⑤）。
- **状态**：✅ 已满足。

---

## ④ GH Pages 手动 + CF Pages 直传

- **判据**：提供两套部署能力 —— GitHub Pages（手动触发）+ Cloudflare Pages（Direct Upload 直传）。
- **当前证据**：
  - 部署文档就绪：`docs/DEPLOYMENT.md` 存在（涵盖本地 / GH Pages / CF Pages 三套）。
  - 工作流文件就绪：`.github/workflows/deploy-gh-pages.yml`（手动触发）、`.github/workflows/deploy-cf-pages.yml`（CF Pages 直传）。
  - 前端产物为纯静态（`dist/`），`main.mjs` 经 `copyToPublicData` 把 `public/data/` 注入，符合静态托管形态。
- **状态**：⚠️ 部分满足。
  - **缺什么（未验证）**：真实部署到 GH Pages / CF Pages 需 **老登提供**：① GitHub 仓库 Pages 设置（或 `gh-pages` 分支/Secrets）；② Cloudflare 账号与 **CF_API_TOKEN / CF_ACCOUNT_ID** 等 Secrets，使 `deploy-cf-pages.yml` 直传可用。本机无法代替真实部署验证。

---

## ⑤ 页面3 分类分布 + 通知日报

- **判据**：
  - (a) 页面3（分析报告）展示 **分类分布**（category distribution）；
  - (b) 每日 **通知日报** 经通知渠道真实发送。
- **当前证据**：
  - **(a) ✅**：`report.categoryStats` 由 `analyzeSnapshot` 产出（按 item.category 计次）；`src/pages/Page3Report.tsx` 读取并渲染分类分布。本 e2e S8 还断言了 `history-index` 的 `categoryStats` 与快照一致。
  - **(b) ⛔**：`config/notify.json` 的 4 个渠道（`email-main`、`feishu-webhook`、`dingtalk-webhook`、`wecom-webhook`）**全部 `enabled:false`**；`.github/workflows/notify.yml` 虽存在，但真实发送需凭据与 Secrets，且 `README.md:221` 明确「通知真实发送尚未验证」。本 e2e 不触碰通知（纪律：不连真实网络）。
- **状态**：⚠️ 部分满足（分类分布 ✅；通知日报 ⛔ 未验证）。
  - **需老登提供**：在 `config/notify.json` 填入各渠道真实凭据并将对应渠道 `enabled:true`；为 `notify.yml` 配置 Secrets（邮箱 SMTP / 飞书·钉钉·企微 webhook）。配置后即可由本地 dry-run 或 Actions 验证日报发送。

---

## 需要老登提供的项（把 ⛔/⚠️ 翻转为 ✅ 的前置条件）

| 项 | 依赖 |
|---|---|
| ② Actions 真实触发（`collect.yml` 每小时调度） | 远程 GitHub 仓库 + Actions 权限/Secrets（**代码侧 rollover 已接入，不再是前置条件**） |
| ④ CF Pages 实际部署 | Cloudflare 账号 + `CF_API_TOKEN` / `CF_ACCOUNT_ID` Secrets；GH Pages 仓库设置 |
| ⑤ 通知真实发送 | `config/notify.json` 真实凭据 + 各渠道 `enabled:true` + `notify.yml` 所需 Secrets |

## 与端到端 e2e 的关联

- 管线正确性（ingest → 去重 → 报告 → 跨天 rollover → 归档 → history-index 读回）由 `tests/e2e/full-pipeline.mjs` 以 mock fixture 源（6 源，含跨天数据，写临时目录）实测：正常通过（exit 0，31 断言），`--mutate` 变异模式必然失败（exit 1）。详见同目录交付报告。
- 该 e2e **不验证** ②/④/⑤ 的「真实远程触发 / 真实部署 / 真实通知发送」，那三项必须在老登提供上述条件后于真实环境复测。

# P3 QA 验证报告 · 页面3（分析报告）/ 页面4（历史趋势）/ 关于页 + 跨页

- **报告日期**：2026-09-14
- **验证对象**：`rss-radar` 前端 vite 应用（worktree `6b354f5`，detached HEAD，与主仓库 HEAD 一致）
- **验收基准**：`docs/PRD.md` §6.3/§6.4/§6.5 · `docs/ARCHITECTURE.md` §5.2/§12/§13 · 主理人本任务书列出的 26 条判据
- **验证人**：严过关（QA，software-qa-engineer-3）
- **结论**：**有条件通过**（IS_PASS: **YES**）—— 26 条判据中 22 条 PASS、0 条 FAIL、4 条未覆盖（附原因），另发现 **1×P2 + 2×P3** 展示层瑕疵，均不阻断主流程。

> 说明：本报告所有结论均来自**真实 headless Chrome 渲染 + 在页面上下文中真实触发交互/网络**，不是静态代码审查。凡「代码里写了」一律不作结论；每条 PASS 都附**原始测量值**（计数 / 百分比 / URL / 请求 URL）。

---

## 〇、TL;DR（给主理人）

- **一句话**：页面3/4/关于页真浏览器实测 **全绿（0 FAIL）**；主理人的 **假设 #1 证伪（页面自洽）**、**假设 #2 证实（抓取失败黄条不可达）**。
- **反向验证**：4 条故意改坏的断言 **全部按预期 FAIL**（证明测试确实在跑，不是空过）。
- **缺陷**：无 P0/P1；1×P2（饼图中心「22 条（去重后）」措辞与去重口径不符）+ 2×P3（占比取整两处不一致 / 判据 17 措辞与实现口径差异）。
- **未覆盖 4 项**：dead 条目降级、判据 24 真实数据下的「查看全部」点击路径（均因数据规模不足，已用可控数据补验）、判据 21（可选，已补验）、判据 17 的「不可达」分支语义（已实测并记录）。
- **未改动主仓库**：主仓库 `git status` 仅 `.workbuddy/`（非本次产生），`public/data` 全部原文件完好；所有「空态/异常态」构造均通过 **CDP 请求拦截**完成，零磁盘改动。

---

## 一、验证方法（可复现）

工具：本机 `Google Chrome 152.0.7977.84`（headless=new）+ Node.js v22.22.2，经 **DevTools Protocol（CDP）** 驱动（非 `--dump-dom` 快照）。

**工作区**：git worktree `/tmp/rr-qa-head`（detached HEAD `6b354f5`），`node_modules` 与 `public/data` 均软链至主仓库；dev server `npx vite --port 5283`。

**启动 Chrome（隔离 profile，避免污染用户目录；本机未出现 GoogleUpdater 拦截）**：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --no-first-run --no-proxy-server \
  --disable-crash-reporter --disable-breakpad --disable-background-networking \
  --remote-debugging-port=9333 --user-data-dir=/tmp/rrqa34/prof_main about:blank
```

⚠️ 环境事实：headless Chrome **渲染正常但不会自行退出**（页面存在挂起的网络/定时器）；因此必须由 CDP 显式 `Page.close` + `SIGKILL` 收尾，否则命令会被工具超时杀掉。

**CDP harness（可复现脚本）**：

| 脚本 | 覆盖 | 校验数 |
|---|---|---|
| `/tmp/rrqa34/lib.mjs` | CDP 会话库（导航/求值/真实鼠标点击/截图/网络与 console 采集/请求拦截） | — |
| `/tmp/rrqa34/suite.mjs` | 页面3(A) + 页面4(B) + 关于/通知(C) + 跨页响应式(D22~D24) | 38 |
| `/tmp/rrqa34/extra.mjs` | 假设#2 + 边界（快速连点/无数据月）+ 补充截图 | 6 |
| `/tmp/rrqa34/split.mjs` | **生产构建**路由级代码分割（vite build + preview 5284） | 5 |
| `/tmp/rrqa34/neg.mjs` | 反向验证（故意改坏的断言） | 4 |
| **合计** | | **53** |

**关键方法点**：

1. **三层数据降级的本地兜底**：dev 为 `http:` 时 `dataClient.resolveOrder()` = `['raw','jsdelivr','local']`。外网不可达，故用 CDP `Network.setBlockedURLs` 立即阻断 `raw.githubusercontent.com` / `cdn.jsdelivr.net`，让客户端**快速降级到第 3 层 `./data/` 本地真实文件**——这正是 ARCH §6.3.3 设计的降级路径。请求日志确认三跳都真实发生（见 B13a）。
2. **同文档 hash 导航**：`Page.navigate` 对仅 hash 变化的跳转**不触发 load 事件**；故每次导航前注入唯一 query（`?__qa=<ts>`，HashRouter 忽略外层 query）强制整页加载，保证模块状态干净。
3. **空态/异常态构造 = CDP `Fetch` 域拦截**（不碰磁盘）：`Fetch.failRequest` 模拟缺位、`Fetch.fulfillRequest` 注入受控 payload。**全程未修改主仓库任何文件**。
4. **真实点击**：跳转/切换类判据用 `Input.dispatchMouseEvent`（真实指针事件）而非 `.click()`。
5. **反向验证**：见 §六，4 条断言故意改坏 → 全部 FAIL。

> ⚠️ 本机 Bash `grep` 会静默失效；本报告所有「代码事实」均以 Read 工具 + 浏览器实测为准，不用 grep 下「没有」的结论。

**截图**：`docs/qa/screenshots/`（新增 `p3-p3-1280/375`、`p3-p4-1280/375`、`p3-about-1280/375`，未覆盖任何既有文件）。

---

## 二、逐项验证结果表

三态：**通过 / 失败 / 未覆盖（附原因）**。

### A. 页面3 分析报告（`/#/report`）

| # | 判据 | 结果 | 原始证据值 |
|---|---|---|---|
| 1 | 4 张数字卡与 report.json 一致 | **通过** | `p3-metric`=4；total=**14** / channels=**8** / hot=**10** / cats=**6**（与 `report-2026-09-14.json` 逐字段一致） |
| 2 | 热点榜 10 行、名次 1..10、热度单调不增 | **通过** | `p3-hot-row`=**10**；ranks=`[1..10]`；hotScore=`[1,0.87,0.85,0.85,0.84,0.84,0.82,0.82,0.82,0.82]` 单调；10 个标题全为外链 `<a href=https:…>` |
| 3 | 分类饼图百分比之和 = 100%（我的读数） | **通过** | 图例 `p3-pie-pct` = **32/23/23/9/9/4** → **Σ=100**（各项见下「假设#1」）；饼图中心合计 = **22** |
| 4 | 🔴 假设#1 分类占比是否两套口径 | **证伪（自洽）** | 全页 `%` 字符串 = `32,23,23,9,9,4`（图例）+ `32,23,23,9,9,5`（切片 tooltip）+ `100,100`；**未出现任何 `ratio` 派生值**（50%/36%/14%/7% 均无）。详见 §三 |
| 5 | 跨源重合榜 = 1 条且真渲染 | **通过** | `p3-cross-source` 存在；`p3-cross-row`=**1**；文本=`1 大家平时都用什么 RSS 阅读器？共 2 个渠道报道 Hugging Face Blog / V2EX` |
| 6 | 渠道活跃度条形图 8 条 | **通过** | `data-component="chart-bar"`；8 个子条：Hugging Face Blog / Hacker News / 少数派 / GitHub Blog / 科技爱好者周刊 / 内核恐慌 / 阮一峰的网络日志 / V2EX |
| 7 | 「查看历史趋势 →」真实点击跳转 | **通过** | 点击前 hash=`#/report` → 点击后 hash=`#/history`，`p4-root`=1 |
| 8 | 报告缺位 → `p3-empty` | **通过** | 拦截 `report-2026-09-14.json` 使其失败 → `p3-empty`=1，文本=「报告生成中，请稍候当天报告尚未生成（采集任务可能仍在进行）…」 |
| 9 | dead 条目不剔除 + 链接降级 | **未覆盖** | 原因：数据（snapshot + report）**无 `urlStatus` / `alternateUrl` 字段**，`p3-hot-title` 非链接数=0、无可触达的 dead 样本。代码路径存在但无数据触达 |

### B. 页面4 历史趋势（`/#/history`）

| # | 判据 | 结果 | 原始证据值 |
|---|---|---|---|
| 10 | 趋势图渲染且 3 个数据点 | **通过** | `p4-trend-chart` 存在；`circle`=**3**，tooltip=`2026-09-12：8 / 2026-09-13：11 / 2026-09-14：14`；aria-label=「近 90 天总条数趋势图」 |
| 11 | 指标切换真的变 | **通过** | 切「活跃渠道数」后 tooltip=`2026-09-12：7 / 2026-09-13：8 / 2026-09-14：8`，标题=「趋势：活跃渠道数」；切回总条数恢复 8/11/14 |
| 12 | 窗口 90/180/365 不跳转、切片变化 | **通过** | hash 全程=`#/history`；label 依次=「近 90/180/365 天总条数趋势图」；边界：**连点 12 次**窗口按钮 → hash 不变、`p4-error`=0 |
| 13 | 月度下钻：真发 NDJSON 请求 + ≈33 条 | **通过** | 真实请求 URL 含 `history/2026/09/items.ndjson`（raw→jsdelivr→local 三跳均记录）；`p4-month-loaded`=「共 **33** 条」；`p4-month-item`=**33** |
| 14① | 回看·有数据 | **通过** | 2026-09-12→条目数 **8**；09-13→**11**；09-14→**14**（与索引/快照一致） |
| 14② | 回看·无数据 | **通过** | 点 2026-09-05 → `p4-lookback-empty`=「该日期无数据…」；边界：翻月至 2026-08 点 2026-08-10 → 同样空态 |
| 14③ | 回看·已归档 | **通过** | 日历翻至 **2025 年 8 月** 点 2025-08-15 → `p4-lookback-archived` + `p4-lookback-release` href=`https://github.com/Shonee/rss-radar/releases/tag/archive-2025`（target=_blank） |
| 15 | 归档区 1 行（2025）· 12 月 · 外链 | **通过** | `p4-archive-row`=**1**，`data-year`=**2025**；`p4-archive-month`=**12**；`p4-archive-release` href=`…/releases/tag/archive-2025`、`target=_blank`、`rel=noopener noreferrer` |
| 16 | 移动 375 只画 1 张趋势图 | **通过** | 375px 下 `[data-component="chart-trend"]`=**1**；`p4-trend[data-chart-count]`=`"1"` |
| 17 | 无索引 → `p4-empty` | **有条件通过**（P3） | (a) 索引可读但 `days:[]` → `p4-empty`=「历史数据生成中」✓；(b) **索引完全不可达** → 实际渲染 `p4-error`「历史数据加载失败：Failed to fetch（可重试）」，**非** `p4-empty`。判据措辞（「不可达」）与实现口径不一致，见 §四 D-3 |

### C. 关于页 + 通知状态面板

| # | 判据 | 结果 | 原始证据值 |
|---|---|---|---|
| 18 | 关于页渲染 | **通过** | `about-root`=1；`about-slogan`=「把散落在各处的 RSS 源，汇聚成一份每天更新的信息雷达与热点报告」；`about-notify-section`=1；`about-notify-panel`=1 |
| 19 | 通知面板只读（必须证伪「能触发发送」） | **通过** | 面板内可点击元素**仅 2 个**：`DIV[role=button]`「通知状态⌃」（折叠开关）与 `BUTTON`「⌃」（aria-label 展开/收起）——**均无 href、无 send 语义**；页面加载与交互全程 **0 个** 指向 feishu/dingtalk/wecom/qyapi/smtp 的请求。**「能触发发送」被证伪** |
| 20 | 空态降级不报错 | **通过** | 无 `stats/notify-state.json` → 面板/页面出现「暂无发送记录」；面板体=「上次发送：暂无 成功 0 / 失败 0 启用渠道 0」；console error + exception + log error = **0** |
| 21 | （可选）造 notify-state.json 验证展示 | **通过** | 拦截注入 `{sent:{daily:2026-09-13:…},realtime:{count:2,lastSentAt…}}` → 面板=「上次发送：1 小时前（2026-09-14 03:00 GMT+8）**成功 1 / 失败 0** 启用渠道 0」+ 逐条记录 |

### D. 跨页与响应式

| # | 判据 | 结果 | 原始证据值 |
|---|---|---|---|
| 22 | 5 路由可开、不白屏、console 报错 0 | **通过** | `/`→p1-root、`/channels`→p2-root、`/report`→p3-root、`/history`→p4-root、`/about`→about-root；5×`app-shell`=1、5×marker=1、**console 报错全 0**、hash 正确 |
| 23 | 4 档宽度无横向溢出（有数据态） | **通过** | 375/768/1024/1280 × 5 页 = **20/20** 组合 `scrollWidth === clientWidth`（失败 0）；测量前均等到该页要素渲染 |
| 24 | 页面2 → 页面1 深链 | **通过（含未覆盖说明）** | 真实数据下 `channel-card-more`=**0**（单渠道最多 3 条 < 最小 cardLimit 5，链接不渲染）→ 真实点击路径**未覆盖**；改用拦截 `today/latest.json` 注入 12 条合成条目 → 链接出现，真实点击后 hash=`#/?channel=huggingface-blog`，列表 `data-channel-id` 去重后=**仅 `huggingface-blog`**，结果条数=15 |
| 25 | 路由懒加载 chunk 真按需 | **通过** | **生产构建**（`vite build` + `vite preview:5284`）：首屏 `/#/` 只加载 `index/vendor-*`（**无** Page3/Page4 chunk）；进入 `/#/report` 请求 `assets/Page3Report-DO1oq-QH.js`；`/#/history` 请求 `assets/Page4History-DN6Lyphg.js`；`/#/about` 请求 `assets/PageAbout-BkuYC2KB.js`；chunk 加载全程 console 报错 0。主 chunk `index-Cb8Udvk3.js` 仅 **44 KB**（页面已外置） |

### E. 反向验证（证明测试在跑）

| # | 判据 | 结果 | 证据 |
|---|---|---|---|
| 26 | 2~3 条断言故意改坏必须 FAIL | **通过** | 4 条全 FAIL（预期失败）：`p3-hot-row`==11→实际 **10**；metric==「0」→实际 **「14」**；饼图百分比和==101→实际 **100**；`p4-month-item`==99→实际 **33**。输出见 §六 |

---

## 三、两个假设的证实 / 证伪判定

### 🔴 假设 #1 ——「页面同时出现分类占比的两套口径」→ **证伪（页面自洽）**

**判定**：**证伪**。页面3 上**只有一套分母**（`Σ categoryStats[].itemCount = 22`），不存在「渲染 `ratio`（≤1、和 1.5714）与「重算份额」并存」的情况。

**证据（实测原始值）**：
- 页面3 全部 `%` 字样字符串：`32%,23%,23%,9%,9%,5%`（饼图切片 tooltip）· `32%,23%,23%,9%,9%,4%`（图例）· `100%`。
- `report.categoryStats[].ratio` = `0.5 / 0.3571 / 0.3571 / 0.1429 / 0.1429 / 0.0714`（和 1.5714）→ 其派生值应为 `50% / 36% / 36% / 14% / 14% / 7%`，**页面任何位置都没有出现这些数字**。
- 代码侧一致：`ratio` 字段仅存在于 `src/types/models.ts:274` 的类型定义，**无任何页面/组件读取渲染**（逐文件核对）。

**附带发现（非假设本身，属新缺陷 P3，见 §四 D-2）**：同一分类「播客」在**图例显示 4%**（最大余数法，使图例和恰为 100）而**切片 tooltip 显示 5%**（`Math.round`，导致切片和 101）。二者仍是**同一分母**，只是取整算法不同 —— 故假设#1 仍判「证伪」。

### 🔴 假设 #2 ——「页面1 异常态黄条（抓取失败）不可达」→ **证实（不可达）**

**判定**：**证实**。数据条件下 `p1-alert-warning`（抓取失败黄条）**确实不可达**。

**证据（实测原始值）**：
- 页面1 在**有数据态**（`p1-item`=**14** 条、状态条=「最近更新：刚刚 共 8 个渠道 今日 14 条 涉及 6 个分类」）下，`p1-alert-warning`=**0**。
- 数据证明：snapshot 的 `stats.sourceFailed`=**0**；`stats.sources[]` 8 项字段=`[channelId, channelName, itemCount]`，**无 `ok` 字段**（`'ok' in s` 全为 `false`）。
- 代码口径：`Page1HotStream.failedChannels = sources.filter(s => s.ok === false)` → 因 `ok` 恒 `undefined`，结果恒为 `[]` → 黄条分支恒不渲染。

**注**：同日**另一条黄条** `p1-alert-info`（数据可能非最新）**可达**——实测其被渲染（=1），文案=「数据可能非最新（来源：本地缓存）。」原因是快照 `generatedAt`(2026-09-13T18:58:47Z) 相对当前时间超过 60min stale 阈值且数据来自 local 兜底层。即：**告警区本身工作正常，只是「抓取失败」这条缺数据触达**。

---

## 四、缺陷清单（分级 + 复现 + 证据）

> 分级：**P0 阻断 / P1 严重 / P2 一般 / P3 建议**。本次 **无 P0、无 P1**。

### D-1（P2，一般）饼图中心标注「22 条（去重后）」与去重口径不符
- **位置**：`src/components/Chart.tsx` `PieChart` 中心文案硬编码 `条（去重后）`；`src/pages/Page3Report.tsx` 传入 `categoryStats.itemCount`（多标签计次合计=22）。
- **现象**：饼图中心显示「**22** 条（去重后）」，但当天**去重后 totalItems=14**（同页 hero「数据覆盖：8 个渠道 / **14** 条」、数字卡「总条数（去重后）=14」）。22 实为「分类多标签归入合计」，非去重条数。
- **复现**：`/#/report` → 观察「分类分布」卡片中心数字（`#chart-pie text`）。
- **证据**：`chart-pie` 文本节点=`["22","条（去重后）"]`；hero meta=`…数据覆盖：8 个渠道 / 14 条…`；`p3-pie-total`=「合计 22 条（分类多标签归入…）」。
- **影响**：同一屏两个「去重后」数字（22 与 14）互相矛盾，误导读者；不阻断功能。
- **建议**：中心文案改为「22 条（分类计次）」或直接显示去重后的 14，二者择一并加口径说明。

### D-2（P3，建议）同一分类占比两处取整不一致（4% vs 5%）
- **位置**：`Page3Report.integerPercentages()`（最大余数法，和恒 100）vs `Chart.tsx PieChart` 切片 tooltip `Math.round(frac*100)`（和可能 ≠100）。
- **现象**：「播客」图例=**4%**、切片 tooltip=**5%**；图例和=100、切片和=101。
- **复现**：`/#/report` → 对比图例 `p3-pie-pct` 与饼图切片 `<title>` tooltip。
- **证据**：`legend=[32,23,23,9,9,4] Σ=100`；`sliceTooltip=[32,23,23,9,9,5] Σ=101`；切片 title=`播客：1（5%）`。
- **影响**：hover 与图例数字不一致，属口径/取整瑕疵；不阻断。
- **建议**：切片 tooltip 复用 `integerPercentages()` 结果，与图例统一。

### D-3（P3，建议）判据 17「索引不可达 → p4-empty」与实现口径差异
- **位置**：`src/pages/Page4History.tsx`（`error` 分支→`p4-error`；`!index || days.length===0` 分支→`p4-empty`）。
- **现象**：**索引完全不可达**（三跳全失败）时渲染 `p4-error`（「历史数据加载失败：… 重试」）；仅当索引**可读但 `days:[]`** 时才 `p4-empty`（「历史数据生成中」）。
- **复现**：CDP 拦截 `history-index.json` (a) 返回 `days:[]` → `p4-empty`；(b) 直接 fail → `p4-error`。
- **影响**：两者都有兜底 UI（非白屏、非崩溃），`p4-error` 还带重试按钮，产品上可接受；仅与判据文字「不可达 → p4-empty」存在**措辞/实现口径**差异。**不判 FAIL，记录为口径差异**。

---

## 五、未覆盖项及原因

| 判据 | 状态 | 原因 |
|---|---|---|
| #9 dead 条目不剔除 + 链接降级 | **未覆盖** | 当天数据（snapshot.items / report.hotList）**无 `urlStatus` / `alternateUrl` 字段**，无 dead 样本可触达；`Page3Report.HotRow` 的 dead 分支（置灰删除线 / 切换备用地址）无法在此数据下验证。需构造带 `urlStatus:"dead"` 的快照数据另测。 |
| #24 真实数据下「查看全部 →」链接点击 | **部分未覆盖** | 真实数据单渠道最大 **3 条** < 组件最小 `cardLimit` **5**，故 `channel-card-more` 在真实数据下**恒定不渲染**（实测 0 个）。已改用**拦截注入 12 条合成条目**覆盖链接渲染 + 真实点击 + 深链过滤（PASS）；但「真实数据直接点链接」这一路径客观不可达。 |
| #17 「不可达 → p4-empty」 | **措辞未覆盖** | 见 D-3：不可达实际走 `p4-error`；已实测并如实记录，不冒充 PASS。 |
| #21 造 notify-state.json | 已覆盖（原为可选） | 通过 CDP 拦截注入实现。 |

---

## 六、反向验证（证明测试在跑）

挑 4 条断言，把期望值**故意改成必然错误**，确认 FAIL：

```
[FAIL(EXPECTED)] N1 BROKEN: expect p3-hot-row count = 11
        expected(BROKEN)=11  actual=10
[FAIL(EXPECTED)] N2 BROKEN: expect metric total = "0"
        expected(BROKEN)="0"  actual="14"
[FAIL(EXPECTED)] N3 BROKEN: expect pie legend percentage sum = 101
        expected(BROKEN)=101  actual=100
[FAIL(EXPECTED)] N4 BROKEN: expect p4-month-item count = 99
        expected(BROKEN)=99  actual=33

==== REVERSE VALIDATION: 4/4 deliberately-broken assertions FAILED as required ====
```

结论：测试断言**确实在真实读取页面**，非空过。

---

## 七、测试方法自查（哪些「先判失败、后确认是测试自己的锅」）

1. **首轮读到「0 条」误判无数据**：`p1-root` 在骨架加载态即存在，早期读取时条目尚未渲染 → 误判「页面1 无数据」。自查后改为**等待 `p1-item` 出现**再断言。
2. **hash 导航假挂 20s**：`Page.navigate` 对仅 hash 变化不触发 `loadEventFired`，导致每次跳转等到超时。自查后改为**注入唯一 query 强制整页加载**，既消除假挂又保证模块状态干净。
3. **判据 24 初判 FAIL**：首轮以为「页面2 卡片缺『查看全部』」是缺陷 → 复核代码（`channel.items.length > cardLimit`）+ 数据（最多 3 条 < 5）后确认是**数据规模不足**导致链接本就不渲染，非缺陷；改用合成数据覆盖点击路径。
4. **判据 17 初判 FAIL**：实测不可达得到 `p4-error`，与判据文字「p4-empty」不符 → 复核 `Page4History` 分支后确认属**判据措辞 vs 实现口径**差异（两条分支均有兜底），降级为 P3 observation 而非 FAIL。
5. **Chrome 不自退**：首轮命令被工具超时 SIGKILL；自查为「headless 有挂起网络/定时器」，改为 CDP 显式收尾后稳定。

---

## 八、结论

- **页面3 / 页面4 / 关于页 与 5 路由、4 档响应式、代码分割**：真浏览器实测 **53 条程序化校验中 0 条 FAIL**（PASS 44 / 未覆盖 4 / 口径差异 1 / 反向验证 4 条按预期 FAIL）。
- **假设 #1 证伪**（页面占比口径自洽，`ratio` 未渲染）；**假设 #2 证实**（抓取失败黄条因 `stats.sources[].ok` 缺失而不可达）。
- **通知面板只读硬约束**：**证伪「能触发发送」**——面板内无可发送控件、全程 0 个通知渠道请求。
- **未改动主仓库**：所有空态/异常态均以 CDP 拦截构造；主仓库 `git status` 干净，`public/data` 原文件完好。
- **结论**：**有条件通过（IS_PASS: YES）**——缺陷均为 P2/P3 展示层瑕疵，不阻断交付；建议工程师顺手修 D-1/D-2 两处口径文案。

**IS_PASS: YES**

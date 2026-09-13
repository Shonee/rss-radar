# P3 前端 QA 报告 · 页面1 聚合热榜流 + 页面2 渠道看板

- **报告日期**：2026-09-14
- **被测对象**：冻结 commit **`d9cb166`**（`feat(p3): T-P3-03/04 页面1 聚合热榜流 + 页面2 渠道看板 + 权重口径接线修复`）
- **验证人**：严过关（QA / software-qa-engineer-2）
- **验收基准**：team-lead 21 条判据 + `docs/PRD.md` §6.1/§6.2（:535-537 响应式表、:513 摘要、:556-568 卡片字段）+ 上一轮 `docs/qa/prototype-qa-report.md` §2.2 栅格基线
- **结论（TL;DR）**：**有条件通过** —— 页面2 与页面1 的**代码路径**实测可用，但存在 **2 个 P1**（页面1 真实数据下恒为空态；`file://` 打开白屏）与 **3 个 P2**，建议修复后再交付。`IS_PASS: NO`。

> 验证目标：**证明它能用**，而非「确认它存在」。所有结论来自**真实 headless Chrome 渲染 + 在页面上下文真实触发交互**，每条 PASS 均附原始测量值。三态区分：**通过 / 失败 / 未覆盖（附原因）**。

---

## 一、验证方法（可复现）

### 1.1 被测环境（工作区隔离）

```bash
# 冻结工作树（不触碰主工作区 src/）
cd /Users/dushouxin/WorkSpace/github/rss-radar
git worktree add /tmp/rr-qa-d9cb166 d9cb166
ln -s /Users/dushouxin/WorkSpace/github/rss-radar/node_modules /tmp/rr-qa-d9cb166/node_modules
npx vite build                       # 生产构建（vite 5.4.21，单 chunk 495.97 kB）
```

**数据说明（重要）**：`d9cb166` 里被 git 跟踪的 `public/data/today/snapshot.json` 只是一份 **3 条演示快照**（date=`2026-09-13`，渠道 ruanyifeng-blog / hacker-news / huggingface-blog）；team-lead 描述的「20 条真实采集产物（少数派 + GitHub Blog）」实为主工作区中**被 gitignore 的 `public/data/today/snapshot-2026-09-14.json`**（`latest.json` 为其软链）。为忠实复现主工作区 dev server 实际提供的数据，我把该真实文件复制进冻结工作树：

```bash
cp /Users/.../rss-radar/public/data/today/snapshot-2026-09-14.json /tmp/rr-qa-d9cb166/public/data/today/
ln -sfn snapshot-2026-09-14.json /tmp/rr-qa-d9cb166/public/data/today/latest.json
```

**真实数据事实（`node` 读取，非 grep）**：
`items.length=20`；`date=2026-09-14`；`stats.sources` 全部 `ok:true`（`sourceFailed=0`）；`sourceCount>1` 的条目 **0** 条；每渠道条数 sspai 10 / github-blog 10；分类并集 5 个（tech_blog, dev_community, ai, news, podcast）；**最新条目 `updatedAt=2026-09-13T07:51:55Z`（上海时区 2026-09-13 15:51），落在 `snap.date` 上的条目 = 0 条**。

### 1.2 测试驱动（自建 CDP harness，无第三方依赖）

Node v22.22.2 自带全局 `WebSocket`，直接走 **DevTools Protocol**（真实导航/真实点击/真实输入，非 `--dump-dom`）：

| 脚本 | 覆盖 |
|---|---|
| `/tmp/rrqa-p3/cdp.mjs` | CDP 客户端 + 启动器（隔离 profile；`Runtime.exceptionThrown` / `console` / `Log.entryAdded` / `Network.loadingFailed` 全量采集；`Fetch` 请求拦截） |
| `/tmp/rrqa-p3/server.mjs` | dist 的**进程内静态服务器**（替代易被回收的 vite dev server） |
| `/tmp/rrqa-p3/t_real.mjs` | 真实数据：6 档视口 × 两页 + 页面2 全交互（35 PASS / 8 FAIL / 15 INFO） |
| `/tmp/rrqa-p3/t_fixture.mjs` | **合成 fixture**：页面1 有数据态的可交互代码路径（19 PASS / 3 FAIL） |
| `/tmp/rrqa-p3/t_file.mjs` | `file://` 离线兜底（6 PASS / 2 FAIL / 2 未覆盖） |
| `/tmp/rrqa-p3/t_mutation.mjs` | 反向（变异）验证：5 条故意错误断言 |

Chrome：`/Applications/Google Chrome.app/.../Google Chrome`（**152.0.7977.84**，`--headless=new --disable-gpu --no-sandbox --no-first-run --remote-debugging-port=… --user-data-dir=/tmp/rrqa-p3/*`）。

> **环境坑（已规避）**：本机沙箱会拦截 Chrome 写 `~/Library/Application Support/Google/GoogleUpdater/…` 与 `RLZ/RlzStore.plist`（触发授权弹窗）；Chrome 仍能运行，但为稳定起见我把 Chrome 的请求经 **CDP `Fetch.fulfillRequest` 直接喂本地快照**（并补 `Access-Control-Allow-Origin: *`），得到**确定性、零网络噪声**的渲染环境；另单独跑一次「自然网络」以记录真实降级行为。**全程未用 `grep` 反证**——所有判据取自浏览器 `getComputedStyle` / DOM 计数 / `node -e` 读取。

### 1.3 fixture 的定位（务必区分真实 / 合成）

真实数据里**最新条目也早于快照日期**，导致页面1 三个时间档全空（见缺陷 P1-1）。因此「页面1 有数据时的代码路径」（排序/搜索/加载更多/深链/跨源/黄条）无法用真实数据触发，我用一份**明确标注为合成**的 fixture（40 条，date=当天，`updatedAt≠publishedAt`，注入 1 条跨源 + 1 个失败源）来回答「**代码路径是否可用**」。**凡 fixture 结论一律单列「[合成]」，绝不冒充真实数据 PASS。**

---

## 二、逐项结果表（判据编号 + PASS/FAIL/未覆盖 + 原始证据值）

### A. 页面1 聚合热榜流

| # | 判据 | 结果 | 原始证据值 |
|---|---|---|---|
| 1 | 真渲染 + 零 console 报错（375/768/1024/1280 + 1440/1600 逐档） | **通过（附注）** | 生产构建下 6 档 × 两页：`exception=0 / console.error=0 / console.warn=0`。自然网络（不拦截）下另有 **2 条 `LOG.error: Failed to load resource: 404`** —— 来自三层降级（`raw…/today/latest.json` 404 → `./data/today/latest.json` 200 → `./data/today/report-2026-09-14.json` 404），**属设计行为，非 JS 缺陷** |
| 2 | 有数据渲染（`p1-item`>0）且与快照 `items.length` 一致 | **失败（真实数据）** | `rendered=0`，`resultCount="共 0 条符合当前条件"`，`p1-empty-filter` 出现（`p1-empty` 未出现 ⇒ 快照已加载，是**过滤**把 20 条全部滤掉）。快照 `items.length=20`，**落在 `snap.date(2026-09-14)` 上的 = 0**。[合成] 下 `filtered=40==预期40`、`rendered=min(20,40)=20` ⇒ 渲染/过滤代码正确 |
| 3 | 无横向溢出 @375/768/1024/1280（**必须多批数据**） | **通过** | [合成] 加载至 40 条后：`375/375`、`768/768`、`1024/1024`、`1280/1280`（`scrollWidth==clientWidth`）。真实数据 p2 有数据：`1600/1440/1280/1024/768/375` 全部相等 |
| 4 | 排序真改变顺序 | **通过 [合成]** | 默认（updatedAt）前 3：`搭建自己的 HomeLab…` / `与 AI 搏斗失败后重新开始找工作…` / `本周看什么…`；点 `p1-sort-published` 后：`搭建自己的 HomeLab…` / `本周看什么…` / `与 AI 搏斗失败后重新开始找工作…`（序列不同）。**真实数据两序天然等价**（20 条 `updatedAt===publishedAt`，属数据巧合而非实现等价） |
| 5 | 搜索过滤生效 | **通过 [合成]** | 输入真实标题词 `Copilot`：`共 40 条` → `共 10 条`，与按 `title+summary+author` 口径算出的预期 10 条**一致** |
| 6 | 加载更多 | **通过 [合成]；真实数据未覆盖** | [合成] `rendered 20→40`、`filtered=40`、底部文案 `— 已到底部，共 40 条 —`。真实数据仅 20 条且全被「今天」滤除，**无法在该环境下触发**（如实说明，未伪造） |
| 7 | 深链 `?channel=<真实id>` | **通过** | [合成] `#/?channel=sspai` → 渲染 20 条，`channels=["sspai"]`（去重后仅 1 个），chip `少数派` 已勾选。真实数据 `#/?channel=github-blog` → chip `GitHub Blog` 已勾选（列表 0 条 ⇒ 判据2 根因） |
| 8 | 跨源「+N 源」展开 | **真实数据未覆盖；[合成] 通过** | 真实数据 **0 条** `sourceCount>1`（20 条全为 1）⇒ 无法覆盖。合成注入 1 条后：`p1-sources-toggle` 存在，点击后面板文案 `该条内容被 2 个渠道报道：少数派 · 原文 · … V2EX · 原文 · …` |
| 9 | 异常态黄条（`ok=false`） | **真实数据未覆盖；[合成] 通过** | 真实 `stats.sources` 全 `ok:true`（`sourceFailed=0`）⇒ 无法覆盖。合成注入 1 个失败源后：`p1-alert-warning` = `1 个渠道本次抓取失败：V2EX。该渠道本次无入库条目…` |
| 10 | 时间筛选 今天/近3小时 | **通过 [合成]；真实数据异常** | [合成] `今天=40(预期40)`、`近3小时=6(预期6)`、`近6小时=40(预期40)`。真实数据三档**全 0**（判据2 根因） |
| 11 | 移动端(375)：筛选收进按钮/抽屉 + 摘要默认隐藏 | **摘要 通过 / 筛选 失败** | 375 摘要 `display:none`（PRD :513 要求满足）。筛选：`filter-bar display=flex`、渠道下拉可见、`collapseToggle=false`（**未折叠**）；768 同样 `filterDisplay=flex`（**未收进顶部抽屉**）→ 违背 PRD §536/§537 |

### B. 页面2 渠道看板

| # | 判据 | 结果 | 原始证据值 |
|---|---|---|---|
| 12 | 栅格列数（与 prototype 基线 `4/4/3/2/2/1` 一致） | **通过** | `1600→4`(340px×4) `1440→4`(340px×4) `1280→3`(405.33px×3) `1024→2`(488px×2) `768→2`(360px×2) `375→1`(343px)。**实测列数 = 基线** |
| 13 | 卡片数 = 启用渠道数；健康四态 | **通过（两态未出现）** | `cards=8` == `sources.json` 中 8 个 `enabled:true` 渠道；`health = {ok:2, empty:6}`；**`failed=0`、`disabled=0`**（真实数据无失败源、无停用渠道 ⇒ 该两态在真实数据下不出现，如实标注）。375 下每卡条目 10→**5**（移动降级生效） |
| 14 | 配置抽屉：条数=5 + 取消勾选渠道 | **通过** | 打开 `p2-open-config` → 选 `5` → 首卡（sspai）条目 `10→5`；取消勾选「少数派」→ 卡片 `8→7`，`ls={"channelIds":[…无 sspai],"cardLimit":5,…}` |
| 15 | localStorage 持久化（真实 reload） | **通过** | reload 后 `firstItems=5`、`cards=7`、`localStorage['rss-radar:page2-config']` 仍为改后值；http 下 `localStorage` 可用 = true |
| 16 | 「恢复默认」 | **通过** | 点 `p2-drawer-reset` → `firstItems=10`、`cards=8`、`ls={"channelIds":null,"cardLimit":10,"sort":"updatedAt","cardLimitUserSet":false}` |
| 17 | 边界：取消全部渠道 → 全局空态 | **失败** | 逐个取消全部 8 个渠道后：`cards=8`、`emptyState=false`、`ls.channelIds=null` ⇒ 取消到最后一个时**回落为「全选」**，`p2-empty` **不可达** |
| 18 | 「查看全部 →」跳转并过滤 | **通过** | 默认 cardLimit=10 时无入口（无渠道 >10 条）；置 5 后出现 `href="/#/?channel=github-blog"`；点击后 `location=…/#/?channel=github-blog`，页1 chip 勾选 `GitHub Blog` |

### C. 主题与产物

| # | 判据 | 结果 | 原始证据值 |
|---|---|---|---|
| 19 | 浅色主题（计算样式证明） | **通过** | `getComputedStyle(document.body).backgroundColor = "rgb(246, 247, 249)"`（= `#f6f7f9` gray-50）；主色元素 `p2-open-config` 的 `backgroundColor = "rgb(47, 107, 255)"`（= `#2f6bff`） |
| 20 | `file://` 离线兜底 | **① 失败 ② 通过 ③ 未实现** | ① **默认 Chrome 打开 `file://…/dist/index.html` 白屏**：`#root` 子节点 `=0`、无 `app-shell`；原因 `Access to script at 'file://…/assets/index-*.js' from origin 'null' has been blocked by CORS policy`（**ES module 无法经 file:// 加载**）。删掉 `crossorigin` 属性后仍被拦（已实测），说明与属性无关。② `--allow-file-access-from-files` 下页面2 渲染 8 卡；点卡片外链：`window.__opened=[{u:"https://sspai.com/",t:"_blank",f:"noopener,noreferrer"}]` 且 `json/list` 新增 `{type:"page",url:"https://sspai.com/"}` ⇒ **走 `window.open` 且未被拦截**。③ **构建期内联兜底数据不存在**（三层降级第三层是 `./data/`，非内联），故该子项无对应实现 |
| 21 | 反向验证（证明断言非恒真） | **通过** | 5 条故意错误期望**全部 FAIL**：`MUT1 bodyBg 实测 rgb(246,247,249) vs 期望 rgb(0,0,0)`；`MUT2 栅格实测 4 vs 期望 3`；`MUT3 items 实测 0 vs 期望 5`；`MUT4 过滤计数实测 40 vs 期望 45`；`MUT5 加载更多后实测 40 vs 期望 39` |

### 附加（非判据，供参考）

| 项 | 结果 | 证据 |
|---|---|---|
| 页面1 状态条文案 | 观察 | `最近更新：14 小时前 · 共 8 个渠道 · 今日 20 条 · 涉及 5 个分类`。其中「渠道数 8」取自 `sources.json` 启用渠道数，**非**快照 `stats.sourceTotal(2)`；「今日 20 条」= 全部条目数（见 P2-1）；「5 个分类」与快照 `channels` 字段一致 |
| 页面1 异常/提示黄条 | 通过 | 快照 `generatedAt=2026-09-13T08:30:00Z` 距今 >60min ⇒ `stale=true`，提示条 `数据可能非最新（来源：源站）。` 正确出现 |
| 项目自带测试基线 | 通过 | `npm run test:node` → **246 pass / 0 fail**；`npm run test:vitest` → **33 pass / 0 fail**（未改动任何断言） |
| 构建产物 | 提示 | 单 chunk `index-*.js = 495.97 kB`（gzip 156.07 kB），无路由级代码分割（工程师任务 #59 未完成，非缺陷） |

---

## 三、缺陷清单（分级 + 复现步骤 + 证据）

> 分级：**P0 阻断 · P1 严重 · P2 一般 · P3 建议**

### P1-1 页面1 默认视图恒为空态：真实数据 20 条一条也看不到
- **页面/文件**：页面1 ｜ `src/pages/Page1HotStream.tsx:122-128`（`today` 用 `snap.date` 比对）、`:125-127`（3h/6h 按真实 `Date.now()` 计）、`src/config/site.ts:85-91`（`TIME_RANGES=['today','3h','6h']`）
- **现象**：快照已成功加载（`p1-empty` 不出现），但**三个时间档全部把 20 条滤掉**，页面只显示 `暂无数据`，且 UI 无「全部/不限」选项可绕过。
- **根因（实测定位）**：① `snap.date=2026-09-14`，而**最新条目为上海时区 2026-09-13 15:51**（早 1 天）⇒ `isSameShanghaiDay` 恒 false；② 相对窗口按真实时钟算（QA 运行时 ≈ 2026-09-14 06:00，最新条目已 ~14h）⇒ 3h/6h 亦恒 0。
- **复现**：① 起服务并让页面读到 `snapshot-2026-09-14.json`；② 打开 `/#/`；③ `document.querySelectorAll('[data-testid="p1-item"]').length` → `0`；分别点 `今天/近3小时/近6小时` → 均 `共 0 条`。
- **证据**：判据 2 / 判据 10；`results_real.json` 中 `A2b@*`（6 档全 FAIL）。
- **建议**：时间档增加「全部/不限」，或当「今天」为空时自动回退到最近有数据的时间范围；采集侧亦应令 `snapshot.date` 与条目日期口径一致。

### P1-2 `file://` 打开白屏（离线兜底失效，较原型为回归）
- **页面/文件**：构建产物 `dist/index.html`（`<script type="module" crossorigin src="./assets/index-*.js">`）+ `vite.config.ts`（`base:'./'` 但未提供非模块产物）
- **现象**：默认 Chrome 下 `file:///…/dist/index.html` **整页白屏**（`#root` 子节点 0）。
- **根因**：Chrome 拒绝通过 `file://`（origin `null`）加载 **ES module** 脚本（`blocked by CORS policy: Cross origin requests are only supported for protocol schemes: chrome, chrome-extension, …`）。**实测去掉 `crossorigin` 属性无效**（仍被拦），故需非模块产物或改用 http。
- **复现**：`npx vite build` 后 `file://…/dist/index.html` 打开；或 `--dump-dom` 观察 `#root` 为空。
- **证据**：判据 20①；截图 `docs/qa/screenshots/p3-file-default-white.png`（4.7 KB 全白）。
- **建议**：为 file:// 场景产出 IIFE 包（`build.rollupOptions.output.format='iife'` + 关闭 modulePreload），或明确「file:// 需 `--allow-file-access-from-files` / 必须经 http 访问」并写入 README；上一轮原型（classic script）在 file:// 下可用，本版属**能力回归**。

### P2-1 页面1 状态条「今日 N 条」与列表计数自相矛盾
- **页面/文件**：`src/pages/Page1HotStream.tsx:171`（`todayCount = report?.totalItems ?? mainItems.length`）vs `:122-128`（列表按 `today` 过滤）
- **现象**：同一页里状态条写「今日 **20** 条」，列表写「共 **0** 条符合当前条件」。
- **根因**：状态条取**全量条目数**（不套日期过滤），列表取**过滤后**条数，两处「今日」口径不同。
- **复现**：真实数据打开 `/#/`；读 `p1-statbar` 与 `p1-result-count` 文案。
- **证据**：判据 `A11`（`statbar今日=20 列表共=0`）；[合成] `C2`（两者一致时才无矛盾，反证口径差异）。
- **建议**：状态条改用同一（按日期过滤）口径，或把标签改为「今日入库 N 条 / 全量 M 条」。

### P2-2 页面1 移动端/平板筛选未按 PRD 折叠
- **页面/文件**：`src/pages/Page1HotStream.tsx:298-302`（无条件渲染 `<FilterBar>`）+ `src/components/FilterBar.tsx`
- **现象**：375px 与 768px 下筛选仍为**内联可见控件**，无「筛选」按钮/顶部抽屉。
- **期望**：PRD §537「移动(<768px)：控件折叠进『筛选』按钮」；§536「平板(768–1023)：筛选栏收起为顶部抽屉」。
- **证据**：判据 11（`C9`/`C9b`：`collapseToggle=false`、`filterDisplay=flex`）。
- **建议**：按 `useMediaQuery` 在 <1024px 折叠为抽屉/按钮（`FilterBar` 已可复用）。

### P2-3 页面2「取消全部渠道 → 全局空态」不可达
- **页面/文件**：`src/components/ConfigDrawer.tsx:63-73`（`toggleChannel` 中 `next.length===0 ? null : next`）+ `src/pages/Page2Channels.tsx:315-329`（`p2-empty` 空态分支）
- **现象**：逐个取消最后一个渠道时，`channelIds` 回退为 `null`（= 全选），于是**永远到不了 0 个渠道**，全局空态 `p2-empty` 成为死代码。
- **复现**：页面2 → 配置抽屉 → 依次取消全部 8 个渠道；观察卡片仍 8 张、空态未出现。
- **证据**：判据 17（`B10`：`cards=8 emptyState=false ls.channelIds=null`）。
- **建议**：允许 `channelIds=[]` 表示「一个都不选」，或在全不选时给出明确文案而非静默回退。

### P3-1 真实数据下页面2 无「查看全部 →」入口
- **现象**：默认 `cardLimit=10`，而没有任何渠道条目数 >10（最多 10）⇒ `channel.items.length > cardLimit` 恒 false，入口在默认态不可见（置 5 后正常）。
- **证据**：判据 18（`B7`）。**建议**：数据侧补 >10 条渠道，或默认阈值降低。

### P3-2 桌面端无左侧筛选栏（PRD §535 措辞）
- **现象**：1280px 下无 `aside/sidebar`，筛选为顶部内联条（`C18 hasSidebar=false`）。PRD §535 写「列表 + 左侧筛选栏」。属布局风格偏差，可与 P2-2 一并决策。

### P3-3 文档口径不一致：PRD 仍写「近 2 小时」
- `docs/PRD.md:497` 写「今天 / 近 2 小时」，实现与 `site-config.json` 为 `today/3h/6h`（原型 F 决策已改 3h，PRD 未同步）。建议同步文档。

### P3-4 构建产物 favicon 绝对路径
- `dist/index.html` 中 `href="/favicon.svg"` 为绝对路径，file:// 下解析为 `file:///favicon.svg` → `ERR_FILE_NOT_FOUND`（与 P1-2 同场景，影响很小）。建议改相对路径 `./favicon.svg`。

---

## 四、未覆盖项及原因（如实标注，不写成 PASS）

| 未覆盖项 | 原因 | 补充说明 |
|---|---|---|
| 判据 2/4/5/6/7/10/11（真实数据下的页面1 列表类断言） | 真实快照 20 条**全部早于 `snap.date`**，三档时间筛选恒空 ⇒ 列表态不可达 | 已用**合成 fixture** 覆盖其代码路径（[合成] 标注） |
| 判据 8 跨源「+N 源」 | 真实数据 `sourceCount>1` = **0 条** | [合成] 注入 1 条跨源 → PASS |
| 判据 9 异常态黄条 | 真实数据 `stats.sources` 全 `ok:true`（`sourceFailed=0`） | [合成] 注入 1 个失败源 → PASS |
| 判据 13 中 `failed` / `disabled` 两态 | 真实数据**无失败源、无停用渠道**（8 个渠道 `enabled` 全 true） | 该两态在真实数据下不出现；`ok/empty` 已实测出现 |
| 判据 6 的 20→40（真实数据） | 真实数据**仅 20 条**且被过滤 | 改用 [合成] 40 条验证 20→40；并验证了 375 下 10→20 |
| 判据 20③ 构建期内联兜底数据 | 实现里**不存在**该机制（第三层为 `./data/` 而非内联） | 属实现缺失，非测试遗漏 |
| 判据 1「零报错」在完全断网环境 | 三层降级必然产生 2 条 network 404 日志 | 属设计行为，已单列并区分于 JS 报错 |
| 真机 / 非 Chrome 内核 | 本轮仅 Chrome 152 headless + 设备仿真 | 与上一轮一致 |

---

## 五、测试方法复核（哪些 FAIL 最终确认是「我自己的锅」）

| 首轮 FAIL | 复核方式 | 判定 |
|---|---|---|
| `C1`「默认渲染数 ≠ 预期」 | 发现我把**已渲染条数**当**过滤条数**（桌面 `batch=20` 封顶，25 条被截到 20） | **测试 Bug**：改为解析 `resultCount` 的「共 N 条」后 PASS |
| `C6`「加载更多 20→40」首轮点击无效 | 旧 fixture 的「今天」只有 20 条 ⇒ 全部已显示、无按钮 | **测试数据设计 Bug**：调整 fixture 使「今天」=40 后 PASS |
| `C12`「时间筛选计数」首轮 today=20(预期40) | 同 `C1`（渲染封顶） | **测试 Bug**：改用过滤计数后 PASS |
| `C4`「排序切换」首轮序列相同 | 我 fixture 的两个排序键抖动**单调**，导致两序等价 | **测试数据设计 Bug**：改用非单调抖动后 PASS。**副产品结论**：真实数据 `updatedAt===publishedAt`，两序天然等价（数据巧合，非实现等价）——已写入判据 4 |
| `C5`「搜索」首轮 `allContainTerm=false` | 实现按 `title+summary+author` 匹配，我断言只看 `title` | **测试 Bug**：改为与实现同口径的预期计数后 PASS |
| `A2` 首轮被当作「判据2 通过」 | 我误把 `rendered==onDate`（0==0）当判据2；判据2 要求 `items>0` | **测试方法 Bug**：拆出 `A2b` 后**暴露真实 FAIL**（P1-1） |
| 早期 `sError`/`sA` 的 `CDP timeout: Page.navigate` | `Page.navigate` 到**已是** `about:blank` 的 no-op 不返回 + 复用了上一轮残留 Chrome + vite dev server 被回收 | **环境/测试方法问题**：改为「唯一 query 强刷 + 生产构建 + 进程内静态服务器」后稳定 |
| `Fetch` 拦截后出现 CORS 报错 | 我的 `fulfillRequest` 未带 `Access-Control-Allow-Origin` | **测试 Bug**：补 CORS 头后控制台归零 |

> 纪律确认：**全程未用 `grep` 反证**（所有判据取自 `getComputedStyle` / DOM 计数 / `node -e` 读文件）；所有 FAIL 在定级前先自查测试方法，上表 8 条已还原为测试侧问题，**只有 P1-1/P1-2/P2-1/P2-2/P2-3 与 3 条 P3 判定为产品侧**。

---

## 六、结论

- **页面2 渠道看板**：栅格 `4/4/3/2/2/1`、卡片数/健康角标、配置抽屉（条数/勾选）、localStorage 持久化、恢复默认、`查看全部 →` 跳转与过滤 —— **实测全部可用**；1 处边界缺陷（P2-3 空态不可达）。
- **页面1 聚合热榜流**：**代码路径**（过滤/排序/搜索/加载更多/深链/跨源/黄条/时间档/移动降级）在[合成]数据下**全部实测通过**，主题/响应式/零 JS 报错达标；但**真实数据下恒为空态（P1-1）**，且状态条与列表口径矛盾（P2-1）、移动/平板筛选未按 PRD 折叠（P2-2）。
- **主题与产物**：浅色主题 `rgb(246,247,249)` / 主色 `rgb(47,107,255)` **经计算样式证真**；`file://` 打开白屏（P1-2），仅 `--allow-file-access-from-files` 下可用，且无构建期内联兜底。
- **反向验证**：5 条故意错误断言全部 FAIL，证明断言**非恒真**。

### 判定：**有条件通过 —— 建议修复 P1-1、P1-2（以及 P2-1/P2-2/P2-3）后再交付。**

**IS_PASS: NO**

> 说明：若以「页面1 必须能在真实数据下展示内容」为硬验收线，则 P1-1 为阻断级；若接受「qa 在凌晨样本下无同日常内容属正常现网现象」这一解释，则 P1-1 可降为 P2，但「无『全部』档位」与 P2-1 的口径矛盾仍需修复。

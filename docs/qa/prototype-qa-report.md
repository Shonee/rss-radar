# 原型 QA 验证报告 · RSS Radar 4 页静态原型

- **报告日期**：2026-09-12
- **验证对象**：`prototype/`（4 页 HTML + 内联 mock 数据，共 17 文件 4369 行）
- **验收基准**：`docs/PRD.md` §6.1~§6.4（页面详细需求）· `docs/ARCHITECTURE.md` §13（页面4 数据契约）· `docs/data-model/examples/`
- **验证人**：严过关（QA）
- **结论（第一轮）**：不通过（需工程师修复 1 个 P1 + 3 个 P2 后复验）
- **结论（第二轮回归后）**：**通过 —— 可交付给用户查看**（见文末 §七）

> 说明：验证目标是「证明它能用」，而非「确认它存在」。所有结论均来自**真实 headless Chrome 渲染 + 在页面上下文中真实触发交互**，不是静态代码审查。

---

## 一、验证方法（可复现）

工具：本机 `Google Chrome 152.0.7977.84`（headless）+ Node.js v22.22.2（经 DevTools Protocol 驱动，非仅 `--dump-dom`）。
Chrome 运行参数（隔离 profile，避免污染用户目录）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --no-first-run \
  --user-data-dir=/tmp/rrqa/p --virtual-time-budget=6000 \
  --dump-dom "file:///Users/dushouxin/WorkSpace/github/rss-radar/prototype/page1-hot-stream.html"
```

交互/响应式验证通过自建 CDP harness 完成（可复现脚本）：

| 脚本 | 覆盖 | 用例数 |
|---|---|---|
| `node --check assets/js/*.js` | 7 个 JS 语法 | 7 |
| `/tmp/rrqa/harness.mjs` | 4 页渲染 + 交互 + 响应式 + 数据契约 | 72 |
| `/tmp/rrqa/harness2.mjs` | 首轮 FAIL 复核（深链/真实点击/边界） | 13 |
| `/tmp/rrqa/harness3.mjs` | 页2/3/4 四档宽度横向溢出 | 12 |
| `/tmp/rrqa/probe4~11.mjs` | 页面4 溢出根因定位与修复验证 | — |

**合计约 97 条程序化校验**，其中 4 档宽度（375/768/1024/1280，另补 1440/1600）逐页实测。
截图证据：`docs/qa/screenshots/`（p1-1280 / p1-375 / p3-1280 / p4-1280）。

> 首轮 5 个 FAIL 中有 3 个经复核确认为**我测试方法的问题**（已自行修正），详见 §四。

---

## 二、逐项验证结果表

### 2.1 真实渲染 / 控制台错误（最关键）

| 验证项 | 方法 | 结果 | 证据 |
|---|---|---|---|
| 四页 HTML 是否有 JS 报错 | 监听 `Runtime.exceptionThrown` / `console.error/warn` / `Log.entryAdded` | **通过** | page1/2/3/4 + `?channel=` 深链 + `?date=` 深链 + index：**均 NONE**（0 报错） |
| 页面是否整页白屏 | dump-dom / CDP 读 DOM | **通过** | 内容均由 JS 渲染且渲染成功（见下） |
| 页面1 条目渲染 | 计数 `#list article.item` | 通过 | 20 条；`共 49 条符合当前条件，已显示 20 条` |
| 页面2 卡片渲染 | 计数 `.chan-card` | 通过 | 13 张（=启用渠道数） |
| 页面3 报告渲染 | 计数 `.metric` / `.hot-row` / `.pie path` / `.cat-col` / `.bar-row` | 通过 | 4 / 10 / 6 / 6 / 11 |
| 页面4 趋势渲染 | 计数 `#trend-chart svg .point` | 通过 | 90 个数据点 |
| 页面4 日历渲染 | 计数 `.cal-day` | 通过 | 30 格（2026-09），其中 12 格 has-data |

### 2.2 三端响应式

| 验证项 | 方法 | 结果 | 证据 |
|---|---|---|---|
| 页面2 栅格列数 | `getComputedStyle(board).gridTemplateColumns` | 通过 | 1600/1440→**4**、1280→**3**、1024→**2**、768→**2**、375→**1**（与 PRD §6.2 :581-585 吻合） |
| 页面1 无横向溢出 | `scrollWidth>clientWidth` | 通过 | 375/768/1024/1280 全部相等 |
| 页面2 无横向溢出 | 同上 | 通过 | 375/768/1024/1280 全部相等 |
| 页面3 无横向溢出 | 同上 | 通过 | 375/768/1024/1280 全部相等 |
| **页面4 无横向溢出** | 同上 | **失败(P1)** | **375px: scrollWidth=840 / clientWidth=375；768px: 848/758**；≥1024px 正常 |
| 页面1 移动端筛选折叠 | 375px 读 `#side`/`#mobile-filter-toggle` 显示态 | 通过 | `side display=none`，筛选按钮 `display=flex` |

### 2.3 逐字段对照 PRD §6

| 验证项 | 方法 | 结果 | 证据 |
|---|---|---|---|
| 页面1 条目 10 字段（PRD :499-509） | DOM 探测每条 | 通过 | 标题/摘要/渠道/分类/创建时间/更新时间/原文/渠道主页/NEW/「+N源」**全部存在** |
| 页面1 顶部状态条（PRD :481） | 读 `#statbar` | 通过 | `最近更新…· 共 13 个渠道 · 今日 58 条 · 涉及 8 个分类` |
| 页面1 异常态黄条（PRD :517） | 读 `#alerts` | 通过(有缺陷) | 渲染了 warning + info 黄条（文案重叠问题见缺陷 #6） |
| 页面2 卡片 11 字段（PRD :556-568） | DOM 探测每卡片 | 通过 | 渠道名/图标/分类/首页/Feed地址/最后更新/今日条数/单条标题/时间/「+N源」/健康状态**全部存在** |
| 页面3 头部/概要/热点/分类/渠道活跃/关键词/方法论/历史入口（PRD :602-645） | 分块探测 | 通过(有缺项) | 均渲染；**缺 PRD :613「跨源重合榜」**（见缺陷 #9） |
| 页面4 趋势/回看/归档（PRD :678-689） | 分块探测 | 通过 | 趋势图 / 日历回看三态 / 归档 1 年份·6 月均渲染 |

### 2.4 功能交互（在页面上下文中真实触发）

| 验证项 | 方法 | 结果 | 证据 |
|---|---|---|---|
| 页面1 排序切换真的改顺序 | click `#sort-published` 对比前 5 条 | 通过 | 更新时间序 `科技爱好者周刊…` → 创建时间序 `新能源车企…`，序列确实改变 |
| 页面1 搜索过滤 | input 事件 + 计数 | 通过 | `Rust` → 20 条降到 2 条 |
| 页面1 「加载更多」追加 | click `#load-more` | 通过 | 20 → 40 |
| 页面1 「+N 源」可展开 | click `[data-toggle-sources]` | 通过 | 面板 `.hidden` 被移除，可见多来源列表 |
| 页面1 深链 `?channel=v2ex` | 带 query 打开 | 通过 | 勾选 v2ex、列表仅 4 条全为 V2EX |
| 页面2 配置抽屉（条数/渠道/排序） | 打开抽屉改配置 | 通过 | 条数=5 后首卡 5 条；取消 V2EX 后卡片消失 |
| **页面2 localStorage 持久化** | 改配置 → **reload** → 读回 | **通过** | `cardLimit:5 / channels:[…无v2ex]` 重载后仍生效；`file://` 下 `hasLocalStorage=yes` |
| 页面2 「恢复默认」 | click `#drawer-reset` | 通过 | 回到 `cardLimit:10 / channels:null`，V2EX 复现 |
| **页面4 月度明细下钻懒加载** | 真实点击 `summary` + 等待 | **失败(P2)** | 点击后 `.mini-item`=**0**、`data-loaded` 仍为 `"0"`（功能完全不触发） |
| 页面4 指标切换（总条数/活跃渠道） | click `[data-series=activeChannels]` | 通过 | 数值与标题均改变（232条…→10个渠道…） |
| 页面4 窗口 90/180/365 | click `[data-window]` | 通过(无差异) | 标签变为 180，但数据点仍 90（mock 仅 90 天，见缺陷 #8） |
| 页面4 日历翻月 | click `#cal-prev` | 通过 | 2026 年 9 月 → 8 月 |

### 2.5 异常态 / 空态 / 边界

| 验证项 | 方法 | 结果 | 证据 |
|---|---|---|---|
| 页面2 失败渠道灰化 | 计数 `.is-failed` / `.status-error` | 通过 | 1 张 is-failed（OpenAI Blog），status: ok11/err1/empty1 |
| 页面2 无数据渠道「暂无内容」 | 文本扫描 | 通过 | OpenAI Blog、内核恐慌（播客） |
| 页面2 边界：**取消勾选全部渠道** | 取消所有 `data-cfg-ch` → apply | 通过 | 展示全局空态「没有可展示的渠道」 |
| 页面1 边界：搜索不存在关键词 | input `zzz_no_such_xyz` | 通过 | 空态「暂无数据」+ 跳页面2 按钮 |
| 页面4 回看三态：有数据 | 默认今天 | 通过 | 条目数 168 / 活跃 12 / TopN 表 3 行 |
| 页面4 回看三态：无数据 | 点 8/30（索引内但快照为空） | 通过 | 「该日期无数据」 |
| 页面4 回看三态：已归档 | `?date=2025-08-15` | 通过 | 「该日期已归档（超过一年）」+ Release 下载 |
| 页面4 回看：索引有但无逐条快照 | 点 09-05 | 通过 | 显示条目数 161 + 「该日未提供逐条快照」 |
| 页面3 空态可切 | click `#toggle-empty` | 通过 | 「今日暂无数据」 |

### 2.6 数据契约对齐（`mock-data.js` vs `docs/data-model/examples/`）

| 验证项 | 方法 | 结果 | 证据 |
|---|---|---|---|
| 条目数 | `items.length` | 通过 | **59**（与工程师自报一致；去重后主条目 58） |
| 渠道/源 | `length` | 通过 | 渠道 **14** / 源 **16** |
| 热点/分类/趋势/月 | `length` | 通过 | 热点 **10** / 分类 **6** / 趋势 **90 天** / 月度明细 **3 月** |
| `sources[]` 为对象数组 | `Array.isArray` | 通过 | 全条目 `true`，元素均为对象 |
| `category[]` 多标签原生数组 | `Array.isArray` | 通过 | items 与 channels 均为数组 |
| `hotScore/sourceCount/isNew` 原生类型 | `typeof` | 通过 | hotScore=`number,null`、sourceCount=`number`、isNew=`boolean`（**无字符串**） |
| **report.totalItems 一致性** | report vs items | **失败(P2)** | `report.totalItems=168` vs `items.length=59`（见缺陷 #3） |
| **channelActivity vs activeChannels** | len vs 字段 | **失败(P3)** | 排行 11 行 vs `activeChannels=12`（见缺陷 #7） |
| 分类 itemCount 之和 = totalItems | sum | 通过 | 168 = 168 |

### 2.7 工程约束 / 无障碍

| 验证项 | 方法 | 结果 | 证据 |
|---|---|---|---|
| 零外网请求 | 代码扫描 + `Performance.getEntriesByType('resource')` | 通过 | 无 fetch/XHR、无 CDN `<script|link|img>`；resource 全部 `file://`（`examples` 内 URL 仅为展示用 href，非请求） |
| `file://` 可打开、无 CORS | 全流程 file:// 访问 | 通过 | 无 CORS/网络错误 |
| `node --check` 全过 | 7 文件 | 通过 | 独立复核全部 OK |
| 四页共用 design tokens | 读 `getComputedStyle` + 引用检查 | 通过 | 5 页均引 `tokens.css`；`--color-primary/--space-4/--fs-sm/--radius-md` 均解析 |
| a11y：skip-link / nav / focus | DOM + CSS | 通过 | 有 `.skip-link`、`nav[aria-label]`、`button type`、`:focus-visible`；无 `<img>` 故无 alt 问题 |
| 少量硬编码色值 | CSS 扫描 | 通过(建议) | `components.css` 14 处、`pages.css` 10 处未走 tokens（见缺陷 #10） |
| smoke test 16 项（工程师自报） | 全仓查找测试产物 | **无法复现** | 仓库内无任何 smoke/test 脚本（见缺陷 #11） |

---

## 三、缺陷清单

> 严重度：**P0 阻断** · **P1 严重** · **P2 一般** · **P3 建议**

### P1-1 页面4 在窄屏（<1024px）横向溢出
- **页面**：页面4 历史趋势与回看
- **文件行号**：`assets/css/pages.css:421-424`（`.cal-grid` / `.cal-day`）；根因位于「回看区」日历
- **现象**：375px 视口下 `document.documentElement.scrollWidth = 840`（≈2.2 倍视口）；768px 下 848；≥1024px 正常。移动端页面整体可横向拖动、右侧留白。
- **复现步骤**：
  1. Chrome 打开 `prototype/page4-history.html`；
  2. 切宽到 375px（或 768px）；
  3. 执行 `document.documentElement.scrollWidth >  clientWidth` → 840 > 375。
- **期望**：任何断点下无横向溢出（PRD §6.4 :708-714 要求移动端单列轻量展示）。
- **根因（已定位并验证）**：`.cal-day { aspect-ratio: 1/1 }` 使日历格成为**正方形**，在 `grid-template-columns: repeat(7, 1fr)` 下每列被撑到 ~114px，7 列 ≈ 822px，撑破容器。隔离验证：`#calendar` 设 `display:none` → scrollWidth 立即回到 375；`#lookback`/`.month-list`/`#archive` 隐藏均无效果。
- **已验证的修复方案**（在页面上下文实测，无源码改动）：

  ```css
  .cal-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); }
  .cal-day  { aspect-ratio: auto; min-width: 0; height: 36px; }
  ```

  实测结果：375px → **375**（修复）；768px → **758**（修复）。仅加 `minmax(0,1fr)` + `min-width:0` 可修复 768px，但 375px 仍因「方形格」最小尺寸残留 411，故需同时去掉 `aspect-ratio` 改用固定行高。

### P2-1 页面4「月度明细下钻」懒加载失效（宣称功能不可用）
- **页面**：页面4
- **文件行号**：`assets/js/page4.js:120`
- **现象**：点击任意月份的 `<summary>` 展开后，明细行**永远加载不出来**：`.month-body .mini-item` = 0，`data-loaded` 保持 `"0"`。
- **复现步骤**：`page4-history.html` → 点击「2026 年 9 月明细」→ 展开后仅空白，无 loading 后无明细。
- **期望**：展开某月 → 显示骨架屏 → ~420ms 后列出该月明细（如 6 条）。
- **根因**：`el('months').addEventListener('toggle', …)` 把监听器挂在**容器 `#months`** 上，但 `<details>` 原生的 `toggle` 事件**不冒泡**（实测 `bubbled=false`），事件永远到不了容器 → 处理器不触发。
- **修复建议**：监听器改为直接绑定到每个 `<details class="month-row">`；或改用 `click` 事件代理到 `summary`。

### P2-2 跨页「今日条数」自相矛盾
- **页面**：页面1 ↔ 页面3（mock 数据层）
- **文件行号**：`assets/js/mock-data.js:594`（`report.totalItems:168`）与 `:570-582`（snapshotStats）
- **现象**：页面1 顶部状态条显示「今日 **58** 条」（由 `items[]` 派生），页面3 头部显示「数据覆盖 … **168** 条」（`report.totalItems`）。同一个「今天」两个数字。
- **期望**：同一时间基准（`2026-09-12`）下两页「今日条数」一致。
- **修复建议**：页面1 状态条改用 `report.totalItems` 取整日口径，或明确标注「样本 N 条 / 全量 168 条」。

### P2-3 响应式内容未按 PRD 断点降级
- **页面**：页面1、页面2
- **文件行号**：`assets/js/page1.js:34`（batch 恒为 store 值）、`assets/js/page2.js:141`（cardLimit 恒为 10）
- **现象**：PRD §6.1 :525 要求「移动（<768px）每批 10 条」，实测 375px 仍渲染 **20** 条；PRD §6.2 :585 要求「移动卡片内默认 5 条」，实测 375px 每卡片仍 **10** 条。
- **期望**：断点切换时按 PRD 调整每批/每卡片条数。
- **修复建议**：渲染前按 `matchMedia('(max-width:767px)')` 覆写 batch/cardLimit（仅在用户未自定义时）。

### P3-1 「查看全部→」在默认态永不出现
- **页面**：页面2 ｜ **文件行号**：`assets/js/components.js:276`
- **现象**：默认每卡片 10 条时 `.chan-more` 数量 = **0**，因为**没有任何渠道条目数 >10**（最多 7 条）。把每卡片条数改为 5 后正常出现 4 个 `?channel=` 链接（功能实现正确）。
- **期望/建议**：为至少 1 个渠道补充 >10 条 mock 条目，使该入口在默认态即可见可验。

### P3-2 页面1 异常黄条逻辑重叠
- **页面**：页面1 ｜ **文件行号**：`assets/js/page1.js:82-97`
- **现象**：OpenAI Blog 同时出现在「1 个渠道本次抓取失败」与「2 个渠道今日暂无内容」两条提示里（失败渠道必无条目，被同时判为"无内容"），文案互相矛盾。
- **建议**：「暂无内容」列表排除已失败的渠道（并换用更准确措辞）。

### P3-3 元数据内部不一致
- **页面**：mock 数据层 ｜ **文件行号**：`assets/js/mock-data.js:595` vs `:634-646`
- **现象**：`report.activeChannels=12`，但 `channelActivity` 仅 **11** 行；页面2 显示启用渠道 **13**。
- **建议**：对齐三处口径。

### P3-4 趋势窗口 180/365 无实际差异
- **页面**：页面4 ｜ **文件行号**：`assets/js/page4.js:56` + `mock-data.js:700`（仅 90 天数据）
- **现象**：切到「近 180 天」标签变化，但数据点仍 90（切片等价）。窗口能力无法被验证。
- **建议**：mock 趋势扩到 ≥365 天，或在 UI 上注明「仅提供近 90 天数据」。

### P3-5 页面3 缺 PRD 的 P1 区块
- **页面**：页面3 ｜ **PRD 行号**：§6.3 :612-613（词云、**跨源重合榜**）、:616（分类分栏 8 类）
- **现象**：`report.crossSource` 数据已备但 `page3.js` 未渲染，**「跨源重合榜」缺失**；分类分栏只有 6 类（空分类被省略，PRD 列了 8 类命名）。
- **建议**：补渲染 crossSource 榜，或在页脚注明「P1 区块未实现」。

### P3-6 设计令牌未完全收敛
- **文件行号**：`assets/css/components.css`（14 处）、`assets/css/pages.css`（10 处）
- **现象**：如 `.hot-rank.r1/r2/r3` 配色、alert 文字色、渐变端点等为硬编码 hex，未走 tokens。
- **建议**：收敛到 `tokens.css` 语义变量。

### P3-7 「smoke test 16 项」无交付物
- **现象**：工程师自报「smoke test 16 项」，但仓库内**无任何测试脚本/产物**，无法复现。其「node --check 全过」结论我已独立复核通过。
- **建议**：把 smoke 脚本一并提交（如 `prototype/tests/smoke.mjs`），否则该结论不可复现。

---

## 四、首轮 FAIL 的复核结论（区分源码 Bug / 测试 Bug）

| 首轮 FAIL | 复核方式 | 判定 |
|---|---|---|
| P4「月度下钻 miniItems=0」 | 改用**真实点击 summary**（harness2） | **源码 Bug（真）**，见 P2-1 |
| P4「回看：无数据」 | 首轮误点 **未来日期 `2026-09-20`（disabled）** | **测试 Bug（我的）**；改点 8/30 后通过 |
| P2「查看全部→」 | 首轮在**默认 10 条**下查找 | 测试口径问题；改为 5 条后功能正常 → 归为 **P3-1 数据覆盖** |
| DATA「totalItems 一致性」 | 复核 | **源码/数据缺陷（真）**，见 P2-2 |
| DATA「channelActivity 一致性」 | 复核 | **数据缺陷（真）**，见 P3-3 |

---

## 五、未验证项与原因

1. **像素级视觉评审**：本报告仅做程序化布局/DOM 校验 + 4 张截图（`docs/qa/screenshots/`），未做人工视觉走查（配色/间距/排版观感）。
2. **真机 / 非 Chrome 内核**：仅用 Chrome headless 移动 emulation；未在真机 iOS Safari、Android Chrome 上验证（如需，可另测）。
3. **时间锚点固定（`NOW='2026-09-12'`）**：确认为**有意为之**（保证相对时间稳定），**不算 Bug**；已验证不会导致显示错乱（相对时间以 NOW 为基准正常，跨天比较正确）。
4. **性能**（首屏耗时、图表大数据量）未做基准测试（原型阶段非重点）。

---

## 六、结论

原型**信息架构、字段清单、绝大多数交互、数据契约、响应式栅格、零外网请求、a11y 基础、file:// 可用性**均**通过**——尤其是工程师重点声明的 **localStorage 持久化**、**排序/搜索/加载更多/深链**、**饼图/条形图/趋势图**、**回看三态**均经真实交互验证为**真**。

但**不能判定通过**，需修复后再验：
- **P1 × 1**：页面4 窄屏横向溢出（根因与已验证修复方案见 P1-1）。
- **P2 × 3**：月度下钻懒加载失效、跨页「今日条数」矛盾、移动端每批/每卡片条数未降级。

**路由判定：交回工程师 寇豆码 修复**（P1-1、P2-1、P2-2、P2-3 建议一并处理 P3-1/2/3/4/5）。

---

# 第二轮回归验证（2026-09-12）

> 本轮为 SOP 第 2 轮（上限）。第一轮记录保留于上（§一~§六），本节为回归复验与最终结论。

## 七、本轮验证方法（可复现）

工具同第一轮：Chrome 152（headless）+ Node.js v22 经 DevTools Protocol 驱动（**真实点击/输入，非静态审查**）。

```bash
# 自检脚本（工程师新增）
node prototype/tools/smoke-test.mjs --no-dom          # 数据契约层
TMPDIR=/tmp/rrqa CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node prototype/tools/smoke-test.mjs                 # 含 DOM 段
# 回归 harness（QA 自建）
node /tmp/rrqa/harness_r2.mjs    # 48 条：渲染/交互/响应式/回归/数据契约
node /tmp/rrqa/harness_r2b.mjs   # 12 条：修正测试方法后复核（固定视口/新开页）
node /tmp/rrqa/probe_r2.mjs      # 黄条重叠 + 跨页口径
# 变异测试（对抗性）
#   1) report.totalItems → 999   2) 某 hotScore → "0.87"   （测后已还原，diff -q 校验 clean）
```

本轮共执行 **约 62 条**程序化校验。**重要前提修正**：Chrome headless 默认视口宽度为 **756px（<767 ⇒ 移动断点）**，故第一轮「桌面」类判定必须显式固定视口——本节所有桌面断言均在 `1280px` 下重测。

## 八、逐条回归结果表

| 缺陷 | 上轮严重度 | 本轮结果 | 证据 |
|---|---|---|---|
| **P1-1** 页面4 窄屏横向溢出 | P1 | ✅ **已修复** | 375px `sw=375/cw=375`、768px `sw=758/cw=758`；375px **无任何超宽元素**（`[]`）；日历格 `@375 = 45×36`、`@1280 = 99×36`，`textOverflow=false`，无变形 |
| **P2-1** 月度下钻懒加载失效 | P2 | ✅ **已修复** | 真实点击**每个**月份：明细行 `6 / 5 / 4`，`data-loaded="1"`；每月份均出现 **12 个骨架屏**（loading 真实出现过） |
| — 月度下钻·重复开合 | — | ✅ 通过 | 开→合→再开：明细保留（`mini=6`，未丢失/未重复请求） |
| — 月度下钻·A 后 B | — | ✅ 通过 | 展开月份0 后再展月份1：`m0=6, m1=5` 两者并存 |
| **P2-2** 跨页「今日条数」矛盾 | P2 | ✅ **已修复** | 页面1「今日 **57** 条」== 页面3「数据覆盖 **57** 条」；`report.totalItems=57 == ΣcategoryStats=57 == snapshotStats.itemsAfterDedup=57`；README「67 条条目（今日去重后 57 条）」自洽（实测 items=67 / 主条目=66 / 今日=57） |
| **P2-3** 移动端未按断点降级 | P2 | ✅ **已修复** | 页面1：1280→20 条 / 375→**10** 条；页面2：1280→每卡 10 / 375→每卡 **5** |
| — P2-3 用户优先规则 | — | ✅ 通过 | 页面1 显式设 40 后 375px 仍 40（不降级）；页面2 抽屉设 20 后 375px 每卡 15（未降为 5）；均经 localStorage 重载后仍生效 |
| **P3-1** 「查看全部→」默认不可见 | P3 | ✅ **已修复** | 桌面默认态 `chan-more=1`（HN 今日 15 > 10）；375px 下 `moreLinks=4` |
| **P3-2** 黄条逻辑重叠 | P3 | ✅ **已修复** | 失败黄条=「1 个渠道本次抓取失败：OpenAI Blog」；无内容提示=「内核恐慌（播客）」；**重叠判定 = false** |
| **P3-3** 元数据不一致 | P3 | ✅ **已修复** | `activeChannels=11 == channelActivity.length=11 == 条形图行数=11` |
| **P3-4** 趋势窗口无差异 | P3 | ✅ **已修复** | 数据点 `90 / 180 / 365`（`buildHistoryIndex(365)`）三档真正不同 |
| **P3-5** 缺跨源重合榜 | P3 | ✅ **已修复** | 页面3 渲染「跨源重合榜」区块，`crossSource` 行数 **4** 全渲染（`.hot-row` 含「共 N 个渠道报道」） |
| **P3-6** 硬编码色值 | P3 | ✅ **已修复** | 排除 `tokens.css` 后，`assets/css` 中非 token hex **= 0 处**（独立 grep 复核） |

### 回归扫描（重构未改坏既有能力）

全部通过：localStorage 持久化（重载后仍生效）· 排序切换/搜索/加载更多/「+N 源」展开/`?channel=` 深链 · 页面2 栅格 **4/3/2/1**（1600/1280/1024-768/375）· 饼图/条形图/趋势图/日历三态回看 · 数据契约类型（`sources[]` 对象数组、`category[]` 数组、`hotScore`=`number|null`、`sourceCount`=`number`、`isNew`=`boolean`）· **零外网请求**（`resource` 全 `file://`）· **四页 + 深链 + index 控制台 0 报错**。

### 工程师交办的两处交互级验收（本轮核心）

1. **页面4 真实点击月度下钻**：✅ 通过 —— 见上表 P2-1（3 个月份逐一真实点击，明细/骨架屏/重复开合/A-B 并存全部验证）。
2. **375/768 无横向溢出**：✅ 通过 —— `scrollWidth <= clientWidth`，且**全页扫描无任何超宽元素**；日历格未因去掉 `aspect-ratio` 而变形或文字溢出（`45×36` / `99×36`，`textOverflow=false`）。

## 九、变异测试（证明测试有效，非"永远通过"）

| 变异 | 手段 | 结果 | 退出码 |
|---|---|---|---|
| MUT1 | `report.totalItems` 改 999（破坏 A 组恒等式） | **3 项失败**（totalItems/ΣcategoryStats/snapshotStats） | **exit 1** |
| MUT2 | 某 `hotScore: 0.87` → 字符串 `"0.87"`（破坏 C 组类型） | **1 项失败**（hotScore 类型） | **exit 1** |

测后已 `cp` 还原并以 `diff -q` 校验文件一致（输出 `RESTORED_CLEAN`）。
**结论：`tools/smoke-test.mjs` 的断言是真实有效的**（会因数据损坏而失败并非 0 退出），**不是"永远通过"的假测试**。`--no-dom` 模式复现工程师声称的 **通过 29 / 失败 0 / 跳过 1**（那 1 条 SKIP = DOM 元素存在性段，`--no-dom` 下按设计跳过）。

## 十、本轮新增缺陷

### P3-7（测试质量，不影响原型本体）smoke-test 的 DOM 段在「渲染失败」时静默 SKIP 且仍报 PASS
- **文件行号**：`prototype/tools/smoke-test.mjs:146-176`
- **现象**：当 Chrome 不存在**或渲染失败**时，4 个页面的 DOM 断言全部 `SKIP`，但脚本仍打印 `SMOKE TEST PASS` 且 **退出码 0**。即在无 Chrome / Chrome 异常的环境中，**DOM 层断言完全未生效却给出"通过"**，可能掩盖真实的 DOM 破坏。
- **复现**：`CHROME_BIN=/nonexistent node prototype/tools/smoke-test.mjs` → DOM 段全 SKIP，输出 `SMOKE TEST PASS`；本轮在本机沙箱（Chrome 渲染受限）实跑时亦观测到 `page2/3/4 (Chrome 渲染失败)` 被 SKIP 而整体 PASS。
- **期望**：DOM 段若因**渲染失败**未能执行，应计入失败或至少以显著警告标注「DOM 未验证」，而非静默 PASS。
- **备注**：README :149 已说明「无浏览器自动 SKIP」，属已知设计；但"渲染失败也 SKIP"这一细分会削弱 CI 把关力，建议改进（P3）。

## 十一、最终结论

- **第一轮**发现的 **1×P1 + 3×P2 + 7×P3 已全部修复并经真实渲染/交互复验通过**；
- **回归扫描**：既有能力（localStorage/排序/搜索/加载更多/深链/栅格/图表/日历三态/数据契约/零外网/无 JS 报错）**无一被改坏**；
- **变异测试**证明自检脚本断言有效；
- **新增 1 个 P3**（smoke-test DOM 段 SKIP 语义，测试质量，不阻塞交付）。

### ✅ 最终判定：**通过 —— 该原型可以交付给用户查看。**

后续建议（非阻塞）：修复 P3-7（让 DOM 段渲染失败不计为 PASS）；第二轮的两处交互级验收（月度下钻、窄屏溢出）均已实测确认。

---

## P3-7 变异验收（2026-09-13）

> 工程师完成 `tools/smoke-test.mjs` 第二轮修复（251 行版本，新增 `domVerified` / `domUnverifiedWhy` 标志、`--chrome-path` 参数、三态汇总行、`exit 0/1/2`）。QA 验收如下。

### A. `--no-dom` 显式跳过
- **PASS**
- 关键输出：
  - `D. 各页关键元素存在性 (headless Chrome)` → `• DOM 段：未验证（--no-dom，显式跳过）`
  - 汇总：`SMOKE TEST PASS（DOM 未验证）`
  - `EXIT=0`
- 备注：与上一轮 `--no-dom` 行为一致（数据契约 29/0 走完，DOM 段按设计跳过），且汇总行新增了明确的「未验证」标注。

### B. 变异：默认模式 + 假装没有 Chrome
- **PASS**
- 命令：`node prototype/tools/smoke-test.mjs --chrome-path /nonexistent/chrome`
- 关键输出：
  - `D.` → `✗ DOM 未验证：--chrome-path 指定的文件不存在`
  - 汇总：`SMOKE TEST PASS（DOM 未验证）` · `EXIT=2`
- **关键证据**：`--chrome-path` 指向不存在时，退出码由 0 → **2**。这正是 P3-7 的核心修复 —— "DOM 未验证"不再是"假通过"，CI 与本地人工都能看到 `EXIT=2` + 显式红字 ✗。

### C. 默认模式（有 Chrome）
- **SKIP（沙箱环境，脚本本身正常）**
- 现象：默认 + `TMPDIR=/tmp/rrqa` + 显式 `--chrome-path /Applications/Google Chrome.app/Contents/MacOS/Google Chrome` 三种姿势均跑通 A/B/C/E 五组，但 D 段仍报 `✗ DOM 未验证：Chrome 渲染或启动失败（page1/2/3/4-history.html）`；汇总 `SMOKE TEST PASS（DOM 未验证）` · `EXIT=2`。
- 根因：本工具的沙箱拦截 `~/Library/Application Support/Google/GoogleUpdater/` 写操作（系统 sandbox 行为，与脚本无关，stderr 见 `/private/var/folders/.../code_sign_clone` 拒绝记录）；headless Chrome 启动时被沙箱杀死。
- **判定**：按 team-lead 指示「环境原因不判 P3-7 失败」。脚本行为正确 —— 启动失败时正确打出 `✗`、汇总标 `未验证`、`EXIT=2` 而非 0，**没有再退化为"假通过"**。工程师本机（或任意有 Chrome 启动权限的 CI）能直接验证 D 段为 `✓ DOM 段：已验证 4/4 页` + `EXIT=0`。
- 我另用自建 CDP harness（`/tmp/rrqa/harness_r2.mjs`、`r2b.mjs`、`regress_d.mjs`）通过 `--user-data-dir=/tmp/...` 绕开沙箱独立渲染了全部四页，结果见 D 段，验证 P1-1 / P2-1 / 跨页口径 / 移动端降级均无回退。

### D. 旧 P1/P2 回归

| 项 | 结果 | 证据 |
|---|---|---|
| P1-1 页面4 窄屏溢出 | PASS | 375px `sw=375/cw=375`；768px `sw=758/cw=758`（CDP 实测） |
| P2-1 月度下钻懒加载 | PASS | 真实点击 3 个月份：明细 6/5/4、每月份骨架屏 12、data-loaded=1 |
| P2-2 跨页口径 | PASS | 页面1「今日 57」== 页面3「数据覆盖 57」 |
| P2-3 移动端降级（页1） | PASS | 1280px batch=20/rendered=20；375px batch=10/rendered=10 |
| P2-3 移动端降级（页2） | PASS | 1280px maxItems=10；375px maxItems=5 |
| P3-2 黄条不重叠 | PASS | warning=OpenAI Blog；info=内核恐慌（播客）；overlap=false |
| P3-4 趋势窗口 | PASS | 90/180/365 → 90/180/365 点 |
| P3-5 跨源重合榜 | PASS | 区块存在 + 4 行渲染 |
| 数据契约恒等（A 组） | PASS | totalItems=57=Σcat=57=snapshotStats；activeChannels=11=channelActivity 长度 |
| mock-data 未被污染 | PASS | `diff -q` 输出 CLEAN（无变异残留） |

> 同时 `tools/smoke-test.mjs` 的 A/B/C/E 段（口径/类型/响应式护栏）**全部通过**（29/0/0），这本身就构成对 P2-2 / P1-1 / P3-3 等数据层修复项的回归护栏。

**结论**：P3-7 已闭环，原型阶段可交付。

> 验收核心证据是 B 项：`--chrome-path /nonexistent` → `EXIT=2` + 显式 `✗ DOM 未验证`，证明"无 Chrome / 渲染失败"不再静默 PASS。脚本现在以 `exit 0 = 全部验证通过`、`exit 1 = 数据层失败`、`exit 2 = 数据层通过但 DOM 未验证` 三态准确区分，CI 接入方可根据退出码决策是否阻断。

---

## v1.3 优化验收（2026-09-13）

> 工程师完成 10 个 v1.3 commit（`a1e3285 / 005199c / 5d65842 / 23f51b3 / 7314177 / eef99d2 / 9792d77 / 7d19c9c / c6804d0 / 323363b`，HEAD `323363b`）。QA 用 CDP harness 真实渲染 + 静态分析做了 28 条程序化校验，结果如下。

- **A 排序综合倒序（page1）**：PASS
  - DOM 中**无** `#sort-updated` / `#sort-published` 按钮（CDP 实测 `#toolbar` 中 `sortBtns=0`）
  - `page1.js` 移除 `setSort` 函数，`state.sort` 字段保留仅为兼容历史 `page1Sort` 存储值
  - **渲染列表前 5 条按 updatedAt 倒序**（GMT+8 转 UTC）：10:16 > 10:08 > 10:05 > 10:02 > 09:48，`sortedDesc=true`
  - 备注：你给的 DevTools 片段 `RR_MOCK.items.filter(i=>!i.duplicateOf).slice(0,5)` 测的是**原始 mock 数组**（按渠道分组入数组，**未预排序**）—— 这是 mock 数据组织方式而非排序逻辑问题；页面 `filtered()` 在渲染前对 ISO 串做字典序倒序，用户实际看到的列表顺序正确。若希望 raw slice 也能反映序，可在 `mock-data.js` 末尾对 `items` 做一次排序（建议 P3，非阻断）。

- **B 简称去除（全局）**：PASS
  - `git grep -nE "c\.icon \+ ' '" prototype/` → **0 匹配**（工程师自检项过）
  - 4 页面 + about.html 的 `.badge-channel` / `.chan-name` / 配置抽屉 checkbox 文字**全部干净**（CDP 抽查 13 个渠道名均为全称："阮一峰的网络日志"、"Hugging Face Blog"、"IT之家"、"Hacker News"、"V2EX"、"36氪"、"TechCrunch"、"GitHub Blog"、"少数派"、"美团技术团队"、"arXiv cs.AI"、"OpenAI Blog"、"内核恐慌（播客）"，**无任何"阮/氪/IT/少/美/H/TC"前缀**）
  - 注：第一次校验因正则 `阮\s*阮一峰` 误命中（`textContent` 把头像字"阮"与名字"阮一峰"串接），后改用单元素 `.chan-name textContent` 精确断言通过。

- **C 看板卡片官网跳转（page2）**：PASS
  - DOM 中任一渠道卡片同时含 `[data-feed]`（RSS 源图标） + `.btn-ghost.btn-icon[href][target="_blank"]`（官网跳转图标）
  - mock-data 全部 14 个渠道 `ch.homepage` **非空**（`empty homepage channels: 0`）
  - 卡片头部"渠道名"链接本身也带 `target="_blank"`，点击直达首页

- **D 跳转修复（file:// 协议下 target=_blank）**：PASS
  - `components.js:481-485` 在 `bindGlobalClicks` 事件委托中新增：
    ```js
    var link = e.target.closest('a[target="_blank"]');
    if (link && link.href) {
      window.open(link.href, '_blank', 'noopener,noreferrer');
      e.preventDefault();
    }
    ```
  - 覆盖 4 页面 + about.html 的所有外链（item-title / 原文 / 渠道主页 / 看板 / 配置 / etc.）
  - 本沙箱因拦截 GoogleUpdater 路径无法实测真实弹出窗口，但静态逻辑成立（沙箱限制 ≠ 脚本问题）

- **E 首页改造 + NAV + brand + slogan 截断**：PASS
  - `index.html` 已变为聚合热榜流首页：`#statbar` + `#alerts` + `#toolbar` 全部存在；**无任何** `.proto-card`（`protoCards=0`）
  - `about.html` 含 4 个 proto-card，NAV 中「关于网站」`aria-current="page"` 高亮
  - NAV 数组 = 5 项：`['聚合热榜流','渠道看板','分析报告','历史趋势','关于网站']`（components.js:174-180）
  - 顶栏 `.brand` 包成 `<a class="brand" href="index.html">`，点击回聚合流首页
  - slogan `title` 属性兜底（hover 完整文本），375px 下 `display:none`（CDP 实测：375=`display:none, title 完整保留`；1280=`display:flow-root, 全文显示`）
  - footer 链接 `/about.html`（E5 更新）

- **F 时间筛选近 3 小时（page1）**：PASS
  - 侧栏 `#range-3h` 存在；**无** `#range-2h`；DOM 范围按钮 = 2（"今天" / "近 3 小时"）
  - `state.timeRange` 默认 `'today'`，可切换 `'3h'`（page1.js:178-179, 218, 243）

### smoke-test 三态（P3-7 不能回归）
- **A. `--no-dom`**：PASS — `通过 29 / 失败 0 / 跳过 0`，`DOM 段: 未验证（--no-dom）`，汇总 `SMOKE TEST PASS（DOM 未验证）`，`EXIT=0`
- **B. `--chrome-path /nonexistent/no-chrome-here`**：PASS — `通过 29 / 失败 0 / 跳过 0`，`✗ DOM 未验证：--chrome-path 指定的文件不存在`，`EXIT=2`（P3-7 三态语义保留）
- **C. 默认模式（有 Chrome）**：**SKIP（环境原因，脚本本身正常）** — 本工具的沙箱拦截 `~/Library/Application Support/Google/GoogleUpdater/` 写操作，headless Chrome 启动被沙箱杀死。该问题为已识别的环境性 SKIP（与上轮 P3-7 验收一致），由我自建 CDP harness（`/tmp/rrqa/harness_v13.mjs`）独立渲染 4 页 + about 共 6 页旁证 0 报错。

### 旧 P1/P2 回归
- P1-1 页面4 窄屏溢出：index.html @375 `sw=375/cw=375`，@768 `sw=758/cw=758`
- P2-1 月度下钻：3 月份逐个真实点击，明细 6/5/4、每月份骨架屏 12、`data-loaded=1`
- P2-2 跨页 today 数字：page1=57，page3=57
- P2-3 移动端降级：page1 1280→20 / 375→10；page2 1280→每卡 10 / 375→每卡 5
- P3-2 黄条不重叠：warning=OpenAI Blog，info=内核恐慌（播客），overlap=false
- 0 JS 报错：4 页 + about 共 6 个文档，CDP `Runtime.exceptionThrown` / `console.error|warn` / `Log.error` 全部 NONE

### mock-data 完整性
`diff -q` 与上一轮基准一致（CLEAN），无变异残留。

**结论**：v1.3 已闭环，原型阶段可迭代交付。

> 全部 28 条程序化校验通过（含 1 个 A 项测试方法注解 + 0 真实缺陷）。核心证据：
> - A 渲染列表实测 updatedAt 倒序正确（10:16>10:08>10:05>10:02>09:48 UTC）
> - B 13 个渠道名全部无前缀
> - C page2 卡片同时含 Feed 源图标 + 官网跳转图标
> - D `window.open(..., 'noopener,noreferrer')` 委托 + `e.preventDefault` 已就位
> - E 聚合流迁到 index.html，about.html 接管旧引导，slogan 375 隐藏 + title 兜底
> - F 侧栏从"近 2 小时"改为"近 3 小时"
> - smoke-test 三态：EXIT 0（PASS）/ 2（DOM 未验证），P3-7 行为保留

---

## v1.4 验收（2026-09-13）

**范围**：master HEAD `541218d`，两个 commit——`7f68787` A：mock-data URL 修正为真实可访问（+334/-334，仅 `prototype/assets/js/mock-data.js`）；`541218d` B：docs 首次入库 + URL 健康检查增补（仅 `docs/`，21 个文件 +4694 行）。验收基准：PRD §5.12（F-108~F-110）、ARCHITECTURE §15、data-model schema/README。

### A. mock URL 修正验证 —— 通过（11/11 可访问 + 5/5 标题语义匹配）

WebFetch 逐条实测（判据：HTTP 200/301/302/反爬=PASS，404/timeout=FAIL）：

| # | URL | 结果 | mock 标题 vs 实际标题 |
|---|-----|------|----------------------|
| 1 | ruanyifeng.com/.../weekly-issue-412.html | PASS 200 | 一致（第 412 期：禁止 issue，只用 PR） |
| 2 | sspai.com/post/114461 | PASS 200 | 一致（与 AI 搏斗失败后重新开始找工作…） |
| 3 | tech.meituan.com/.../Agent-Evaluation-White-Paper-01.html | PASS 200 | 一致（《Agent 评测白皮书》系列01） |
| 4 | news.ycombinator.com/item?id=49672510 | PASS 200 | 一致（We must pace the frontier，574 points/807 评论） |
| 5 | techcrunch.com/.../automattic-confirms-mullenweg… | PASS 200 | 一致（Automattic confirms Mullenweg has returned as CEO…） |
| 6 | arxiv.org/abs/2609.11916 | PASS 200 | 一致（Can Edge-Deployable VLMs Identify Species?） |
| 7 | ithome.com/1/001/698.htm | PASS 200 | 一致（绿联 Nexode Air Slim 100W） |
| 8 | 36kr.com/p/3981147673345033 | PASS 200 | 一致（物理AI企业自研WMM世界机理模型） |
| 9 | github.blog/.../marketing-ops-as-code… | PASS 200 | 一致（Marketing ops as code…） |
| 10 | v2ex.com/t/1241336 | PASS 200 | 跨源条目 it_9f2c1a7b3e5d 的 sources[] 命中（见"观察"） |
| 11 | huggingface.co/blog/sheebz/there-is-no-ai-arms-race | PASS 200 | 一致（There Is No AI Arms Race…） |

node 侧全量扫描（67 条 items）：item 级 URL 0 重复、item+sources URL 100% `https://`、0 条 placeholder/example.com 残留。

**观察（P3，不阻塞）**：跨源条目 `it_9f2c1a7b3e5d`（阮一峰周刊 412 期）的第二个源 `v2ex.com/t/1241336` 实际帖子标题为《有人买了中转站 6TB 的数据…》，与周刊主题无关——URL 本身真实可访问（验收判据满足），但"跨源重合"的语义配对不真实。mock 演示数据可接受，真实实现时跨源聚合需按内容相似度判定。

### B. docs 增补审查 —— 2 处缺口（已上报 team-lead，不回退工程师）

**通过项**：
- `snapshot.schema.json`：Item 新增 `urlStatus`（enum ok/dead/moved/blocked）+ `urlCheckedAt`（date-time），**不在 required**，向后兼容 ✓
- `data-model/README.md` §4.1 字段字典：urlStatus/urlCheckedAt 两行 🆕 在 ✓
- `ARCHITECTURE.md` §15 URL 健康检查与失效降级（15.1 HEAD 校验/15.2 状态机/15.3 跨源优先级/15.4 前端降级/15.5 重试）+ §14.A v1.4 变更点表 ✓
- `PRD.md` §5.12 F-108/F-109/F-110（P1）✓；行 476 统计行"合计 = 84 条（P0=47/P1=29/P2=8）" ✓

**缺口 B-1（P2）**：`snapshot.example.json` 无 `blocked` 示例。5 条 items 仅 2 条赋 `urlStatus:"ok"`；按 §15.2 状态机设计意图（V2EX 反爬为现实案例），V2EX 条目（`it_9f2c1a7b3e5d` sources 中的 v2ex url、`it_4a2b8c0d6e1f`）应赋 `urlStatus:"blocked"` 作示例，实际未赋。schema 本身向后兼容不受影响，但示例未能演示四态中最有代表性的 blocked 态。

**缺口 B-2（P2）**：PRD 文档内统计口径自相矛盾 + §13 疑似漏补。§13 待确认问题清单仅列到 Q20，无 Q21/Q22；C.3 统计表仍显示"功能条目 81"，与行 476 的 84 不一致（同文档两处矛盾）。

### C. smoke-test 三态 —— 通过

```
node prototype/tools/smoke-test.mjs --no-dom
  → 通过 29 / 失败 0 / 跳过 0，"SMOKE TEST PASS（DOM 未验证）"，EXIT=0 ✓
node prototype/tools/smoke-test.mjs --chrome-path /nonexistent/no-chrome-here
  → 数据层 29/0，"DOM 未验证：--chrome-path 指定的文件不存在"，EXIT=2 ✓
```
三态语义（0=全过 / 1=数据层失败 / 2=DOM 未验证）保留，P3-7 行为无退化。

### D. 回归 —— 代码面 0 回归；DOM 渲染段受环境限制未执行（降级验收）

- `git diff 323363b..HEAD -- prototype/`：仅 `mock-data.js`（+334/-334），**其余 JS/CSS/HTML 0 改动** → 代码回归面只有纯数据文件。
- mock-data.js 为纯数据 + 派生函数，不含 DOM/渲染逻辑；v1.3 已做过 6 文档全量渲染回归（0 JS 报错），本轮无渲染逻辑变更，渲染回归风险≈0。
- node 侧数据契约：跨页口径恒等（totalItems=ΣcategoryStats=itemsAfterDedup=57）、67 条 items、URL 全 https 无重复 ✓。
- **环境限制声明**：CDP 真实渲染段（Chrome headless）本轮被桌面沙箱拦截（Chrome 写 `~/Library/.../RLZ/RlzStore.plist` 触发权限弹窗且被拒绝，按约定未重试）。该段验证待环境授权后可补跑（harness 已备好：`/tmp/rrqa/harness_v14.mjs`）。

### 结论

A/C 全过，D 代码面 0 回归（DOM 渲染段因环境沙箱降级，有等效静态证据 + 可补跑 harness）。**B 项 2 处缺口（example 无 blocked 示例、PRD 统计口径矛盾+§13 漏 Q21/Q22）已即时上报 team-lead 裁决，按指示不回退工程师。** 待 B 缺口处置结论 + D 段渲染补跑（或主理人接受降级）后，v1.4 方可宣告闭环。

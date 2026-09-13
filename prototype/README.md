# RSS Radar · 页面原型（Prototype）

> 四个页面 + 导航页的**高保真静态原型**。目的：在进入真实实现前，确认**信息架构、字段清单、交互行为与响应式效果**。

---

## 一、怎么打开

**直接双击 HTML 文件即可**，无需任何构建、服务器或依赖：

- 总入口：**`index.html`**
- 页面1：`page1-hot-stream.html` · 聚合热榜流
- 页面2：`page2-channels.html` · 渠道分栏看板
- 页面3：`page3-report.html` · 分析报告（只做当天）
- 页面4：`page4-history.html` · 历史趋势与回看

> 在 `file://` 协议下也能正常渲染（不依赖 `fetch`、不依赖 CDN、不依赖网络）。推荐用现代 **Chrome / Safari / Edge** 打开。

**响应式自检**：依次把窗口拉到 **≥1280px（桌面）**、**768–1023px（平板）**、**<768px（移动）** 三档查看。移动端页面1/2 的筛选栏会折叠为「筛选」按钮，页面2 栅格降为单列，页面4 默认只展示一张趋势图。

---

## 二、每页看什么

### 页面1 · 聚合热榜流（对应 PRD §6.1）
- 顶部数据状态条：最近更新时间 / 渠道数 / 今日条数 / 涉及分类数。
- 控制区：**排序切换**（更新时间 ⇄ 创建时间）、**渠道多选**（按分类分组）、**分类多选**、**时间范围**（今天 / 近 2 小时）、**搜索**。
- 列表项完整字段：标题 / 摘要 / 来源渠道 / 分类标签 / 创建时间 / 更新时间 / `原文` / `渠道主页` / **NEW 徽标** / **「＋N 源」跨源徽标**（点击展开所有来源）。
- **每批 20 条**「加载更多」；首屏有**骨架屏**加载态。**移动端（<768px）默认每批 10 条**（PRD §6.1）；用户显式选择过条数后以显式值为准。
- **异常态**：OpenAI Blog 抓取失败 → 顶部**黄条**提示「1 个渠道本次抓取失败」。
- 从页面2 的「查看全部」可带 `?channel=<id>` 跳回并按渠道过滤。

### 页面2 · 渠道分栏看板（对应 PRD §6.2）
- 顶部：标题 + 渠道总数 + **配置按钮**（打开配置抽屉）。
- **配置抽屉**：选择展示哪些渠道（按分类分组多选）、**每卡片条数 5 / 10 / 20（默认 10）**、卡片排序（按渠道名 / 按最近更新）。配置**写入 localStorage**，重开页面仍生效；可「恢复默认」。**移动端（<768px）每卡片默认降为 5 条**（PRD §6.2）；用户在抽屉显式设置后以其为准。
- 看板：**响应式栅格**（桌面 3~4 列 → 平板 2 列 → 移动 1 列），每渠道一张卡片。
- 卡片内容：渠道名 / 首字母头像 / 分类标签 / 首页链接 / Feed 源地址（源图标 hover 提示）/「最后更新：x 分钟前」/「今日 N 条」/ **健康状态角标**（正常 · 抓取失败 · 停用）。
- 卡片内条目时间倒序；超出条数显示「查看全部 →」。
- 空态：**内核恐慌（播客）** 卡片显示「暂无内容」；**OpenAI Blog** 卡片灰化 + 失败角标；**我的飞书源表** 为停用渠道。

### 页面3 · 分析报告（严格只做当天）（对应 PRD §6.3）
- 头部：**「RSS 日报 · 2026-09-12」** + 生成时间 + 数据覆盖 + 「只包含当天数据」提示。
- 概要区：一句话总览 + **4 张关键数字卡**（总条数 / 活跃渠道数 / 热点条数 / 涉及分类数）。
- 热点区：**热点榜 TOP 10**（排名 + 标题 + 热度分进度条 + 来源数 + 分类）。
- 分类区：**分类分布饼图（原生 SVG，含图例与占比）** + **分类分栏**（当天有内容的分类各列代表条目）。
- **跨源重合榜**：同一主题被多个渠道报道的主题榜（PRD §6.3 / F-063，P1）。
- 渠道活跃区：渠道活跃度排行（原生 SVG 条形图）。
- 底部：**方法论说明（可折叠）** + 版权声明 + **「查看历史趋势 →」**；另含「演示空态」按钮可切换到「今日暂无数据」。

### 页面4 · 历史趋势与回看（对应 PRD §6.4 / ARCHITECTURE §13）
- 趋势区：**原生 SVG 折线/面积图**，近 90 天「总条数」趋势，可切换「活跃渠道数」「分类占比走势」与窗口（90/180/365 天）。图上标注 **「This trend chart = 1 request from history-index.json」** 的数据契约说明。
- 下钻区：**月度明细**（展开某月 → 模拟懒加载该月 `items.ndjson`，带 loading 态），覆盖 3 个月。
- 回看区：**日历**选日期 → 该天快照摘要（条目数 / 渠道数 / 热点 TopN），并**刻意演示三种状态**：
  - 有数据：`2026-09-12`、`2026-09-11` 等；
  - 无数据：`2026-08-30`、`2026-08-31`；
  - 已归档（>1 年）：`2025-08-15` → 提示前往 GitHub Release 下载。
- 归档区：**2025 年归档**只读元数据（月份 / 条数 / 体积）+「前往 GitHub Release 下载」（原型阶段给出提示，不真实跳转）。

---

## 三、Mock 数据从哪里来 / 与 PRD 的对应关系

所有数据内联在 **`assets/js/mock-data.js`**（不用 `fetch`，避免 `file://` 的 CORS 限制）。**结构严格对齐** `docs/data-model/examples/`，使原型同时验证了数据契约：

| 原型页面 / 视图 | 对齐文件 | 关键字段 |
|---|---|---|
| 页面1 条目流 | `snapshot.example.json` | `title / summary / channelName / category / publishedAt / updatedAt / sourceCount / sources / isNew / dedupKey / duplicateOf` |
| 页面2 渠道卡片 | `sources.example.json` | `channels[]`（`name / homepage / category / icon / displayLimit`）、`sources[]`（`url / lastStatus / lastError`） |
| 页面3 报告 | `report.example.json` | `totalItems / activeChannels / categoryStats / hotList / hotScore / channelSummary / channelActivity / keywords / crossSource / weights` |
| 页面4 趋势 | `history-index.example.json` | `days[].date / totalItems / activeChannels / categoryStats / topKeywords / sourceOk / sourceFailed` |
| 页面4 下钻 | `history-item.example.ndjson` | 月度精简行（`id / title / channelId / category / publishedAt / sourceCount / hotScore`） |
| 页面4 回看 | `snapshot.example.json` | 该天条目数 / 渠道数 / TopN |
| 页面4 归档 | `ARCHITECTURE §13.1` / `history-index.archives` | `year / releaseTag / releaseUrl / months[]` |
| 站点配置 | `site-config.example.json` | `display.cardLimit / page1BatchSize / defaultSort`；`history.windowDays / windowOptions` |

**刻意构造的“特殊数据”**（用于展示各种能力）：
- 跨源同文章：`sourceCount: 2~3`（阮一峰周刊、Hugging Face 推理框架、Show HN 静态聚合器、M 系列芯片 Docker）；
- 今日新增：`isNew: true`（NEW 徽标）；
- 抓取失败渠道：`lastStatus: "error"`（OpenAI Blog）；
- 无数据渠道：内核恐慌（播客）；
- 停用渠道：我的飞书源表（`enabled: false`）；
- 超一年归档数据：`2025-08-15` + `2025 年归档包`。

数据量级：**67 条条目（今日去重后 57 条）**、**14 个渠道**、**16 个源**、**报告热点 10 条 + 7 个分类**、**历史趋势 365 天 + 3 个月度明细**。

> **口径一致性（重要）**：页面1 顶部「今日 N 条」、页面3 「数据覆盖 N 条」、`report.totalItems`、`snapshotStats.itemsAfterDedup` 均**由 `items[]` 统一派生**（`report.totalItems == 当天去重后条目数`）；`categoryStats` 各项条数之和恒等于 `totalItems`；`activeChannels == channelActivity.length`。这些恒等关系由 `tools/smoke-test.mjs` 断言，防止数字漂移。

---

## 四、与真实实现阶段的差异说明

| 维度 | 本原型（有意为之） | 真实实现阶段 |
|---|---|---|
| 技术栈 | **纯 HTML + CSS + 原生 JS**，无构建 | Vite + React + MUI + Tailwind（PRD B1） |
| 数据来源 | `mock-data.js` 内联 Mock | 运行时从 `deploy` 分支 raw/CDN 读取 + 兜底内联（ARCHITECTURE §6.3） |
| 历史趋势 | 90 天确定性生成的假数据 | 读真实 `history-index.json`（1 次请求） |
| 网络请求 | **零网络请求**，离线可用 | 有真实 HTTP 读取（带降级） |
| 图表 | 原生 SVG 手绘（离线可用） | 可换图表库（视实现而定） |
| 部署 | 无 | GH Pages（手动）+ CF Pages（Actions 直传） |

> 本原型**不做**：真实抓取 RSS、真实 API、真实数据管线、`.github/workflows`。

---

## 五、文件结构

```
prototype/
├─ index.html                 # 原型导航页
├─ page1-hot-stream.html      # 页面1 聚合热榜流
├─ page2-channels.html        # 页面2 渠道分栏看板
├─ page3-report.html          # 页面3 分析报告（只做当天）
├─ page4-history.html         # 页面4 历史趋势与回看
├─ assets/
│  ├─ css/
│  │  ├─ tokens.css           # 设计令牌（颜色/间距/字号/圆角/阴影/z-index）
│  │  ├─ base.css             # reset + 基础排版 + 无障碍工具类
│  │  ├─ components.css       # 通用组件（按钮/标签/徽标/卡片/抽屉/分页/骨架/空态…）
│  │  └─ pages.css            # 各页面专属布局 + 响应式
│  └─ js/
│     ├─ mock-data.js         # Mock 数据（对齐示例契约）
│     ├─ store.js             # localStorage 站点配置 / 用户偏好
│     ├─ components.js        # 通用渲染（头部/页脚/条目/卡片/图表/Toast）
│     └─ page1.js ~ page4.js  # 各页交互逻辑
├─ tools/
│  └─ smoke-test.mjs          # 自检脚本（数据契约恒等断言 + 各页元素存在性）
└─ README.md
```

---

## 六、设计系统与无障碍

- **浅色主题**，现代、干净、信息密度适中。
- 全部样式引用 **CSS 自定义属性**（`tokens.css`）：主色、语义色（正常/警告/错误/成功）、**9 级中性灰阶**、间距刻度（4/8/12/16/24/32）、字号刻度、圆角、阴影、层级。**配色零硬编码**：语义色、排行榜名次色、渐变端点、图表序列色全部收敛到 tokens；JS 侧图表色经 `RR.cssVar('--…')` 读取，保证单一来源。
- 组件状态完整：默认 / hover / active / focus-visible / disabled / loading / empty / error。
- **键盘可达**（`:focus-visible` 可见、按钮用 `<button>`、抽屉 `Esc` 关闭）。
- 语义化标签 + `aria-*` / `role` + `alt`；相对时间用 `<time title="绝对时间">`。

---

## 七、自检脚本（可复现）

```bash
node prototype/tools/smoke-test.mjs           # 数据契约 + 各页关键元素存在性（需本机 Chrome）
node prototype/tools/smoke-test.mjs --no-dom  # 仅数据契约（无需浏览器，任何环境可跑）
node prototype/tools/smoke-test.mjs --chrome-path <BIN>  # 指定 Chrome/Chromium 可执行文件
```

> 默认会自动探测 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`、`/usr/bin/google-chrome` 等常见路径；`--chrome-path <BIN>` 可用于覆盖、CI 注入或测试「无 Chrome」场景。

覆盖：**(A)** 跨页口径恒等关系断言（`totalItems == 当天去重条目数`、`Σ categoryStats == totalItems`、`activeChannels == channelActivity.length` 等）；**(B)** 特殊数据齐备性（跨源 / 失败 / 无数据 / 停用 / 归档 / 回看三态 / 单渠道 >10 条）；**(C)** 关键字段类型（对齐数据模型示例）；**(D)** 四页关键元素存在性（headless Chrome 渲染 DOM 后断言，无浏览器自动 SKIP）；**(E)** 响应式静态护栏（日历栅格不溢出）。退出码非 0 表示存在失败。

---

## 八、已知不足（后续可迭代）

1. 时间锚点固定为 `2026-09-12`，相对时间以该日为基准（保证展示稳定）；真实实现会以“现在”为基准。
2. 页面4 趋势生成 365 天，90/180/365 天窗口切换有真实差异；月度明细仅提供近 3 个月示例（下钻为懒加载模拟）。
3. 页面4「分类占比走势」以 AI 类占比演示，真实实现可支持多分类叠加。
4. 「原文 / 渠道主页 / Release 下载」等外链在原型中指向示例或给出提示，不对真实站点发起请求。
5. 页面1 的「加载更多」为前端分片模拟，非真实分页接口。
6. 页面3 分类统计按条目「主分类」归入（故各分类条数之和 == 总条数），仅展示当天有内容的分类；PRD 命名的 8 类中空缺分类不占位。

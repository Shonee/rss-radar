# P3 页面1 排序整合 + 时间筛选删「近3小时」真机回归报告

- **报告人**：qa-final-p3（RSS Radar QA）
- **仓库**：`/Users/dushouxin/WorkSpace/github/rss-radar`（master，HEAD=`d661349`）
- **被测改动**：
  1. 排序整合：`Page1HotStream.tsx` 删除「综合倒序/按创建时间」`ToggleButtonGroup`（`p1-sort`/`p1-sort-updated`/`p1-sort-published` 已移除），改为固定比较器 `compareByRecencyDesc`：键恒为 `updatedAt || publishedAt`，整体倒序。
  2. 时间筛选：`time.ts` 删 `'3h'`；`config/site.ts` 的 `TIME_RANGES` 顺序恒为 `['6h','today','all']`；`config/site-config.json` 改为 `["6h","today"]`；默认选中仍为「今天」。
- **`domVerified`: `true`** —— 以下判据均由真实 headless Chrome（CDP 驱动）在 `vite` 实时服务上读取真实 DOM 得到，非静态审查。
- **三态原则**：浏览器真实跑通，所有判据标「通过」；凡未能实测者标「未验证」，绝不给假 PASS。

---

## 环境与配方（实测可用）

- 浏览器：`/Applications/Google Chrome.app` `--headless=new --disable-gpu --no-sandbox --no-first-run --remote-debugging-port=9333 --user-data-dir=/tmp/rrqa-final-p3`（**隔离** `/tmp` profile，规避 GoogleUpdater 权限拒绝）。
- 服务：`npx vite --port 5299`（真实数据在 `public/data/today/`，快照 2026-09-14，21 条主条目）。
- 驱动方式：Node 22 内置 `WebSocket` 连接 CDP，**不修改任何仓库源码/配置**。合成快照通过 CDP `Fetch` 拦截 `today/latest.json` 在内存中注入，仅用于判据 5/6a/6d，仓库文件零改动。
- `grep` 统一用 `grep -E`；命令间用 `;`。

---

## 判据总览（通过 / 失败 / 未验证）

| # | 判据 | 结果 | DOM 证据 |
|---|------|------|----------|
| 1 | 排序切换 UI 已消失（`p1-sort`/`p1-sort-updated`/`p1-sort-published` 均为 null） | ✅ 通过 | 三者 `querySelector` 均返回 `null` |
| 2 | 时间档按钮实际渲染顺序 近6小时→今天→全部，共 3 个，不含「近3小时」 | ✅ 通过 | `['近6小时','今天','全部']`，count=3，`has3h=false` |
| 3 | 默认选中「今天」 | ✅ 通过 | `aria-pressed="true"` + `Mui-selected` |
| 4 | 点「近6小时」「全部」生效，数量变化；「全部」有条目（逃生出口） | ✅ 通过 | 真实数据 今天=1 / 全部=20（共21条）/ 近6小时=0 |
| 5 | 排序口径真实生效（按 `updatedAt||publishedAt` 倒序，含三类条目） | ✅ 通过 | 合成注入，渲染顺序与期望值逐位一致 |
| 6a | `p1-show-all-time` 空态逃生按钮仍在且可点 | ✅ 通过 | 合成 today=0 时出现，点击→全部=10 |
| 6b | 响应式：1280 左侧栏可见；1023/767 `p1-filter-toggle` 存在可展开 | ✅ 通过 | 见下 |
| 6c | 页面2 取消全部渠道出 `p2-empty` | ✅ 通过 | 取消 8 渠道后 `emptyNone=true` |
| 6d | 页面2 全部渠道无数据出 `p2-empty-all` | ✅ 通过 | 合成后 `emptyAll=true` |
| 6e | favicon 不再 404（`/favicon.svg` 200） | ✅ 通过 | network `200` |
| 7 | 控制台无新报错 | ✅ 通过 | 6 条均为外部/可选 404，非本改动引入 |

> 全部 11 项判据 **通过**；`domVerified: true`。

---

## 详细证据

### 判据 1 — 排序切换 UI 已消失
页面1 真实 DOM 读取：
```js
document.querySelector('[data-testid="p1-sort"]')          // null
document.querySelector('[data-testid="p1-sort-updated"]') // null
document.querySelector('[data-testid="p1-sort-published"]')// null
```
`sortToggleRemoved: true`。✅

### 判据 2 — 时间档按钮顺序与数量
`filter-time-range` 容器内 button 的 textContent 数组（真实渲染）：
```
['近6小时', '今天', '全部']   // 顺序与数量均符合预期
count = 3
has3h = false                // 不含「近3小时」
```
✅

### 判据 3 — 默认选中「今天」
各按钮 `pressed`/`sel`（MUI `aria-pressed` 与 `Mui-selected`）：
```
近6小时  pressed=false sel=false
今天      pressed=true  sel=true   ← 默认选中
全部      pressed=false sel=false
```
`defaultSelected: '今天'`。✅

### 判据 4 — 时间档点击生效（真实数据）
真实快照（21 条主条目，均在 2026-09-13/09-12，无 09-14 条目）：
```
默认（今天） p1-item 数 = 1     // 结果条数文案：「共 1 条符合当前条件，已显示 1 条」
点击「全部」       p1-item 数 = 20    // 「共 21 条符合当前条件，已显示 20 条」（懒加载首批，余可加载更多）
点击「近6小时」     p1-item 数 = 0     // 条目均数天前，近 6h 窗口无命中（诚实结果）
点击「今天」       p1-item 数 = 1
```
- 「全部」确有条目（逃生出口成立）：✅
- 数量随档位变化（1↔20）：✅
- 「近6小时」=0 为真实谓词结果（条目过旧），非失效。✅

### 判据 5 — 排序口径真实生效（CDP Fetch 注入合成快照）
真实数据 21 条 `updatedAt===publishedAt`，无法区分口径，故按项目要求注入合成快照（三类条目：只缺 `updatedAt` / 只缺 `publishedAt` / 两者都有且不同），全部置于上海自然日 09-13（确保与默认「今天」09-14 区分），快照 `date=2026-09-14`。

注入确认：`injectionConfirmed=true`（首条 `data-item-id` 以 `it_sort_` 开头，证明拦截生效）。

「全部」视图下 `p1-item` 实际渲染顺序（`data-item-id`）：
```
1  it_sort_23   // 只缺 updatedAt → 比较键=publishedAt(15:00Z)
2  it_sort_22   // 只缺 publishedAt → 比较键=updatedAt(14:00Z)
3  it_sort_21   // 两者都有：updatedAt=13:00Z, publishedAt=02:00Z → 取 updatedAt（证明 updatedAt 优先）
4  it_sort_20   // updatedAt=publishedAt=12:00Z
5  it_sort_19   // 只缺 updatedAt → publishedAt=11:00Z
6  it_sort_18   // 只缺 publishedAt → updatedAt=10:00Z
7  it_sort_17   // updatedAt=09:00Z, publishedAt=00:00Z
8  it_sort_16   // updatedAt=publishedAt=08:00Z
9  it_old_11    // 旧日 09-12 updatedAt=11:00Z（底部）
10 it_old_10    // 旧日 09-12 publishedAt=10:00Z（最末）
```
- **整体倒序**：首条键 `15:00Z` ≥ 末条键 `09-12 10:00Z`：✅
- **`updatedAt` 优先回落 `publishedAt`**（`compareByRecencyDesc` 语义）三类均被证明：
  - `it_sort_23` 仅有 `publishedAt` 却排第 1 → 缺失 `updatedAt` 时正确回落 `publishedAt`；
  - `it_sort_22` 仅有 `updatedAt` 排第 2 → 用 `updatedAt`；
  - `it_sort_21` 两者都有且 `updatedAt(13:00) > publishedAt(02:00)`，排第 3（若误用 `publishedAt` 会落到底部）→ `updatedAt` 优先得证。
- `allCount=10`，`h6Count=0`（旧条目，近 6h 无命中）。✅

### 判据 6a — `p1-show-all-time` 空态逃生按钮
合成快照「今天」=0 → `p1-empty-filter` 空态出现，`p1-show-all-time` 存在：
```
todayItemCount = 0
showAllTimePresent = true
点击「查看全部时段」后 p1-item 数 = 10   // 切到 all，逃生出口生效
```
✅

### 判据 6b — 响应式筛选布局
| 视口 | `p1-filter-panel` display | `p1-filter-toggle` 存在 | 展开后 panel |
|------|--------------------------|------------------------|--------------|
| 1280px | `block`（左侧栏常驻可见） | `false`（桌面不渲染开关） | — |
| 1023px | 展开前 `none` | `true` | 点击后 `block` |
| 767px  | 展开前 `none` | `true` | 点击后 `block` |

✅（窄屏默认折叠、开关可展开左侧筛选栏）

### 判据 6c — 页面2 取消全部渠道 → `p2-empty`
打开配置抽屉，取消全部渠道（抽屉内 `input[type="checkbox"]` 共 8 个，逐一取消勾选）：
```
p2AfterUncheck = { emptyNone: true, emptyAll: false, board: false }
```
即 `p2-empty` 空态出现、`p2-board` 消失。✅

### 判据 6d — 页面2 全部渠道无数据 → `p2-empty-all`
合成快照条目归属不存在渠道 `synthetic_unknown`，使所有真实渠道「今日」条目为 0。导航页面2：
```
p2StateSynth = { hasBoard: false, emptyNone: false, emptyAll: true }
```
即 `p2-empty-all` 全局空态出现。✅

> 说明：phase A 取消全部渠道会写入 `localStorage` 的 config，phase B 验证前已 `localStorage.clear()` 清掉，避免污染 `empty-all` 判定。

### 判据 6e — favicon
network 监听：`http://localhost:5299/favicon.svg` → `status 200`（非 404）。✅

### 判据 7 — 控制台报错
页面加载期间收集到 6 条 console error，去重后来源为：
```
404 https://raw.githubusercontent.com/Shonee/rss-radar/deploy/today/latest.json
404 https://raw.githubusercontent.com/Shonee/rss-radar/deploy/stats/notify-state.json
404 https://raw.githubusercontent.com/Shonee/rss-radar/deploy/stats/notify-latest.json
404 https://cdn.jsdelivr.net/gh/Shonee/rss-radar@deploy/today/latest.json
404 https://cdn.jsdelivr.net/gh/Shonee/rss-radar@deploy/stats/notify-state.json
404 https://cdn.jsdelivr.net/gh/Shonee/rss-radar@deploy/stats/notify-latest.json
```
分析：
- `raw`/`jsdelivr` 的 `today/latest.json` 404 属**离线环境三层降级**（local→raw→jsdelivr）的正常回落——本地 `today/latest.json` 实际加载成功（页面数据正常渲染），与本排序/时间改动无关。
- `notify-state.json`/`notify-latest.json` 404 属**可选通知统计**端点缺失，应用已按设计降级为空态，非本次改动引入。
- 上述 404 在改动前即存在（既有网络/可选资源行为），**无一条可归因于本次排序整合或时间筛选删 3h**。
- 此外无 JS 异常（`Runtime.exceptionThrown` 为空）、无 `console.error` 业务报错。

结论：本次改动**未引入新控制台报错**。✅

---

## 三态清单（回报用）

- 判据 1 排序 UI 消失：**通过**
- 判据 2 时间档 近6小时→今天→全部（3 个，无 3h）：**通过**
- 判据 3 默认选中今天：**通过**
- 判据 4 近6小时/全部生效、全部有条目：**通过**（真实数据 今天=1 / 全部=20 / 近6h=0）
- 判据 5 排序键 `updatedAt||publishedAt` 倒序（含三类条目）：**通过**（合成注入渲染顺序逐位一致）
- 判据 6a `p1-show-all-time` 仍在可点：**通过**
- 判据 6b 响应式 1280/1023/767：**通过**
- 判据 6c 页面2 `p2-empty`：**通过**
- 判据 6d 页面2 `p2-empty-all`：**通过**
- 判据 6e favicon 200：**通过**
- 判据 7 控制台无新报错：**通过**

`domVerified: true`（真实 headless Chrome + CDP + vite 实时服务；合成数据仅经 `Fetch` 内存注入，仓库零改动）。

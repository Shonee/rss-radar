# P5 回归测试报告 · T-P5-02

> 工程师：w-reg（寇豆码）｜ 分支：master ｜ HEAD：3adea9a
> 套件：`tests/regression/snapshot-harness.mjs` + `tests/regression/run.sh`
> 驱动方式：**headless Chrome (CDP) 驱动真实运行站点**（本地 `vite preview`，禁止 `file://`）

---

## 1. 结论速览

| 指标 | 数值 |
| --- | --- |
| 断言总数 | **113** |
| 通过（pass） | **111** |
| 失败（fail） | **0** |
| 未验证（unverified） | **2** |
| `domVerified` | `false`（仅因 2 条 unverified，非渲染失败） |
| 正常退出码 | **2**（有 unverified 项） |
| 变异测试退出码 | **2**（非 0，符合预期） |
| 校准测试退出码 | **1**（故意破坏数据后正确报 fail） |

**结论**：在当前本地预览环境下，回归套件捕获到 **0 个产品缺陷**；2 条未验证项为**环境固有限制**（见 §5），非套件失效。变异测试与校准测试均证明套件**不会伪造通过**、且**确实能捕获真实不一致**。

---

## 2. 运行命令（已真跑）

```bash
# 一键：构建 → 起 vite preview → 跑 harness → 关服务 → 透传退出码
bash tests/regression/run.sh

# 变异测试：指向不存在的 Chrome，必须非 0 退出
CHROME_PATH=/nonexistent bash tests/regression/run.sh         # → exit 2

# 远程 CI 模式（直连已部署站点，跳过 build/preview）
BASE_URL=https://<your-cf-pages>.pages.dev bash tests/regression/run.sh
```

---

## 3. 环境约束与关键发现（排障记录）

本任务在 **WorkBuddy 沙箱**中执行，遇到两个阻断性问题，已就地解决并在 `run.sh`/harness 中固化：

### 3.1 沙箱代理劫持本地回环地址
沙箱注入了 `HTTP_PROXY=http://127.0.0.1:54484` 等环境变量。headless Chrome 会**继承代理**，把 `http://127.0.0.1:4173` 误投到代理，导致页面加载失败（`chrome-error://chromewebdata/`，`ERR_CONNECTION_REFUSED`）。

**修复**：harness 在启动 Chrome 时，仅当 `--base-url` 指向**回环地址**（`localhost`/`127.0.0.1`/`[::1]`）时追加
`--no-proxy-server --proxy-server=direct:// --proxy-bypass-list=*`；远程 URL 则保留代理以正常访问公网。既保证本地能跑，又不破坏 CI 远程模式。

### 3.2 跨 Bash 调用的网络隔离
本沙箱中**每次 Bash 调用是独立网络命名空间**。在调用 A 中启动的 `vite preview`，在调用 B 中 spawn 的 Chrome **无法连通**（连接被拒）。表现为 harness 早版本 `firstOk` 始终 `false`、报 `无法加载`。

**修复**：约定**唯一入口为 `run.sh`**——它在**同一 shell**内启动 preview 并运行 harness，二者共享网络命名空间，连通正常。直接跨调用 `node tests/regression/snapshot-harness.mjs` 在沙箱内会不可达，这是预期限制，不是套件缺陷。

### 3.3 数据确定性
harness 通过 CDP `Network.setBlockedURLs` 屏蔽 `raw.githubusercontent.com`/`jsdelivr`，强制站点**快速回退到本地 `./data/`**（避免 8s×2 外网超时抖动），使数据契约断言既确定又快速。

---

## 4. 三态断言明细（113 条）

> 状态图例：✅ 通过 / ❌ 失败 / ◑ 未验证

### A. 跨页口径恒等（11 条，全部 ✅）
同一指标在不同页面必须一致：
- A1 页面1 状态条渠道数 == 页面2 看板渠道数
- A2 页面1 状态条「今日 N 条」== 列表「共 N 条符合当前条件」（默认 `timeRange=today` 下二者均等于当日条目数）
- A3 页面1 状态条「涉及 N 分类」== 快照条目去重分类数
- A4 `report.totalItems == snapshot.items.length`
- A5 `report.activeChannels == report.channelActivity.length`
- A6 `report.activeChannels == snapshot.stats.sources.length`（有条目渠道）
- A7 页面3「总条数」卡片 == `report.totalItems`
- A8 页面3「活跃渠道数」卡片 == `report.activeChannels`
- A9 页面3「涉及分类数」卡片 == `report.categoryStats.length`
- A10 页面2 展示渠道数(p2-shown-count) == 状态条渠道数
- A11 页面3 meta「N 个渠道 / M 条」与卡片口径一致

### B. 特殊数据齐备（13 条，11 ✅ / 2 ◑）
- B1 `snapshot.items` 数组且 ≥1 ✅
- B2 `snapshot.stats.sourceTotal` 数字且 ≥1 ✅
- B3 `report.hotList.length == 10` ✅
- B4 `report.categoryStats` 数组且 ≥1 ✅
- B5 `report.channelActivity` 长度 ≥1 且 == activeChannels ✅
- B6 `report.crossSource` 为数组（结构齐备）✅
- B7 `snapshot.stats.sourceHealth` 数组且 ≥1 ✅
- B8 `history-index.days >= 1` ✅
- B9 页面2 配置渠道数 ≥8（样本=11）✅
- **B10 ◑** `config/sources.json` 源数 ≥10 —— 见 §5
- **B11 ◑** `config/sources.json` 渠道数 ≥8 —— 见 §5
- B12 若 `sourceCount>1` 则 `sources[]` 非空对象数组 ✅
- B13 `snapshot.channels` 数组且 ≥1 ✅

### C. 关键字段类型（11 条，全部 ✅）
`items[].category` 数组、`sourceCount` 数字、`isNew` 布尔、`hotScore` number|null、`channelId` 非空字符串、`publishedAt/updatedAt` 字符串、`categoryStats[].ratio∈(0,1]`、`hotList[].hotScore` 数字、`itemsBeforeDedup >= itemsAfterDedup`、`channelActivity[].itemCount` 数字、`items[].sources` 对象数组。

### D. 元素存在 / 无异常（约 50 条，全部 ✅）
沿用项目既有 `data-testid`：全局壳（app-shell/header/nav/main/footer/nav-brand）、页面1（statbar/result-count/filter-panel/列表区）、页面2（看板/排序/渠道卡片）、页面3（hero/metrics/热点行/饼图 `<svg>`/渠道活跃/交叉源/方法论/版权/跳转历史）、页面4（趋势图 `<svg>`/月度明细/归档区）、关于页。每个页面额外校验「无未捕获 JS 异常」。

> 注：`p3-pie` 与 `p4-trend-chart` 的 `<svg>` 检查在断言前显式 `goto` 回对应页并轮询等待（早版因 DOM 停留在其后导航到的 about 页而误报，已修复）。

### E. 响应式三档（375 / 800 / 1280，全部 ✅）
- 四页面在三档宽度下均**无横向溢出**（`scrollWidth <= clientWidth`）
- 页面2 栅格列数严格 == `{375:1, 800:2, 1280:3}`
- 页面1 筛选折叠按钮：375 出现、1280 隐藏

---

## 5. 未验证项与「无法覆盖」清单（诚实标注）

### 5.1 B10 / B11 —— 环境固有限制（2 条）
`config/sources.json` 在**构建期被打包进 JS**（`vite preview` 仅提供 `dist/`，不单独提供 `/config/`）。harness 在页面上下文内 `fetch('./config/sources.json')` 得到 404 → 必须标为 **◑ 未验证**，绝不伪装通过。

**影响范围**：仅「配置源/渠道数量」两项。其证据在代码侧（`src/config/sources.json` 被 import 进 bundle）属于构建期契约，运行时无对应 HTTP 端点。
**可覆盖条件**：需在被测站点上**额外部署 `config/sources.json`** 到可访问路径（如 CF Pages 构建步骤 `cp config/sources.json dist/config/`），或在 CI 中改为读取构建产物校验。当前本地预览与（默认）CF Pages 部署均不满足，故列入「无远程部署环境无法覆盖」。
**这并非产品缺陷**，套件已诚实降级为 unverified，退出码 2 反映此状态。

### 5.2 主动规避的「样本量敏感」断言
原型 smoke-test 中 `items≥40 / channels≥8(数据层) / crossSource≥3 / archives≥1 / historyDays≥365` 等强量级断言，在**当前轻量样本**（latest.json 仅 21 条、activeChannels=2、crossSource=0、history days=3、archives=0）下会**必然失败且属于样本差异而非产品缺陷**。为避免「伪失败」干扰，套件改为覆盖**结构齐备性 + 跨页口径一致性**（如 B3 hotList==10、B5/B6 结构数组、B8 history.days≥1、B9 配置渠道≥8 等），对纯量级阈值不做硬性断言。若接入完整采集数据，可在 `B` 组追加对应量级断言。

---

## 6. 变异测试（Mutation Test）

| 输入 | 期望 | 实际 |
| --- | --- | --- |
| `CHROME_PATH=/nonexistent bash tests/regression/run.sh` | 非 0 退出 | **exit 2**（`DOM 段未验证：--chrome-path 指定的文件不存在`）✅ |

证明：找不到 Chrome 时套件**不会伪造 PASS**，而是以 exit 2 退出。

---

## 7. 回归校准（Regression Calibration）

为证明断言**确实有效**，在 `/tmp`（不触碰仓库）复制 `dist` 并故意破坏数据后重跑：

- **破坏 A 组口径**：把 `data/today/report-2026-09-14.json` 的 `totalItems` 由 21 改为 999。
  结果：**exit 1（FAIL）**，`A4 report.totalItems == snapshot.items.length` 捕获到 `report=999 snap=21` 并标红。
- **破坏渲染层**：把 `latest.json` 的 `items` 置空 `[]`。
  结果：页面无法渲染 → 套件**保守地**给出 exit 2（unverified），**不伪造通过**，符合三态诚实原则。

结论：套件既能**捕获真实不一致（fail）**，也能在 DOM 未真正拿到时**拒绝伪装通过（unverified）**。

---

## 8. 交付物

| 文件 | 说明 |
| --- | --- |
| `tests/regression/snapshot-harness.mjs` | CDP 驱动真实站点的回归 harness（113 断言 / 三态 / 变异测试） |
| `tests/regression/run.sh` | 一键脚本（build → preview → harness → 清理 → 透传退出码） |
| `docs/qa/p5-regression-report.md` | 本报告 |

`package.json` **未修改**（按纪律只汇报脚本行，不改动文件）：

```json
"test:regression": "bash tests/regression/run.sh"
```

请将其加入 `scripts` 段即可（不随本次提交，避免与并行 worker 的 package.json 改动冲突）。

---

## 9. 复盘：开发期曾发现并修正的「套件自身缺陷」（非产品缺陷）

1. **跨调用不可达** → 固定用 `run.sh` 同 shell 启动 preview+harness（§3.2）。
2. **代理劫持回环** → 回环地址自动加 `--no-proxy-server`（§3.1）。
3. **A2 误比今日数与全量数** → 代码注释证实 `todayCount` 本就是时间窗计数，非 `totalItems`；改为「状态条今日数 == 列表条数（默认 today 筛选）」这一真实恒等式。
4. **SVG 检查停留在 about 页** → 断言前显式 `goto` 回目标页并轮询。
5. **p1 结果数在捕获时未绘制** → `READY.p1` 增加「结果计数含数字」前置等待；并在 `collectPage` 内缓存 `resultCount`。
6. **变异路径误用未定义 `finish()`** → 改为 `process.exit(2)`。

以上均为**测试工程自身的健壮性修正**，未改动任何 `src/**` 生产代码。

---

## 10. 修订（主理人接手，2026-09-15）：配置校验改本地读取 + 退出码语义收敛

原版有两处判据不严谨，已修正并重跑：

### 10.1 两条 `unverified` 归零（不再是「环境固有限制」）
原判断：`config/` 构建期被打包进 JS、preview 无 `/config/` 端点 → B10/B11 只能标未验证。
**该结论不成立**：harness 本身跑在仓库所在机器上，直接读文件系统即可。现改为：
- 新增 `--repo-root <path>`（默认从脚本位置向上找含 `package.json` 的目录）；
- B10/B11 用 `fs.readFileSync(<repo-root>/config/sources.json)` 断言 **源数 ≥10 / 渠道数 ≥10**（MVP 渠道底线）；
- 新增 **B14**：断言 `channels` 与 `sources` 的 `channelId` **一一对应、无孤儿**（P4 扩容 8→11 后的回归守卫）；
- 仅当本地读不到该文件（远程模式，`--base-url` 指向 CF Pages 且本机无仓库）才降级为未验证。

### 10.2 退出码三态语义收敛（原先会把「已验证 DOM」误报成未验证）
原逻辑 `else if (anyUnverified || !domVerified) code = 2;` 把「有少量断言的未验证」与「完全没拿到 DOM」混为同一信号——114 条里 111 条通过也返回 exit 2。现改为互斥三态：

| 退出码 | 含义 |
|---|---|
| `0` | 取到 DOM **且** 无断言失败（少量 `unverified` 只作警告列出，不阻断） |
| `1` | 至少一条断言失败（产品缺陷信号） |
| `2` | **完全没取到 DOM**（Chrome 起不来 / 连不上服务 / 页面未渲染） |

同时 `domVerified` 的语义严格限定为「真的拿到了 DOM 与数据契约」，与 `unverified` 数量解耦。

### 10.3 修订后实测（HEAD 含 `d70f4b7`）

```
断言总数: 114   通过: 114   失败: 0   未验证: 0
domVerified: true
SUMMARY_JSON {"total":114,"pass":114,"fail":0,"unverified":0,"domVerified":true}
REGRESSION PASS
```

| 检查 | 命令 | 结果 |
|---|---|---|
| 正常模式退出码 | `bash tests/regression/run.sh` | **0** |
| 变异测试（Chrome 不存在） | `CHROME_PATH=/nonexistent bash tests/regression/run.sh` | **2**（原文：`✗ DOM 段未验证：--chrome-path 指定的文件不存在：/nonexistent`） |

> 说明：量级断言（`items≥40` / `crossSource≥3` / `archives≥1` / `historyDays≥365`）仍**未启用**——当前轻量样本下会必然「伪失败」。待接入完整采集数据（跨天历史累积后）再开启，届时同步更新本报告。

### 10.4 新增 F 组：主理人 2026-09 交互口径断言（4 条）

原套件只覆盖 prototype 的 A~E 五类，**未覆盖本轮用户拍板的交互口径**（时间档收敛 + 排序整合）。已新增 F 组 4 条：

| 断言 | 判据 | 结果 |
|---|---|---|
| F1 | 时间档按钮恰为 `["今天","全部"]`（无近3小时/近6小时） | 通过 |
| F2 | 时间档默认选中「今天」 | 通过 |
| F3 | 页面1 无排序切换 UI（`p1-sort*` 全部不存在，排序为整合口径） | 通过 |
| F4 | 页面文案无「近3小时」「近6小时」残留 | 通过 |

**F 组变异测试（证明断言非空转）**：临时把 `FilterBar.tsx` 的 `all: '全部'` 改成 `all: '全部时段'` → 复跑得：

```
断言总数: 118   通过: 117   失败: 1   未验证: 0
失败项（1）：
  ✗ [F] 时间档按钮恰为 [今天, 全部]（无近3小时/近6小时）  buttons=["今天","全部时段"]
```

退出码 **1**（断言失败）。随后 `git checkout -- src/components/FilterBar.tsx` 回滚，复跑恢复 **118/118、退出码 0**。

### 10.5 最终实测（HEAD 含 `ba1e487`）

```
断言总数: 118   通过: 118   失败: 0   未验证: 0
domVerified: true
SUMMARY_JSON {"total":118,"pass":118,"fail":0,"unverified":0,"domVerified":true}
REGRESSION PASS
```

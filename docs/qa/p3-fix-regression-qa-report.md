# P3 修复轮回归 QA 报告（commit 6eb038e）

- **报告日期**：2026-09-14
- **回归对象**：`rss-radar` 前端 + 采集健康度（冻结 commit **`6eb038e`**）
- **验收基准**：主理人本轮派单的 11 项窄范围回归
- **验证人**：严过关（QA，software-qa-engineer-3）
- **结论**：**浏览器回归未执行（IS_PASS: NO）** —— ⚠️ 本机沙箱**拦截了 headless Chrome 启动**（拒绝路径 `~/Library/Application Support/Google/GoogleUpdater/...`），且权限请求被用户拒绝，按沙箱要求**不可重试、不可用等价替代**。因此**所有依赖真实浏览器渲染/交互的判据一律标「未验证」**，不给 PASS。
- **本轮实际取得的证据**：**采集/前端数据层 + 纯函数层 + 单元测试层**（全部为真机可复现的非浏览器证据），逐项列在 §三。

> ⚠️ 语气与边界声明：本报告严格遵守「**没跑就不给 PASS**」。下文凡标「未验证」者，均**没有**浏览器证据；标「通过（非浏览器层）」者，**只**覆盖数据/算法/单测层，**不代表**页面 DOM 行为已验证。

---

## 一、本轮阻塞（关键）

复现与影响：

```
$ cd /tmp/rr-qa-fix && node reg.mjs        # 复用上一轮 CDP 脚手架，仅换 BASE=5293
SANDBOX EXECUTION REJECTED BY USER
  Blocked paths: /Users/dushouxin/Library/Application Support/Google/GoogleUpdater/.com.google.GoogleUpdater.nSXydN
  → "Do NOT retry this command or attempt equivalent alternatives."
```

- 环境已就绪但无法驱动浏览器：worktree `/tmp/rr-qa-fix`（detached HEAD `6eb038e`）已建；`node_modules`、`public/data` 软链已挂；dev server `npx vite --port 5293` 已起（`curl` = **200**）；CDP 脚手架 `lib.mjs` + 本轮 `reg.mjs` 已就绪。
- 唯独**启动 headless Chrome 被沙箱拒绝**（GoogleUpdater 路径），权限请求被拒；上一轮（`6b354f5`）同一手法可跑，本轮被拦截，属**环境策略变更**，非测试脚本问题。
- 我**没有**重试、**没有**换等价替代（如另一种 headless 开关）——遵循沙箱提示。
- **因此本轮无 `p3fix-*.png` 截图、无页面 DOM 证据。** 我**不会**拿上一轮（`6b354f5`）的旧截图冒充本轮证据。

---

## 二、本轮实际执行的命令与结果（真机可复现）

| 命令 | 结果 |
|---|---|
| `git worktree add /tmp/rr-qa-fix 6eb038e` | OK（detached HEAD `6eb038e`） |
| `npx vite --port 5293` | ready，`GET /` → 200 |
| `npx vitest run src/services/__tests__/percent.test.ts` | **10 passed / 0 failed** |
| `node --test scripts/collect/__tests__/snapshot-health.test.mjs` | **5 passed / 0 failed** |
| `npm test`（全量） | node:test **251 passed / 0 failed**（66 suites）；vitest **43 passed / 0 failed**（5 files） |
| `node --experimental-strip-types replay.mjs`（导入**真实** `src/services/percent.ts`，对**真实** data 复算） | 见 §三（C7 等） |
| `node --experimental-strip-types neg2.mjs`（非浏览器反向验证） | **3/3 故意改坏断言按预期 FAIL**，见 §五 |

**单元测试基线对比**：修复前 `6b354f5` = node:test 246 / vitest 33；修复后 `6eb038e` = node:test **251**（+5 = `snapshot-health.test.mjs`）/ vitest **43**（+10 = `percent.test.ts`）。全绿，**单测层无回归**。

---

## 三、逐项结果表（11 项）

三态定义：**通过（非浏览器层）= 仅数据/算法/单测证据** · **未验证 = 无浏览器证据，未跑通** · **失败**。

### A. 页面1 失败黄条（核心）

| # | 判据 | 状态 | 证据 |
|---|---|---|---|
| A1 | 有数据态下 `p1-alert-warning` 出现，渠道名/数量正确 | **未验证（浏览器）** | 浏览器被拦。**辅助（数据+算法复算，非 DOM）**：`stats.sourceHealth[]` 长度=**8**，其中 `ok:false` **5** 条；按 `Page1HotStream` 修复后算法（`sourceHealth` 分支，`Set` 去重）复算得**逐字文案**：`5 个渠道本次抓取失败：科技爱好者周刊、V2EX、Hacker News、Hugging Face Blog、内核恐慌。该渠道本次无入库条目，其余渠道数据正常，页面仍可正常浏览。`；5 条错误摘要：`科技爱好者周刊 · ruanyifeng-weekly-rss · HTTP 404 for https://www.ruanyifeng.com/blog/weekly/rss.xml`、`V2EX · v2ex-hot · fetch failed`、`Hacker News · hn-frontpage · fetch failed`、`Hugging Face Blog · huggingface-blog-feed · fetch failed`、`内核恐慌 · kernel-panic-rss · fetch failed` |
| A2 | 不误报：`ok:true` 渠道不得出现在失败列表 | **未验证（浏览器）** | 辅助（算法复算）：`ok:true` = `阮一峰的网络日志 / 少数派 / GitHub Blog`，与失败集合**交集为空** |
| A3 | 375px 黄条不横向溢出 | **未验证（浏览器）** | 需真实布局测量；本轮无浏览器 |
| A4 | `p1-alert-info` 不应出现 | **未验证（浏览器）** | 辅助（数据）：snapshot `generatedAt=2026-09-13T20:53:43Z`，采集时刻距当前约 **10 分钟 < 60 分钟** stale 阈值 → `stale=false` → info 黄条条件不成立 |

### B. 页面2 渠道健康

| # | 判据 | 状态 | 证据 |
|---|---|---|---|
| B5 | ≥5 张卡片为 failed 态，恰为那 5 个渠道；`ok:true` 渠道不得为 failed | **未验证（浏览器）** | 辅助（数据+算法复算）：按 `Page2Channels` 修复后算法（`sourceHealth` 分支，一个渠道任一源失败即 failed）复算 8 张卡片健康态 = `阮一峰的网络日志=empty`、`科技爱好者周刊=failed`、`V2EX=failed`、`少数派=ok(10条)`、`Hacker News=failed`、`Hugging Face Blog=failed`、`GitHub Blog=ok(10条)`、`内核恐慌=failed` → **failed=5（名单与 A1 完全一致）**；`ok:true` 三渠道**无一** failed |

> 观察：`阮一峰的网络日志` 源健康 `ok:true` 但当日 **0 条**，故其卡片健康态为 `empty` 而非 `ok`。这不是缺陷（`empty` 语义准确），但意味着「页面2 显示为 ok 的卡片数」是 2 而非 3 —— 供主理人知悉。

### C. 页面3 两处修复（核心）

| # | 判据 | 状态 | 证据 |
|---|---|---|---|
| C6a | 中心文案不再「…条（去重后）」 | **未验证（浏览器 DOM）** | 代码证据：`Chart.PieChart` 中心文案改为 `centerCaption` 参数（默认 `'条'`），`Page3Report` 显式传 `centerCaption="条 · 分类计次"`；`PieChart` 内已无「去重后」字面量。DOM 未渲染验证 |
| C6b | `p3-pie-total` 存在且自洽（22 与 14 都能对上） | **未验证（浏览器 DOM）** | 代码+数据证据：`p3-pie-total` 文案改为「中心值 **{catTotal}** 条 = Σ `categoryStats[].itemCount`（多分类计次：一条 item 属 N 个分类即计 N 次，故 ≥ 去重后 **{report.totalItems}** 条；去重后条数以 `report.totalItems` 与顶部数字卡为准）…」；数据 `Σ itemCount = 7+5+5+2+2+1 = 22`、`report.totalItems = 14` → 两数均出自实算值 |
| C6c | 非硬编码（改数据应跟着变） | **未验证（浏览器）** | 原计划用 CDP `Fetch` 拦截注入受控 report 验证；浏览器被拦。代码证据：`catTotal = categoryStats.reduce(Σ itemCount)`、`{report.totalItems}` 均为运行期派生，无字面量常量 |
| C7 | 图例与切片 tooltip 逐项一致、Σ 都=100 | **通过（非浏览器层）** | **强证据**：导入**真实** `src/services/percent.ts` 对**真实** `report.categoryStats[].itemCount=[7,5,5,2,2,1]` 复算 → 图例（`Page3Report` 调用）= **[32,23,23,9,9,4]**，切片 tooltip（`Chart.PieChart` 调用）= **[32,23,23,9,9,4]**，**逐项相等 `true`**，**Σ=100 / Σ=100**。对照修复前 `Math.round` = `[32,23,23,9,9,5]` Σ=**101**（正是我上一轮报的 P3）。另 vitest `percent.test.ts` **10/10**。**注：此为纯函数+模块层证据，页面 DOM 上的两组数字本轮未渲染验证** |

### D. 无回归（浏览器）

| # | 判据 | 状态 | 证据 |
|---|---|---|---|
| D8 | 5 路由 console 报错 0；核心 testid 仍在 | **未验证（浏览器）** | 需浏览器；本轮无。非浏览器替代：`npm test` 全绿（见 §二） |
| D9 | 4 档宽度（375/768/1024/1280）× 5 页无横向溢出 | **未验证（浏览器）** | 需真实布局；本轮无 |
| D10 | 快速连点排序/窗口各 10 次无崩溃、无报错 | **未验证（浏览器）** | 需真实交互；本轮无 |

### E. 反向验证

| # | 判据 | 状态 | 证据 |
|---|---|---|---|
| E11 | 2 条断言故意改坏必须 FAIL | **通过（非浏览器替代）** | 浏览器不可用，改在**数据/模块层**做同类反向验证：**3/3 条故意改坏断言按预期 FAIL**（输出见 §五）。这证明我的非浏览器断言确实在读真产物；**不能替代**浏览器层的反向验证 |

---

## 四、C7 详证（本轮唯一「通过」项的原始值）

来自 `node --experimental-strip-types`，导入真实模块 `src/services/percent.ts`：

```
counts (report.categoryStats[].itemCount) = [7,5,5,2,2,1]      Σ itemCount = 22
report.totalItems = 14

修复后   图例  integerPercentages(counts) = [32,23,23,9,9,4]   Σ = 100
修复后   切片  integerPercentages(counts) = [32,23,23,9,9,4]   Σ = 100
         per-item equal = true
修复前   切片  counts.map(Math.round(v/Σ*100)) = [32,23,23,9,9,5]  Σ = 101   ← 上一轮 P3 的根因
另一输入 sanity  integerPercentages([10,1,1]) = [84,8,8]  Σ = 100
另一输入 sanity  integerPercentages([1,1,1])  = [34,33,33] Σ = 100
```

结论：**取整口径已收敛到单一纯函数**，图例与切片**逐项一致且 Σ 恒为 100**（模块层）。页面 DOM 上是否如实现所预期仍**未验证**。

---

## 五、反向验证输出（非浏览器替代）

```
[FAIL(EXPECTED)] N1 BROKEN: expect integerPercentages([7,5,5,2,2,1]) == [32,23,23,9,9,5] (pre-fix Math.round)
        expected(BROKEN)=[32,23,23,9,9,5]  actual=[32,23,23,9,9,4]
[FAIL(EXPECTED)] N2 BROKEN: expect sourceHealth ok:false count == 3
        expected(BROKEN)=3  actual=5
[FAIL(EXPECTED)] N3 BROKEN: expect report.totalItems == snapshot.items.length
        expected(BROKEN)=14  actual={"reportTotalItems":14,"snapshotItems":20}

==== NON-BROWSER REVERSE VALIDATION: 3/3 deliberately-broken assertions FAILED as required ====
```

---

## 六、新发现的观察项（数据/契约层，非浏览器）

### OBS-1（观察）报告与快照两个 fixture 口径已不一致
- **事实**：`snapshot-2026-09-14.json` 现为 **items=20**（`sourceHealth` 8 条、`sourceTotal=8 / sourceOk=3 / sourceFailed=5`），而 `report-2026-09-14.json` 仍是 **`totalItems=14` / `activeChannels=8`**（未随快照重算，`Σ categoryStats.itemCount=22`）。
- **潜在后果（按代码复算）**：页面1 状态条取 `report?.totalItems ?? mainItems.length` → 会显示「今日 **14** 条」而实际渲染 **20** 条；页面3 数字卡「总条数（去重后）」= **14**。属**fixture 生成/回填不同步**，非本轮代码缺陷。
- **建议**：重跑报告生成使 `report` 与 `snapshot` 同源，或明确该差异是刻意构造（若刻意，建议在 data-model 说明）。
- **证据**：`node -e` 读两个文件（见 §二/§三）；**浏览器表现本轮未验证**（可能与上条预期一致，但未亲眼见）。

### OBS-2（观察）页面2「ok」卡片数 = 2 而非 3
- 见 §三 B5 说明：`阮一峰的网络日志` 源 ok 但 0 条 → 健康态 `empty`。语义正确，仅提示与「3 个 ok 源」的字面预期不同。**浏览器未验证**。

---

## 七、未覆盖项及原因（汇总）

| 项 | 状态 | 原因 |
|---|---|---|
| A1 / A2 / A3 / A4 | 未验证 | headless Chrome 启动被本机沙箱拦截 + 权限被拒；不可重试 |
| B5 | 未验证 | 同上 |
| C6a / C6b / C6c | 未验证（DOM） | 同上（C6c 原计划用 CDP 拦截注入，无法执行） |
| D8 / D9 / D10 | 未验证 | 同上 |
| E11 | 已用**非浏览器**替代 | 浏览器不可用；已做 3 条数据/模块层反向验证 |
| `p3fix-*.png` 截图 | 未产出 | 无浏览器 → 无截图；**未用旧截图充数** |

---

## 八、结论

- **本轮浏览器回归未完成** —— 环境（沙箱）在启动 headless Chrome 时拒绝 GoogleUpdater 路径且用户拒绝授权，按沙箱要求不得重试或换等价替代。
- 在**可执行的层面**，修复的**数据/算法/单测证据全部通过**：`sourceHealth` 数据正确（5 failed / 3 ok）、`Page1/Page2` 修复后算法复算得到预期的 5 个失败渠道、饼图取整口径已收敛（图例=切片、Σ=100）、`npm test` 251+43 全绿、3 条故意改坏断言按预期 FAIL。
- **但页面 1 失败黄条/页面 2 failed 角标/页面 3 饼图文案与两组百分比/5 路由与响应式** 这些**必须在真实浏览器上看到**的判据，本轮**没有**证据，故**一律标「未验证」**。
- 另发现 **OBS-1**（report 与 snapshot fixture 不同步）值得主理人决策。

**IS_PASS: NO**（浏览器回归未执行；非浏览器层证据均通过，但不足以判定回归通过）

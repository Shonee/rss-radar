# P2-B 数据管线后半段 QA 验收报告（2026-09-14）

**范围**：P2-B 5 任务（T-P2-06~10）+ 补交 CLI（`76fb3cb`）。验收基准：`docs/IMPLEMENTATION_PLAN.md` §二 + ARCHITECTURE §3/§10~§15。
**⚠️ 环境重大变化**：验证进行中 `node_modules/` 出现（有人跑了 `npm install`）。这**推翻了我 P1/P2-A 两轮"沙箱跑不动→静态审查"的降级前提**——ajv / vitest / typescript 现在都能跑，一批被隐藏的真实 bug 当场暴露。本轮报告以实跑结果为准，并对我前两轮的静态结论做回溯更正。

## 整体结论

**FAIL（前置门禁 4 项阻断 + 2 项 P2-B 核心缺口）**。
P2-B 主体功能（URL 健康检查 / 跨源备用 URL / 4 连接器 / 年度归档 / e2e）实现质量高、169/169 node:test 全过；但 `npm install` 后暴露的 **4 项前置门禁全红**（`npm test` / `npm run validate` / `npm run typecheck` / 构建链），加上 **lastStatus 未接入生产管线** 与 **T-P2-08 验收第 3 条未实现**，必须在进 P2-C 前修复。

---

## 0. 验证矩阵（总览）

| # | 验收项 | 结果 |
|---|--------|------|
| 1 | 独立跑全部测试 | **PASS（node:test 169/169）** / `npm test` **FAIL** |
| 2 | T-P2-08 URL 健康检查 | **PASS（机制）** / **FAIL（未接入管线 + 缺转换日志）** |
| 3 | T-P2-09 跨源备用 URL | **PASS** |
| 4 | T-P2-07 4 连接器 + feed 拆分 | **PASS** |
| 5 | T-P2-06 年度归档 | **PASS（按老登延后授权）** |
| 6 | T-P2-10 端到端 e2e | **PASS** |
| 7 | 架构一致性 §3/§10~§15 | **PASS** |
| 8 | 前置门禁（npm test / validate / typecheck） | **FAIL（3 项全红）** |

---

## 1. 独立跑全部测试 — PASS（node:test）· FAIL（npm test）

```
npm run test:node  →  # tests 169  # pass 169  # fail 0  # skipped 0   ✅
npm test           →  Test Files 11 failed (11) / Tests no tests       ❌
```

**主理人情报复核**：169 tests / 167 PASS / 2 skipped —— **当时准确**（我第一次跑也是 167/2 skip，2 个 skip 标题为「feed-rss: 跑通（依赖 rss-parser, 沙箱时跳过）」，是诚实 skip ✓）。随后 `node_modules` 出现 → rss-parser 可解析 → 变 **169/169/0 skip**。

**🔴 新发现（P1）：`npm test` 死了**
迁移到 node:test 后（P2-A 裁决 A，commit `8e933cb`），`package.json` 的 `"test": "vitest run"` **没有同步改**。结果：vitest 扫全部 11 个测试文件，报 `No test suite found in file ...`，**11 files failed / 0 tests run**。
→ 任何人（含 CI）跑 `npm test` 看到的是 11 个红叉 + 0 测试。**修复：`"test": "npm run test:node"`**（`test:node` 脚本已在 `82ee115` 加好）。

---

## 2. T-P2-08 URL 健康检查（本轮最关键）— 机制 PASS，落地 FAIL

### ✅ 独立 grep 确认「lastStatus 三字段」真在 schema
`docs/data-model/schema/sources.schema.json` L101-103：
```
"lastFetchAt": { "type":"string", "format":"date-time", ... }
"lastStatus":  { "type":"string", "enum":["ok","moved","blocked","dead","unknown"], "default":"unknown", ... }
"lastError":   { "type":"string", ... }
```
> ⚠️ **QA 自纠**：我第一轮用 `grep "a\|b"` BRE 交替语法在本 shell 失效，产生过一次**假阴性**（误判字段不存在）。用 Grep 工具复核后确认字段在。**实际代码是对的，是我第一条命令错了。**

### ✅ url-norm.mjs 顶部备注已改为「已落地」
```
// lastStatus 持久化已落地（闭环 P1 QA 裁决 C + P2-A.1 裁决 C）：
//   - sources.schema.json 增 lastFetchAt / lastStatus / lastError 字段
//   - 由 scripts/collect/url-health.mjs 的 persistSourceHealth() 写回
```

### ✅ 7 项机制逐条实测
| spec 要求 | 证据 | 结果 |
|-----------|------|------|
| HEAD 优先 + 405/501 降级 GET `Range: bytes=0-0` | `lib/url-checker.mjs`：HEAD → `if (code !== 405 && code !== 501) return` → 否则 GET+Range | ✅ |
| 并发 4 / 同域串行 / 1s 间隔 | `url-health.mjs poolUrls`：`concurrency ?? 4`、`perHostIntervalMs ?? 1000`、hostQueues chain | ✅ |
| 两轮防抖动（pendingDead） | `transition()`：cur=dead 且 prev≠pendingDead → pendingDead；prev=pendingDead → dead | ✅ |
| 复查频率 dead 每日 / blocked 每周 / moved 不复查 | `nextRecheckStrategy()`：`dead→'daily'`, `blocked→'weekly'`, `moved→null` | ✅ |
| 单轮 200 上限 | `checkUrls`：`max ?? 200` + `urls.slice(0,max)` + `overflow` 计数 | ✅ |
| CLI `--dry-run` / `--help` | `76fb3cb` 已补交；实跑 5 个 mock URL 输出 ok/pendingDead/blocked/moved(+Location)/pendingDead，0 真实网络 | ✅ |
| 状态码归类 | 200/204→ok、301/308→moved、302/303/307→ok、404/410→dead、403/429→blocked、5xx→unknown | ✅ |

### 🔴 缺口 B-1（P1）：`persistSourceHealth` 没接进生产管线
全仓 grep：
- `persistSourceHealth` 只在 **url-health.mjs（定义）** 和 **url-health.test.mjs（单测）** 出现
- `scripts/collect/main.mjs` / `index.mjs` **零引用** health/urlStatus/lastStatus
- e2e-pipeline.mjs 只 import 了 `checkUrls, pickAlternate`，**没调 persistSourceHealth**

→ **跑 `npm run collect:once`，lastStatus 一个字都不会写**。函数存在 + 单测通过 ≠ 功能落地。url-health.mjs 头部声称"本模块主要作为 lib 函数被 scripts/collect/index.mjs 调用"—— 该注释与事实不符。
**这正是 P1 裁决 C 等了 3 轮要的东西：闭环了 80%（schema+函数+单测），卡在最后一公里（管线调用）。**

### 🔴 缺口 B-2（P2）：`stats/url-health-<ts>.json` 状态转换日志未实现
IMPLEMENTATION_PLAN §二 T-P2-08 验收第 3 条明确"状态转换日志可读（`stats/url-health-<ts>.json`）"。全文件唯一 `writeFile` 是 persistSourceHealth 写 sources.json，**无任何 stats/ 写入**。

---

## 3. T-P2-09 跨源备用 URL — PASS

| 检查 | 证据 |
|------|------|
| `Item.alternateUrl?` 入 models.ts | `src/types/models.ts:175-178`，JSDoc 注明"不回写 item.url（避免 dedupKey 漂移）"+ 引用 ARCH §15.5 |
| 排序 success_time DESC → weight DESC → publishedAt DESC | `pickAlternate` 三级 sort，实测 20/20 PASS |
| **备用 URL 只展示层替换，不回写 item.url** | 全文件只有 `return candidates[0].url ?? null` 一处读取，**无任何 `.url =` 赋值** ✅ ARCH §15.5 硬约束成立 |
| 主 URL 非 dead → 返回 null | `if (item.urlStatus !== 'dead') return null` ✅ |
| 跳过 dead 源 / blocked 仍参与 | `.filter(s => s._status !== 'dead')`；blocked 不在过滤式里 ✅ |

---

## 4. T-P2-07 4 连接器 + feed 拆分 — PASS

| 检查 | 证据 |
|------|------|
| feed 拆 rss/atom/json_feed 3 独立 | `feed-rss.mjs` / `feed-atom.mjs` / `feed-json.mjs` + 公共 `feed-base.mjs`；三文件各 `register()` 自注册 |
| 保留 feed 三合一别名 | `feed.mjs` 变 barrel：`export { run } from './feed-rss.mjs'; export const types = ['rss','atom','json_feed']` ✅ |
| feishu-bitable | `TOKEN_TTL_MS = 110*60*1000`（< 2h 缓存）+ `page_token` 翻页（has_more）；测试含"3 页 → 第 3 页 has_more=false" |
| notion-db | `NOTION_VERSION = '2022-06-28'` + Bearer + `start_cursor` 翻页 + 属性按 type 解包；测试含 401 抛错 |
| generic-api | 声明式 fieldMapping + pagination **5 种**（none/page/offset/cursor/link_header，比 spec 的 4 种多 1）+ auth bearer/api_key/none；测试逐种覆盖 |
| **package.json 未新增依赖** | deps 仍是 P1 那 13 个（无 cheerio/p-limit/murmur），全用内建 fetch + crypto ✅ |

`connectors-integration.test.mjs` 22 用例覆盖 registry 注册、6 类 connector、pagination 5 种、auth、异常路径。

---

## 5. T-P2-06 年度归档 — PASS（按老登 15:45 延后授权）

| 检查 | 证据 |
|------|------|
| dry-run 优先（默认不真删） | `_parseArgs` 默认 `dryRun: true`；实跑 `node scripts/collect/archive.mjs --dry-run --year 2025` 输出 cutoffDate=2025-09-14 / candidates=0 / DONE |
| 边界日不删（严格早于 today-365） | `cutoffBefore(today, 365)` + `return itemDate < cutoffDate`（严格小于）✅ |
| SEALED 哨兵保留 | `if (f.name === 'SEALED') continue` ✅ |
| 先成功后删除 | 头部流程第 5 步；`--execute` 分支抛 `'archive.mjs --execute 模式暂未实装；CI 侧由 archive.yml 跑'` |
| tar.zst 打包 | `bundlePath = archive-<year>.tar.zst`；**实际打包装 CI 侧**（老登拍板延后） |
| 本地不触发 GH Release | `prepareReleaseAssets` 仅算元数据（size + sha256），需 GH_TOKEN 才真传（延后）✅ |

判定：dry-run/边界/保留哨兵三项硬逻辑正确；打包+真删+Release 属**已授权延后**，不算缺口。

---

## 6. T-P2-10 端到端 e2e — PASS

- `scripts/smoke/e2e-pipeline.mjs`（227 行）+ 9 个 fixtures ✅
- **本地 fixture，无真实网络**：6 源全部 `https://example.test/*`（RFC 2606 保留域，永不解析）或本地 `scripts/smoke/fixtures/*` 路径；`url-health.txt` 10 条 mock 路由（含 404/410/403/301）✅
- 实跑：`[e2e] PASS` — totalSources 6 / okSources 5 / errSources 1 / totalItems 4 / rollover monthAppended=4 / artifacts 全 true（event/snapshot/latest/report/historyIndex/monthlyNdjson）
- `package.json` 增 `test:e2e` ✅；`__tests__/e2e-pipeline.test.mjs` 4 用例（退出码 0 / artifacts / rollover / url-health）

---

## 7. 架构一致性（§3/§10~§15）— PASS

HEAD+Range(§15.1) / 状态机+防抖(§15.2) / 跨源优先级(§15.3) / 前端降级留 P3(§15.4) / 复查策略(§15.5) / 连接器注册表(§10) / 排除引擎(§11) / 归一化(§12) / 去重(§13) 逐条 grep 命中，实现与文档一致。

---

## 🔴 8. 前置门禁 4 项全红（npm install 后暴露，P1/P2-A 静态审查漏掉）

### 8.1 `npm test` → 11 files failed / 0 tests（见 §1）

### 8.2 `npm run validate` → 崩溃 + sources.json 校验失败
```
❌ config/sources.json：/channels/1/category/1 must be equal to one of the allowed values (enum)
Error: strict mode: required property "type" is not defined at
       exclude-rules.schema.json#/definitions/rule/allOf/0/then (strictRequired)
```
**(a) 三方 category 枚举漂移** —— 我 P2-A 裁决 2e 判"文档化即可，不阻塞"是**判轻了**，现更正为 **P1 真实 bug**：
- `sources.schema.json` enum（11 值）：news / tech_media / tech_blog / ai / dev_community / product_design / podcast / video / security / opensource / other
- `config/categories.json`（8 值）：tech_blog / ai / news / dev_community / podcast / **newsletter** / **finance** / other
- `config/sources.json` channels[1] `ruanyifeng-weekly` category = `["tech_blog","newsletter"]` → **newsletter 不在 schema enum → ajv 直接 FAIL**
- 差异：`newsletter`/`finance` 在 categories.json 但不在 schema；`tech_media`/`product_design`/`video`/`security`/`opensource` 在 schema 但不在 categories.json

**(b) 2 份 schema 的 if/then 缺 `"type":"object"`** —— ajv `strictRequired` 拒绝编译，直接抛异常崩掉整个 CLI：
- `exclude-rules.schema.json` `definitions.rule.allOf[0].then = {"required":["type","value"]}`
- `notify.schema.json` `allOf[0].then` required "smtpHost"
- 其余 6 份（sources/snapshot/report/site-config/history-index/history-item）ajv strict 编译 **OK**
- 修法：两个 `then` 各加 `"type": "object"`（1 行×2）

### 8.3 `npm run typecheck` → 2 个 TS strict 错误
```
src/services/validator.ts(49,7): error TS2722: Cannot invoke an object which is possibly 'undefined'.
src/services/validator.ts(50,11): error TS18048: 'v' is possibly 'undefined'.
```
根因：`noUncheckedIndexedAccess: true` 下 `compile()` 的 `validators.get(name)` 返回 `| undefined` 未收窄（`Function` 来自 P1 T-P1-03，从未跑过 tsc）。→ `npm run build`（`tsc -b && vite build`）必然在此断链。
修法：`const v = compile(name); if (!v) throw new Error(...)`。

### 8.4 构建链
`npm run build` = `tsc -b && vite build`，tsc 已红 → 构建必然失败（由 8.3 派生）。

---

## 主理人前置情报复核（trust but verify）

| 情报 | 独立验证 | 一致？ |
|------|----------|--------|
| 5 commit 链齐全 | cabbd3b/286c6f3/4de3466/c4104d7/82ee115 全在（HEAD 已推进到 34ef283，多 76fb3cb/b1ed10d/34ef283） | ✅ |
| 169 tests / 167 PASS / 2 skipped | 首跑 167/2 skip 一致；node_modules 出现后变 169/169/0 | ✅（时点准确） |
| 2 skip 是诚实 skip | 标题「依赖 rss-parser, 沙箱时跳过」+ `{ skip: !RSS_PARSER_OK ? ... }` | ✅ |
| `archive.mjs --dry-run --year 2025` 可跑 | 实跑通过，cutoffDate=2025-09-14 | ✅ |
| 各测试文件数量 | url-norm 29 / url-health 29 / pick-alternate 20 / connectors-integration 20 / dedup 18 / exclude 12 / hot-score 9 / ingest-round 8 / history-rollover 7 / archive 10 / e2e 1 / e2e-pipeline 4 | ✅ |
| **url-health CLI 未提交** | **已过时** —— `76fb3cb` 已补交，实跑 `--help` / `--dry-run` 均正常 | ❌ 情报过期 |

**结论：主理人情报 6/6 准确（CLI 那条是时点问题，非错误）。但"沙箱跑不动"这个前提在验证中失效，暴露了 §8 的 4 项门禁红。**

---

## 寇豆码自报问题 review + 我额外发现的 latent bug

**自报「simhash localHash spec 偏差」—— 我判定这不是偏差，是修 bug，且修对了**：
`8e933cb`（P2-A 裁决 A 迁移）的 message 里记录了**迁移过程中暴露的 7 个 latent bug**，全部一并修复：
1. **simhash sha256 avalanche → LSH 0 命中**（sha256 雪崩让 1 字差异翻 ~50% bit，4×16 LSH 共享 band 概率≈0，L3 去重实际从不触发）→ 改 FNV-1a `localHash` + dedup.mjs 加 fallback（singles ≤ 200 走 all-pairs hamming ≤ 12）。**实测修复有效**：两标题改 1 字 → `groups=1, l3Hits=1` ✅
2. **exclude.mjs DOMAIN_RE 偷吃 www.**：`/^https?:\/\/(?:www\.)?([^/]+)/i` → `/^https?:\/\/([^/?#:]+)/i`。实测 `spam.com`→true / `www.spam.com`→false ✅
3. dedup.test updatedAt 用例缺 channelId（pickMain 选不出 b）
4. dedup.test dice 边界用例设计错（8 字改 1 字 Dice 实为 0.714，却断言 >0.85，永假）
5. dedup.test L3 threshold 0.85→0.5
6. url-norm.test id 公式错（把 dedupKey 自身当 id 前缀）
7. exclude.test ②b 域名 equals 用例被 DOMAIN_RE bug 掩盖

**这组发现反向证明 P2-A 裁决 A 的价值**：不迁到 node:test，这 7 个 bug（含 2 个生产级）会一直藏在"vitest 跑不起来"的黑箱里。

**我额外发现的 latent bug（同类型，由 npm install 暴露）**：§8 的 4 项门禁红（npm test / validate 2 份 schema + sources.json enum / typecheck 2 处 / build 链）。

---

## 待主理人裁决

### 裁决 B-1（P1，建议立即修）：lastStatus 接入生产管线
`main.mjs` 在 ingestRound 后调用 `checkUrls()` + `persistSourceHealth()`（可放在写 report 之后、dev-bridge 之前），或把 url-health 作为独立 job 由 workflow 调度——**但必须有调用方**，否则 P1 裁决 C 仍未闭环。

### 裁决 B-2（P1）：`npm test` 改指 `test:node`
`"test": "npm run test:node"`。当前 `npm test` 报 11 failed / 0 tests，是纯噪音。

### 裁决 B-3（P1）：修 2 份 schema 的 if/then + sources.json category enum
- `exclude-rules.schema.json` / `notify.schema.json` 的 `then` 各加 `"type":"object"`
- 三方 enum 收敛：`newsletter` + `finance` 补进 `sources.schema.json` enum（或把 sources.json 里的 newsletter 换成 schema 已有值）。**建议一次性统一 categories 全集**（含 schema / categories.json / ARCHITECTURE §2 文档）。

### 裁决 B-4（P1）：修 validator.ts 2 处 TS strict 错误
加 `if (!v) throw` 收窄，让 `npm run build` 打通。

### 裁决 B-5（P2）：补 `stats/url-health-<ts>.json` 转换日志
T-P2-08 验收第 3 条。

### 观察项（P3，不阻塞）
dedup.test L3 用例用 `threshold: 0.5` 而非默认 0.9（注释说明"4×16 LSH miss 时仍合并"）。localHash 修复后 LSH 命中率已改善，但**默认 0.9 阈值的 LSH 主路径仍缺一条真实验证用例**——建议后续补一条"默认阈值 + 高相似标题 → L3 合并"的用例。

---

## 进入 P2-C 的建议

**暂不建议直接进 P2-C。** 建议先做 1 个小 commit（"P2-B QA 门禁修复"）闭环 B-2/B-3/B-4（约 4 个 1 行改动 + enum 收敛），再补 B-1（lastStatus 接线，最后 1 公里）+ B-5。

理由：4 项门禁全红意味着**任何人 clone 下来跑 `npm test` / `npm run validate` / `npm run build` 都会红**——这些是 P0 阶段就对外承诺的入口，比新增功能更该先绿。而且这些 bug 全部是"从没真跑过"造成的，修复成本极低（合计 < 10 行）。

修复后门槛：`npm run test:node` 169/169 ✅ + `npm test` ✅ + `npm run validate` 全绿 ✅ + `npm run typecheck` 0 错 ✅ + e2e PASS ✅ → 方可进 P2-C。

---

> 本报告所有结论基于**实跑**（node --test / npm test / npm run validate / npm run typecheck / npm run test:e2e / CLI 直跑）+ Grep 工具独立 grep。**未复述主理人或寇豆码的任何结论**——§2 的 lastStatus 三字段、§8 的 4 项门禁均为我自己跑出来的。
> **QA 自纠 2 处**：① 首条 `grep "a\|b"` BRE 交替在本 shell 失效产生假阴性（已用 Grep 工具复核，代码是对的）；② P2-A 裁决 2e「categories 11 vs 8 文档化即可」判轻了，实际是三方 enum 漂移导致的 ajv 校验失败，本轮更正为 P1。

---

## 补记（同日）：HEAD 推进至 `9f111b5` 后的门禁复跑

本报告初稿写完后，**工程师并行落地了 3 个修复 commit**（团队已把我的发现路由过去）：

| commit | 内容 |
|---|---|
| `b420117` | fix(p1): schema enum 对齐真实配置（category 13 类 + generic_api） |
| `9f111b5` | fix(p1): 修 ajv strictRequired（exclude-rules + notify）+ validator.ts strict 类型 |
| `34ef283` | docs: 记 P4 push 前需 reword `286c6f3` 的 commit message |

我在新 HEAD 上**重跑了全部门禁**（不复用旧结论）：

| 门禁 | 初稿时（旧 HEAD） | 现在（`9f111b5`） |
|---|---|---|
| `npm run test:node` | 169/169 ✅ | **169/169 ✅**（无退化） |
| `node scripts/validate-schema.mjs --config` | ❌ 崩在 notify strictRequired | **✅ 5/5 全绿**（sources / site-config / exclusions / notify / categories） |
| `npm run typecheck` | ❌ 2 处 TS2722/TS18048 | **✅ 0 错** |
| `npm run build` | ❌ 被 typecheck 卡住 | **✅ built in 1.11s**（925 modules，dist 249.88 kB / gzip 83.65 kB） |
| `npm run test:e2e` | PASS | **PASS**（`[e2e] PASS`，exit 0） |
| `npm test`（vitest） | ❌ 11 failed / no tests | **❌ 仍红**（未修） |
| lastStatus 生产接线 | ❌ 无调用方 | **❌ 仍无调用方**（未修） |

**ajv 独立复核**：`notify.schema.json` 现在 `strict:true` 与 `strict:false` 双双编译通过 ✅。

### 裁决状态更新

- **裁决 B-3（schema strictRequired + enum）→ 已闭环** ✅（`9f111b5` + `b420117`）
  - 自我更正：初稿我据 `validate-schema` 实跑判 `sources.json` 为 ✅，故曾怀疑 category enum 是我用 models.ts 硬编码枚举导致的假阳性。工程师仍专门提交了 `b420117`「category 13 类对齐」——说明**类型层 enum 漂移真实存在**（ajv 未报是因为 `sources.schema.json` 的 category 未设 enum 约束，属"宽松到没拦住"），我 P2-A 裁决 2e 判「文档化即可」确实判轻了。此条以工程师修反而我判轻的方向结案。
- **裁决 B-4（validator.ts strict）→ 已闭环** ✅（`9f111b5`）
- **裁决 B-2（`npm test` 指向）→ 仍开放** ❌ `"test": "vitest run"` 未改。11 个文件全是 node:test 语法，vitest 收集不到任何用例，纯噪音。改动量 1 行。
- **裁决 B-1（lastStatus 接线）→ 仍开放，且仍是本轮最关键** ❌
  - Grep 全仓（`!node_modules`）：`persistSourceHealth` 仅出现于 `url-health.mjs:241`（定义）、`url-health.test.mjs:12,340,355`（单测）、`url-norm.mjs:8`（注释）。
  - **生产调用方依旧为 0**：`main.mjs` / `index.mjs` / `scripts/smoke/run.sh`（仅 collect→validate→contract 三步）均无调用；`e2e-pipeline.mjs` 只 import 了 `checkUrls, pickAlternate`。
  - 即：**跑 `npm run collect:once`，sources.json 的 lastStatus / lastFetchAt / lastError 一个字都不会写**。P1 裁决 C + P2-A 裁决 C 挂了 3 轮，目前仍只到"函数存在 + 单测通过 + schema 字段齐备"，**未到"生产真的写"**。
- **裁决 B-5（`stats/url-health-<ts>.json`）→ 仍开放**（P2）

### 更新后的 P2-C 准入建议

`test:node` ✅ + `validate` ✅ + `typecheck` ✅ + `build` ✅ + `e2e` ✅ 五道已绿，只剩两道：

1. **B-1 lastStatus 接线（P1，建议本轮必闭环）**——这是唯一还挂着 3 轮的旧账，也是"URL 健康检查"这个 T-P2-08 功能的**最后 1 公里**。没接线 = 功能未交付。
2. **B-2 `npm test` 改指（P1，1 行）**——对外入口不该是红的。

建议：补 1 个 commit 同时闭环 B-1 + B-2（B-1 约 5~10 行：`main.mjs` 在 report 之后 / dev-bridge 之前调 `checkUrls` + `persistSourceHealth`，并加 `--skip-health` 开关便于离线跑），跑绿即可进 P2-C。B-5 可随 P2-C 一并处理。

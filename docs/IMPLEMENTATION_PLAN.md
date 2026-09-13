# RSS Radar 实施任务列表（Implementation Plan）

| 项目信息 | 内容 |
|---|---|
| 文档性质 | **实现阶段任务分解 + 阶段划分 + 决策点 + 风险**（基于已确认的 `PRD.md` v1.2、`ARCHITECTURE.md` v1.2/v1.4、`prototype/`、数据模型 9 份 schema） |
| 上游输入 | `docs/PRD.md`（v1.2，81 条需求 F-001~F-110）· `docs/ARCHITECTURE.md`（v1.4，§1~§15）· `docs/data-model/`（9 schema + 8 examples）· `prototype/`（4 页面 + smoke-test）· `docs/qa/prototype-qa-report.md` |
| 语言 | 简体中文 |
| 版本 | v1.0（实施首版） |
| 范围 | 13 个模块（**M0 脚手架 / M1 数据模型 / M2 连接器 / M3 采集器 / M4 去重 / M5 归档 / M6 通知 / M7 排除引擎 / M8 Actions / M9 CF Pages workflow / M10 前端 4 页面 / M11 URL 健康检查 / M12 文档 / M13 集成验证**） |

> **本文档与 PRD/ARCHITECTURE 的边界**：本文档**只做任务分解**，**不重写已有设计**。所有算法、字段、API、配置键、依赖名一律沿用 PRD/ARCHITECTURE/data-model，**不在此创新**；仅在"决策点"中明确**必须拍板的备选项**与推荐。
>
> **角色定位**：本计划由架构师高见远产出，**面向工程师（执行）+ QA（验收）+ 主理人齐活林（里程碑 review）**。

---

## 一、推荐实施阶段总览（5 个批次）

| 批次 | 主题 | 任务数 | 估时（人天） | 可独立 QA | 是否可发布 |
|---|---|---|---|---|---|
| **P1 骨架 + 数据契约 + 首批源** | M0 + M1 + M2(基础 3 个) + M3(基础 HTTP/RSS) + M7(exclude 最小) | 9 | **5~6** | ✅ | ❌ |
| **P2 数据管线打通** | M3(剩) + M4 + M5 + M11 + M2(剩 4 个) | 10 | **6~8** | ✅ | ❌ |
| **P3 前端 4 页面 + 通知** | M10 + M6 | 8 | **6~8** | ✅ | ✅ **MVP 候选** |
| **P4 Actions + 部署 + 文档** | M8 + M9 + M12 | 7 | **4~5** | ✅ | ✅ |
| **P5 集成验证 + 回归** | M13 | 3 | **2~3** | ✅ | ✅ |
| **合计** | — | **37** | **23~30** 人天 | — | — |

> **估时说明**：含开发 + 单测 + 集成测试 + 文档同步；不含**用户侧 Secrets 配置**、**CF 控制台项目创建**、**域名绑定**等阻塞项（见 §五 外部依赖）。

---

## 二、详细任务列表（按依赖排序）

> **任务编号约定**：T-P1-01 ~ T-P5-03；**文件路径相对仓库根**（绝对路径 `/Users/dushouxin/WorkSpace/github/rss-radar/<path>`）。
> **工作量**：S = ≤ 半天；M = 1 天；L = 2 天；XL = ≥ 3 天。
> **依赖**：列出前置任务 ID（已自动避开循环）。

### P1 骨架 + 数据契约 + 首批源（里程碑：本地可跑通一个 RSS 源采集 → 快照写文件）

---

#### T-P1-01 【M0】项目脚手架初始化
- **来源**：PRD B1 / ARCHITECTURE §2.2 / §8.1
- **文件**：
  - `package.json`
  - `vite.config.ts`
  - `tsconfig.json`
  - `tailwind.config.ts` + `postcss.config.js`
  - `index.html`
  - `src/main.tsx`
  - `src/App.tsx`
  - `src/router.tsx`
  - `.gitignore`（含 `dist/`、`node_modules/`、`public/data/`、`*.log`）
  - `README.md`（项目骨架版 + 快速开始 + 架构图引用）
- **依赖**：无（首任务）
- **工作量**：M
- **技术决策点**：
  - Vite `base: './'`（ARCHITECTURE §7.2）
  - **HashRouter**（`react-router-dom@^6`，避免 GH Pages 刷新 404）
  - TypeScript **strict: true**
  - Node ESM（`.mjs`）与前端 TS 共存（package.json `"type": "module"`）
  - MUI ThemeProvider + Tailwind preflight 兼容（disable preflight on MUI 元素或用 `important: true`）
- **验收**：本地 `npm run dev` 能打开占位首页；`npm run build` 产出 `dist/` 且 `dist/index.html` 可直接打开；`npm run typecheck` 0 错误。
- **风险**：MUI 与 Tailwind preflight 冲突需在 `tailwind.config.ts` 配 `corePlugins.preflight: false` 或使用 MUI `ScopedCssBaseline`。

---

#### T-P1-02 【M1】数据模型 TypeScript 类型定义
- **来源**：ARCHITECTURE §2.4 + `docs/data-model/schema/*.schema.json` 9 份
- **文件**：
  - `src/types/models.ts`（Item / Snapshot / Report / Source / Channel / SourceList / HistoryIndex / HistoryItem / ArchiveIndex / NotifyChannel / ExclusionRule / SiteConfig / DataLayout）
  - `src/types/index.ts`（re-export）
- **依赖**：T-P1-01
- **工作量**：M
- **技术决策点**：
  - **手写 vs 生成**：手写（避免 ajv-codegen 等重型工具，9 份 schema 手写更快且可读）
  - 类型用 `type` 别名 + 字段 JSDoc 注释指向 schema 路径
  - 统一时间字段为 `string`（ISO 8601 UTC），封装 `asISODate()` / `parseISO()` 工具
- **验收**：`tsc --noEmit` 通过；类型覆盖 `data-model/schema/*.schema.json` 全部 required 字段；与 prototype `mock-data.js` 字段对齐（通过 PR diff 检查）。

---

#### T-P1-03 【M1】JSON Schema 校验（ajv）+ Zod 双轨
- **来源**：ARCHITECTURE §2.2 校验选型
- **文件**：
  - `scripts/validate-schema.mjs`（CLI 入口 + 库导出）
  - `src/services/validator.ts`（前端运行时校验，可选——主要给 Actions 侧用）
  - `scripts/lib/ajv-loader.mjs`（统一加载 9 份 schema + draft-07 配置）
  - `package.json` 依赖：`ajv@^8.17.0`、`ajv-formats@^3.0.1`、`zod@^3.23.0`
- **依赖**：T-P1-02
- **工作量**：S
- **技术决策点**：
  - **ajv（产物校验）+ Zod（脚本内部类型守卫）双轨**：ajv 跑 JSON Schema（采集落盘后 fail fast）；Zod 给脚本内部用（更友好的 TS 推断）
  - ajv 严格模式 `strict: true` + `allErrors: true`
  - 校验时机：① 启动期校验 config（sources/exclusions/notify）；② 落盘前校验产物（snapshot/report/history-item 行）
- **验收**：`node scripts/validate-schema.mjs --check config/sources.json` 通过；用故意改坏的 JSON 应退出码非 0 + 打印错误路径。

---

#### T-P1-04 【M2 + M7 最小】Connector Registry + 排除引擎骨架 + RSS 接入器
- **来源**：ARCHITECTURE §10 + §11 + §3.2
- **文件**：
  - `scripts/collect/connectors/registry.mjs`（`register/get/listTypes`）
  - `scripts/collect/connectors/index.mjs`（显式注册数组）
  - `scripts/collect/connectors/feed.mjs`（`rss` / `atom` / `json_feed` 三合一，`rss-parser`）
  - `scripts/collect/connectors/local-json.mjs`（`local_json`，jsonpath）
  - `scripts/collect/connectors/local-csv.mjs`（`local_csv`，`papaparse`）
  - `scripts/collect/exclude.mjs`（三级粒度评估器 + `hitCount` 回填；**先实现 `keyword` / `domain` / `channel` 三种最小规则**）
  - `scripts/collect/normalize.mjs`（按 data-model §3 映射表归一化）
  - `scripts/collect/lib/http.mjs`（fetch + AbortController + 重试 + UA + ETag/Last-Modified）
  - `scripts/collect/lib/hash.mjs`（sha256 + base62）
  - `scripts/collect/lib/text.mjs`（NFKC / 大小写折叠 / 繁简暂用 ICU `Intl.Segmenter` 简化版 / 去 HTML `sanitize-html`）
  - `package.json` 依赖：`rss-parser@^3.13.0`、`papaparse@^5.4.1`、`sanitize-html@^2.13.0`、`cheerio@^1.0.0`、`p-limit@^6.1.0`、`re2@^1.20.0`、`safe-regex@^2.1.1`、`node:crypto`（内建）
- **依赖**：T-P1-03
- **工作量**：L
- **技术决策点**：
  - **rss-parser** vs fast-xml-parser vs 手写：选 **rss-parser**（成熟、容错强、自动判 RSS/Atom）
  - **p-limit** 并发控制（全局 6，同域串行）
  - **re2** 排除正则（防 ReDoS，ARCHITECTURE §11.5）；`safe-regex` 在加载期静态拦截
  - 排除引擎匹配时机：**归一化后、分类后、去重前**（ARCHITECTURE §11.3 硬约束）
  - 未知 `source.type` → 抛 `unknown source.type` 错误，单源隔离不阻断整体
- **验收**：
  - `node scripts/collect/connectors/registry.mjs` 列出 3 个注册 type
  - `node scripts/collect/index.mjs --only <source-id> --dry-run` 对一条 RSS 源打印归一化后的 Item[]
  - 故意在 `exclusions.json` 加一条 `keyword:"招聘"` 规则，命中条目被剔除并打印 hitCount

---

#### T-P1-05 【M0】config 资产初始化（master 分支首批配置）
- **来源**：data-model §1~§5 / `docs/data-model/examples/*.example.json`
- **文件**：
  - `config/sources.json`（**先填 5~8 个真实 RSS 源**作为 MVP：阮一峰 Atom、V2EX、少数派、Hacker News、Hugging Face Blog、OpenAI Blog、AWS What's New、酷 壳）
  - `config/site-config.json`（display / dataBaseUrl / analysis.weights / history.windowDays / quietHours / 默认主题）
  - `config/exclusions.json`（**MVP 最小规则集**：招聘/广告 关键词、某垃圾域名、停用某个 channel）
  - `config/categories.json`（8 类：tech_blog / ai / news / dev_community / podcast / newsletter / finance / other）
  - `config/keyword-rules.json`（关键词 → 分类映射，每类 ≥ 20 条）
  - `config/stopwords-zh.txt`（≥ 200 词）+ `config/stopwords-en.txt`（≥ 100 词）
  - `config/notify.json`（**MVP 占位**：仅 `enabled: false` 的一个 email 渠道示例，便于 schema 校验通过）
  - `config/local/sample-feed.json`（local_json 演示源，可选）
- **依赖**：T-P1-03（schema 已加载）
- **工作量**：M
- **技术决策点**：
  - **首批 5~8 个源优先选 RSS/Atom 标准源**（无鉴权，简化 M2/M3）
  - **categories 8 类**固定命名（与 `data-model/README §2` 对齐）
  - notify.json 先全部 `enabled: false`，仅占位（避免 P1 阶段误触发通知）
- **验收**：`ajv` 校验全部 config 通过；`node scripts/collect/index.mjs --dry-run` 至少成功跑通 1 个源。

---

#### T-P1-06 【M2 + M3 最小】采集器编排入口（HTTP + 重试 + 并发 + 单源快照）
- **来源**：ARCHITECTURE §3.7 / §6.7
- **文件**：
  - `scripts/collect/index.mjs`（编排：`loadConfig → dueSources → pool(concurrent=6) → connector.run → normalize → classify → exclude → writeSingleDayJson`）
  - `scripts/collect/write.mjs`（`writeJsonCompact` / `writeCsv` / 覆盖写）
  - `scripts/collect/classify.mjs`（关键词规则 → 分类）
  - `scripts/collect/lib/time.mjs`（Asia/Shanghai 固定时区 + 切日 + ISO UTC 输出）
  - `scripts/collect/lib/retry.mjs`（指数退避 1s/3s + retryable 判定）
- **依赖**：T-P1-04、T-P1-05
- **工作量**：L
- **技术决策点**：
  - **单源快照**（P1 简化）：**不**实现事件流 NDJSON + 折叠，先做最简的「读-合并-写」快照（ARCHITECTURE §4.6 v1.0 逻辑），**待 T-P2-XX 实现双写后再升级**——避免 P1 阶段过度设计
  - **allSettled 语义**：单源失败不阻断整体（ARCHITECTURE §3.7）
  - **同域串行**：用 `Map<host, p-limit(1)>` 包裹全局并发
  - **超时**：单请求 15s（AbortController）
- **验收**：
  - 本地 `node scripts/collect/index.mjs --dry-run --only <source-id>` 跑通 1 个 RSS 源
  - 本地 `node scripts/collect/index.mjs` 跑通全部 enabled 源，产出 `today/snapshot-YYYY-MM-DD.json`（P1 暂存到 `./tmp/`，**不进 deploy 分支**）
  - 故意把一个源 URL 改成 404：脚本退出码非 0 但其他源继续，`lastStatus=error` 写入源
  - `lastFetchAt/lastStatus/lastError/etag/lastModified` 正确回写

---

#### T-P1-07 【M7 补全】排除规则三类 + 命中记录 + `--explain` 调试
- **来源**：ARCHITECTURE §11.2~§11.6
- **文件**：
  - `scripts/collect/exclude.mjs`（**补全 `title_regex` / `category` / `domain` 通配 `*` 支持**）
  - `scripts/collect/exclude.mjs` 导出 `explain(itemId)` 函数
  - `scripts/collect/lib/stats.mjs`（写 `stats/exclusions-<ts>.json`）
  - 单元测试：`scripts/collect/__tests__/exclude.test.mjs`（vitest）
  - `package.json` 脚本：`"test": "vitest run"`
- **依赖**：T-P1-04
- **工作量**：M
- **技术决策点**：
  - 测试框架 **Vitest**（与 Vite 同源、ESM 原生、TS 一等公民）
  - 测试用例覆盖：① 关键词命中；② 域名通配符；③ 标题正则（用 re2）；④ 分类排除；⑤ 整源停用；⑥ `hitCount` 回填；⑦ ReDoS 危险正则被拦截
- **验收**：`npm test` 全部通过；`node scripts/collect/exclude.mjs --explain <itemId>` 打印被哪条规则命中哪个字段。

---

#### T-P1-08 【M0 验证】本地端到端：单源采集 → 快照 → 前端 mock 显示
- **来源**：prototype/page1 + prototype/tools/smoke-test.mjs
- **文件**：
  - `src/pages/Page1HotStream.tsx`（**MVP 占位**：用构建期内联 `today/snapshot-*.json`，**仅在 P3 完整实现**）
  - `scripts/collect/dev-bridge.mjs`（开发服务器代理：把 `today/snapshot-*.json` 暴露给 `npm run dev` 通过 `/data/*.json` 路径）
  - `vite.config.ts` 增量：dev server proxy + 静态资源路径
- **依赖**：T-P1-06
- **工作量**：M
- **技术决策点**：
  - **P1 阶段前端不读取真实网络**，只走构建期内联 + dev proxy 验证数据契约
  - dev bridge 把采集产物软链接到 `public/data/today/`，Vite dev server 自动暴露
- **验收**：
  - `npm run collect:once`（本地跑一次采集脚本）→ `npm run dev` → 浏览器访问 `http://localhost:5173/#/` 看到至少 1 个源的若干条目
  - 字段与 `data-model/examples/snapshot.example.json` 严格对齐（用 smoke-test 断言）
- **风险**：dev bridge 与构建期内联兜底**逻辑容易混**，需要明确两条路径——dev 用 bridge，prod 用构建期内联 + 运行时 fetch

---

#### T-P1-09 【M1 + M3 验证】smoke-test v2：脚本产物契约断言
- **来源**：prototype/tools/smoke-test.mjs
- **文件**：
  - `scripts/smoke/snapshot-contract.mjs`（跑一次采集 → 校验产物的 schema / 字段类型 / `Σ categoryStats == totalItems` 等恒等关系）
  - `scripts/smoke/run.sh`（一键：`collect → validate → contract`）
  - `package.json` 脚本：`"smoke": "bash scripts/smoke/run.sh"`
- **依赖**：T-P1-06
- **工作量**：S
- **技术决策点**：沿用 prototype smoke-test 的恒等关系断言（PRD §6.3 口径），移植到采集产物侧
- **验收**：`npm run smoke` 全绿；故意篡改 `snapshot.json` 的 `totalItems`，smoke 应失败并指出违反的不变量。

---

### P2 数据管线打通（里程碑：本地跑通 采集 → 去重 → 归档 → 通知）

---

#### T-P2-01 【M4】URL 标准化 + dedupKey 计算
- **来源**：ARCHITECTURE §4.1~§4.2
- **文件**：
  - `scripts/collect/lib/url-norm.mjs`（R1~R12 规则实现，开关化 R11/R12 默认关）
  - `scripts/collect/lib/dedup-key.mjs`（退化链：URL → guid(URL) → "guid:" + sourceId + ":" + guid → "title:" + title 指纹）
  - 单元测试：`scripts/collect/__tests__/url-norm.test.mjs`（覆盖 R1~R12 + 退化链 4 种）
- **依赖**：T-P1-06
- **工作量**：M
- **技术决策点**：
  - **R2 黑名单**严格按 ARCHITECTURE §4.1 表（含 utm_*、fbclid、gclid、igshid、mc_cid、mc_eid、yclid 等）
  - `titleFingerprint` 走 NFKC + 大小写折叠 + 去标点（用 T-P1-04 的 text.mjs 复用）
  - `id = "it_" + sha256(dedupKey).slice(0, 12)`（ARCHITECTURE §4.6）
- **验收**：12 条规则 + 退化链单元测试 100% 通过；同一 URL 不同 query 参数归一为同 key。

---

#### T-P2-02 【M4】L1~L5 去重引擎 + SimHash64/Dice
- **来源**：ARCHITECTURE §4.3~§4.5
- **文件**：
  - `scripts/collect/dedup.mjs`（`L1 dedupKey 分组 → L2 标题完全一致 → L3 SimHash LSH 分桶 + Dice 精算 → L4 跨源 sourceCount 标记 → L5 主题重合（关键词 Jaccard，不合并只标记）`）
  - `scripts/collect/lib/simhash.mjs`（64-bit SimHash + 4 band × 16-bit LSH 分桶）
  - `scripts/collect/lib/dice.mjs`（字符二元组 Dice）
  - 单元测试：`scripts/collect/__tests__/dedup.test.mjs`（覆盖 L1/L2/L3/L4 + 长度比守卫 + 阈值可配）
- **依赖**：T-P2-01
- **工作量**：L
- **技术决策点**：
  - **SimHash64 + 4 band × 16 bit LSH**（ARCHITECTURE §4.4 性能实测：5000 条候选对通常数百~数千）
  - **字符二元组 Dice**（主算法）+ Levenshtein **不**使用
  - 长度比 < 0.5 直接跳过（ARCHITECTURE §4.4 守卫）
  - 阈值默认 **0.9**（G4 决策，可配）
  - `compare` 顺序：updatedAt → 完整度 → channelWeight → id 字典序（ARCHITECTURE §4.5）
- **验收**：5000 条 mock 输入秒级完成；同 URL 多源归并为 1 个主条目 + sources[] 展开 + `sourceCount` 正确；故意构造 2 条标题 Dice=0.95 的条目被合并。

---

#### T-P2-03 【M5】事件流 NDJSON + 投影快照双写（升级 ingestRound）
- **来源**：ARCHITECTURE §6.7
- **文件**：
  - `scripts/collect/append-events.mjs`（`appendNdjson` + `foldByLastWrite(id)`）
  - `scripts/collect/project-snapshot.mjs`（折叠事件流 → 去重归并 → 写 JSON + CSV）
  - `scripts/collect/index.mjs` 升级：用 `ingestRound`（ARCHITECTURE §6.7 伪代码）取代 T-P1-06 的简化版
- **依赖**：T-P2-02
- **工作量**：M
- **技术决策点**：
  - 事件流行 schema：**`{op:"upsert", runId, fetchedAt, item:{...}}`**（ARCHITECTURE §6.7）
  - **O(1) 追加**：`appendFile`（不读老行）；折叠按 `id` 取最后一行
  - 投影快照**覆盖写**（一次性 `JSON.stringify` + `writeFileSync`，不用流）
  - `latest.json` 指针：`{date, generatedAt, snapshotPath, reportPath, eventPath, commit}`
- **验收**：
  - 跑 3 次采集 → `events-<date>.ndjson` 行数 = 3 次新增/更新条目之和（真·追加）
  - 折叠后 `snapshot-<date>.json` 的 `items[]` 长度 ≤ 事件流行数（去重生效）
  - `latest.json` 的 `commit` 字段先填 `"local"`（P1 本地版）

---

#### T-P2-04 【M5】次日转换：月度 NDJSON + history-index + 按天快照封口
- **来源**：ARCHITECTURE §6.8
- **文件**：
  - `scripts/collect/history.mjs`（`rolloverIfNewDay(today)`：封口昨天事件流 → 追加月度 NDJSON → move 快照/报告 → 追加 history-index 天级聚合）
  - `scripts/collect/lib/history-row.mjs`（**精简行**构造：不含 summary/sources，B-8 决策，约 300B/行）
  - 集成测试：`scripts/collect/__tests__/history-rollover.test.mjs`（用 fake clock 跨天验证）
- **依赖**：T-P2-03
- **工作量**：L
- **技术决策点**：
  - **月度 NDJSON**（`history/YYYY/MM/items.ndjson`）—— 不拆 30 个按天文件（ARCHITECTURE §6.8）
  - **history-index.json**（1 次请求够趋势用）：`{schemaVersion, updatedAt, days:[{date, totalItems, activeChannels, categoryStats, topKeywords, sourceOk, sourceFailed}]}`
  - 月末封口：月末那天触发 `sealed=true`，下月 1 号新建 NDJSON
  - 保留事件流 N=7 天后清理（可配，默认 7）
- **验收**：
  - 用 fake clock 模拟跨天 → 月度 NDJSON 包含昨天的精简行；`history-index.json` 新增昨天 day 聚合；按天快照/报告 move 到 `history/YYYY/MM/`
  - 故意构造 2 个连续天 → history-index.json 有 2 行 days[]
  - 单月体积估算 ≤ 2.3MB 裸 / 0.68MB gzip（ARCHITECTURE §13.4 量级）

---

#### T-P2-05 【M5】分析层：热点公式 + 关键词提取 + 报告生成
- **来源**：ARCHITECTURE §5.1~§5.5
- **文件**：
  - `scripts/collect/analyze.mjs`（`hotScore` + `categoryStats` + `channelActivity` + `crossSource`）
  - `scripts/collect/lib/keyword.mjs`（`Intl.Segmenter('zh', {granularity:'word'})` + 停用词过滤 + TopN）
  - `scripts/collect/lib/hot-score.mjs`（log+max 归一化 + 5 权重 + 指数衰减 6h 半衰期）
  - `scripts/collect/report.mjs`（`buildReport(snapshot)` → `report-<date>.json`）
  - 单元测试：`scripts/collect/__tests__/hot-score.test.mjs`（权重和=1、log+max ∈ [0,1]、decay 单调递减）
- **依赖**：T-P2-03
- **工作量**：M
- **技术决策点**：
  - 权重默认 `[0.40, 0.25, 0.20, 0.10, 0.05]`（Z_source / decay / Z_freq / Z_channel / Z_kw）
  - **半衰期 6 小时**（`analysis.halfLifeHours=6`）
  - 中文分词 **MVP 用 `Intl.Segmenter`**（G3 决策）；P1 精度不足换 `nodejieba`
  - 报告**在 Actions 期生成**（ARCHITECTURE §5.5）；落盘路径 `today/report-<date>.json`
  - 报告回写 `weights` 字段以**复现**
- **验收**：
  - 跑一次完整采集 → `report-<date>.json` 含 `totalItems/activeChannels/categoryStats/hotList/keywords/channelActivity/crossSource`
  - `Σ categoryStats == totalItems`、`activeChannels == channelActivity.length`（恒等断言）
  - 权重和 = 1，hotScore ∈ [0,1]

---

#### T-P2-06 【M5】年度归档 + GitHub Release + 安全删除
- **来源**：ARCHITECTURE §6.9 / §15 安全
- **文件**：
  - `scripts/collect/archive.mjs`（打包 `history/<year>/**` 为 `tar.zst` → 计算 sha256 → 准备 Release 资产）
  - `scripts/collect/lib/release.mjs`（用 `gh release create` 调 GitHub CLI 或 REST API）
  - 单元测试：`scripts/collect/__tests__/archive.test.mjs`（dry-run 列出将被删除文件清单，不真删）
- **依赖**：T-P2-04
- **工作量**：L
- **技术决策点**：
  - 打包格式 **`tar.zst`**（B9 决策）
  - **先成功后删除**：脚本必须先验 Release 资产可下载 + archive-index.json 写入完成，才进入删除
  - **dry-run 优先**：默认模式列出删除清单到 stdout，不实际执行
  - 边界日不删：删除对象 = 严格早于 `today - 365 天` 的 `history/<year>/**`
- **验收**：
  - `--dry-run` 模式列出 N 个待删除文件（用 fake history 数据），不真删
  - `--execute` 模式（需 `--yes` 二次确认）真删后，git log 可 revert
  - **本地不实际触发**（需要 GH_TOKEN；CI 侧由 archive.yml 跑）

---

#### T-P2-07 【M2】补全 4 个连接器：feishu-bitable / notion-db / generic-api / rss（拆细分）
- **来源**：ARCHITECTURE §3.2~§3.6 / §10
- **文件**：
  - `scripts/collect/connectors/feishu-bitable.mjs`（app_id/app_secret → tenant_access_token 缓存 + page_token 翻页）
  - `scripts/collect/connectors/notion-db.mjs`（Bearer + Notion-Version + start_cursor 翻页 + 属性按 type 解包）
  - `scripts/collect/connectors/generic-api.mjs`（声明式 `fieldMapping` + `pagination` 策略：none/page/offset/cursor/link_header）
  - `scripts/collect/connectors/feed.mjs` 升级：把 `rss` / `atom` / `json_feed` 拆为 3 个独立 connector（更细粒度的注册粒度；与 v1.0 兼容保留 `feed` 三合一别名）
  - `scripts/collect/connectors/index.mjs` 注册全部
  - `package.json` 依赖：无新增（都用内建 fetch + crypto）
- **依赖**：T-P1-04
- **工作量**：L
- **技术决策点**：
  - **飞书与 Notion 鉴权**：`app_id/app_secret` / `Bearer token` 通过 `auth.ref` 引用 GitHub Secrets / 本地 `.env`
  - **Notion 属性解包**：title/rich_text/date/select/multi_select 按 ARCHITECTURE §3.6 处理
  - **generic-api 分页**：声明式 `pagination.strategy`，4 种实现
- **验收**：
  - 三个真实源的 mock 调用成功（飞书 demo token、Notion demo db、通用 API jsonplaceholder）
  - 翻页：3 页数据正确合并，无重复

---

#### T-P2-08 【M11】URL 健康检查 + urlStatus 状态机
- **来源**：ARCHITECTURE §15
- **文件**：
  - `scripts/collect/url-health.mjs`（HEAD 校验 + 状态码归类 + 状态机 + 复查策略）
  - `scripts/collect/lib/url-checker.mjs`（p-limit 并发 4 + 同域串行 + 1s 间隔）
  - 集成测试：`scripts/collect/__tests__/url-health.test.mjs`
- **依赖**：T-P2-03
- **工作量**：M
- **技术决策点**：
  - **HEAD 优先 + 405/501 降级 GET Range: bytes=0-0**（ARCHITECTURE §15.1）
  - **并发 4，同域串行，间隔 1s**（礼貌）
  - **两轮防抖动**：首轮 404 不立即判 dead，记 `pendingDead`，下轮仍 404 才落 dead（ARCHITECTURE §15.2）
  - **复查频率**：dead 每日、blocked 每周、moved 不复查（跟进新地址重写 url）
  - 单轮硬上限 200 条（可配）
  - `urlStatus`/`urlCheckedAt` 回写到 `sources.example.json` schema（已含字段）
- **验收**：
  - 对 10 个 mock URL（含 200/404/410/403/301）跑校验，分类正确
  - 同一 URL 连续 2 轮 404 才标 dead（防误杀）
  - 状态转换日志可读（`stats/url-health-<ts>.json`）

---

#### T-P2-09 【M11】跨源备用 URL 优先级（前端用，但规则在数据契约层定义）
- **来源**：ARCHITECTURE §15.3
- **文件**：
  - `src/types/models.ts` 增量：`Item.alternateUrl?: string`（展示层替换，不回写 `item.url`）
  - `scripts/collect/url-health.mjs` 增量：`pickAlternate(item)` —— `sources[]` 中 `urlStatus != 'dead'`，按 `success_time DESC + weight DESC + publishedAt DESC` 排序
  - 单元测试：`src/types/__tests__/pick-alternate.test.mjs`
- **依赖**：T-P2-08
- **工作量**：S
- **技术决策点**：备用 URL **只展示层替换**（不回写 `item.url`，避免 dedupKey 漂移）
- **验收**：主 URL dead + 备用 URL ok 时，`pickAlternate` 返回备用 URL；全部 dead 时返回 null。

---

#### T-P2-10 【M2 + M3 + M4 + M5 集成】端到端管线测试（local）
- **来源**：ARCHITECTURE §6.7 / §4 / §5
- **文件**：
  - `scripts/smoke/e2e-pipeline.mjs`（mock 4~6 个源 → 完整 ingestRound → 折叠 → 去重 → 报告 → 模拟跨天 rollover）
  - `scripts/smoke/fixtures/`（mock feed XML/JSON/CSV + mock 飞书/Notion/API 响应）
  - `package.json` 脚本：`"test:e2e": "node scripts/smoke/e2e-pipeline.mjs"`
- **依赖**：T-P2-03、T-P2-04、T-P2-05
- **工作量**：M
- **技术决策点**：用本地 fixture 文件模拟外部 HTTP（不打真实网络）
- **验收**：
  - fixture 5 个源跑完，产出 snapshot + report + history-index + 月度 NDJSON
  - 跨源归并条目 `sourceCount` ≥ 2、`sources[]` 含全部来源
  - hotScore ∈ [0,1]、Σ categoryStats == totalItems

---

### P3 前端 4 页面 + 通知（里程碑：MVP 候选可演示）

---

#### T-P3-01 【M10】前端基础设施：服务层 + 数据客户端 + Hooks
- **来源**：ARCHITECTURE §6.3 / §13.2 / prototype
- **文件**：
  - `src/services/dataClient.ts`（`loadLatest()` 伪代码实现：`raw` 主 → `jsDelivr` 回退 → 构建期内联兜底；返回 `{snap, rep, fresh, stale}`）
  - `src/services/historyClient.ts`（`fetchHistoryIndex` / `fetchMonthItems` / `fetchDaySnapshot` / `fetchDayReport` / `fetchArchiveIndex`）
  - `src/services/hotScore.ts`（**前端降级**：当 report 缺位时用 snapshot 算 hotScore；同公式同权重）
  - `src/services/time.ts`（`formatRelative` / `formatAbsolute` / `Asia/Shanghai`）
  - `src/hooks/useSnapshot.ts` / `useReport.ts` / `useHistory.ts`（轻量 hooks，封装 fetch + loading + error + stale）
  - `src/hooks/useUserPrefs.ts`（localStorage：display.cardLimit / page1BatchSize / sort / theme）
  - `src/types/api.ts`（前端视图模型：ItemCardData / ChannelCardData / HotItemData / TrendDay / MonthBucket）
- **依赖**：T-P1-02
- **工作量**：L
- **技术决策点**：
  - **状态管理**：**Context + useReducer**（足够，避免 TanStack Query 引入体积）；**Zustand** 作备选
  - **数据加载策略**：默认 `cache:'no-store'`（绕浏览器缓存）+ 接受 raw CDN ≤5min TTL + 降级横幅（ARCHITECTURE §6.3.3）
  - **构建期内联兜底**：Vite plugin `viteBuildDataFallback` 把最近一次 `today/*.json` 拷贝到 `dist/data/`（P2 阶段 CI 跑 `npm run collect:once` 产出 → build → 拷贝）
  - **不使用 SWR/TanStack Query**（避免过度依赖；可 P2 升级）
- **验收**：
  - 单元测试覆盖 dataClient 三层降级（mock fetch 失败序列）
  - dev 模式下 fetch 真实 raw.githubusercontent.com（指向自己的 fork）
  - 断网时构建期内联兜底仍能渲染

---

#### T-P3-02 【M10】公共组件库（ItemCard / ChannelCard / FilterBar / Chart / EmptyState / Skeleton）
- **来源**：prototype/assets/css/components.css + assets/js/components.js
- **文件**：
  - `src/components/ItemCard.tsx`（标题 / 摘要 / 来源 / 分类 / 时间 / 链接 / NEW 徽标 / 「+N 源」展开）
  - `src/components/ChannelCard.tsx`（渠道名 / 头像 / 分类 / 首页 / 健康角标 / 条目列表）
  - `src/components/FilterBar.tsx`（多选下拉：渠道 / 分类；搜索框；时间范围）
  - `src/components/StatusBadge.tsx`（NEW / +N 源 / 失效 / 已迁移 / 可能需验证）
  - `src/components/Chart.tsx`（**Recharts 封装**：趋势折线、分类饼图、活跃度条形图；统一 token 读取）
  - `src/components/EmptyState.tsx` / `Skeleton.tsx` / `ErrorBanner.tsx` / `StaleBanner.tsx`
  - `src/components/ConfigDrawer.tsx`（页面2 抽屉：channel 选择 + cardLimit + 排序）
  - `src/components/DatePicker.tsx`（页面4 日历）
  - `src/theme/tokens.ts`（颜色 / 间距 / 字号 / 圆角 / 阴影；与 prototype/tokens.css 对齐）
  - `src/theme/index.ts`（MUI Theme + Tailwind preflight 关闭）
- **依赖**：T-P3-01
- **工作量**：L
- **技术决策点**：
  - **Recharts** vs 自绘 SVG（ARCHITECTURE §2.2 已选 Recharts；体积 ~100KB gzip，按需打包）
  - **MUI 组件**：Drawer / Tabs / Tooltip / Snackbar 等；Card 用 MUI Card + Tailwind 工具类布局
  - **图标**：`@mui/icons-material` 按需导入
- **验收**：Storybook-like 独立 `/components` 路由（开发模式），每个组件渲染通过 prototype 视觉对照

---

#### T-P3-03 【M10】页面1 聚合热榜流（Page1HotStream）
- **来源**：PRD §6.1 / prototype/page1-hot-stream.html
- **文件**：
  - `src/pages/Page1HotStream.tsx`
  - `src/pages/Page1HotStream.module.css`（**仅页面专属**少量样式，主样式用 Tailwind）
- **依赖**：T-P3-02
- **工作量**：M
- **技术决策点**：
  - **每批 20 条懒加载**（桌面）；移动端默认 10 条（PRD §6.1）
  - **排序切换**：更新时间 ⇄ 创建时间（默认综合倒序，prototype A 决策）
  - **筛选**：渠道多选（按分类分组）、分类多选、时间范围（今天 / 近 3 小时，prototype F 决策）、搜索
  - **异常态黄条**：抓取失败 → 顶部 warning；数据延迟 → 顶部 info
  - **NEW 徽标**：当天首次出现；`isNew=true` 由 ingestRound 置位
  - **「+N 源」展开**：点击展开 `sources[]`（ARCHITECTURE §4.5）
- **验收**：
  - 桌面 1280 / 平板 768 / 移动 375 三档响应式正确（无横向溢出）
  - 搜索 `Rust` 过滤生效（prototype QA 用例复用）
  - 「加载更多」点击从 20 → 40
  - 深链 `?channel=v2ex` 按渠道过滤

---

#### T-P3-04 【M10】页面2 渠道分栏看板（Page2Channels）
- **来源**：PRD §6.2 / prototype/page2-channels.html
- **文件**：
  - `src/pages/Page2Channels.tsx`
- **依赖**：T-P3-02
- **工作量**：M
- **技术决策点**：
  - **响应式栅格**：桌面 3~4 列 → 平板 2 列 → 移动 1 列（MUI Grid + Tailwind）
  - **配置抽屉**：channel 选择（按分类分组多选）+ 每卡片条数（5/10/20，默认 10）+ 卡片排序（按渠道名 / 按最近更新）
  - **localStorage 持久化**：`useUserPrefs` 写入并 reload 仍生效
  - **「恢复默认」按钮**
  - **健康状态角标**：正常 / 抓取失败 / 停用 / 无数据
- **验收**：
  - 抽屉配置 `cardLimit=5 + 取消 V2EX` 后 reload 仍生效
  - 桌面 1600/1440 → 4 列；1024 → 2 列；375 → 1 列
  - 失败渠道（mock OpenAI Blog）灰化 + 角标

---

#### T-P3-05 【M10】页面3 分析报告（Page3Report）
- **来源**：PRD §6.3 / prototype/page3-report.html
- **文件**：
  - `src/pages/Page3Report.tsx`
- **依赖**：T-P3-02
- **工作量**：M
- **技术决策点**：
  - **头部**：日期 + 生成时间 + 数据覆盖 + 「只包含当天数据」提示
  - **4 张关键数字卡**：总条数 / 活跃渠道 / 热点条数 / 涉及分类
  - **热点榜 TOP 10**：排名 + 标题 + 热度分进度条 + 来源数 + 分类
  - **分类分布饼图 + 分类分栏**：Recharts PieChart
  - **跨源重合榜**（F-063 P1）：同一主题被多源报道
  - **渠道活跃度条形图**：Recharts BarChart
  - **方法论（可折叠） + 版权 + 「查看历史趋势 →」入口**
- **验收**：
  - 数字卡与 `report.json` 字段一致
  - 饼图各分类占比之和 = 100%
  - 「查看历史趋势」跳转 `/#/history`

---

#### T-P3-06 【M10】页面4 历史趋势与回看（Page4History）
- **来源**：PRD §6.4 / ARCHITECTURE §13 / prototype/page4-history.html
- **文件**：
  - `src/pages/Page4History.tsx`
- **依赖**：T-P3-02
- **工作量**：L
- **技术决策点**：
  - **趋势区**（**1 次请求**）：`history-index.json` → days[] → 总条数 / 活跃渠道 / 分类占比走势 / 窗口（90/180/365）
  - **月度明细下钻**：点击月份 → 懒加载 `history/YYYY/MM/items.ndjson`（**流式逐行** + loading 态）
  - **日历回看**：选某天 → 读 `history/YYYY/MM/snapshot-<date>.json` + `report-<date>.json`
  - **归档区**：读 `archive-index.json` → 只读元数据 + 跳 GitHub Release 下载
  - **回看三态**：有数据 / 无数据 / 已归档（>1 年）
  - **移动端默认只画 1 张趋势图**（PRD §6.4）
- **验收**：
  - 趋势图切换指标（总条数 / 活跃渠道）正确
  - 90/180/365 窗口切换数据点正确
  - 月度下钻触发真实 fetch（不是 mock）
  - 选中「2025-08-15」→ 跳 GitHub Release 下载链接

---

#### T-P3-07 【M6】通知模块：适配器 + Notify Registry + 模板 + 节流
- **来源**：ARCHITECTURE §12
- **文件**：
  - `scripts/notify/index.mjs`（编排：`buildDailyDigest` / `buildRealtime` / `dispatch`）
  - `scripts/notify/channels/email.mjs`（`nodemailer` SMTP）
  - `scripts/notify/channels/feishu.mjs`（webhook + 应用消息 2 种）
  - `scripts/notify/channels/dingtalk.mjs`（webhook + HMAC 加签）
  - `scripts/notify/channels/wecom.mjs`（webhook + 应用消息 2 种）
  - `scripts/notify/template.mjs`（日报 / 实时 Markdown 模板 + 渠道转 text/markdown/HTML）
  - `scripts/notify/throttle.mjs`（条目级 + 事件级去重 + 限频 + 每日上限 + 静默时段）
  - `scripts/notify/lib/idempotency.mjs`（`realtime:<itemId>` / `daily:<date>` 幂等键）
  - 单元测试：`scripts/notify/__tests__/*.test.mjs`
  - `package.json` 依赖：`nodemailer@^6.9.0`
- **依赖**：T-P2-05
- **工作量**：L
- **技术决策点**：
  - **加签算法**钉钉 vs 飞书**分开写**（ARCHITECTURE §12.2 警示：形似但不同）
  - **静默时段**默认 23:00–07:00（`notify.json` 可配）
  - **每日上限**默认 10（realtime.maxPerDay）
  - **限频**：同类实时最小间隔 10 分钟合并
  - **不阻断主流程**：采集完成后独立步骤；失败写 `stats/notify-*.json`；workflow 不标红（除非全部失败）
  - **密钥**：只存 `refs.*` 引用名；运行时 `process.env[ref]` 读
- **验收**：
  - 4 渠道 mock 发送单元测试通过（不真发，用 fetch mock / SMTP test server）
  - 加签算法各渠道独立测试（钉钉 vs 飞书不互串）
  - 静默时段内实时合并为一条；超每日上限丢弃并记日志

---

#### T-P3-08 【M6 + M10】通知配置 UI（页面1 侧栏小工具：测试发送 + 状态展示）
- **来源**：PRD §6.5 / F-105
- **文件**：
  - `src/components/NotifyStatusPanel.tsx`（在页面1 底部折叠面板：上次发送时间 / 成功/失败计数 / 启用渠道数）
  - `src/pages/PageAbout.tsx`（关于页：列出通知启用步骤链接到 `docs/NOTIFY.md`）
- **依赖**：T-P3-07
- **工作量**：S
- **技术决策点**：前端**只展示状态 + 链接到文档**，**不能**直接触发发送（密钥不在前端；ARCHITECTURE §12 硬约束）
- **验收**：状态面板读 `stats/notify-*.json`（构建期内联 + 运行时 fetch）；无法点击触发发送。

---

### P4 Actions + 部署 + 文档（里程碑：可发布）

---

#### T-P4-01 【M8 + M9】6 个 workflow 编写（collect / notify / archive / deploy-gh-pages / deploy-cf-pages / keepalive）
- **来源**：ARCHITECTURE §6.1 / §6.1.1 / §7.5 / §7.6
- **文件**：
  - `.github/workflows/collect.yml`（cron `7,37 * * * *` + workflow_dispatch；提交带 `[skip ci]`；当天 amend / 跨天新建）
  - `.github/workflows/notify.yml`（cron `3 0 * * *` ≈ 08:03 Asia/Shanghai + workflow_dispatch）
  - `.github/workflows/archive.yml`（cron `23 0 1 1 *` = 每年 1/1 + workflow_dispatch）
  - `.github/workflows/deploy-gh-pages.yml`（**`push` 默认注释** + workflow_dispatch）
  - `.github/workflows/deploy-cf-pages.yml`（**`push` 默认注释** + workflow_dispatch；`cloudflare/wrangler-action@v3`，**生产固定到 commit SHA**）
  - `.github/workflows/keepalive.yml`（每周一次 trivial commit）
- **依赖**：T-P2-03、T-P2-04、T-P2-06、T-P3-07
- **工作量**：M
- **技术决策点**：
  - **触发段「先注释掉不启用」合法写法**（ARCHITECTURE §6.1.1 方案 B：注释 `push:` + 保留 `workflow_dispatch` + job `if` 守卫）
  - **`wrangler-action@v3` 固定到 commit SHA**（ARCHITECTURE §7.6.3 安全红线）
  - **绝不使用 `cloudflare/pages-action`**（CVE-2026-11325 + 2026-09-18 删除）
  - **`[skip ci]`** 在 collect.yml 提交信息末尾
  - **`permissions`** 最小化：`contents: read` + `deployments: write`（CF job）
  - **`secrets` 显式列出**：`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`（CF job）；notify job 用 `SMTP_PASSWORD` / `FEISHU_WEBHOOK` / 等
- **验收**：
  - 6 个 workflow 文件 YAML lint 通过
  - **手动触发**每个 workflow 一次成功（Actions 页 Run workflow）
  - deploy-cf-pages.yml 实际产出 CF Pages URL 可访问
  - collect.yml 推送 `deploy` 分支带 `[skip ci]`

---

#### T-P4-02 【M8】collect.yml 详细步骤：checkout 双分支 + secrets 注入 + 步骤串联
- **来源**：ARCHITECTURE §6.6~§6.8 / §12
- **文件**：
  - `.github/workflows/collect.yml`（**详细步骤**：actions/checkout@v4 with `fetch-depth:0` + `ref:master` + 后续 `git checkout deploy`；setup-node@v4 Node 20 + npm cache；npm ci；运行 `node scripts/collect/index.mjs`；可选 notify；提交 `deploy` 分支带 `[skip ci]` + GITHUB_TOKEN push）
  - `.github/workflows/notify.yml`（**详细步骤**：checkout deploy → setup-node → `node scripts/notify/index.mjs --mode dailyReport` → 提交 `stats/notify-*.json`）
- **依赖**：T-P4-01
- **工作量**：M
- **技术决策点**：
  - **双分支 checkout**：先 master（拿代码/配置），再 `git fetch origin deploy && git checkout deploy`（写数据）
  - **提交 `deploy` 分支**：用 `adventagey/github-actions-push-to-another-repo` 或 `git push` + GITHUB_TOKEN（更稳的是 `git push`）
  - **commit author**：固定 `radar-bot <radar@users.noreply.github.com>`
  - **`[skip ci]`**：commit message 末尾
  - **当天 amend**：先 `git log -1 --format=%s` 检查今天的提交，`--amend`；否则新建
  - **force-with-lease**：`git push --force-with-lease origin deploy`（保护）
- **验收**：本地 `act`（可选）+ 实际跑一次 Actions → deploy 分支有数据提交 + `[skip ci]` 标记 + workflow 不死循环

---

#### T-P4-03 【M9】CF Pages 部署 workflow：wrangler-action@v3 详细配置
- **来源**：ARCHITECTURE §7.6.5
- **文件**：
  - `.github/workflows/deploy-cf-pages.yml`（**完整骨架**：checkout → setup-node Node 20 + npm cache → npm ci → npm run build → `cloudflare/wrangler-action@<commit-sha>` with `apiToken/accountId/command/gitHubToken`）
  - `wrangler.toml`（**可选**，若不用 CLI 配置则靠 workflow 参数）
- **依赖**：T-P4-01
- **工作量**：S
- **技术决策点**：
  - **`command: pages deploy dist --project-name=rss-radar`**（官方用法）
  - **`apiToken` 仅 Account›Cloudflare Pages›Edit**（最小权限）
  - **`gitHubToken: ${{ secrets.GITHUB_TOKEN }}`**（可选：在 GH 生成 Deployment 记录）
- **验收**：实际跑一次 → CF Pages URL 可访问（用户首次需在 CF 控制台创建 Direct Upload 项目，见 §五 外部依赖）

---

#### T-P4-04 【M12】README.md 重写为「仓库介绍 + 快速开始 + 架构图」
- **来源**：README.md 已存在（v1.2），本任务**重写为面向工程师/用户的安装版**
- **文件**：
  - `README.md`（重写）：
    - 项目一句话 + 截图（页面1/2/3/4 4 张）
    - **5 分钟快速开始**（克隆 → `npm ci` → `npm run collect:once` → `npm run dev`）
    - 架构图（引用 ARCHITECTURE §2.3 + 引用 data-model/README §0）
    - **目录结构速览**（引用 ARCHITECTURE §8.1）
    - **6 个 workflow 一句话职责**
    - **「如何接入新源」「如何启用通知」「如何部署」** 三个超链接（指向 docs/SOURCES.md / NOTIFY.md / DEPLOYMENT.md）
    - **贡献指南**链接（docs/CONTRIBUTING.md）
    - **数据契约**链接（docs/data-model/README.md）
    - **已知限制 + License**
- **依赖**：T-P1-01（项目已能跑）
- **工作量**：S
- **技术决策点**：截图从 `docs/qa/screenshots/` 复制或重新生成；README 不写"待拍板事项"（那是 PRD/ARCHITECTURE 的事）
- **验收**：在 GitHub 上看 README 渲染正常，所有链接有效

---

#### T-P4-05 【M12】docs/USAGE.md（完整使用流程）
- **来源**：老登重点要求
- **文件**：
  - `docs/USAGE.md`（**完整使用流程**）：
    - 第一次配置（克隆 → npm ci → 修改 config/sources.json → 本地 `npm run collect:once` 验证）
    - 日常使用（启停 / 修改源 / 看本地报告）
    - 部署到 GitHub Pages / Cloudflare Pages（链接 DEPLOYMENT.md）
    - 启用通知（链接 NOTIFY.md）
    - 添加新源（链接 SOURCES.md）
    - 排障（看 `stats/*.json`、看 Actions 日志、跑 `npm run smoke`）
- **依赖**：T-P4-04
- **工作量**：M
- **技术决策点**：**与代码同步出**，不要最后才补
- **验收**：一个新用户照着文档能跑通

---

#### T-P4-06 【M12】docs/SOURCES.md（多源接入指南）
- **来源**：ARCHITECTURE §3 / §10 / 老登重点要求
- **文件**：
  - `docs/SOURCES.md`：
    - **7 步接入流程**（选 type → 写 connector（如新类型）→ 注册一行 → 加 schema 枚举（可选）→ 加映射文档（可选）→ 配 `sources.json` 一条 → 验证）
    - **7 种连接器配置示例**：rss / atom / json_feed / local_json / local_csv / feishu_bitable / notion_db / api（每种一个完整 JSON 示例）
    - **字段映射详解**（引用 data-model §3）
    - **鉴权配置**（`auth.ref` 引用 GitHub Secrets）
    - **新增一个「来源类型」的标准步骤**（ARCHITECTURE §10.2）
    - **新增一个「具体源」的零代码步骤**（ARCHITECTURE §10.3）
    - **常见源模板**：阮一峰、V2EX、少数派、HN、HuggingFace 等
- **依赖**：T-P2-07
- **工作量**：M
- **技术决策点**：每个连接器示例都用真实可访问的源（阮一峰 Atom、V2EX RSS、Hacker News RSS 等）
- **验收**：照文档添加一个新 RSS 源 ≤ 5 分钟

---

#### T-P4-07 【M12】docs/NOTIFY.md（4 渠道配置指南）
- **来源**：ARCHITECTURE §12 / 老登重点要求
- **文件**：
  - `docs/NOTIFY.md`：
    - **4 渠道启用流程**：邮箱（QQ 邮箱 / Gmail / 企业邮箱 SMTP）/ 飞书（群机器人 / 应用消息）/ 钉钉（群机器人 + 加签）/ 企业微信（群机器人 / 应用消息）
    - 每渠道的：**获取 Webhook / Token → 存 GitHub Secrets → 在 `config/notify.json` 加 channel → 测试发送 → 启用**
    - **加签算法详解**（钉钉 vs 飞书**分开**）
    - **两种推送形态**配置（日报 / 实时）
    - **静默时段 / 每日上限 / 限频**配置
    - **排障**：看 `stats/notify-*.json`
- **依赖**：T-P3-07
- **工作量**：M
- **技术决策点**：每渠道的"获取 Webhook"步骤附官方文档截图或文字描述
- **验收**：照文档能完成一个渠道的端到端启用（不真发，只验配置）

---

#### T-P4-08 【M12】docs/DEPLOYMENT.md（部署指南：本地 / GitHub Pages / Cloudflare Pages 三套）
- **来源**：ARCHITECTURE §7 / 老登重点要求
- **文件**：
  - `docs/DEPLOYMENT.md`：
    - **本地**：`npm run dev` / `npm run build` / `npm run preview`
    - **GitHub Pages**：
      - 仓库设置 Pages（Source: GitHub Actions）
      - 触发 `deploy-gh-pages.yml` 手动 workflow
      - 启用自动（取消 `push:` 注释 + 删除 `if` 守卫）
    - **Cloudflare Pages**（Direct Upload）：
      - CF 控制台一次性创建项目（Workers & Pages → Create → Pages → Upload assets → 输入项目名）
      - 生成 API Token（Account›Cloudflare Pages›Edit）→ 存 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
      - 触发 `deploy-cf-pages.yml` 手动 workflow
      - 启用自动（同上）
      - **不可逆警告**：Direct Upload 项目不能切回 Git 集成
    - **自定义域名**
    - **缓存策略**：`index.html` no-cache + 带 hash 资源 immutable + 数据 raw 5min TTL
- **依赖**：T-P4-03
- **工作量**：M
- **技术决策点**：**双流程分开**的语义重点说明（ARCHITECTURE §7.6.5 核心要求）
- **验收**：照文档能在新仓库上完成三套部署的最小验证

---

#### T-P4-09 【M12】docs/VERIFICATION.md + docs/CONTRIBUTING.md
- **来源**：老登重点要求
- **文件**：
  - `docs/VERIFICATION.md`：
    - **冒烟测试**（`npm run smoke`）：采集产物契约断言
    - **端到端测试**（`npm run test:e2e`）：mock fixture 全管线
    - **部署验证**：① Actions 触发 → ② CF Pages URL 可访问 → ③ 真实 fetch raw 数据 → ④ 四页面渲染正确
    - **回归测试**：prototype smoke-test 97 条断言（移植）
    - **QA checklist**：每页关键元素 / 响应式 / 数据契约恒等
  - `docs/CONTRIBUTING.md`：
    - **开发流程**：分支 → PR → CI → Review → 合并
    - **新增 RSS 源**：链接 SOURCES.md
    - **新增通知渠道**：链接 NOTIFY.md（4 渠道已支持，新增需扩 connector）
    - **代码规范**（ESLint / Prettier / TS strict）
    - **测试规范**（Vitest）
    - **Commit 规范**（Conventional Commits）
- **依赖**：T-P4-06、T-P4-07、T-P4-08
- **工作量**：M
- **技术决策点**：VERIFICATION.md 必须可复现（命令可复制粘贴）
- **验收**：新工程师照 VERIFICATION.md 能跑通全套验证；照 CONTRIBUTING.md 能提交第一个 PR

---

### P5 集成验证 + 回归（里程碑：发布就绪）

---

#### T-P5-01 【M13】Actions 真实触发 → CF Pages 部署验证
- **来源**：ARCHITECTURE §6 / §7.6
- **文件**：无需新增；纯验证
- **依赖**：T-P4-01、T-P4-02、T-P4-03
- **工作量**：M
- **技术决策点**：
  - 真实触发一次 `collect.yml` → 看 `deploy` 分支有数据 + `[skip ci]`
  - 真实触发一次 `deploy-cf-pages.yml` → CF Pages URL 可访问 + 四页面正确渲染 + 真实 fetch raw.githubusercontent.com 拉到当天数据
- **验收**：
  - `<proj>.pages.dev` 域名可访问
  - 4 页面均能打开，数据正确
  - raw.githubusercontent.com 拉到当天数据 ≤ 5 分钟 TTL（行为正确）
  - Actions workflow 不标红

---

#### T-P5-02 【M13】回归测试：prototype smoke-test 97 条断言移植
- **来源**：`prototype/tools/smoke-test.mjs` + `docs/qa/prototype-qa-report.md`
- **文件**：
  - `tests/regression/snapshot-harness.mjs`（headless Chrome 驱动真实部署的页面）
  - `tests/regression/run.sh`（一键：build → deploy → smoke）
  - CI 集成：在 `deploy-cf-pages.yml` 末尾 + `notify.yml` 触发后跑一次（fail → workflow 标红）
- **依赖**：T-P5-01
- **工作量**：L
- **技术决策点**：
  - **沿用 prototype 的 97 条断言**：跨页口径恒等 + 特殊数据齐备 + 字段类型 + 元素存在 + 响应式
  - **真实环境跑**（不上 file://）：指向 CF Pages URL 或 localhost preview server
  - **CI 集成**：可作为可选 check（不阻塞部署）
- **验收**：97 条断言在真实部署的 CF Pages URL 上全部通过；故意篡改一个字段能让回归失败

---

#### T-P5-03 【M13】端到端冒烟：本地 fetch → 去重 → 归档 → 前端展示 + 部署验证报告
- **来源**：MVP 验收标准（README §六）
- **文件**：
  - `tests/e2e/full-pipeline.mjs`（本地：mock 6 个源 → 完整 ingestRound → 折叠 → 去重 → 报告 → 模拟跨天 rollover → 模拟归档 → 读 history-index）
  - `docs/qa/release-checklist.md`（MVP 验收 5 条对照 README §六：① ≥10 渠道；② Actions 每 30 分钟采集 + 次日转历史；③ 四页面 + 趋势图；④ GH Pages 手动 + CF Pages 直传；⑤ 页面3 分类分布 + 通知日报）
- **依赖**：T-P5-01、T-P5-02
- **工作量**：M
- **技术决策点**：
  - **5 条 MVP 验收标准**逐条验证（README §六）
  - **真实部署 + 真实通知 + 真实抓取**（非 mock）：用 ≥10 个真实 RSS 源跑一次
- **验收**：`tests/e2e/full-pipeline.mjs` 通过；`docs/qa/release-checklist.md` 5 条全部 ✅

---

## 三、文档清单（与代码同步出）

> 老登明确要求：文档与实现同步出，**不要最后才补**。下面列出所有**新建**文档（README.md 与 prototype README 之外的增量）。

| 文档 | 路径 | 对应任务 | 受众 | 何时出 |
|---|---|---|---|---|
| **README.md**（重写为面向用户/工程师） | `README.md` | T-P4-04 | 用户 + 工程师 | P4 早期（项目骨架完成后立刻写第一版） |
| **完整使用流程** | `docs/USAGE.md` | T-P4-05 | 终端用户 | P4 阶段 |
| **多源接入指南** | `docs/SOURCES.md` | T-P4-06 | 想加源的人 | P4 阶段（与 M2/M7 完成后即可出第一版） |
| **通知渠道配置** | `docs/NOTIFY.md` | T-P4-07 | 想开通知的人 | P4 阶段（与 M6 完成后即可出第一版） |
| **部署指南**（三套） | `docs/DEPLOYMENT.md` | T-P4-08 | 部署者 | P4 阶段（与 M9 完成后即可出第一版） |
| **验证流程** | `docs/VERIFICATION.md` | T-P4-09 | QA + 工程师 | P5 阶段（与回归测试同出） |
| **贡献指南** | `docs/CONTRIBUTING.md` | T-P4-09 | 贡献者 | P4 阶段 |
| **URL 健康检查实施细节**（补 ARCHITECTURE §15） | `docs/URL-HEALTH-IMPL.md` 🆕（建议） | T-P2-08 完成后 | 工程师 | P2 阶段 |
| **发布验收清单** | `docs/qa/release-checklist.md` | T-P5-03 | QA + 主理人 | P5 阶段 |

> **建议**：**P1 阶段就建立 README.md 第一版**（项目骨架 + 快速开始），后续每次 P 阶段完成同步更新；不要 P4 才出。

---

## 四、关键技术决策点（必须拍板）

> 以下决策点是**实现前必须确定**的；推荐已给出。**红色 ★ = MVP 阻塞**（不拍板无法开工）。

### ★ D1 状态管理：Context+useReducer vs Zustand vs TanStack Query
- **推荐**：**Context + useReducer**（足够 4 页面；不引入体积）
- **理由**：4 页面状态复杂度有限（filter / sort / drawer / currentDate），Context + useReducer 0 依赖、易测试
- **备选 1**：Zustand（~3KB）— 若 T-P3-02 阶段发现 Context 重渲染问题，迁移
- **备选 2**：TanStack Query（~13KB）— 若数据加载复杂度爆炸（多源并发 + stale 状态机）
- **风险**：过度设计 = 引入体积；过简 = 后续重构
- **拍板时机**：T-P3-01 之前

### ★ D2 数据加载策略：构建期内联兜底 + 运行时 fetch
- **推荐**：**构建期 + 运行时双轨**（ARCHITECTURE §6.3）
- **理由**：构建期保证首屏有数据 + 离线可用；运行时保证新鲜度
- **关键技术**：
  - 构建期内联：`viteBuildDataFallback` 插件，CI 在 `npm run build` 前先跑 `npm run collect:once` 产出 → 拷贝到 `dist/data/today/`
  - 运行时 fetch：默认 `cache:'no-store'`（绕浏览器缓存），接受 raw CDN ≤ 5min TTL
  - 降级：`raw` 失败 → `jsDelivr` 回退（用 commit SHA）→ 构建期内联 + StaleBanner
- **风险**：CI 跑采集 = 每次 build 多 1~2 分钟；可用缓存优化（cache: dist/data/today/）
- **拍板时机**：T-P3-01 之前

### ★ D3 RSS 解析：rss-parser vs fast-xml-parser vs 手写
- **推荐**：**rss-parser**（ARCHITECTURE §2.2 已定）
- **理由**：成熟、容错强、自动判 RSS/Atom；体积 ~50KB
- **备选**：fast-xml-parser（更快但容错差，需自己写 RSS/Atom schema）
- **拍板时机**：T-P1-04（已锁定，无需再拍）

### D4 并发控制：p-limit vs 自实现
- **推荐**：**p-limit**（~1KB，成熟）
- **理由**：ARCHITECTURE §3.7 已选；支持全局并发 + 同域串行（`Map<host, p-limit(1)>`）
- **拍板时机**：T-P1-04（已锁定）

### D5 邮件发送：nodemailer vs 直接 SMTP
- **推荐**：**nodemailer**（ARCHITECTURE §2.2 已定）
- **理由**：成熟、支持 HTML/附件/STARTTLS
- **备选**：直接 SMTP（更轻但需自己写 RFC5322）
- **拍板时机**：T-P3-07（已锁定）

### D6 测试框架：Vitest vs Jest
- **推荐**：**Vitest**（与 Vite 同源、ESM 原生、TS 一等公民）
- **理由**：配置最简、速度更快（用 esbuild）、与 Vite HMR 集成
- **备选**：Jest（生态更广但 ESM 配置繁琐）
- **拍板时机**：T-P1-07（已锁定）

### D7 中文分词：Intl.Segmenter vs nodejieba
- **推荐**：**MVP 用 Node 内建 `Intl.Segmenter`**（G3 已定）
- **理由**：零依赖、ICU 支持 CJK
- **P1 升级**：若关键词精度不足 → 换 `nodejieba`（原生依赖，CI 编译耗时 +20s）
- **拍板时机**：T-P2-05（已锁定 MVP）

### ★ D8 TypeScript：strict 全开 vs 部分严格
- **推荐**：**strict: true 全开**（noImplicitAny / strictNullChecks / strictFunctionTypes 等全开）
- **理由**：架构/数据契约复杂，TS 严格模式能在编译期捕获大部分数据漂移
- **风险**：与 ajv-formats 等老库类型兼容可能报 warning
- **拍板时机**：T-P1-01

### ★ D9 PWA：MVP 是否做
- **推荐**：**MVP 不做 PWA**（README P1）
- **理由**：4 页面是数据消费型，非"工具型应用"；PWA 主要价值是离线 + 桌面入口，离线已被构建期内联兜底覆盖
- **风险**：若用户希望离线收藏 / 后台刷新，需要补
- **拍板时机**：T-P3-01 之前

### D10 主题切换（深色模式）：MVP 是否做
- **推荐**：**MVP 浅色主题单模式**（与 prototype 一致）
- **理由**：控复杂度，先做可演示
- **P1 升级**：MUI Theme 切换 + localStorage 持久化（`useUserPrefs.theme`）
- **拍板时机**：T-P3-02

### D11 URL 健康检查的 cron 频率
- **推荐**：**dead 每日 / blocked 每周 / moved 不复查**（ARCHITECTURE §15.5 已定）
- **理由**：平衡流量与恢复概率
- **拍板时机**：T-P2-08（已锁定）

### D12 真实部署验证的 GitHub 仓库选择
- **推荐**：**先用 fork/沙箱仓库**，稳定后合并到 `rss-radar` 主仓
- **理由**：避免 CI 失败污染主仓 Actions 状态
- **拍板时机**：T-P4-01 之前

---

## 五、风险与依赖

### 5.1 项目级风险（按概率 × 影响排序）

| # | 风险 | 概率 | 影响 | 缓解 | 触发任务 |
|---|---|---|---|---|---|
| 1 | **CF Pages Direct Upload 不可逆**（用户拍板后无法切回 Git 集成） | 高 | 高 | 主理人**必须**在 T-P4-01 前确认方案 A（ARCHITECTURE §7.6.6）；先在 fork 仓库验证 | T-P4-01、T-P5-01 |
| 2 | **wrangler-action 供应链风险**（CVE-2026-11325 / 仓库 2026-09-18 删除） | 中 | 极高 | **禁用 pages-action**；**固定到 commit SHA**（ARCHITECTURE §7.6.3 硬结论） | T-P4-01、T-P4-03 |
| 3 | **GitHub Actions cron 延迟**（整点高峰 5~30 分钟） | 高 | 中 | 接受；文案诚实标注"准实时 ≤35 分钟"；避整点（`7,37` 分） | T-P4-01、T-P4-02 |
| 4 | **采集源 IP 被 RSSHub / 站点限流** | 中 | 中 | 串行同域 + UA + 指数退避；尊重 Retry-After | T-P1-04、T-P1-06 |
| 5 | **真实 RSS 源 URL 漂移**（mock 通真实不一定通） | 高 | 中 | T-P2-10 用真实 fixture + T-P5-01 实际验证；T-P2-08 URL 健康检查兜底 | T-P2-10、T-P5-01 |
| 6 | **MUI 与 Tailwind preflight 冲突** | 高 | 低 | `tailwind.config.ts` 关 preflight 或 `important: true`；已记录于 T-P1-01 | T-P1-01 |
| 7 | **去重误杀**（标题 Dice=0.9 误合并） | 中 | 中 | 阈值可配；保留原始数据可回退（B12）；T-P2-02 单元测试覆盖边界 | T-P2-02 |
| 8 | **跨天切日时区 bug**（凌晨 0 点前后归属错乱） | 中 | 高 | 固定 `Asia/Shanghai`；T-P2-04 fake clock 集成测试覆盖 | T-P2-04 |
| 9 | **前端 hotScore 降级计算结果与 Actions 不一致** | 中 | 中 | 前端 hotScore.ts 严格复用同一公式 + 同权重（来自 `site-config.json`） | T-P2-05、T-P3-01 |
| 10 | **MUI/Tailwind/Recharts 体积叠加**（gzip 后 ~150KB） | 低 | 低 | 按需导入 + tree-shaking；可接受（PRD 性能基线 500KB） | T-P3-02 |
| 11 | **文档与代码漂移** | 中 | 中 | 文档与代码同步出（P4 强制要求）；CI 加文档链接检查 | 全部 P4 任务 |
| 12 | **PWA / 主题切换 P1 升级遗漏** | 低 | 低 | README §五明确 P1 范围；不阻塞 MVP | — |

### 5.2 外部依赖（用户侧必须提供，阻塞 T-P4-03 / T-P4-01）

| # | 依赖 | 阻塞任务 | 准备步骤 | 主理人提供 |
|---|---|---|---|---|
| 1 | **GitHub 仓库** | 全部 | 仓库已存在（`rss-radar`）；权限 `Actions: write` + `Pages: write` | ✅ 已有 |
| 2 | **CLOUDFLARE_API_TOKEN** | T-P4-03、T-P5-01 | CF 控制台 → My Profile → API Tokens → Create Token → 模板 "Edit Cloudflare Pages" → 存 GitHub Secrets | ⚠️ **需要主理人提供** |
| 3 | **CLOUDFLARE_ACCOUNT_ID** | T-P4-03、T-P5-01 | CF 控制台 → Workers & Pages → 右侧栏 | ⚠️ **需要主理人提供** |
| 4 | **CF Pages 项目**（Direct Upload） | T-P4-03 | Workers & Pages → Create application → Pages → **Upload assets** → 输入项目名 `rss-radar` | ⚠️ **需要主理人在 CF 侧创建一次** |
| 5 | **GitHub Secrets: SMTP_PASSWORD** | T-P4-02（notify job） | 邮箱开启 SMTP（QQ/Gmail/企业邮箱）+ 申请授权码 | ⚠️ **MVP 不强制**（notify 可全 disabled） |
| 6 | **GitHub Secrets: FEISHU_WEBHOOK / SIGN_SECRET / DINGTALK_WEBHOOK / WECOM_WEBHOOK** | T-P4-02 | 各平台建群机器人 + 复制 Webhook | ⚠️ **MVP 不强制**（notify 可全 disabled） |
| 7 | **真实 RSS 源连通性** | T-P5-01 真实验证 | 至少 5~8 个源可访问（已在 `config/sources.json` 中列出，需用户/工程师在真实网络环境验证） | ⚠️ **T-P5-01 前确认** |
| 8 | **GH Pages 启用**（仅手动部署需要） | T-P5-01 | 仓库 Settings → Pages → Source: GitHub Actions（默认即可） | ✅ 默认配置 |

### 5.3 时间风险（任务延期预警）

| # | 任务 | 预估 | 风险原因 | 缓解 |
|---|---|---|---|---|
| 1 | T-P1-04 Connector Registry + 3 connector + 排除引擎骨架 | L | rss-parser 配置/版本兼容；re2 原生模块编译可能 CI 慢 | T-P1-01 先验证 Node 20 + re2 安装；备选用 safe-regex 兜底 |
| 2 | T-P2-02 SimHash + Dice + L1~L5 去重 | L | 中文标题归一化边界；LSH 分桶参数调优 | 复用 Intl.Segmenter 简化归一化；阈值可配 |
| 3 | T-P2-06 年度归档 + Release | L | 涉及 gh CLI / REST API 鉴权 + tar.zst 打包 + 安全删除 | dry-run 优先；本地不真跑；CI 跑 |
| 4 | T-P2-08 URL 健康检查 | M | HEAD 校验的反爬/限流；两轮防抖动的状态机边界 | 全并发 4 + 同域串行；首轮不立即判 dead |
| 5 | T-P3-06 页面4 历史趋势 + 回看 | L | 多请求编排（趋势 + 下钻 + 日历）+ 归档区分支 | 先用 mock history-index 跑通；真实数据接入留 P5 |
| 6 | T-P4-01 6 个 workflow | M | YAML 触发段写法易踩坑（§6.1.1）；wrangler-action SHA 锁定需查 commit | 直接用 ARCHITECTURE §7.6.5 骨架；commit SHA 在 T-P4-01 当天查官方 repo 最新稳定 SHA |
| 7 | T-P5-01 真实 CF Pages 部署验证 | M | CF Pages 项目创建需主理人操作；DNS 解析需时 | 提前请主理人准备（§5.2 第 4 项）；准备降级：先 GH Pages 验证 |

---

## 六、阶段验收标准

### P1 验收（本地可跑通 1 个 RSS 源）
- ✅ 9 个 schema 校验脚本 + config 资产通过
- ✅ 1 个真实 RSS 源（阮一峰 Atom）能本地采集 → 归一化 → 排除 → 写入 `today/snapshot-*.json`
- ✅ Vitest 单测全绿（含排除 + URL 标准化）
- ✅ `npm run dev` 能在前端看到 mock 内联数据

### P2 验收（本地全管线打通）
- ✅ ≥5 个真实源完整 ingestRound（双写 + 折叠 + 去重）
- ✅ 模拟跨天 rollover → 月度 NDJSON + history-index 正确
- ✅ 报告 hotScore + 关键词 + 分类分布正确
- ✅ 端到端 e2e 脚本全绿
- ✅ URL 健康检查在 fixture 上验证状态机正确

### P3 验收（MVP 候选：4 页面 + 通知）
- ✅ 4 页面响应式正确（375/768/1024/1280 四档无横向溢出）
- ✅ 4 页面数据真实从 raw.githubusercontent.com fetch（指向 fork 仓库）
- ✅ 通知 4 渠道 mock 发送通过；加签算法钉钉/飞书分开测试
- ✅ 深链 / 抽屉 / localStorage / 排序 / 搜索 / 加载更多 等交互全过
- ✅ README/USAGE/SOURCES/NOTIFY/DEPLOYMENT 文档第一版出

### P4 验收（可发布：Actions + 部署 + 文档完整）
- ✅ 6 个 workflow 编写完成 + YAML lint + 手动触发各一次成功
- ✅ CF Pages 部署 URL 可访问（**需主理人提供 CF 项目**）
- ✅ 7 份文档完成且与代码同步
- ✅ DEPLOYMENT.md 三套部署流程完整

### P5 验收（发布就绪：回归 + 端到端）
- ✅ Actions 真实触发 → CF Pages 部署成功
- ✅ 97 条 prototype smoke-test 断言在真实部署上全过
- ✅ MVP 验收 5 条全部 ✅（README §六）

---

## 七、给主理人的执行节奏建议

| 周次 | 任务批次 | 关键里程碑 |
|---|---|---|
| **W1** | P1 全 9 任务 | **本地可跑通 1 个 RSS 源**；README 第一版 |
| **W2** | P2 前半（T-P2-01 ~ T-P2-05） | **本地全管线打通**（采集 → 去重 → 归档 → 报告） |
| **W3** | P2 后半（T-P2-06 ~ T-P2-10） | **URL 健康检查 + 端到端测试**完成 |
| **W4** | P3 全 8 任务 | **4 页面 + 通知 MVP 候选**；可演示 |
| **W5** | P4 前半（T-P4-01 ~ T-P4-04） | **6 个 workflow 编写完成**；CF Pages 手动部署验证 |
| **W6** | P4 后半（T-P4-05 ~ T-P4-09） | **7 份文档完成** |
| **W7** | P5 全 3 任务 | **回归 + 真实部署 + 验收清单** |

> **若主理人需要并行开发**（如 2 名工程师）：
> - **工程师 A**：P1（脚手架+契约）+ P2（管线）+ P4（workflow + 部署）—— **后端主线**
> - **工程师 B**：P3 前端（4 页面）+ P4 文档（与 A 同步）—— **前端 + 文档主线**
> - **同步点**：T-P1-08（前端能看数据）+ T-P2-10（前端能接真实管线）+ T-P4-09（文档定稿）

---

## 八、不在本计划范围（明确 Out of Scope）

| 项 | 说明 | 备注 |
|---|---|---|
| **微信公众号源** | PRD 已默认不内置（合规风险） | docs/SOURCES.md 提供接入说明 |
| **WebSub 实时订阅推送** | PRD 已排除（30 分钟轮询为准） | — |
| **服务端 / 用户账号 / 云端同步** | PRD 已排除（纯静态） | — |
| **LLM 打标 / 摘要** | MVP 不做（PRD G5） | V2 可选 |
| **RSSHub 公共实例内置源** | PRD 不内置（G6） | docs/SOURCES.md 说明自建 |
| **PWA / 主题切换 / 词云** | MVP 不做 | README §五 标 P1 |
| **历史回看 >1 年的站内分析** | 站内只读元数据 + 跳 Release 下载（G14 / §13.3） | — |
| **真实通知发送（P5 之前）** | T-P5-01 之前 notify 全 disabled | — |
| **多语言 i18n** | MVP 中文为主；英文站名/字段保留但不做完整翻译 | P1 升级 |

---

## 九、变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-13 | 初版（基于 PRD v1.2 + ARCHITECTURE v1.4 + prototype） |

---

*本文档由架构师高见远产出；面向工程师（执行）+ QA（验收）+ 主理人齐活林（里程碑 review）。所有任务**严格基于已确认的 PRD/ARCHITECTURE/data-model**；无设计变更；决策点已给出推荐与备选。*

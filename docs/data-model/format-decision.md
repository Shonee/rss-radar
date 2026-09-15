# RSS Radar 数据格式选型决策（JSON vs CSV，及历史归档）

| 项目 | 内容 |
|---|---|
| 文档性质 | **格式选型决策（Decision Record）** |
| 触发问题 | 老登：「针对 RSS 数据，包括**当天数据**和**历史数据**，你觉得用 json 好还是 csv 好，为什么？」 |
| 上游输入 | `docs/PRD.md`（Q3/Q8）、`docs/ARCHITECTURE.md`（§4 / §6.4 / §9.1）、`docs/data-model/README.md` |
| 结论一句话 | **当天数据：JSON 主 + CSV 辅（保持）；历史数据：NDJSON 为归档主 + `history-index.json` 滚动聚合（新增）。** |
| 语言 | 简体中文 |
| 版本 | v1.0 |

> 数据来源：本文所有体积/耗时数字均由脚本对**本项目真实字段结构**（`snapshot.example.json` 的 Item 形态）做合成压测实测，非估算。
> 压测脚本：5000 条 Item 全字段，UTF-8，gzip(level 9)。

---

## 0. TL;DR 结论卡

| 数据类别 | 推荐格式 | 主/辅 | 一句话理由 |
|---|---|---|---|
| **当天快照** | **JSON**（紧凑单行） | **主** | 浏览器运行时 `JSON.parse` 原生解析、能承载 `sources[]/category[]/components` 嵌套；这是**主格式唯一的硬需求** |
| **当天快照（外部分析）** | **CSV** | **辅** | Excel / pandas / DuckDB 零摩擦，覆盖「给人看 + 给 Excel 用」诉求 |
| **手编配置**（sources/site-config） | **JSON**（2 空格 pretty） | **主** | 需 diff、需 schema 校验；pretty 在 gzip 后只贵 4% |
| **历史归档（条目级）** | **NDJSON / JSONL** | **主** | 兼具 JSON 结构表达力 + CSV 的行式追加与 diff 友好，**历史数据最优解** |
| **历史趋势（天级聚合）** | **`history-index.json`** | **主** | 一个轻量滚动文件支撑趋势图，免读 90 个文件 |
| **本地重型离线分析** | **Parquet / DuckDB** | **可选（不进仓库）** | 列存压缩极高，但**浏览器读不了**，对静态站是死路 |
| **人肉导出/交付** | **CSV** | **辅** | 通用交付格式，任何工具都认 |

**一句话正面回应老登的两个潜在动机**：
1. 「既然要给人看和给 Excel 用，为什么不用 CSV？」——**给人看/给 Excel 用，CSV 确实赢，我们保留它当辅格式**；但**主格式的消费者不是人、也不是 Excel，是浏览器运行时**，它要直接吃嵌套结构（`sources[]` 多来源、`category[]` 多标签），这一条只有 JSON 能胜任。**所以不是「CSV 不好」，而是「CSV 只覆盖了你说的那半个场景」。**
2. 「历史数据分析要不要上 CSV / Parquet？」——**跨天分析用 CSV/Parquet 都对**，但 Parquet **浏览器读不了**（静态站前端拿不到），CSV 又**表达力不足**；**归档用 NDJSON 最平衡**（DuckDB 可直接 `read_ndjson_auto`、又是纯 JSON），要真做重型 OLAP 再**本地另存 Parquet**。

---

## 1. 立论前提：两类数据，两种用法（第一性原理）

> **格式由「数据怎么被消费」决定，不由「数据长什么样」决定。**
> 老登特意点出「当天」和「历史」两类，正是解题钥匙——**它们的使用方式根本不同，因此不必然用同一个格式。**

| 维度 | 当天数据（Snapshot / Report） | 历史数据（跨天归档） |
|---|---|---|
| **规模** | 单文件 **250~5000 条** | 按天累积，90~365 个文件 |
| **写模式** | **高频覆盖写**：每小时「读旧 → 按 `id` 合并 → 覆盖写」（`mergeWrite`） | **追加写**：每天新增一份，写后基本不改 |
| **读模式** | **浏览器运行时 fetch**（首屏 + 运行时刷新 F-073） | **离线分析**：趋势 / 同比 / 榜单回溯 |
| **消费者** | React 前端（渲染页面1/2/3） | 脚本 / DuckDB / pandas / Excel / BI |
| **结构复杂度** | **高**：`sources[]`（对象数组）、`category[]`（多标签）、`hotList[].components`（热度分量） | 高（同上），但只读、可扁平 |
| **对格式的核心诉求** | ① 原生解析 ② 承载嵌套 ③ 幂等合并 ④ CDN 传输 | ① 追加友好 ② diff 干净 ③ 分析工具直接读 |

**由此推出两条独立结论**：
- **当天数据**：核心瓶颈是「**运行时解析 + 嵌套结构 + 幂等合并**」→ 指向 **JSON**。
- **历史数据**：核心瓶颈是「**只追加 + 逐行 diff + 分析工具直读**」→ 指向 **NDJSON**（见 §3）。
- **CSV 的共同价值**：只在一个场景赢——**「人 + 表格工具」**。它是**辅格式**的天然人选，但**两处都不是主格式**。

---

## 2. 逐维度对比 JSON vs CSV（量化）

> 约定：✅ = 该格式赢；⚠️ = 有条件；❌ = 该格式输。数据为实测（§实测附录）。

### 2.1 结构表达力（**这一条基本决定胜负**）

PRD/数据模型里**必须表达**的三处嵌套：

| 字段 | 结构 | JSON | CSV 的活法（现设计 §4.3） |
|---|---|---|---|
| `sources[]` | **对象数组** `[{channelId,channelName,url,publishedAt}]` | 原生嵌套，直接 `.sources.map()` | **单列塞 JSON 字符串** → 值里再套引号与转义 |
| `category[]` | 多标签 `["ai","opensource"]` | 原生数组 | `\|` 连接 → 消费方要二次 `split('\|')` |
| `hotList[].components` | 热度分量对象 | 原生对象 | 无处安放 |

**`sources[]` 在 CSV 里的实际代价**（这是决定性的一条）：

```
# CSV 单元格里塞对象数组（RFC 4180 转义后）
id,...,sources,...,hotScore
it_9f2c,"[{""channelId"":""ruanyifeng-blog"",""channelName"":""阮一峰的网络日志"",""url"":""https://..."",""publishedAt"":""2026-09-12T00:05:00Z""}]",...,0.87
```

- **双份转义**：CSV 层的 `""` + JSON 层的 `\"`，人眼不可读、正则极易错。
- **类型第二次丢失**：`sources` 本是 `object[]` → CSV 存字符串 → 消费方还得再 `JSON.parse` 一次。**绕了一圈回到 JSON，却多付了 CSV 的转义成本。**
- **`|` 连接的隐患**：若 `category` 或 `tags` 的内容本身含 `|`，需先转义为 `\|`，解析侧必须对称还原；一旦某源头漏转义就**静默错列**。

| 结论 | 赢家 |
|---|---|
| 一键直读嵌套；无二次拆解、无转义往返 | ✅ **JSON** |
| CSV 表达嵌套 = 「把 JSON 塞进单元格」，得不偿失 | ❌ CSV |

> **判断**：`sources[]` / `category[]` 的存在，使 **CSV 在「快照主格式」这一角色上直接出局**。这不是「JSON 更灵活」的空话，而是「**CSV 无法在保持可读的前提下表达对象数组**」的硬约束。

### 2.2 可解析性与类型保真

| 项 | JSON | CSV |
|---|---|---|
| 类型 | `hotScore:0.87`（number）、`sourceCount:2`（int）、`isNew:true`（bool）、`duplicateOf:null`（null）**全保真** | **一切皆字符串**：`"0.87"` `"2"` `"true"` `""` → 消费方逐列 `parseFloat/parseInt/=== 'true'` |
| 空值 | `null` vs 缺失键，语义清晰 | 空串 `""` 二义（是「空」还是「无此列」？） |
| **数值排序陷阱** | `.sort((a,b)=>b.hotScore-a.hotScore)` **正确** | **字符串排序翻车**：`"0.9" < "0.87"`（字典序），`"10" < "2"`。按 hotScore/sourceCount 排行必须先转 number |
| 布尔 | 原生 `true/false` | `"true"/"false"/"1"/"0"/"yes"` 各家不一，需约定 |

> **判断**：热点榜（F-062）的核心操作就是**按 `hotScore`/`sourceCount` 排序**；CSV 做这件事**天然踩坑**。

### 2.3 体积与压缩（**实测，最反直觉的一条**）

5000 条 Item（本项目全字段）实测：

| 格式 | 原始体积 | gzip-9 | 相对 CSV（raw） | 相对 CSV（gzip） |
|---|---|---|---|---|
| **JSON（紧凑单行）** | **4174.8 KB** | **770.2 KB** | **1.51×** | **1.04×** |
| **CSV** | **2873.7 KB** | **739.9 KB** | 1.00× | 1.00× |
| JSON（2 空格 pretty） | 5870 KB | 800 KB | 2.04× | 1.08× |

250 条档位（更贴近日常）：

| 格式 | 原始体积 | gzip-9 |
|---|---|---|
| JSON 紧凑 | 209.2 KB | 39.6 KB |
| CSV | 144.2 KB | 38.0 KB |
| gap | 1.51× | **1.04×** |

**关键发现**：
1. **裸体积**：JSON 比 CSV **大 51%**（键名每行重复）。
2. **gzip 后**：JSON 只比 CSV **大 4%**——**差距几乎消失**。原因：JSON 的**键名高度重复**（`"channelId"` 每行都出现），gzip 的 LZ77 把它压成极短引用，**冗余键名反而成了「高压缩收益」的来源**。
3. **结论**：**「JSON 体积大」在 gzip 之后基本不成立**（差 4% ≈ 30KB）。CDN（raw = gzip、jsDelivr = brotli）传输的都是压缩态，**这条不构成选 CSV 的理由**。

> 补充：`brotli` 自带针对 JSON/HTML 的静态字典，JSON 的实际线上差距会**更小**。

### 2.4 解析性能

| 项 | JSON | CSV |
|---|---|---|
| 机制 | `JSON.parse` —— **原生（浏览器 C++/V8 实现，非 JS 逐字符）** | `papaparse` —— **JS 状态机逐字符扫描**（还要处理引号/RFC 4180 转义） |
| 5000 条实测 | **~17 ms** | ~21 ms（Python `csv`；JS `papaparse` 因转义处理通常更慢） |
| 250 条估算 | **<1 ms** | 1~3 ms |

> **判断**：两者在本项目量级（250~5000 条）**都是「瞬间」，都不构成瓶颈**。JSON 略快（原生 vs 手写状态机），但**不足以单独决定选型**——真正的决定项是 §2.1 的结构表达力。

### 2.5 人工可读 / 可编辑（老登的核心诉求之一）

| 项 | JSON | CSV |
|---|---|---|
| 直接双击打开 | 需编辑器；pretty 后尚可 | **Excel / 表格工具秒开** ✅ |
| 手编源清单 | ✅ **可加注释（JSONC/JSON5）、可嵌套** | ⚠️ 平表能编，但**嵌套列（`sources`）没法手编** |
| 中文 + 逗号 + 换行 | 天然（引号即转义） | **RFC 4180 转义**；且 **Excel 默认按本地码页（GBK）打开 UTF-8 CSV → 中文乱码**，需加 BOM（`EF BB BF`） |
| Excel 副作用 | — | 长数字被转科学计数、前导 0 丢失、`3-4` 被识别成日期 |

> **判断**：**「给 Excel 看」是 CSV 的真优势**（我们已用辅格式覆盖）；但**「手编源清单」用 JSON 更好**——因为源清单本身是**嵌套的**（`channels[]` + `sources[]` + `fieldMapping{}`），CSV 根本编不了。

### 2.6 Git 友好度（**对纯静态站极关键**）

| 形态 | 一行改动 → diff | 评价 |
|---|---|---|
| JSON **紧凑单行** | **整个文件 1 行 → `±1` 行、全部内容高亮** | ❌ diff 完全无用 |
| JSON **2 空格 pretty** | 改 1 字段 → 改几行 | ✅ 可读 diff |
| CSV | 改 1 条 → **改 1 行** | ✅✅ **最干净** |
| NDJSON | 改 1 条 → **改 1 行**，且**该行自包含** | ✅✅ **等同 CSV 的行级 diff，还保住类型** |

**实测推导的建议**：
- **手编配置（`sources.json`）→ pretty-print**（2 空格）：diff 友好，且 gzip 后只贵 ~4%（§2.3）。
- **运行时 fetch 的当天快照 → 紧凑单行**：省 30% 裸体积、解析略快；反正它每小时被覆盖，**没有 diff 价值**。
- **历史归档 → NDJSON**：既不牺牲类型，又拿到 CSV 级的行级 diff。

### 2.7 增量 / 幂等合并（`mergeWrite` 的可行性）

现设计 `runSnapshot`（ARCHITECTURE §4.6）本质是「**读旧快照 → 按 `id` 合并 → 覆盖写**」。各格式下：

| 格式 | 「读-合并-写」可行性 |
|---|---|
| **JSON** | **✅ 天然**：`JSON.parse` → `Map(byId)` → 改对象属性 → `JSON.stringify`。嵌套字段**原地存活** |
| **CSV** | **⚠️ 有损往返**：必须 **parse 全表 → 逐行重建对象 → 把嵌套字段再解析回来（`\|` 拆、`sources` 列再 `JSON.parse`）→ 改 → 再序列化整表**。任一步转义不对称即**静默数据损坏**；且对象数组在「写回」时**无法保证字节级幂等** |
| **NDJSON** | ✅ 但**不适合覆盖合并**（追加型）：`mergeWrite` 需**整文件重写**才能合并，故 NDJSON 适合「历史归档」而非「当天高频合并」 |

> **判断**：**CSV 不适合承担「读-合并-写」主链路**——它的嵌套往返有损，而 `mergeWrite` 又恰好每小时跑一次。**这一条与 §2.1 一起，双重锁定「当天主格式 = JSON」。**

### 2.8 Schema 校验

| 项 | JSON | CSV |
|---|---|---|
| 现成机制 | ✅ **4 份 JSON Schema（draft-07）已在 `docs/data-model/schema/`，CI 用 `ajv` 校验** | ❌ **无原生 schema**；只能靠「列顺序约定」或额外元数据表 |
| 嵌套校验 | ✅ `items[].sources[].channelId` 可精确约束 | ❌ 嵌套列是字符串，schema 管不到 |
| 演进 | 加字段 = 加键，向后兼容 | 加列 **打破列序假设**，下游脚本易错位 |

> **判断**：**现有 4 份 schema + CI 校验是既有资产**；换 CSV 等于**放弃 schema 校验**，倒退。

### 2.9 工具生态（谁更省事）

| 工具 | CSV | JSON |
|---|---|---|
| **Excel** | ✅✅ 双击即用（注意 BOM/编码） | ⚠️ 需 Power Query / 加载项 |
| **pandas** | ✅ `read_csv()` 一行 | ✅ `read_json()` / `json_normalize()`（嵌套需展开） |
| **DuckDB** | ✅✅ `read_csv_auto()` | ✅ `read_json_auto()`（嵌套自动展开为结构体/列表） |
| **BI（Metabase/Grafana…）** | ✅✅ 原生 | ⚠️ 多数需先落库 |
| **浏览器** | ⚠️ 需 `papaparse` + 转义 | ✅✅ `JSON.parse` 原生 |

> **判断**：**离线分析（Excel/pandas/BI）CSV 普遍更省事**；**浏览器运行时只有 JSON 省事**。→ **各司其职，不冲突。**

### 2.10 CDN / HTTP 传输

| 项 | JSON | CSV |
|---|---|---|
| `fetch` 直读 | ✅ `JSON.parse(await res.json())` 一行 | ⚠️ 需 `papaparse`、编码（BOM 处理）、转义约定 |
| 压缩 | CDN 自动 gzip/brotli ✅ | 同 ✅ |
| CORS | raw/jsDelivr 开放 ✅ | 同 ✅ |

> **判断**：**浏览器直读 JSON 明显更省事**（这是「当天主格式」的又一个硬理由）。

### 2.11 版本演进

| 项 | JSON | CSV |
|---|---|---|
| 加字段 | ✅ 加键，**旧消费者忽略未知键**，向后兼容 | ❌ 加列：**位置敏感**，下游脚本按序号取值即错位 |
| schemaVersion | ✅ 已有 `schemaVersion` + 宽容解析（README §7） | ⚠️ 只能靠文件名/额外元数据 |

> **判断**：**JSON 演进更安全**（PRD 明确会持续加字段：`hotScore`、`components` 等）。

---

## 3. 第三选项：要不要跳出二选一？

### 3.1 NDJSON / JSONL —— **历史归档的最佳候选**

> 每行一个独立 JSON 对象，无外层数组、无逗号分隔。

**实测体积**（5000 条）：**5411.4 KB / gzip 1192.9 KB** ≈ 与紧凑 JSON **完全一致**（内容相同，只是换行符替代逗号）。

| 特性 | NDJSON 表现 | 对「历史数据」的意义 |
|---|---|---|
| **追加** | ✅✅ 直接 `>>` 末尾追加一行，**不解析、不重写全文** | 完美匹配「按天累积」 |
| **diff 友好** | ✅✅ 一条一行，改/删一条 → **一行 diff** | 等同 CSV，却**保住类型** |
| **类型保真** | ✅ 原生 number/bool/null/嵌套 | 无 CSV 的字符串化问题 |
| **结构表达力** | ✅ 与 JSON 相同（`sources[]` 照样嵌套） | 无 CSV 的转义地狱 |
| **流式处理** | ✅✅ 可逐行流式读（内存 O(1)） | 大文件不爆内存 |
| **DuckDB** | ✅✅ `read_ndjson_auto('f.ndjson')` | BI/OLAP 零摩擦 |
| **grep / wc -l** | ✅ 纯文本可 grep、`wc -l` 即条数 | 可运维、可校对 |
| 缺点 | ⚠️ 无单文档元信息头（需旁路 `_meta` 文件或首行 `{"_meta":…}`）；部分工具需显式指定「NDJSON」而非「JSON」 | 可控，约定即可 |

> **结论：NDJSON 兼具「JSON 的结构表达力」与「CSV 的行式追加 + diff 友好」，是历史数据的最优解。**
> 推荐用法：**按月一个文件** `history/items-YYYY-MM.ndjson`，每行一个历史 Item（含 `dedupKey` → 天然跨天去重）。月份封口后**只读不写**，天然不可变、可校验。

### 3.2 Parquet / SQLite / DuckDB 文件 —— 强，但对静态站「用不上」

| 项 | Parquet | SQLite / DuckDB 文件 |
|---|---|---|
| 压缩率 | ✅✅ 列存 + 字典/游程编码，**比 gzip-JSON 再小 3~10×** | ✅✅ 类似 |
| OLAP 性能 | ✅✅ 列裁剪、谓词下推 | ✅✅ |
| **浏览器直读** | ❌ **不能**（需 WASM：`duckdb-wasm` / `hyparquet`，体积数 MB） | ❌ 不能（需 `sql.js`/`wa-sqlite`，同样重） |
| 二进制 diff | ❌ 不可 diff、不可手编、不可 grep | ❌ 同 |

> **适用边界（明确划线）**：
> - ✅ **本地离线分析可以**：把 90 天 NDJSON 用 DuckDB 一条 SQL 转 Parquet，做重型 OLAP/同比——**在开发者机器上跑，产物 `.gitignore`，不进仓库**。
> - ❌ **进仓库给站点用不行**：前端要 WASM 才能读，**违背「零依赖纯静态」**，且无法 CDN 直取。
> - → **定性：Parquet = 可选的分析加速器，不是归档格式本身。**

### 3.3 CSV 的明确适用场景（不为了结论而否定它）

**CSV 在这些场景明确更优，务必保留**：
1. **人肉导出/交付**：F-051「导出当前视图为 CSV」——任何人 Excel 打开即用。
2. **喂给不支持 JSON 的老 BI / 报表**：列存平表的原生输入。
3. **当天快照的「辅」格式**：给外部不做代码的消费者看「今天有什么」。
4. **`item` 级平表分析**（无需嵌套字段时）：DuckDB `read_csv_auto` 极顺手。

> **CSV 不是被淘汰的输家，而是被放到正确的「辅」位置。**

---

## 4. 明确结论

### 4.1 当天数据用什么？

> **JSON（紧凑单行）为主 + CSV 为辅。** ——**与现有设计一致，保持不变。**

理由（三条硬需求同时只被 JSON 满足）：
1. **承载嵌套**：`sources[]`（对象数组）、`category[]`（多标签）、`hotList[].components`。
2. **读-合并-写**：`mergeWrite` 每小时跑一次，JSON 原生对象改属性；CSV 嵌套往返有损。
3. **浏览器运行时 fetch**：`JSON.parse` 原生；CSV 需 `papaparse` + 转义 + 编码处理。

CSV 作为**辅格式**保留，专供「人 + Excel + 外部分析」（正是老登说的「给人看/给 Excel 用」）。

### 4.2 历史数据用什么？

> **NDJSON 为归档主格式**（按月文件 + 逐行追加），**外加 `history-index.json` 滚动聚合**支撑趋势。**按天一个 JSON 快照**保留为「源真相」，但**趋势查询走 `history-index.json`，不读 N 个文件。**

- **按天一个文件 vs 单大文件 vs 追加日志**：
  - 按天 JSON（现状）：**保留**，作为「当日权威快照 + 便于与当天链路复用」。
  - **追加日志（月度 NDJSON）：新增，作为长期归档主格式**——只在月末封口，天然不可变。
  - 单大文件：❌ 不做（写放大、diff 爆炸、无法并发）。
- 「按天一个文件」的分析代价（90 天读 90 文件）→ **用 `history-index.json` 消除**（见 §5）。

### 4.3 是否要改现有设计？

> **当天：保持（JSON 主 + CSV 辅）。历史：新增（NDJSON + `history-index.json`）。数据分支：微调（见 §5.3）。**

| 项 | 动作 | 说明 |
|---|---|---|
| 当天快照 JSON 主 | **保持** | 现设计正确 |
| 当天快照 CSV 辅 | **保持** | 覆盖「Excel/外部分析」 |
| 4 份 JSON Schema + CI 校验 | **保持** | 既有资产，不下车 |
| 当天快照序列化 | **微调** | 运行时 fetch 的快照改**紧凑单行**（省 30% 裸体积） |
| 手编配置序列化 | **微调** | `sources.json` / `site-config.json` 保持 **pretty（2 空格）**（diff 友好） |
| 历史归档 | **新增** | `history/items-YYYY-MM.ndjson` + `history-index.json` |
| 数据分支策略 | **微调** | 从「纯 force-push」→「每小时 amend（当日内）+ 每日一次提交」，以保留跨天 provenance（见 §5.3） |

### 4.4 结论速查表

| 数据类型 | 推荐格式 | 序列化样式 | 理由（一句话） |
|---|---|---|---|
| 当天快照（运行时消费） | **JSON** | 紧凑单行 | 浏览器原生解析 + 承载嵌套 + 幂等合并 |
| 当天快照（外部分析） | **CSV** | UTF-8 + BOM | Excel/pandas/DuckDB 零摩擦 |
| 当天报告 Report | **JSON** | 紧凑单行 | 与快照同构，含 `components` 嵌套 |
| 手编配置（sources/site-config） | **JSON** | 2 空格 pretty | diff + schema 校验 |
| 历史归档（条目级） | **NDJSON** | 一行一条 | 追加 + 行级 diff + 类型保真 |
| 历史趋势（天级） | **JSON** | pretty | 小文件，人可读，前端直读 |
| 本地重型离线分析 | **Parquet/DuckDB** | 二进制 | 列存高压缩；**不入仓库** |
| 人肉导出/交付 | **CSV** | UTF-8 + BOM | 通用交付 |

---

## 5. 历史归档的文件组织方案（补原设计留白）

### 5.1 目录结构建议（`data` 分支）

```
data/                          # orphan data 分支
├─ snapshots/
│  ├─ snapshot-2026-09-12.json          # 当天权威快照（覆盖写）
│  └─ snapshot-2026-09-12.csv           # 辅格式
├─ reports/
│  └─ report-2026-09-12.json
├─ history/                              # ★历史归档（新增）
│  ├─ history-index.json                 #   滚动天级聚合（趋势用，单文件）
│  ├─ items-2026-09.ndjson               #   当月条目归档（月末封口，只读）
│  └─ items-2026-10.ndjson
├─ stats/collect-*.json
└─ latest.json                           # 指针
```

### 5.2 跨天趋势分析：为什么需要 `history-index.json`

**问题**：按天分文件时，画一条 90 天趋势线要读 **90 个 JSON 快照**（≈ 90 × 200KB ≈ 18MB，90 次请求）——对「一个趋势图」而言代价过高。

**解法：滚动天级聚合 `history-index.json`**（只追加/更新当天一行）：

```jsonc
{
  "schemaVersion": "1.0",
  "updatedAt": "2026-09-12T09:30:12Z",
  "days": [
    { "date":"2026-09-10","totalItems":238,"activeChannels":11,
      "categoryStats":{"ai":42,"news":30},"topKeywords":["AI","开源"],
      "topIds":["it_9f2c1a7b3e5d","it_4a2b8c0d6e1f"],"sourceOk":12,"sourceFailed":2 },
    { "date":"2026-09-11","totalItems":262, "...":"..." }
  ]
}
```

- **一份文件 ≈ 90 天 × ~250B ≈ 22KB**（gzip < 8KB）→ **趋势图一次 fetch 搞定**，无需读 90 个文件。
- 前端「趋势/同比」直接消费 `days[]`；需要明细时再按 `date` 拉对应快照。

| 分析诉求 | 数据源 | 成本 |
|---|---|---|
| 天级趋势线（总条数/活跃渠道数） | `history-index.json` | 1 次 fetch，~22KB |
| 分类占比随时间 | `history-index.json`（`categoryStats`） | 同上 |
| 某关键词热度走势 | `history-index.json`（`topKeywords`） | 同上 |
| 回溯某天全部条目 | `snapshots/snapshot-<date>.json` | 按需 1 次 |
| 跨天「重复出现的条目」 | `history/items-YYYY-MM.ndjson`（按 `dedupKey`） | 流式 grep / DuckDB |

### 5.3 force-push 与「历史数据」的张力（**重点**）

**矛盾点**：原设计是 `data` 分支 **`git push --force`（单提交、无历史）**（ARCHITECTURE §6.4）。而「历史数据」诉求天然希望**可追溯**。二者存在张力，需辨析清楚：

| 追问 | 答案 |
|---|---|
| force-push 会不会让**历史数据文件**消失？ | **不会。** force-push 替换的是**提交历史**，但提交的**文件树**里包含最近 N 天的所有 `snapshot-*.json` 与 `history/*`。**历史数据是「文件」，不是「commit」。** |
| 那 force-push 到底丢了什么？ | 丢的是 **① commit 级 provenance**（无法 `git log` 看「9:00 那版和 9:30 那版差了什么」）**② 当日内快照的中间态**（当天文件被覆盖，只有最终态）。 |
| 对「跨天趋势」有影响吗？ | **没有。** 每天是**独立文件**，跨天文件从不互相覆盖；趋势分析读的是文件，与 commit 历史无关。 |
| 那还需要改吗？ | **建议微调**，把「纯 force-push」升级为「**当日内 amend + 每日一次正式提交**」，以**用极低成本拿回跨天 provenance**。 |

**推荐分支策略（微调后）**：

```
· 一天内的 24 次采集：git commit --amend + git push --force-with-lease
  → 当天只有 1 个「可变」提交，无 24 次噪音（保留原设计的「无膨胀」优点）
· 跨天：不再 amend，而是「新建提交」追加到分支
  → 结果：data 分支 = 每天 1 个 commit，历史可追溯（git log / blame / 回到任意一天）
· 长期不可变归档（可选）：每月对 history/items-YYYY-MM.ndjson 打一个 tag 或建 GitHub Release
```

| 策略 | 当日内 commit | 跨天 provenance | 仓库膨胀 | 结论 |
|---|---|---|---|---|
| A 纯 force-push（原设计） | 1（可变形） | ❌ 无 | 最低 | 简单，但丢 provenance |
| **B amend + 每日提交（推荐）** | 1（可变形） | ✅ 有（1 commit/天） | 低（~1 commit/天） | **兼顾低噪音与可追溯** |
| C 每次采集都提交 | 24/天 | ✅ 有 | ❌ 高（≈24 commit/天） | 不用 |

> **结论**：**「force-push 会丢历史数据」是个误解——它丢的是 commit 历史，不是数据文件。** 但原设计确实**放弃了跨天 provenance**；用「**当日内 amend + 跨天新建提交**」即可**以接近零的成本**补回，且仍避免 24 次/天的 commit 噪音。**推荐改用策略 B。**

### 5.4 仓库体积量化预估

**单日成本（按 250 条/天，实测外推）**：

| 文件 | 裸体积 | gzip（≈ git blob zlib 后） |
|---|---|---|
| `snapshot-<date>.json` | ~209 KB | ~40 KB |
| `snapshot-<date>.csv` | ~144 KB | ~38 KB |
| `report-<date>.json` | ~40~80 KB | ~10~20 KB |
| `history/items-<month>.ndjson`（日均摊） | ~209 KB | ~40 KB |
| **单日合计** | **~0.6 MB** | **~0.13 MB** |

> ⚠️ **关键**：**git 对象本身用 zlib 压缩存储**，故**仓库实际占用更接近 gzip 列**（而非裸体积列）。

**保留期总体积**：

| 保留 | 文件树（裸） | **仓库实际占用（≈ zlib 后）** | 命中 1GB 软限？ |
|---|---|---|---|
| 30 天 | ~18 MB | **~4 MB** | ✅ 轻松 |
| 90 天 | ~55 MB | **~12 MB** | ✅ 轻松 |
| 365 天 | ~220 MB | **~48 MB** | ✅ 仍远低于 1GB |
| 365 天（仅 JSON+report，不含 CSV/NDJSON） | ~150 MB | **~33 MB** | ✅ |

- **单文件最大 ≈ 几百 KB**，远低于 **100 MB 单文件上限**。
- **结论**：**即便保留一整年，仓库也仅 ~48 MB，方案无体积风险。** 可放心把「历史保留时长」当作产品决策（而非技术约束）来定。

---

## 6. 待明确事项（请老登拍板）

| # | 决策点 | 推荐 | 理由 |
|---|---|---|---|
| **D1** | 历史数据**保留多久**？ | **`data` 分支保留 90 天**；`history/*.ndjson` **月度封口后长期（1 年+）**保留 | 90 天足够趋势/同比；月度 NDJSON 极省空间（§5.4，一年仅 ~48MB） |
| **D2** | force-push **是否改为保留历史**？ | **改为「当日内 amend + 跨天新建提交」（策略 B）** | 近乎零成本拿回跨天 provenance，且仍无 24 次/天噪音（§5.3） |
| **D3** | 是否引入 **Parquet/DuckDB 做本地离线分析**？ | **可选（P2），产物 `.gitignore`，不进仓库** | 列存压缩/OLAP 极强，但浏览器读不了，对静态站「用不上」（§3.2） |
| **D4** | 历史归档**粒度**：按天 JSON / 月度 NDJSON / 两者都要？ | **两者都要**：按天 JSON 为源真相，月度 NDJSON 为分析友好 | 各司其职：前者对齐当天链路、后者追加/diff/直读（§4.2） |
| **D5** | 是否把**历史趋势纳入前端**（原 PRD 标 V2 不做）？ | **若做，只用 `history-index.json` 支撑轻量趋势图** | 一份 ~22KB 文件搞定 90 天趋势，无需读 90 个快照（§5.2） |

---

## 附录 A：格式片段示例

**A.1 当天快照（JSON，紧凑单行 —— 运行时 fetch 用）**
```json
{"schemaVersion":"1.0","date":"2026-09-12","timezone":"Asia/Shanghai","generatedAt":"2026-09-12T09:30:12Z","stats":{"sourceTotal":14,"sourceOk":12,"sourceFailed":2,"itemsBeforeDedup":268,"itemsAfterDedup":251,"mergedCount":17,"durationMs":8421},"items":[{"id":"it_9f2c1a7b3e5d","title":"科技爱好者周刊（第 324 期）：AI 编程助手的一年","url":"https://www.ruanyifeng.com/blog/2026/09/weekly-324.html","channelId":"ruanyifeng-blog","channelName":"阮一峰的网络日志","category":["tech_blog"],"publishedAt":"2026-09-12T00:05:00Z","updatedAt":"2026-09-12T01:20:00Z","sourceCount":2,"sources":[{"channelId":"ruanyifeng-blog","channelName":"阮一峰的网络日志","url":"https://...","publishedAt":"2026-09-12T00:05:00Z"},{"channelId":"v2ex","channelName":"V2EX","url":"https://www.v2ex.com/t/9000001","publishedAt":"2026-09-12T01:10:00Z"}],"isNew":true,"hotScore":0.87}]}
```

**A.2 当天快照（CSV 辅格式 —— 嵌套被降维）**
```csv
id,title,channelId,category,publishedAt,updatedAt,sourceCount,sources,isNew,hotScore
it_9f2c1a7b3e5d,科技爱好者周刊（第 324 期）：AI 编程助手的一年,ruanyifeng-blog,tech_blog,2026-09-12T00:05:00Z,2026-09-12T01:20:00Z,2,"[{""channelId"":""ruanyifeng-blog"",""url"":""https://...""}]",true,0.87
```
> 注意 `sources` 列「JSON 塞单元格」的双重转义（§2.1）；`hotScore` 若被 Excel 读入即为字符串，排序须自行转 number（§2.2）。

**A.3 历史归档（NDJSON —— 一行一 Item，可追加、可 diff、类型保真）**
```ndjson
{"id":"it_9f2c1a7b3e5d","dedupKey":"8f0c1d2e...","channelId":"ruanyifeng-blog","category":["tech_blog"],"publishedAt":"2026-09-12T00:05:00Z","sourceCount":2,"hotScore":0.87}
{"id":"it_4a2b8c0d6e1f","dedupKey":"7e1f0a9b...","channelId":"huggingface-blog","category":["ai","opensource"],"publishedAt":"2026-09-11T15:40:00Z","sourceCount":1,"hotScore":0.79}
```
> 追加写入：`echo '<json-line>' >> history/items-2026-09.ndjson`；跨天去重按 `dedupKey`；DuckDB 直读：`SELECT ... FROM read_ndjson_auto('history/items-2026-09.ndjson')`。

---

## 附录 B：实测方法与原始数据

- 脚本：基于本项目 `snapshot.example.json` 的 Item 字段形态合成 250/1000/5000 条，UTF-8，`json.dumps(ensure_ascii=False)`。
- CSV 序列化严格复刻 `data-model/README.md §4.3` 规则（标量数组 `|` 连接、`sources` 存 JSON 字符串、RFC 4180 转义）。
- 压缩：`gzip(level=9)`。解析：5000 条 ×20 次取总耗时。

| N | JSON 紧凑 raw | JSON 紧凑 gzip | CSV raw | CSV gzip | raw 比 | gzip 比 |
|---|---|---|---|---|---|---|
| 250 | 209.2 KB | 39.6 KB | 144.2 KB | 38.0 KB | 1.51× | **1.04×** |
| 1000 | 837.6 KB | 155.8 KB | 577.4 KB | 149.6 KB | 1.51× | **1.04×** |
| 5000 | 4174.8 KB | 770.2 KB | 2873.7 KB | 739.9 KB | 1.51× | **1.04×** |
| 5000（重摘要档，另测） | 5411.6 KB | 1193.0 KB | 4107.3 KB | 1145.3 KB | 1.32× | **1.04×** |
| 5000 NDJSON | 5411.4 KB | 1192.9 KB | — | — | ≈ JSON | ≈ JSON |

**解析耗时（5000 条）**：`JSON.parse` ≈ **17 ms/次**；CSV 状态机解析 ≈ **21 ms/次**（同量级，JSON 略快）。

---

*本文档为格式选型决策产物，不含业务代码。结论经老登确认后，历史归档方案（NDJSON + `history-index.json`）纳入 `docs/ARCHITECTURE.md` 与 `docs/data-model/` 的后续修订。*

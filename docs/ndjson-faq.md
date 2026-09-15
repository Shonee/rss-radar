# NDJSON 答疑专文（正面回答老登第 3 点三问）

| 项目 | 内容 |
|---|---|
| 文档性质 | **答疑 / 科普 + 设计决策**（面向老登，尽量不用术语） |
| 触发来源 | 老登三问：① 为什么要用 NDJSON，有什么好处？ ② 静态文件中不能用 NDJSON 会不会有影响？ ③ 需要在部署的页面中分析历史数据 |
| 上游输入 | `docs/PRD.md` v1.1（Q14/Q15）、`docs/data-model/format-decision.md`、`docs/ARCHITECTURE.md` v1.0 |
| 语言 | 简体中文 |
| 版本 | v1.0（随 ARCHITECTURE v1.1 产出） |

> 本文所有体积数字均来自 `docs/data-model/format-decision.md §附录B` 的**实测压测**（对本项目真实 Item 字段结构，UTF-8 + gzip-9），非拍脑袋估算。

---

## 0. 三问速答（先看这张卡）

| 老登的问题 | 一句话回答 |
|---|---|
| ① **为什么要用 NDJSON？有什么好处？** | 因为你要「当天数据**追加**到一个文件」——**JSON 数组天生不能追加**（末尾那个 `]` 挡着，加一条必须把整个文件读出来重新写一遍）；NDJSON 是「一行一条」，追加就是往文件尾 `>>` 加一行，**O(1)，永远不碰老数据**。它同时白拿了 diff 干净、流式读、DuckDB 直读、`grep` 可搜等好处。 |
| ② **「静态文件不能用 NDJSON」会不会有影响？** | **这是一场误会，请放心。** 我上一轮说的是「**Parquet 浏览器读不了**」（那是二进制列存，要几 MB 的 WASM 才能读）；**NDJSON 是纯文本，浏览器读它和读普通 JSON 一样轻松**，`fetch` 拿回来按行 `JSON.parse` 即可，还能流式逐行读、内存不爆。**结论：NDJSON 在静态站里完全可用，被"禁止"的只有 Parquet。** |
| ③ **需要在部署页面里分析历史数据，怎么办？** | 已经设计好三件套：**`history-index.json`（趋势，1 次请求出图）+ 月度 NDJSON（明细，一个月一个文件）+ 按天快照（回看某天）**。浏览器**不需要**拉 365 个文件——**趋势只读 1 个 22KB 的索引**；只有用户真的要看某个明细时才按需拉那一个月。 |

---

## 1. 第一问：为什么要用 NDJSON？有什么好处？

### 1.1 从你自己的诉求出发：你要「追加」，而 JSON 数组根本做不到追加

你的原话是：

> 「每30分钟获取一次最新数据，**当天的所有数据都追加到一个 json 数据文件中**」

> ⚠️ 口径注记（2026-09）：上引为 v1.0 原始诉求**逐字保留**，请勿改动。当前实现采集频率已统一为**每小时**一次（`cron: '7 * * * *'`，第 7 分），"每 30 分钟" 为过期口径，不代表现行调度。

注意「**追加**」两个字。它决定了格式的命运。

#### 先看 JSON 数组长什么样

```json
{ "date": "2026-09-12", "items": [ {"id":"A"}, {"id":"B"} ] }
```

现在要在末尾加一条 `{"id":"C"}`。你会发现——**加不了**。因为文件最后一个字符是 `]`（数组结束符），新数据必须插在 `]` **前面**。而一个文件是「字节流」，你没法在中间"插队"，只能：

```
读整个文件 → JSON.parse 成内存对象 → items.push(C) → JSON.stringify → 覆盖写回整个文件
```

**这就是 JSON 数组追加的真相：所谓"追加"，实际是"重写整个文件"。** 数据越大，每次越慢（O(n)）。

#### 有人会说"那我用 `[`…`]` 技巧，把 `]` 覆盖掉不就行了？"

理论上可以：文件保持 `[...,{B},{C}]`，追加时定位到最后一个 `]`，把它改成 `,{D}]`。但这条路全是坑：

| 坑 | 说明 |
|---|---|
| 得先"读整个文件"找最后一个 `]` | 又变成 O(n)，没省下读的代价 |
| 得处理"首元素没有前导逗号" | 第一次追加要特殊判断空数组 `[]` |
| 得处理"逗号位置、换行、缩进" | 极易产生非法 JSON（多一个逗号就整个文件报废） |
| 部分文件系统/对象存储**不支持原地改字节** | 网络盘、COS、git 场景下仍是"整文件重写" |

**结论：JSON 数组没有"真正的追加"，只有"重写"。** 这不是优化问题，是格式的物理限制。

#### 再看 NDJSON：追加就是 `>>` 加一行

NDJSON（Newline Delimited JSON，也叫 JSON Lines / `.jsonl`）就是**每行一个独立完整的 JSON 对象，行与行之间用换行符分隔，没有外层数组，没有逗号**：

```ndjson
{"id":"A","title":"第一条"}
{"id":"B","title":"第二条"}
```

要加一条？**直接在文件尾追加一行**：

```js
import { appendFileSync } from 'node:fs';
appendFileSync('events-2026-09-12.ndjson', JSON.stringify(newItem) + '\n');
```

- **不读老数据**（一个字节都不读）
- **不改老数据**（绝不重写已存在的行）
- **O(1)**：不管文件已经多大，加一条就是加一行

#### 量化：一天 24 次采集，"重写" vs "追加"差多少？

按本项目日常档位（约 250 条/天，单条 ≈ 836 字节）估算：

| 采集轮次 | 文件已积累条数 | JSON 数组「重写」每轮 I/O | NDJSON「追加」每轮 I/O |
|---|---|---|---|
| 第 1 轮 | 10 条 | 读 8KB + 写 8KB | 追加 1 行 ≈ 0.8KB |
| 第 6 轮（约 6h） | 62 条 | 读 52KB + 写 52KB | 追加 1 行 |
| 第 12 轮（约 12h） | 125 条 | 读 104KB + 写 104KB | 追加 1 行 |
| 第 24 轮 | 250 条 | 读 209KB + 写 209KB | 追加 1 行 |
| **全天累计 I/O** | — | **≈ 2.6 MB 读 + 2.6 MB 写（且逐轮变慢）** | **≈ 12KB（恒定，一行）** |

> 一天下来，**NDJSON 省掉了约 99.5% 的磁盘 I/O**，并且每一轮的速度恒定（不会越跑越慢）。

更重要的是跟着来的两个「副作用」——对你这个项目**都要命**：

1. **git diff**：JSON 数组每轮重写 → 整个文件都变 → diff 一大片红绿；NDJSON 追加 → diff 就是「新增 N 行」，干净得像 CSV。
2. **崩溃安全**：万一写到一半断电/超时，JSON 数组会留下**残缺的、无法 parse 的**整个文件（前面所有数据一起报废）；NDJSON 只是**最后一行残破**，丢掉那一行即可，**前面所有行完好**。

### 1.2 NDJSON 的其他好处（除了"能追加"）

| 好处 | 具体表现 | 对历史数据的意义 |
|---|---|---|
| **追加友好** | `>>` 加一行，O(1)，不碰老数据 | 完美贴合「当天持续合并」+「跨天累积」 |
| **diff 干净** | 改/删一条 = **一行 diff**（等同 CSV） | 仓库历史可读、可 review |
| **类型保真** | number / bool / null / **嵌套对象数组** 原生保留 | 不像 CSV 会被字符串化 |
| **结构表达力** | 与 JSON 相同：`sources[]`、`category[]` 照样嵌套 | 不需要 CSV 那套转义地狱 |
| **流式读** | 可逐行读，内存 **O(1)** | 浏览器/脚本读大文件不爆内存 |
| **DuckDB 直读** | `SELECT * FROM read_ndjson_auto('f.ndjson')` | 做 BI / OLAP 零摩擦 |
| **`grep` / `wc -l` 可运维** | 纯文本，可 `grep 关键词`、`wc -l` 数条数 | 排障、核对、抽查都方便 |
| **行级损坏隔离** | 一行坏了只丢一行 | 不会"一颗老鼠屎坏一锅汤" |
| **可并行追加** | 多进程各自 `>>` 追加（配合行级原子写） | 未来若拆并发采集，天然适配 |

### 1.3 NDJSON 的真实缺点（不能只讲好话）

| 缺点 | 说明 | 我们的应对 |
|---|---|---|
| **没有"单文档元信息头"** | JSON 数组能在一个文件顶部放 `{schemaVersion, date, stats}`；NDJSON 每行都是"裸条目"，**没地方放文件级元信息** | ① 旁路一个 `_meta`（如 `history/2026/09/_meta.json`）；或 ② 首行放一个 `{"_meta":{...}}` 哨兵行；本项目选 **① 旁路 `_meta`**（保持数据行纯净） |
| **部分工具需显式指定"NDJSON"** | 有些工具默认按"一个 JSON 文档"解析，对 NDJSON 会报错 | 用支持 NDJSON 的工具：DuckDB `read_ndjson_auto`、pandas `read_json(lines=True)`、`jq -c` 逐行、`wc -l` |
| **不能被 `JSON.parse` 整体解析** | `JSON.parse(整个文件)` 会抛错（因为它不是一个合法 JSON 文档） | **这不是缺陷，是使用方式**：按行 parse 即可（本文第 2 章给完整代码） |
| **IDE 折叠体验差** | 编辑器无法像 JSON 那样折叠成树，只能当文本看 | 明细分析用表格/BI 工具，不用 IDE 折叠 |
| **无法做"整体 schema 校验"** | 没法对整文件断言"所有行的 date 都等于文件名日期"这类跨行约束 | 校验改为**行级 schema**（每行套一个 schema，见 `schema/history-item.schema.json`）+ 脚本级跨行断言 |
| **换行符约定要统一** | 必须约定 `\n`（Unix LF），且每行以换行结尾 | 写入统一 `\n`；解析时 `split('\n').filter(Boolean)` 忽略空行 |

> **一句话**：NDJSON 的缺点都是"少了一个文档头/少了一层折叠糖"，**可控、可约定**；而它的优点是"能追加、diff 干净、类型不丢"，**恰恰命中你项目的核心诉求**。

---

## 2. 第二问：澄清「静态文件不能用 NDJSON」——这是误会

### 2.1 我上一轮到底说了什么

我上一轮（`format-decision.md §3.2`）说的是：

> **Parquet / SQLite / DuckDB 文件：浏览器直读 ❌ 不能**（需 WASM：`duckdb-wasm` / `hyparquet`，体积数 MB）。

**说的是 Parquet（一种二进制列存格式），不是 NDJSON。** 这两者完全不是一回事：

| 格式 | 本质 | 浏览器能不能读 |
|---|---|---|
| **NDJSON** | **纯文本**，一行一个 JSON | ✅ **能**（就是文本，`fetch` + 按行 `JSON.parse`） |
| Parquet | **二进制**列存，带字典/游程编码 | ❌ 不能（没有原生解析，要加载几 MB WASM） |

**所以"静态文件不能用 NDJSON"这个结论，我从没说过，也不成立。** 可能是我上一轮把「Parquet 读不了」和「NDJSON」放在同一段里对比，容易被连带误读，**这里正式澄清**：

> ✅ **NDJSON 是纯文本，浏览器完全能读，静态站放心用。**
> ❌ **被"排除"的只有 Parquet / SQLite 这类二进制列存/库文件**——它们对纯静态站是死路（要么几 MB WASM，要么干脆读不了）。

### 2.2 浏览器读 NDJSON 的完整可用方案

#### 方式 A：一次性读（文件不大时最简单）

```js
// 读一个 NDJSON 文件，解析成对象数组——不到 5 行
const res  = await fetch(url);              // url 例如 history/2026/09/items.ndjson
const text = await res.text();
const items = text
  .split('\n')                              // 按行切
  .filter(Boolean)                          // 去掉空行（末尾换行会产生一个空串）
  .map(line => JSON.parse(line));           // 每行独立 parse
console.log(items.length);                  // 条数
```

- 和 `JSON.parse(await res.json())` 相比，**只多了一个 `split('\n').filter(Boolean)`**。
- 对于本项目规模（一个月几千行、gzip 后几百 KB），这样读**毫无压力**。

#### 方式 B：流式逐行读（文件很大时，内存 O(1)）

如果将来单文件到几十万行，一次性 `split` 会把整个文件读进内存。这时改成**边下边解**，内存恒定：

```js
// 把 ReadableStream 变成「逐行迭代器」
async function* lines(stream) {
  const reader  = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });   // stream:true 处理跨块的多字节字符
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line) yield line;                            // 产出一行
    }
  }
  if (buf) yield buf;                                  // 最后一行可能没有换行
}

// 使用：边下边处理，内存里永远只有「一行 + 小缓冲」
const res = await fetch(monthlyNdjsonUrl);
let count = 0;
const keywordHits = new Map();
for await (const line of lines(res.body)) {          // res.body 就是一个 ReadableStream
  const item = JSON.parse(line);
  count++;
  // 举例：顺便统计关键词，完全不把整个月读进内存
  for (const kw of item.tags ?? []) keywordHits.set(kw, (keywordHits.get(kw) ?? 0) + 1);
}
console.log('本月条数', count, '关键词', [...keywordHits.entries()]);
```

- `res.body` 是标准的 **`ReadableStream`**，现代浏览器（Chrome/Edge/Firefox/Safari 全部支持）。
- 关键点：`decoder.decode(value, { stream: true })` 处理"一个中文字符被切在两个数据块之间"的情况，**中文不会乱码**。

#### 关于 gzip / CORS / 编码（都是好消息）

| 关注点 | 结论 |
|---|---|
| **会不会因为没压缩而很慢？** | CDN（raw / jsDelivr / CF）对 `.ndjson` 这类文本**自动 gzip/brotli**，`fetch` 拿到的已是压缩态，浏览器**透明解压**，你无感 |
| **CORS 跨域能读吗？** | `raw.githubusercontent.com` 与 `jsDelivr` 都返回 `Access-Control-Allow-Origin: *`，**前端可直接 fetch** |
| **Content-Type 是 JSON 吗？** | raw 会返回 `text/plain; charset=utf-8`——**不影响**，因为我们是 `.text()` 拿文本自己解析，不依赖 MIME |
| **编码** | 一律 UTF-8；用 `TextDecoder` 解码（见上） |

> 若哪天需要兼容极老的浏览器（无 `ReadableStream`），降级为「方式 A」的 `text().split('\n')` 即可，**代码几乎一样**。

### 2.3 什么时候 NDJSON 真的读不了？

**基本没有。** NDJSON 是纯文本，凡是能读文本的环境都能读（浏览器、Node、Python、Excel 转存、BI……）。

真正"浏览器读不了"的是**二进制**格式：Parquet、SQLite、DuckDB 文件。它们我们**只用于本地离线重型分析**（开发者机器上把 NDJSON 转成 Parquet 做 OLAP），**产物 `.gitignore`，绝不进仓库、不进站点**。

### 2.4 一句话结论（请记这句）

> **NDJSON 在静态站里 100% 可用——浏览器能读、CDN 能压、CORS 能过。被"禁止"的只有 Parquet 这类二进制格式。**
> 上一轮我"劝退"的从来不是 NDJSON，而是 Parquet。

---

## 3. 第三问：在部署的页面里分析历史数据——完整方案

你的原话：「**是需要在部署的页面中分析历史数据的**」。这是刚需，我们认真设计。

### 3.1 先看一个"朴素方案"的死穴：一年 = 365 个文件 = 365 次请求

如果历史就是「一年 365 个按天 JSON 文件」，那么前端想画一条"90 天趋势线"要发 **90 次请求**；想看全年要 **365 次**。哪怕 HTTP/2 能并发，**请求数、连接开销、失败重试、加载状态管理**都会变得很痛苦，移动端更甚。

**所以我们对历史数据的组织做了两处优化：**

| 优化 | 做法 | 收益 |
|---|---|---|
| ① 把「年/月目录」里的明细做成**月度 NDJSON** | `history/2026/09/items.ndjson`（一个月一个文件） | 拉一年明细：**365 次 → 12 次请求** |
| ② 再加一个**天级滚动聚合索引** `history-index.json` | 一个轻量文件装 365 天的"每天一行汇总" | 画趋势：**12 次 → 1 次请求（~22KB）** |

> 注意：这**同时满足**你说的「历史数据按保存一年来处理（**分好年-月目录存放**）」——目录形态就是 `history/2026/09/`，只是把"月内含 30 个按天文件"改成"月内 1 个 `items.ndjson`"，目录语义不变，请求数减 30 倍。

### 3.2 历史数据的三件套（各司其职）

```
history/                                    ← deploy 部署分支
├─ history-index.json                       ← ① 天级滚动聚合（趋势用，单文件）
├─ archive-index.json                       ← ④ 归档索引（>1 年，只读元数据 + Release 链接）
└─ 2026/
   └─ 09/                                    ← ② 年/月目录
      ├─ items.ndjson                        ←    本月全部条目（月度 NDJSON，追加生成，月末封口只读）
      ├─ _meta.json                          ←    本月元信息（NDJSON 缺"文档头"的补丁）
      ├─ snapshot-2026-09-12.json            ← ③ 按天快照（回看某天用，含完整字段 + stats）
      ├─ snapshot-2026-09-13.json
      ├─ report-2026-09-12.json              ←    按天报告（回看某天报告用）
      └─ ...
```

| 编号 | 文件 | 角色 | 前端何时读 | 体积量级 |
|---|---|---|---|---|
| ① | `history-index.json` | **趋势图数据源**（每天一行汇总） | 打开页面4 趋势区，**1 次** | 一年 ≈ **~91KB**（gzip ~25KB） |
| ② | `history/YYYY/MM/items.ndjson` | **明细/批量分析**（当月全部条目） | 用户下钻某月时，**1 次/月** | 一个月 ≈ 200~650KB（gzip）（见 3.2.1） |
| ③ | `history/YYYY/MM/snapshot-<date>.json` | **回看某天**（含 summary/sources 完整字段） | 用户在日历选某天，**1~2 次** | 单天 ≈ 209KB（gzip ~40KB） |
| ④ | `archive-index.json` | **归档可发现性**（>1 年） | 页面4 归档区，**1 次** | 极小（几 KB） |

#### 3.2.1 月度 NDJSON 到底多大？（把数字算清楚）

单条 Item 的实测体积（来自 `format-decision.md`）：

| 行类型 | 单条裸体积 | 单条 gzip 后 | 说明 |
|---|---|---|---|
| **完整行**（含 `summary`、`sources[]`） | ~1082 B | ~239 B | 内容最全 |
| **精简行**（不含 summary/sources，仅 id/title/url/channel/category/时间/热度） | ~300 B | ~90 B | **月度 NDJSON 采用** |

按"日常档位 250 条/天"估算**一个月**（≈7,500 行）：

| 行类型 | 一个月裸体积 | 一个月 gzip 后 |
|---|---|---|
| 完整行 | ≈ 8.1 MB | ≈ 1.79 MB |
| **精简行（采用）** | **≈ 2.3 MB** | **≈ 0.68 MB** |

> 📌 **对团队给的「约 209KB / gzip 约 40KB」做一次校准**：那组数字其实是**「单日 250 条」**的档位（`format-decision` 里 250 条 = 209.2KB / 39.6KB）。**整月约为其 30 倍**。这不是问题——因为**趋势根本不读它**（趋势读 `history-index.json`），只有用户主动下钻某个月时才拉，且按月懒加载。下文 3.3.2 给请求数/体积的完整对比。

### 3.3 怎么拉、怎么算

#### 3.3.1 趋势：只读 `history-index.json`（1 次请求）

`history-index.json` 每天一行汇总（天级聚合），前端**一次 fetch 就能画所有趋势图**：

```jsonc
{
  "schemaVersion": "1.0",
  "updatedAt": "2026-09-12T09:30:12Z",
  "days": [
    { "date":"2026-09-10","totalItems":238,"activeChannels":11,
      "categoryStats":{"ai":42,"news":30,"tech_blog":51},
      "topKeywords":["AI","开源","Agent"], "topIds":["it_9f2c1a7b3e5d"],
      "sourceOk":12,"sourceFailed":2 },
    { "date":"2026-09-11","totalItems":262, "...":"..." }
  ]
}
```

```js
// 趋势图：1 次请求，一份文件里就有 365 天的每天汇总
const idx = await (await fetch(`${BASE}/history/history-index.json`)).json();
const last90 = idx.days.slice(-90);
// 总条数趋势线
const totalSeries = last90.map(d => ({ x: d.date, y: d.totalItems }));
// 活跃渠道数趋势线
const activeSeries = last90.map(d => ({ x: d.date, y: d.activeChannels }));
// 分类占比随时间（堆叠图）
const catSeries = last90.map(d => ({ date: d.date, ...d.categoryStats }));
```

| 前端视图 | 数据源 | 请求数 | 传输量 |
|---|---|---|---|
| 总条数趋势线 | `history-index.json → days[].totalItems` | **1** | 一年 ~25KB(gzip) |
| 活跃渠道趋势线 | `days[].activeChannels` | 0（复用） | — |
| 分类占比走势 | `days[].categoryStats` | 0（复用） | — |
| 关键词热度走势 | `days[].topKeywords` | 0（复用） | — |

#### 3.3.2 明细下钻：按需拉「那一个月」（1 次/月）

当用户点开"2026 年 9 月"或想对某月做关键词/渠道统计时，才拉该月 NDJSON：

```js
// 流式统计某个月的关键词 TOP，内存 O(1)（代码见 §2.2 方式 B）
const url = `${BASE}/history/2026/09/items.ndjson`;
const hits = new Map();
for await (const line of lines((await fetch(url)).body)) {
  const it = JSON.parse(line);
  for (const t of it.tags ?? []) hits.set(t, (hits.get(t) ?? 0) + 1);
}
```

#### 3.3.3 回看某天：只读「那一天的快照」（1~2 次）

用户用日历选「2026-09-12」→ 按日期拼路径，直接读该天快照（含 summary/sources，字段最全）与该天报告：

```js
const [y, m] = ['2026','09'];
const snap = await (await fetch(`${BASE}/history/${y}/${m}/snapshot-2026-09-12.json`)).json();
const rep  = await (await fetch(`${BASE}/history/${y}/${m}/report-2026-09-12.json`)).json();
```

### 3.4 量化对比：按天 JSON × 365 次 vs 月度 NDJSON × 12 次

| 维度 | 按天 JSON（365 文件） | 月度 NDJSON（12 文件） | 胜出 |
|---|---|---|---|
| 拉一整年**明细**的请求数 | **365** | **12** | 月度 NDJSON |
| 画**趋势线**所需请求数 | 365（得读全年） | **1**（读 index） | **index（都不是 12）** |
| 单请求体积（gzip） | ~40KB/天 | ~0.68MB/月 | 按天更小（但 30 倍请求数） |
| 一年明细总量（gzip） | ~14.6MB | ~8.2MB | 月度更省（少 30 倍"行开销"、无损压缩更整） |
| 追加友好 | 每天新建，天然"追加" | 月内追加，封口只读 | 平手 |
| 行级 diff | 单天文件整体新增 | 月内追加 N 行 | **月度**（diff 更集中） |
| 单文件损坏影响面 | 只坏 1 天 | 坏 1 月（可跳坏行） | 按天更小 |
| 目录整洁度 | 365 文件 | 12 文件 | 月度 |
| 首屏（**都不该拉全年**） | — | — | **两者都靠 index，实操都是 1 次** |

**综合结论**：

1. **趋势**：读 `history-index.json`，**1 次请求**（无论按天还是按月组织，都不该拉全年 item 来画趋势）。
2. **明细**：月度 NDJSON，**12 次/年**，比按天 JSON 的 365 次**少 30 倍**。
3. **回看某天**：按天快照，**1~2 次**，字段最全。

> **给老登的大白话**：**看曲线 → 读 1 个小索引文件；看某个月的明细 → 拉 1 个月度文件；回看某一天 → 拉那一天的快照。浏览器永远不会"哐哐拉 365 个文件"。**

### 3.5 加载与缓存策略（页面4 数据契约）

| 数据 | 加载时机 | 缓存策略 | 失败降级 |
|---|---|---|---|
| `history-index.json` | 进入页面4 立即 | 短 TTL（raw ~5 分钟）或 `sessionStorage` 会话内缓存 | 展示"历史数据生成中" |
| 月度 `items.ndjson` | 用户下钻某月 | `Cache-Control` 由 CDN 控制；前端 `Map` 记住已拉月份，**不重复拉** | 该月显示占位 + 重试按钮 |
| 按天 `snapshot-<date>.json` | 用户选某天 | 同上；同一天不重复拉 | 区分「无数据」与「已归档，去 Release 下载」 |
| `archive-index.json` | 进入页面4 归档区 | 长 TTL 可接受 | 隐藏归档区 |

**关键实现建议**：

- **先出趋势，再出明细**：页面4 首屏只 `await history-index.json`（~25KB），趋势图立刻可画；下钻/回看是用户交互触发的**懒加载**。
- **请求合并**：一次下钻只发 1 个请求（该月 NDJSON），用流式逐行解析，边下边算，**不要先落地成数组再算**。
- **移动端**：默认只画 1 张趋势图（读 index，1 个请求），明细/回看改成弹层按需加载。

### 3.6 代码骨架（可直接抄）

```js
// services/historyClient.ts —— 页面4 的数据访问层（示意）
const BASE = import.meta.env.VITE_DATA_BASE_URL; // raw / jsDelivr 基址

// 1) 趋势：1 次请求
export async function loadTrend(windowDays = 90) {
  const idx = await getJSON(`${BASE}/history/history-index.json`);
  return idx.days.slice(-windowDays);
}

// 2) 回看某天：1~2 次请求
export async function loadDay(date /* 'YYYY-MM-DD' */) {
  const [y, m] = date.split('-');
  try {
    const snap = await getJSON(`${BASE}/history/${y}/${m}/snapshot-${date}.json`);
    let rep = null;
    try { rep = await getJSON(`${BASE}/history/${y}/${m}/report-${date}.json`); } catch {}
    return { snap, rep, source: 'history' };
  } catch {
    // 找不到 → 可能是当天（读 today/）或已归档
    return { snap: null, rep: null, source: 'missing' };
  }
}

// 3) 月度明细：1 次请求 + 流式解析
export async function scanMonth(year, month) {
  const url = `${BASE}/history/${year}/${month}/items.ndjson`;
  const res = await fetch(url);
  if (!res.ok || !res.body) return null;
  const out = [];
  for await (const line of lines(res.body)) out.push(JSON.parse(line));
  return out;
}
```

---

## 4. 一页速查

| 老登的问题 | 记这一句 |
|---|---|
| 为什么用 NDJSON | 你要「追加」，JSON 数组做不到（末尾 `]` 挡着），NDJSON 一行一条、`>>` 即追加、**O(1)**；还顺带白拿 diff 干净 / 流式读 / DuckDB 直读 / `grep` 可搜 |
| 静态站能不能用 NDJSON | **能用**！NDJSON 是纯文本，浏览器 `fetch` + 逐行 `JSON.parse` 即可；被禁的是 **Parquet**（二进制，要几 MB WASM），不是 NDJSON |
| 前端怎么分析历史 | 三件套：**趋势读 `history-index.json`（1 次）→ 明细拉月度 NDJSON（1 次/月）→ 回看某天读该天快照（1~2 次）**；永不拉 365 个文件 |
| 一年到底要发几次请求 | 看趋势 **1 次**；下钻整年明细 **12 次**；回看一天 **1~2 次** |

---

*本文为答疑与设计说明产物，不含业务代码。相关格式选型见 `docs/data-model/format-decision.md`；数据组织与部署细节见 `docs/ARCHITECTURE.md` v1.1；历史数据字段定义见 `docs/data-model/README.md` 与 `docs/data-model/schema/`。*

# RSS Radar 数据模型说明（data-model）

> 本目录定义 RSS Radar 的**全部数据文件**格式：源清单、当天数据（事件流 + 投影快照）、当日报告、站点配置、**历史数据（月度 NDJSON + 天级索引 + 归档索引）**、**排除规则**、**通知配置**。
> 配套产物：`schema/*.schema.json`（JSON Schema draft-07，可直接当校验文件用）、`examples/*.example.json`（填了真实感样例数据的完整示例）。
> 术语以 PRD 第 2 章为准：**Source / Channel / Item / Feed / Snapshot / Report / 去重键 / 源清单 / 分类(Category)**；**v1.1 新增**：**部署分支(deploy) / 当天数据文件 / 历史数据 / 归档 / 通知渠道 / 排除规则**。
> 📖 **NDJSON 是什么、为什么用、浏览器怎么读** → 见 `docs/ndjson-faq.md`；**分支/部署/归档** → 见 `docs/ARCHITECTURE.md` v1.1 §6/§7/§13。

---

## 0. 文件总览

> **【v1.1 变更】** 数据分支由 `data` 改名 **`deploy` 部署分支**；当天数据新增**事件流 NDJSON**；历史改为**年/月目录 + 月度 NDJSON + history-index**；新增 `exclusions.json`、`notify.json`、`archive-index.json`。

| 文件 | 路径（仓库内约定） | 分支 | 生成方 | 消费方 | schema |
|---|---|---|---|---|---|
| 源清单 `sources.json` | `config/sources.json` | **master** | 人（手编） | 采集脚本 + 前端 | `sources.schema.json` |
| 站点配置 `site-config.json` | `config/site-config.json` | **master** | 人（手编） | 前端 + 构建脚本 | `site-config.schema.json` |
| 排除规则 `exclusions.json` 🆕 | `config/exclusions.json` | **master** | 人（手编） | 采集脚本 + 前端 | `exclude-rules.schema.json` |
| 通知配置 `notify.json` 🆕 | `config/notify.json` | **master** | 人（手编） | 通知脚本（Actions） | `notify.schema.json` |
| 当天事件流 `events-<date>.ndjson` 🆕 | `today/` | **deploy** | 采集脚本（**追加**） | 采集脚本（折叠）/ 归档 / 审计 | `snapshot.schema.json`（行内 item） |
| 投影快照 `snapshot-<date>.json` | `today/` | **deploy** | 采集脚本（覆盖写） | 前端 | `snapshot.schema.json` |
| 投影快照 CSV `snapshot-<date>.csv` | `today/` | **deploy** | 采集脚本 | 外部工具 | —（见 §4.3 映射） |
| 当天报告 `report-<date>.json` | `today/` | **deploy** | 分析脚本 | 前端 + 通知 | `report.schema.json` |
| 指针 `latest.json` | `today/` | **deploy** | 采集脚本 | 前端 | —（见 §7.1） |
| 月度归档 `items.ndjson` 🆕 | `history/YYYY/MM/` | **deploy** | 采集脚本（封口时**追加**） | 前端（下钻）/ 离线分析 | `history-item.schema.json`（**行级**） |
| 月元信息 `_meta.json` 🆕 | `history/YYYY/MM/` | **deploy** | 采集脚本 | 脚本 / 审计 | —（见 §8.3） |
| 历史按天快照/报告 | `history/YYYY/MM/snapshot-<date>.json` / `report-<date>.json` | **deploy** | 采集脚本（封口时 move） | 前端（回看某天） | `snapshot/report.schema.json` |
| 历史趋势索引 `history-index.json` 🆕 | `history/` | **deploy** | 采集脚本（每天 append） | 前端（趋势图） | `history-index.schema.json` |
| 归档索引 `archive-index.json` 🆕 | `history/` | **deploy** | 归档脚本（每年） | 前端（归档区） | 内联于 `history-index.schema.json#/definitions/archive` |

**时间格式统一约定**：所有时间字段一律 **ISO 8601 UTC**，形如 `2026-09-12T09:30:00Z`（秒级，结尾 `Z`）。
前端展示时用 `new Date(iso)` 转本地时区（`toLocaleString('zh-CN',{timeZone: 'Asia/Shanghai'})`），相对时间用「x 分钟前」计算。**存储永远是 UTC，展示层负责本地化。**

---

## 1. 源清单 `sources.json`

### 1.1 为什么 `channels` 与 `sources` 分成两个数组？（核心设计决策）

PRD §2 规定「**一个 Channel 可挂载多个 Source（多渠道备份）**」，因此二者是 **一对多** 关系。我们采用**规范化（扁平两表 + 外键）**而非嵌套：

- `channels[]`：逻辑发布方（页面2 卡片、页面3 分类的**基本单位**）。承载展示属性（name/homepage/category/icon/displayLimit/weight）。
- `sources[]`：采集配置（**去哪里拿数据**）。承载采集属性（type/url/auth/fieldMapping/interval/health）。用 `channelId` 外键指回 Channel。

**为什么这样设计**（对比「把 sources 嵌套进 channel」的写法）：

| 考量 | 扁平两表（采用） | 嵌套（未采用） |
|---|---|---|
| 多渠道备份 | 一个 channelId 下挂多条 source，天然支持 | 也支持，但结构更深 |
| 采集健康状态回写 | 脚本只更新 `sources[]`，渠道展示属性不动 | 需深层 patch，易误伤展示字段 |
| 前端消费 | 前端只需 `channels[]` 即可渲染卡片，无需遍历采集配置 | 前端要过滤掉敏感/无关的采集字段 |
| 对比分析（用户诉求） | 可独立对 Source 做健康/成功率对比 | 混在渠道里不便对比 |
| 安全 | `auth` 引用只出现在 sources 层，便于剥离 | 便于一起剥离，但耦合 |
| 稳定性 | 改采集配置不影响渠道 id | 同左 |

**结论**：采用扁平两表。前端渲染页面2 主要读 `channels[]`，仅当需要展示「源地址/健康状态」时才 join `sources[]`。

### 1.2 Source（采集配置）字段字典

| 字段 | 类型 | 必填 | 枚举/取值 | 含义 | 示例值 | 消费方 |
|---|---|---|---|---|---|---|
| `id` | string | 是 | kebab-case | 源唯一标识（主键） | `ruanyifeng-blog-atom` | 脚本 |
| `channelId` | string | 是 | 外键→channels | 所属渠道 | `ruanyifeng-blog` | 脚本/前端 |
| `name` | string | 是 | — | 源名称 | `阮一峰 Atom` | 脚本/前端 |
| `type` | string | 是 | rss/atom/json_feed/local_json/local_csv/feishu_bitable/notion_db/api | 源类型（选接入器） | `atom` | 脚本 |
| `url` | string | 是 | URL 或相对路径 | 源地址 | `https://…/atom.xml` | 脚本 |
| `enabled` | boolean | 是 | true/false | 采集开关 | `true` | 脚本 |
| `auth` | object | 否 | 见 §1.4 | 鉴权引用（**不放明文**） | `{"type":"env","ref":"DEMO_API_KEY"}` | 脚本 |
| `fieldMapping` | object | 否 | 见 §3 | 字段映射规则 | 见示例 | 脚本 |
| `interval` | integer | 否 | ≥5 分钟 | 该源抓取间隔覆盖 | `30` | 脚本 |
| `language` | string | 否 | BCP-47 | 默认语言 | `zh-CN` | 脚本 |
| `pagination` | object | 否 | 见 §3.6 | 翻页策略 | `{"strategy":"cursor",…}` | 脚本 |
| `headers` | object | 否 | — | 静态请求头（**不得放密钥值**） | `{"Accept":"application/json"}` | 脚本 |
| `notes` | string | 否 | — | 备注 | `待核实连通性` | 人 |
| `createdAt` / `updatedAt` | string | 是 | date-time | 创建/更新时间 | `2026-09-01T00:00:00Z` | 脚本/前端 |
| `lastFetchAt` | string | 否 | date-time | 最近抓取时间（脚本回写） | `2026-09-12T09:30:05Z` | 前端 |
| `lastStatus` | string | 否 | ok/error/empty/unknown | 最近抓取状态 | `ok` | 前端 |
| `lastError` | string | 否 | — | 最近错误摘要（截断） | `403 Forbidden` | 前端 |
| `etag` | string | 否 | — | 最近响应 ETag（增量） | `W/"a1b2c3"` | 脚本 |
| `lastModified` | string | 否 | — | 最近响应 Last-Modified（增量） | `Fri, 12 Sep 2026 08:10:00 GMT` | 脚本 |

### 1.3 Channel（逻辑渠道）字段字典

| 字段 | 类型 | 必填 | 枚举/取值 | 含义 | 示例值 | 消费方 |
|---|---|---|---|---|---|---|
| `id` | string | 是 | kebab-case | 渠道唯一标识（主键） | `ruanyifeng-blog` | 脚本/前端 |
| `name` | string | 是 | — | 渠道名称 | `阮一峰的网络日志` | 前端 |
| `homepage` | string | 是 | uri | 渠道首页 | `https://www.ruanyifeng.com/blog/` | 前端 |
| `category` | string[] | 是 | 见 §2 分类枚举 | 分类（多标签） | `["tech_blog"]` | 前端 |
| `enabled` | boolean | 是 | true/false | 渠道总开关 | `true` | 前端/脚本 |
| `displayLimit` | integer | 否 | 1~100 | 页面2 卡片条数（默认 10） | `10` | 前端 |
| `icon` | string | 否 | — | 图标 URL 或首字母 | `阮` | 前端 |
| `language` | string | 否 | BCP-47 | 语言 | `zh-CN` | 前端 |
| `weight` | number | 否 | 0~1 | 渠道权重（热点公式分量） | `0.8` | 脚本 |
| `createdAt` / `updatedAt` | string | 是 | date-time | 创建/更新时间 | `2026-09-01T00:00:00Z` | 脚本/前端 |

> 注：PRD §7.1 把 Source 与 Channel 字段列在一张表里；本设计把它们**按语义拆到两表**，字段**全部覆盖**（`id/name/type/url/homepage/category/enabled/displayLimit/icon/language/auth/fieldMapping/interval/createdAt/updatedAt/lastFetchAt/lastStatus/lastError`）并在合适的一侧落位。

### 1.4 `auth` 密钥注入方式（安全红线）

**绝不在仓库内存放明文密钥**。`auth` 只存 **引用名**：

| `auth.type` | 含义 | 注入方式 |
|---|---|---|
| `none` | 无需鉴权 | — |
| `env` | 本地/CI 环境变量 | 本地：`.env`（已在 `.gitignore`）；CI：`${{ secrets.X }}` |
| `actions_secret` | GitHub Actions Secrets | workflow 中 `env: X: ${{ secrets.X }}` |
| `bearer_env` | 取环境变量值作 `Authorization: Bearer <v>` | 同上，前缀由 `scheme` 指定 |
| `header_env` | 取环境变量值注入到 `headerName` 指定头 | 同上 |
| `query_env` | 取环境变量值拼到查询串 | 同上 |

约定：`auth.ref` 写**变量名**（如 `FEISHU_APP_TOKEN`），脚本运行时用 `process.env[auth.ref]` 读取。**文档与日志中对密钥值做脱敏（只显示前 4 位 + `***`）**。

### 1.5 本地 / 示例如何热加载

- 前端（构建期）：`config/sources.json` 被打进产物，只取 `channels[]`（剥离 `sources[].auth` 等敏感/无关字段）。
- 采集脚本（Actions / 本地）：读全量，含 `sources[]` 采集配置。

---

## 2. 分类（Category）枚举

PRD §9.1 固定枚举，`channels[].category` 与快照/报告中的 `category` 均取自该表：

| key | 中文名 |
|---|---|
| `news` | 新闻资讯 |
| `tech_media` | 科技媒体 |
| `tech_blog` | 技术博客 |
| `ai` | AI |
| `dev_community` | 开发者社区 |
| `product_design` | 产品与设计 |
| `podcast` | 播客 |
| `video` | 视频 |
| `security` | 安全 |
| `opensource` | 开源 |
| `other` | 其他 |

优先级：**显式配置 > 关键词规则 > LLM(P2) > `other`**。

---

## 3. 归一化映射表（接入层核心资产）

> 目标：**任意的异构来源 → 统一的内部 Item**。所有接入器最终都产出同一套 Item 字段（见 §4/快照）。

### 3.1 三种 Feed 格式 → Item（RSS 2.0 / Atom 1.0 / JSON Feed 1.1）

| 内部 Item 字段 | RSS 2.0 | Atom 1.0 | JSON Feed 1.1 |
|---|---|---|---|
| `title` | `item.title` | `entry.title` | `items[].title` |
| `url` | `item.link` | `link[rel=alternate].href` | `items[].url` |
| `guid` | `item.guid` | `entry.id` | `items[].id` |
| `summary` | `item.description`（去 HTML、截断）；优先 `content:encoded` 时也去标签 | `entry.summary`；无则取 `content` | `items[].summary`；无则 `items[].content_text` |
| `author` | `item.author` 或 `dc:creator` | `entry.author.name` | `items[].author.name` |
| `publishedAt` | `item.pubDate`（**RFC 822 → ISO 8601 UTC**） | `entry.published`（RFC 3339） | `items[].date_published` |
| `updatedAt` | `item.pubDate`（RSS 无 updated 时回退） | `entry.updated` | `items[].date_modified` 或回退 `date_published` |
| `tags` | `item.category[*]` | `entry.category[*].term` | `items[].tags[*]` |
| `mediaType` | 有 `enclosure` 且 type 含 audio/video → podcast/video | 同左 | `attachments[]` 判断 |
| `language` | `channel.language` | `feed.lang` | `language` |
| Channel：`channelName` | `channel.title` | `feed.title` | `title` |
| Channel：`homepage` | `channel.link` | `link[rel=alternate]` | `home_page_url` |
| Channel：`sourceUrl` | `atom:link[rel=self]` | `link[rel=self]` | `feed_url` |

**时间解析要点**：RSS `pubDate` 是 RFC 822（`Sat, 06 Dec 2025 10:00:00 GMT`），解析后**统一转 UTC 秒级 ISO**；缺失或非法时间则回退到 `fetchedAt` 并在日志告警。

### 3.2 本地 JSON / 通用 API → Item（FieldMapping: jsonpath 模式）

`fieldMapping.itemsPath` 定位条目数组，`fieldMapping.map` 定义「内部字段 → 源字段 JSONPath」：

```jsonc
{
  "mode": "jsonpath",
  "itemsPath": "$.data.items[*]",
  "map": {
    "title": "$.attributes.title",
    "url": "$.links.self",
    "publishedAt": "$.attributes.created_at",
    "summary": "$.attributes.abstract",
    "author": "$.attributes.author.name"
  },
  "typeCoercion": { "publishedAt": "date" },
  "defaults": { "language": "zh-CN" }
}
```

- `map` 的 key 必须是**内部字段名**（见 §4.1 Item 字段字典），value 是 **JSONPath**。
- 未被 `map` 覆盖的内部字段走**默认规则**（如 `id/dedupKey` 由系统生成，`fetchedAt` 由系统填）。
- `typeCoercion` 处理类型转换（字符串时间→date、逗号分隔串→array）。
- `defaults` 兜底。

### 3.3 本地 CSV → Item（FieldMapping: header 模式）

`fieldMapping.map` 的 value = **CSV 表头列名**：

```jsonc
{ "mode": "header", "map": { "title": "标题", "url": "链接", "publishedAt": "发布时间", "summary": "摘要", "author": "作者", "tags": "标签" }, "typeCoercion": { "publishedAt": "date", "tags": "array" } }
```

- 约定编码 UTF-8，首行为表头；`tags` 列用 `|` 分隔（写入时同理）。
- 解析库建议 `papaparse`（流式、容错强）。

### 3.4 飞书多维表格 → Item（FieldMapping: table 模式）

- 地址：`GET https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records`
- `map` 的 value = **列名**：`{"title":"标题","url":"链接","publishedAt":"发布时间","summary":"摘要","author":"作者","tags":"标签"}`。
- 飞书单元格是**富文本/多值结构**（如 `{"text":"…","type":"text"}`、多选数组），需做**取值展开**：取 `.text` 或数组 join。
- 鉴权：`Authorization: Bearer <tenant_access_token>`；`auth.type=actions_secret`，`ref=FEISHU_APP_TOKEN`（也需 `FEISHU_APP_SECRET` 换 token）。

### 3.5 Notion 数据库 → Item（FieldMapping: table 模式）

- 地址：`POST https://api.notion.com/v1/databases/{database_id}/query`
- `map` 的 value = **属性名（property name）**。
- Notion 属性是**按类型包装**的（`title[0].plain_text`、`rich_text[0].plain_text`、`date.start`、`select.name`、`multi_select[].name`），需按 `type` 解包。
- 鉴权：`Authorization: Bearer <integration_token>` + `Notion-Version: 2022-06-28`。

### 3.6 通用 API → Item

- 鉴权：`auth` 指定头名 + 环境变量引用（见 §1.4）。
- 分页：`pagination.strategy` ∈ `none/page/offset/cursor/link_header`；`cursor` 用 `cursorPath` 从响应取下一页游标；上限 `maxPages`。
- 字段映射：同 §3.2（jsonpath）。

### 3.7 归一化总原则

1. **一律先归一化再入库**：接入器只负责「源格式 → Item 原始字段」，`Normalizer` 统一做时间、去 HTML、截断、补 Channel 冗余字段、生成 `id/dedupKey`。
2. **缺失必填字段的处理**：缺 `url` 的条目直接丢弃并记 warning；缺 `title` 用 `url` 兜底。
3. **统一编码 UTF-8**，去除 BOM、控制字符。
4. **summary 只存纯文本**，去标签、解码实体、压缩空白、按 `analysis.summaryMaxChars`（默认 200 字符）截断。

---

## 4. 当天数据 `today/`（事件流 + 投影快照）

> **【v1.1 变更】** 当天数据由「单一快照文件（读-合并-写）」改为**双写**：
> - **`events-<date>.ndjson`**：**事件流**，每轮采集把本次条目**追加**（append-only，真·追加），用于折叠（last-write-wins）与审计。
> - **`snapshot-<date>.json`**：**投影快照**，由事件流折叠 + 去重归并后**覆盖写**，供前端**一次 `JSON.parse`**。
>
> 目录从 `data/snapshots/` 调整为 **`deploy` 分支的 `today/`**。事件流为何用 NDJSON → 见 `docs/ndjson-faq.md`；双写方案与伪代码 → 见 `docs/ARCHITECTURE.md §6.7`。

### 4.1 文件级元信息 + Item 字段字典

文件级：

| 字段 | 类型 | 必填 | 含义 | 示例 |
|---|---|---|---|---|
| `schemaVersion` | string | 是 | 格式版本 | `1.0` |
| `date` | string | 是 | 所属自然日（Asia/Shanghai 切日） | `2026-09-12` |
| `timezone` | string | 是 | 固定 `Asia/Shanghai` | `Asia/Shanghai` |
| `generatedAt` | string | 是 | 快照生成时间（UTC） | `2026-09-12T09:30:12Z` |
| `stats` | object | 是 | 采集统计（见下） | — |
| `items` | Item[] | 是 | 去重后条目 | — |

`stats`：`sourceTotal`（源数）/`sourceOk`（成功）/`sourceFailed`（失败）/`itemsBeforeDedup`（去重前）/`itemsAfterDedup`（去重后）/`mergedCount`（被归并数）/`durationMs`（耗时）。

Item 字段字典（覆盖 PRD §7.2 全部字段）：

| 字段 | 类型 | 必填 | 含义 | 示例 | 消费方 |
|---|---|---|---|---|---|
| `id` | string | 是 | 内部唯一 id（`it_` + 12 hex，见 §4.4） | `it_9f2c1a7b3e5d` | 脚本/前端 |
| `guid` | string | 否 | 源提供唯一 ID | `https://…/weekly-324.html` | 脚本 |
| `title` | string | 是 | 标题 | `科技爱好者周刊（第 324 期）…` | 前端 |
| `url` | string | 是 | 原文链接（原始，未标准化） | `https://…/weekly-324.html?utm_source=rss` | 前端 |
| `urlStatus` 🆕 | string | 否 | URL 健康状态（v1.4 新增）：`ok` 可访问 / `dead` 失效（404/410）/ `moved` 永久跳转（301/308）/ `blocked` 被反爬拦截（403/429）；缺省 = 未检查，按 `ok` 展示 | `ok` | 前端 |
| `urlCheckedAt` 🆕 | string | 否 | 最近一次 URL 健康检查时间（UTC）；未检查过则缺省 | `2026-09-12T10:00:00Z` | 脚本/前端 |
| `summary` | string | 否 | 纯文本摘要（≤300，默认 ≤200 字符） | `本期主题是…` | 前端 |
| `author` | string | 否 | 作者 | `阮一峰` | 前端 |
| `channelId` | string | 是 | 所属渠道 id | `ruanyifeng-blog` | 前端 |
| `channelName` | string | 是 | 渠道名（冗余） | `阮一峰的网络日志` | 前端 |
| `category` | string[] | 是 | 分类（冗余自 Channel） | `["tech_blog"]` | 前端 |
| `publishedAt` | string | 是 | 发布时间（UTC） | `2026-09-12T00:05:00Z` | 前端 |
| `updatedAt` | string | 是 | 更新时间（UTC） | `2026-09-12T01:20:00Z` | 前端 |
| `fetchedAt` | string | 是 | 抓取时间（UTC） | `2026-09-12T09:30:05Z` | 脚本 |
| `sourceUrl` | string | 否 | 来源 Feed/接口地址 | `https://…/weekly/rss.xml` | 前端 |
| `sourceType` | string | 否 | 来源类型 | `rss` | 脚本 |
| `tags` | string[] | 否 | 标签 | `["AI","编程助手"]` | 前端 |
| `dedupKey` | string | 是 | 去重键（sha256 hex） | `8f0c1d2e…` | 脚本 |
| `duplicateOf` | string\|null | 否 | 重复时指向主条目 id | `it_9f2c1a7b3e5d` | 前端 |
| `sourceCount` | integer | 否 | 归并源数（≥1） | `2` | 前端/脚本 |
| `sources` | object[] | 否 | 所有来源（自身+被归并） | 见示例 | 前端 |
| `isNew` | boolean | 否 | 是否当天首次出现 | `true` | 前端 |
| `hotScore` | number\|null | 否 | 热度分 0~1 | `0.87` | 前端 |
| `language` | string | 否 | 语言 | `zh-CN` | 前端 |
| `mediaType` | string | 否 | 内容形态 | `article` | 前端 |

`sources[]` 元素：`{channelId, channelName, url, publishedAt?}`。

### 4.2 时间字段统一格式与前端本地化

- **存储**：全部 UTC `YYYY-MM-DDTHH:mm:ssZ`。
- **前端展示**：`new Date(iso)` → 绝对时间用 `toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })`；相对时间自算「x 分钟/小时前」。
- **切日**：`date` 字段由 `Asia/Shanghai` 时区计算（`UTC+8`），见 §6 跨天规则。

### 4.3 JSON ↔ CSV 字段映射

CSV 为**一行一条 Item 的扁平表**，列顺序固定：

| CSV 列 | 来源字段 | 序列化规则 |
|---|---|---|
| `id` | `id` | 原样 |
| `guid` | `guid` | 原样，空则空串 |
| `title` | `title` | 原样（含逗号/换行时按 RFC 4180 加双引号转义） |
| `url` | `url` | 原样 |
| `summary` | `summary` | 原样 |
| `author` | `author` | 原样 |
| `channelId` | `channelId` | 原样 |
| `channelName` | `channelName` | 原样 |
| `category` | `category[]` | **`\|` 连接**，如 `tech_blog\|news` |
| `publishedAt` | `publishedAt` | ISO UTC |
| `updatedAt` | `updatedAt` | ISO UTC |
| `fetchedAt` | `fetchedAt` | ISO UTC |
| `sourceUrl` | `sourceUrl` | 原样 |
| `sourceType` | `sourceType` | 原样 |
| `tags` | `tags[]` | **`\|` 连接** |
| `dedupKey` | `dedupKey` | 原样 |
| `duplicateOf` | `duplicateOf` | 空则空串 |
| `sourceCount` | `sourceCount` | 数字 |
| `sources` | `sources[]` | **JSON 字符串**（整段用双引号包裹并转义内部引号） |
| `isNew` | `isNew` | `true/false` |
| `hotScore` | `hotScore` | 数字或空 |
| `language` | `language` | 原样 |
| `mediaType` | `mediaType` | 原样 |

**序列化规则总结**：
- 标量数组（`category`/`tags`）→ `|` 连接（内部 `|` 需先转义为 `\|`）。
- 对象数组（`sources`）→ 单列存 JSON 字符串（RFC 4180 引用转义）。
- 时间统一 UTC ISO。
- CSV 仅作**辅助/外部分析**用途，**字段以 JSON 为准**；CSV 不含文件级元信息（日期已在文件名）。

### 4.4 `id` 与 `dedupKey` 生成规则（接入层生成）

- `id = "it_" + sha256(dedupKey).slice(0,12)`，全局稳定、幂等（同一文章每次跑生成同一个 id）。
- `dedupKey` 见「去重算法设计」（ARCHITECTURE.md §4）。

### 4.5 当天事件流 `events-<date>.ndjson`（v1.1 新增，append-only）

**每行一个事件对象**（NDJSON）；采集脚本每轮把本次（归一化 + 排除后的）条目**追加**成一行，**永不改写已有行**。

| 字段 | 类型 | 必填 | 含义 | 示例 |
|---|---|---|---|---|
| `op` | string | 是 | 操作：`upsert`（新增/更新） / `remove`（预留） | `upsert` |
| `runId` | string | 是 | 本轮采集标识（`YYYYMMDDTHHmm`） | `20260912T0930` |
| `fetchedAt` | string | 是 | 本轮抓取时间（UTC） | `2026-09-12T09:30:05Z` |
| `item` | object | 是 | 完整 Item 对象（字段同 §4.1 Item 字典） | `{ ... }` |

**行示例**：
```ndjson
{"op":"upsert","runId":"20260912T0930","fetchedAt":"2026-09-12T09:30:05Z","item":{"id":"it_9f2c1a7b3e5d","title":"科技爱好者周刊（第 324 期）…","url":"https://…/weekly-324.html","channelId":"ruanyifeng-blog","channelName":"阮一峰的网络日志","category":["tech_blog"],"publishedAt":"2026-09-12T00:05:00Z","updatedAt":"2026-09-12T01:20:00Z","fetchedAt":"2026-09-12T09:30:05Z","dedupKey":"8f0c1d2e…","sourceCount":2,"isNew":true,"hotScore":0.87}}
{"op":"upsert","runId":"20260912T1000","fetchedAt":"2026-09-12T10:00:07Z","item":{"id":"it_9f2c1a7b3e5d","...":"...","updatedAt":"2026-09-12T10:00:06Z"}}
```

**折叠规则（last-write-wins）**：按 `item.id` 取**最后出现的那一行**即为该条目的当前状态（同 id 再次出现 = 更新）。`id = sha256(dedupKey)` 稳定 → 同文章永远同 id。→ 得到「当前状态 Map」后再做 §4.5 之外的**跨源归并**（ARCHITECTURE §4.5），投影成 `snapshot-<date>.json`。

> **行级校验**：事件流按 `snapshot.schema.json#/definitions/item` 校验**每一行的 `item`**；`op/runId/fetchedAt` 为事件包装字段（可用 `scripts/validate-schema.mjs --ndjson` 校验）。

---

## 5. 当日报告 `report-YYYY-MM-DD.json`

字段字典（覆盖 PRD §7.3）：

| 字段 | 类型 | 必填 | 含义 | 消费方 |
|---|---|---|---|---|
| `date` | string | 是 | 报告日期 | 前端 |
| `timezone` | string | 是 | 固定 `Asia/Shanghai` | 前端 |
| `generatedAt` | string | 是 | 生成时间（UTC） | 前端 |
| `windowStart` / `windowEnd` | string | 否 | 数据时间窗（UTC） | 前端 |
| `totalItems` | integer | 是 | 当天去重后条目数 | 前端 |
| `activeChannels` | integer | 是 | 当天有更新的渠道数 | 前端 |
| `weights` | object | 否 | 本次热度权重（可复现） | 前端/脚本 |
| `summary` | string | 否 | 一句话摘要 | 前端 |
| `categoryStats` | object[] | 是 | 各分类条数/占比 | 前端 |
| `hotList` | object[] | 是 | 热点榜 TOP N | 前端 |
| `keywords` | object[] | 否 | 关键词及频次 | 前端 |
| `crossSource` | object[] | 否 | 跨源重合主题 | 前端 |
| `channelActivity` | object[] | 否 | 渠道活跃排行 | 前端 |

`hotList` 元素：`{rank, id, title, url, channelId, channelName, category[], hotScore, sourceCount, channelNames[], publishedAt, components{}}`。`components` 保存热度各分量，用于**可解释性**（页面3「方法论说明」）。

---

## 6. 站点配置 `site-config.json`

### 6.1 站点默认配置（进仓库） vs 用户本地偏好（localStorage）

| | 站点默认 | 用户本地偏好 |
|---|---|---|
| 存储 | `config/site-config.json`（提交进 main） | 浏览器 `localStorage`（key: `rss-radar:prefs:v1`） |
| 谁改 | 维护者 | 访客自己 |
| 字段 | `display`（defaultChannels/cardLimit/page1BatchSize/defaultSort/hotListSize/showWordCloud/…） | 同 `display` 的子集（用户可覆盖项） |
| 生效 | 构建期读入为**基线** | 运行时读取，覆盖基线，即时生效、无需重建 |

### 6.2 合并规则与优先级

```
生效配置 = deepMerge(站点默认.display, 用户本地偏好)
优先级：用户本地偏好  >  站点默认  >  内置硬编码兜底
```

- **浅合并（顶层键覆盖）**，数组字段**整体替换**（用户选了渠道列表就完全以用户为准，不做并集）。
- 用户「恢复默认」= 清空该 key 的 localStorage。
- 站点配置仅含 `display` 子集可被用户覆盖；`analysis`/`network`/`site` 段为**只读**（前端不覆盖）。

### 6.3 字段字典（关键项）

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `site.baseUrl` | string | raw/CDN 基址 | 运行时数据外链基址（见 ARCHITECTURE §7） |
| `site.dataBranch` | string | **`deploy`**（v1.1 改名） | 数据分支（原 `data` 作废） |
| `display.defaultChannels` | string[] | `[]`（全部启用） | 默认展示渠道 |
| `display.cardLimit` | integer | 10 | 页面2 每卡片条数 |
| `display.page1BatchSize` | integer | 20 | 页面1 每批条数 |
| `display.defaultSort` | string | `updatedAt` | 页面1 默认排序 |
| `display.hotListSize` | integer | 10 | 热点榜条数 |
| `display.showWordCloud` | boolean | false | 词云开关 |
| `analysis.titleSimilarityThreshold` | number | 0.9 | L3 相似度阈值 |
| `analysis.summaryMaxChars` | integer | 200 | 摘要截断（合规） |
| `analysis.halfLifeHours` | number | 6 | 时间衰减半衰期 |
| `analysis.weights` | object | 见示例 | 热点权重 |
| `network.timeoutMs/retries/concurrency` | integer | 15000/2/6 | 抓取网络参数 |
| **`deploy.branch`** 🆕 | string | `deploy` | 数据所在部署分支名 |
| **`deploy.dataBaseUrl`** 🆕 | string | raw/CDN 基址 | 数据读取基址（deploy 分支 raw/CDN） |
| **`history.windowDays`** 🆕 | integer | 90 | 页面4 趋势默认窗口（天） |
| **`history.windowOptions`** 🆕 | integer[] | `[90,180,365]` | 可选窗口集合 |
| **`history.visibleDays`** 🆕 | integer | 365 | 前端历史可见范围（天） |
| **`history.showArchive`** 🆕 | boolean | true | 是否显示归档年份区 |
| **`notify.dailyReportTime`** 🆕 | string | `08:00` | 每日推送时间（本地时区） |
| **`notify.realtime.enabled`** 🆕 | boolean | false | 实时推送总开关 |
| **`notify.realtime.hotScoreThreshold`** 🆕 | number | 0.8 | 实时热点分阈值 |
| **`notify.realtime.sourceCountThreshold`** 🆕 | integer | 3 | 实时跨源数阈值 |
| **`notify.realtime.maxPerDay`** 🆕 | integer | 10 | 每日实时推送上限 |
| **`notify.quietHours`** 🆕 | string | `23:00-07:00` | 免打扰时段 |

> 完整的 v1.1 新增配置项语义与默认值见 PRD §14；`site-config.schema.json` 已同步扩展。

---

## 7. 版本与兼容

- `schemaVersion` 语义化：**主版本**变更=破坏性（前端需适配），**次版本**变更=向后兼容新增字段。
- 前端读到未知 `schemaVersion` 主版本 → 展示降级提示，仍尝试渲染已知字段（**宽容解析**）。
- 数据文件为**纯 JSON / NDJSON（纯文本）**，无需数据库；校验用配套 `schema/*.schema.json`（可在 CI 与采集脚本中运行校验，失败即告警）。
  - **JSON 文件**：整文件套 `schema`。
  - **NDJSON 文件**（`events-*.ndjson`、`items.ndjson`）：**逐行**套行级 schema（每行的对象独立校验；跨行约束由脚本断言，如"所有行 `date` 一致"）。

---

## 8. 历史数据（`deploy` 分支 `history/`）（v1.1 新增）

> 详见 `docs/ARCHITECTURE.md §6.8 / §13`；趋势读取策略见 `docs/ndjson-faq.md §3`。

### 8.1 历史数据的三件套与用途

| 文件 | 用途 | 前端读取时机 | schema |
|---|---|---|---|
| `history-index.json` | **天级滚动聚合**（趋势图） | 页面4 打开时（1 次） | `history-index.schema.json` |
| `history/YYYY/MM/items.ndjson` | **月度全部条目**（明细/批量分析） | 用户下钻某月（1 次/月） | `history-item.schema.json` |
| `history/YYYY/MM/snapshot-<date>.json` | **按天完整快照**（回看某天） | 用户选某天（1 次） | `snapshot.schema.json` |
| `history/archive-index.json` | **归档可发现性**（>1 年） | 页面4 归档区（1 次） | `history-index.schema.json#/definitions/archive*` |

### 8.2 月度归档 `history/YYYY/MM/items.ndjson` 行格式（行级 schema）

**一行一个 Item 的"精简行"**（不含 `summary`/`sources[]`，以控制体积；需要完整字段时改读该天的 `snapshot-<date>.json`）。

| 字段 | 类型 | 必填 | 含义 | 示例 |
|---|---|---|---|---|
| `id` | string | 是 | 条目 id | `it_9f2c1a7b3e5d` |
| `dedupKey` | string | 是 | 去重键（跨天去重） | `8f0c1d2e…` |
| `title` | string | 是 | 标题 | `科技爱好者周刊（第 324 期）…` |
| `url` | string | 是 | 原文链接 | `https://…/weekly-324.html` |
| `channelId` | string | 是 | 渠道 id | `ruanyifeng-blog` |
| `channelName` | string | 是 | 渠道名 | `阮一峰的网络日志` |
| `category` | string[] | 是 | 分类 | `["tech_blog"]` |
| `publishedAt` | string | 是 | 发布时间（UTC） | `2026-09-12T00:05:00Z` |
| `updatedAt` | string | 是 | 更新时间（UTC） | `2026-09-12T01:20:00Z` |
| `sourceCount` | integer | 否 | 归并源数 | `2` |
| `hotScore` | number\|null | 否 | 热度分 | `0.87` |
| `date` | string | 是 | 归属自然日（Asia/Shanghai） | `2026-09-12` |

```ndjson
{"id":"it_9f2c1a7b3e5d","dedupKey":"8f0c1d2e…","title":"科技爱好者周刊（第 324 期）…","url":"https://…/weekly-324.html","channelId":"ruanyifeng-blog","channelName":"阮一峰的网络日志","category":["tech_blog"],"publishedAt":"2026-09-12T00:05:00Z","updatedAt":"2026-09-12T01:20:00Z","sourceCount":2,"hotScore":0.87,"date":"2026-09-12"}
```

**写入方式**：每天封口时，把该天最终状态的条目 **`>>` 追加**到当月 `items.ndjson`（O(1)）；月末封口后**只读不写**，天然不可变、可校验。

### 8.3 月元信息 `history/YYYY/MM/_meta.json`（NDJSON 缺"文档头"的补丁）

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `schemaVersion` | string | 是 | 版本 |
| `year` / `month` | integer | 是 | 归属年月 |
| `itemCount` | integer | 是 | 行数（`wc -l` 可校对） |
| `bytes` | integer | 是 | 文件字节数 |
| `days` | string[] | 是 | 覆盖的日期列表 |
| `sha256` | string | 否 | 文件校验和 |
| `sealed` | boolean | 是 | 是否已封口（封口后只读） |

### 8.4 `history-index.json` 字段字典（天级滚动聚合）

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `schemaVersion` | string | 是 | 版本 |
| `updatedAt` | string | 是 | 更新时间（UTC） |
| `days[]` | array | 是 | 天级聚合数组 |
| `days[].date` | string | 是 | 某天 `YYYY-MM-DD` |
| `days[].totalItems` | integer | 是 | 当天去重后条目数 |
| `days[].activeChannels` | integer | 是 | 当天有更新的渠道数 |
| `days[].categoryStats` | object | 否 | 各分类条数（`{category: count}`） |
| `days[].topKeywords` | string[] | 否 | 当天高频关键词 |
| `days[].topIds` | string[] | 否 | 当天热点条目 id |
| `days[].sourceOk` / `sourceFailed` | integer | 否 | 源成功/失败数（健康趋势） |

> 体积：一年 365 天 ≈ **91KB**（gzip ~25KB），**一次 fetch 出全部趋势**。

---

## 9. 排除规则 `config/exclusions.json`（v1.1 新增）

> 详见 `docs/ARCHITECTURE.md §11`。三级粒度：整源停用 / 条目级 / 分类级。

### 9.1 文件级字段

| 字段 | 类型 | 必填 | 默认 | 含义 |
|---|---|---|---|---|
| `schemaVersion` | string | 是 | `1.0` | 版本 |
| `updatedAt` | string | 是 | — | 更新时间 |
| `rules[]` | array | 是 | `[]` | 规则数组 |

### 9.2 规则对象字段字典（`rules[]`）

| 字段 | 类型 | 必填 | 枚举/取值 | 含义 |
|---|---|---|---|---|
| `id` | string | 是 | kebab-case | 规则唯一标识 |
| `level` | string | 是 | `channel` / `item` / `category` | 三级粒度 |
| `scope` | string | 是 | `global` / `source:<id>` / `channel:<id>` / `category:<key>` | 生效范围 |
| `type` | string | 条目级必填 | `keyword` / `domain` / `url` / `title_regex` | 匹配方式 |
| `value` | string\|string[] | 条目级必填 | — | 规则值（关键词/域名/URL/正则） |
| `matchMode` | string | 否 | `contains` / `equals` / `regex` | 匹配语义 |
| `caseSensitive` | boolean | 否 | 默认 false | 是否区分大小写 |
| `enabled` | boolean | 是 | true/false | 开关 |
| `note` | string | 否 | — | 备注（为何排除） |
| `hitCount` | integer | 否 | ≥0 | 命中条数（脚本回填） |

**匹配时机**：**归一化 + 分类之后、去重之前**（保证 `sourceCount` 不被排除源污染）。**正则一律过 `re2` + `safe-regex`** 防 ReDoS。

---

## 10. 通知配置 `config/notify.json`（v1.1 新增）

> 详见 `docs/ARCHITECTURE.md §12`。**密钥只存引用名，值走 GitHub Secrets。**

### 10.1 文件级字段

| 字段 | 类型 | 必填 | 默认 | 含义 |
|---|---|---|---|---|
| `schemaVersion` | string | 是 | `1.0` | 版本 |
| `defaults.timezone` | string | 否 | `Asia/Shanghai` | 默认时区 |
| `defaults.dailyReportTime` | string | 否 | `08:00` | 默认推送时间 |
| `defaults.retry` | object | 否 | `{max:2,backoffMs:[1000,3000]}` | 重试策略 |
| `channels[]` | array | 是 | `[]` | 通知渠道数组 |
| `realtime.enabled` | boolean | 否 | false | 实时总开关 |
| `realtime.hotScoreThreshold` | number | 否 | 0.8 | 热点分阈值 |
| `realtime.sourceCountThreshold` | integer | 否 | 3 | 跨源数阈值 |
| `realtime.maxPerDay` | integer | 否 | 10 | 每日上限 |
| `quietHours` | string | 否 | `23:00-07:00` | 免打扰时段 |

### 10.2 渠道对象字段字典（`channels[]`）

| 字段 | 类型 | 必填 | 枚举/取值 | 含义 |
|---|---|---|---|---|
| `id` | string | 是 | kebab-case | 渠道实例标识 |
| `channelType` | string | 是 | `email` / `feishu` / `dingtalk` / `wecom` | 渠道类型（选适配器） |
| `enabled` | boolean | 是 | true/false | 独立开关 |
| `events` | string[] | 是 | `dailyReport` / `realtime` | 订阅事件 |
| `refs` | object | 是 | `{密钥名: Secrets变量名}` | **密钥引用名**（值走 Secrets） |
| `smtpHost`/`smtpPort`/`secure` | string/int/bool | 邮箱必填 | — | SMTP 服务器 |
| `from` / `to[]` | string / string[] | 邮箱必填 | — | 发件人 / 收件人 |
| `webhookRef` | string | webhook 渠道 | — | 群机器人 webhook 引用名 |
| `signSecretRef` | string | 钉钉/飞书条件 | — | 加签密钥引用名 |
| `corpId`/`agentId`/`toUser`/`toParty` | string | 企微应用消息必填 | — | 企业微信参数 |

> **`refs` 约定**：与 §1.4 `auth` 一致——**只写变量名**（如 `SMTP_PASSWORD` / `FEISHU_WEBHOOK`），运行时 `process.env[ref]`；文档与日志对密钥值脱敏。

---

## 11. 归档索引 `history/archive-index.json`（v1.1 新增）

> 详见 `docs/ARCHITECTURE.md §6.9 / §13.3`。Release 资产**无稳定 raw/CORS 直读 URL** → 站内只读元数据 + 跳 Release 下载。

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `schemaVersion` | string | 是 | 版本 |
| `archives[]` | array | 是 | 归档年份数组 |
| `archives[].year` | integer | 是 | 归档年份 |
| `archives[].releaseTag` | string | 是 | Release 标识（如 `archive-2025`） |
| `archives[].releaseUrl` | string | 是 | Release 链接（跳转下载） |
| `archives[].months[]` | array | 是 | `{month, itemCount, bytes, sha256}` |
| `archives[].generatedAt` | string | 是 | 生成时间 |

# RSS Radar 多源接入指南（SOURCES）

> 本文档最后与代码同步于 commit `8b9eab8`。
>
> 目标：让你**零代码**加一个具体源，或在需要时新增一种「来源类型」。
> 相关文档：[`USAGE.md`](./USAGE.md)（使用流程）、[`NOTIFY.md`](./NOTIFY.md)（通知）、[`DEPLOYMENT.md`](./DEPLOYMENT.md)（部署）。

---

## 1. 两种「加源」

| 场景 | 改动 | 见 |
|---|---|---|
| 加一个**具体源**（已支持的类型） | 只改 `config/sources.json` | §4 |
| 加一种**来源类型**（新数据形态） | 写 connector 文件 + 注册一行（+ 可选扩 schema） | §5 |

权威配置样本：`config/sources.json`（当前 8 个渠道 / 8 个源，全部是 `rss` / `atom`）。字段定义参考 `docs/data-model/schema/sources.schema.json`。

---

## 2. 连接器 type 清单（**8 种，以注册表为准**）

`scripts/collect/connectors/index.mjs` 是唯一注册入口。**真实的 type 取值**为：

| type | 连接器文件 | 用途 | 鉴权 |
|---|---|---|---|
| `rss` | `feed-rss.mjs` | RSS 2.0 / RDF | 无 |
| `atom` | `feed-atom.mjs` | Atom | 无 |
| `json_feed` | `feed-json.mjs` | JSON Feed v1.1 | 无 |
| `local_json` | `local-json.mjs` | 仓库内本地 JSON 文件 | 无 |
| `local_csv` | `local-csv.mjs` | 仓库内本地 CSV 文件 | 无 |
| `feishu_bitable` | `feishu-bitable.mjs` | 飞书多维表格（Bitable v2） | `tenant_access_token` |
| `notion_db` | `notion-db.mjs` | Notion Database | Bearer token |
| `generic_api` | `generic-api.mjs` | 通用 REST API（声明式分页 + 字段映射） | none / bearer / api_key |

> ⚠️ **`generic_api` 不是 `api`**。早期文档（如 `docs/ARCHITECTURE.md §10`、`docs/IMPLEMENTATION_PLAN.md T-P4-06` 与 `docs/data-model/examples/sources.example.json`）里的 `api` 是**过时叫法**；`sources.schema.json` 的 `type` 枚举与注册表**都是 `generic_api`**。
>
> ⚠️ `sources.example.json` 里仍写着 `"type": "api"`，且使用下文 §3.1 的旧 `fieldMapping` 形状——该 example **未经运行时校验**，接入时以本文档与连接器源码为准。

---

## 3. 各连接器配置示例

> 示例均写在 `config/sources.json` 的 `sources[]` 里；`channelId` 必须指向 `channels[]` 中已存在的 id。

### 3.1 Feed 三兄弟：`rss` / `atom` / `json_feed`

这三个连接器**按协议原生解析**，**不使用** `fieldMapping` / `pagination`——只认 `url`。以下三条直接取自 `config/sources.json`（真实可访问）：

```jsonc
// atom
{
  "id": "ruanyifeng-blog-atom",
  "channelId": "ruanyifeng-blog",
  "name": "阮一峰 Atom",
  "type": "atom",
  "url": "https://www.ruanyifeng.com/blog/atom.xml",
  "enabled": true,
  "language": "zh-CN",
  "interval": 30,
  "createdAt": "2026-09-01T00:00:00Z",
  "updatedAt": "2026-09-01T00:00:00Z"
}
```

```jsonc
// rss
{
  "id": "v2ex-hot",
  "channelId": "v2ex",
  "name": "V2EX 热帖",
  "type": "rss",
  "url": "https://www.v2ex.com/feed/tab/hot.xml",
  "enabled": true,
  "language": "zh-CN",
  "interval": 30,
  "createdAt": "2026-09-01T00:00:00Z",
  "updatedAt": "2026-09-01T00:00:00Z"
}
```

```jsonc
// json_feed（JSON Feed v1.1）
{
  "id": "example-json-feed",
  "channelId": "example-channel",
  "name": "Example JSON Feed",
  "type": "json_feed",
  "url": "https://example.com/feed.json",
  "enabled": false,
  "language": "en",
  "interval": 60,
  "createdAt": "2026-10-01T00:00:00Z",
  "updatedAt": "2026-10-01T00:00:00Z"
}
```

- `interval`：该源抓取间隔（分钟，schema 最小值 5）。`etag` / `lastModified` 由采集脚本回写，用于增量条件请求（304 时跳过解析）。
- `url`：HTTPS 地址。

### 3.2 本地文件：`local_json` / `local_csv`

`url` 是**仓库内相对路径**，由连接器用 `resolve(process.cwd(), url)` 读取（即相对于运行 `npm run collect` 时的当前目录）。

**`local_json`** 使用 schema 兼容的 `fieldMapping`（`mode` / `itemsPath` / `map` / `typeCoercion` / `defaults`）：

```jsonc
{
  "id": "v2ex-json-backup",
  "channelId": "v2ex",
  "name": "V2EX（本地 JSON 备份）",
  "type": "local_json",
  "url": "config/local/v2ex-backup.json",
  "enabled": false,
  "language": "zh-CN",
  "interval": 30,
  "fieldMapping": {
    "mode": "jsonpath",
    "itemsPath": "$.topics[*]",
    "map": {
      "title": "$.title",
      "url": "$.link",
      "publishedAt": "$.created",
      "summary": "$.excerpt",
      "author": "$.author"
    },
    "typeCoercion": { "publishedAt": "date" },
    "defaults": { "language": "zh-CN" }
  },
  "createdAt": "2026-10-01T00:00:00Z",
  "updatedAt": "2026-10-01T00:00:00Z"
}
```

> `local_json` 的 jsonpath 是**极简实现**（`local-json.mjs`）：只支持 `$.a.b[*]` 形式的「键 + `[*]`」，`map` 里的路径用 `$.a.b` 逐段取值，**不支持 filter / 通配**。`defaults` 会作为基础对象再被 `map` 结果覆盖。
>
> ⚠️ 仓库内**当前不存在 `config/local/` 目录**，需要你先放数据文件（并把该目录纳入版本管理）。

**`local_csv`** 使用 `fieldMapping.map`（内部字段 → CSV 表头名）：

```jsonc
{
  "id": "my-csv-backup",
  "channelId": "example-channel",
  "name": "本地 CSV 备份",
  "type": "local_csv",
  "url": "config/local/items.csv",
  "enabled": false,
  "language": "zh-CN",
  "interval": 60,
  "fieldMapping": {
    "mode": "header",
    "map": { "title": "标题", "url": "链接", "publishedAt": "发布时间", "summary": "摘要" }
  },
  "createdAt": "2026-10-01T00:00:00Z",
  "updatedAt": "2026-10-01T00:00:00Z"
}
```

> `local_csv` 用 `papaparse`（`header: true`）解析，按 `map` 的「内部字段 → 列名」取值；`publishedAt` 会被 `new Date()` 归一。

### 3.3 声明式三兄弟：`feishu_bitable` / `notion_db` / `generic_api`

> 🔴 **务必先读 §6 的「字段形状分歧」**。这三个连接器**不读取** `sources.schema.json` 里描述的 `fieldMapping.{mode,map}`，而是读取**顶层 `fieldMapping.<内部字段> = 路径`**。下面的示例按**连接器源码实测形状**给出（我已用 mock fetch 实跑验证）。

**`feishu_bitable`**（飞书多维表格）：

```jsonc
{
  "id": "my-feishu-table",
  "channelId": "my-feishu-sources",
  "name": "飞书源表",
  "type": "feishu_bitable",
  "url": "https://open.feishu.cn/open-apis/bitable/v1/apps/<APP_TOKEN>/tables/<TABLE_ID>/records",
  "enabled": false,
  "language": "zh-CN",
  "interval": 30,
  "auth": { "appId": "<从 .env 注入，勿入库明文>", "appSecret": "<从 .env 注入>" },
  "params": { "page_size": 200 },
  "fieldMapping": {
    "id": ["record_id"],
    "title": ["fields", "标题"],
    "url": ["fields", "链接"],
    "summary": ["fields", "摘要"],
    "publishedAt": ["fields", "发布时间"],
    "author": ["fields", "作者"]
  },
  "createdAt": "2026-10-01T00:00:00Z",
  "updatedAt": "2026-10-01T00:00:00Z"
}
```

- 鉴权：`auth.appId` / `auth.appSecret` → `tenant_access_token`（缓存 110 分钟）；可选 `auth.tokenUrl`。
- 分页：内部按 `has_more` + `next_page_token` 自动翻页（`page_size` ≤ 500）。
- `publishedAt` 若是毫秒时间戳会被转成 ISO。
- 连接器内置**默认映射**（上表即为默认值），列名与默认一致时可省略整个 `fieldMapping`。

**`notion_db`**（Notion 数据库）：

```jsonc
{
  "id": "my-notion-db",
  "channelId": "example-channel",
  "name": "Notion 数据库",
  "type": "notion_db",
  "url": "https://api.notion.com/v1/databases/<DB_ID>/query",
  "enabled": false,
  "language": "zh-CN",
  "interval": 60,
  "auth": { "token": "<从 .env 注入，勿入库明文>" },
  "body": { "sorts": [{ "timestamp": "created_time", "direction": "descending" }] },
  "fieldMapping": {
    "id": ["id"],
    "title": ["properties", "Name", "title", 0, "plain_text"],
    "url": ["properties", "URL", "url"],
    "summary": ["properties", "摘要", "rich_text", 0, "plain_text"],
    "publishedAt": ["properties", "日期", "date", "start"],
    "author": ["properties", "作者", "people", 0, "name"]
  },
  "createdAt": "2026-10-01T00:00:00Z",
  "updatedAt": "2026-10-01T00:00:00Z"
}
```

- 鉴权：`auth.token` → `Authorization: Bearer`；固定 `Notion-Version: 2022-06-28`。
- 分页：`start_cursor` / `has_more` / `next_cursor`（每次 ≤ 100，`pageSize` 可调）。
- `body` 可选（透传 query body，如 filter / sorts）。
- 路径元素可以是**数字下标**（如 `0`）。

**`generic_api`**（通用 REST）：

```jsonc
{
  "id": "example-rest-api",
  "channelId": "example-channel",
  "name": "通用 REST API",
  "type": "generic_api",
  "url": "https://api.example.com/v1/posts",
  "method": "GET",
  "enabled": false,
  "language": "en",
  "interval": 30,
  "auth": { "kind": "bearer", "tokenEnv": "EXAMPLE_API_TOKEN" },
  "headers": { "Accept": "application/json" },
  "itemListPath": ["data", "items"],
  "pagination": { "kind": "page", "paramName": "page", "size": 20, "sizeParamName": "per_page", "startAt": 1, "totalPath": ["meta", "total"] },
  "fieldMapping": {
    "id": "id",
    "title": "title",
    "url": "url",
    "summary": "summary",
    "publishedAt": "published_at",
    "author": "author"
  },
  "createdAt": "2026-10-01T00:00:00Z",
  "updatedAt": "2026-10-01T00:00:00Z"
}
```

- 鉴权 `auth.kind`：`none` | `bearer`（`tokenEnv` 引用环境变量）| `api_key`（`valueEnv` + `headerName`，默认头 `X-Api-Key`）。
- `itemListPath`：条目数组在响应里的路径（数组形式，默认 `["data"]`）。
- `fieldMapping`：**内部字段 → 路径**（字符串取单层、数组取多层），默认只有 `title` 退化为 `(untitled)`、`url` 为空则丢弃。
- 分页：见 §7。

---

## 4. 零代码加一个「具体源」

以「再加一个 RSS 源」为例（ARCHITECTURE §10.3）：

1. **（若该渠道不存在）** 在 `config/sources.json` 的 `channels[]` 加一条渠道：

   ```jsonc
   {
     "id": "openai-blog",
     "name": "OpenAI Blog",
     "homepage": "https://openai.com/news/",
     "category": ["ai"],
     "enabled": true,
     "displayLimit": 10,
     "icon": "AI",
     "language": "en",
     "weight": 0.8,
     "createdAt": "2026-10-01T00:00:00Z",
     "updatedAt": "2026-10-01T00:00:00Z"
   }
   ```

2. **在 `sources[]` 加一条源**：

   ```jsonc
   {
     "id": "openai-blog-feed",
     "channelId": "openai-blog",
     "name": "OpenAI Blog",
     "type": "rss",
     "url": "https://openai.com/news/rss.xml",
     "enabled": true,
     "language": "en",
     "interval": 30,
     "createdAt": "2026-10-01T00:00:00Z",
     "updatedAt": "2026-10-01T00:00:00Z"
   }
   ```

3. **校验 + 只验证这一个源**：

   ```bash
   npm run validate
   npm run collect:once -- --only openai-blog-feed --dry-run   # 只打印，不写盘
   npm run collect:once -- --only openai-blog-feed             # 真跑并写盘
   ```

**仅编辑 `config/sources.json` 并提交 `master` 即完成，无需改任何代码。**

> `category` 取值必须是 `docs/data-model/schema/sources.schema.json#/definitions/categoryKey` 里的 13 个之一（启用集 8 + 预留 5）。

---

## 5. 新增一个「来源类型」（只加一个文件 + 注册一行）

以新增「Telegram 频道」类型为例（ARCHITECTURE §10.2）：

1. **建文件** `scripts/collect/connectors/telegram-channel.mjs`，导出 `run(source)`：

   ```js
   import { register } from './registry.mjs';

   export async function run(source) {
     // 1) 抓取 → 2) 用 source.fieldMapping 映射 → 返回内部 raw 字段[]
     const items = [];   // { guid, title, url, summary, author, publishedAt }
     return { items, httpStatus: 200 };
   }

   register('telegram_channel', { run });   // 自注册
   ```

2. **在 `scripts/collect/connectors/index.mjs` 注册一行**（若连接器不自注册）：

   ```js
   import './telegram-channel.mjs';     // 自注册
   // 或：import * as telegram from './telegram-channel.mjs';
   //     register('telegram_channel', telegram);
   ```

3. **（可选）扩 schema 枚举**：在 `sources.schema.json` 的 `type` 枚举里加 `telegram_channel`（让 `npm run validate` 通过）。

4. **（可选）补映射文档**：在 `docs/data-model/README.md` 的归一化映射表补一行。

5. **配一个源**：在 `config/sources.json` 加一条 `{"type":"telegram_channel", ...}`。

6. **本地验证**：`npm run collect:once -- --only <source-id> --dry-run`。

> **一句话**：新增类型 = 1 个连接器文件 + 注册 1 行（+ 可选 schema 枚举），**核心采集 / 去重 / 报告代码零改动**。

---

## 6. 🔴 字段形状分歧（schema 与连接器，接入前必读）

`docs/data-model/schema/sources.schema.json` 描述的是**声明式**形状：

- `fieldMapping`：`{ mode, itemsPath, map, typeCoercion, defaults }`，`map` =「内部字段 → 来源字段」
- `pagination`：`{ strategy, pageParam, offsetParam, cursorParam, … }`
- `auth`：`{ type, ref, headerName, scheme }`

但**部分连接器实际读取的字段形状与之不同**（我逐份读了 `scripts/collect/connectors/*.mjs` 并用 mock fetch 实跑核对）：

| 连接器 | 实际读取的字段形状 | 与 schema 是否一致 |
|---|---|---|
| `rss` / `atom` / `json_feed` | 只用 `url`（+ `etag` / `lastModified`） | 一致（不涉及） |
| `local_json` | `fieldMapping.{itemsPath,map,typeCoercion,defaults}` | ✅ 一致 |
| `local_csv` | `fieldMapping.map` | ✅ 一致（子集） |
| `feishu_bitable` | **顶层** `fieldMapping.<内部字段> = path[]`；`auth.{appId,appSecret}`；`params.page_size` | ❌ 不一致（不读 `mode/map`） |
| `notion_db` | **顶层** `fieldMapping.<内部字段> = path[]`；`auth.token`；`body`；`pageSize` | ❌ 不一致 |
| `generic_api` | **顶层** `fieldMapping.<内部字段> = path`；`itemListPath`；`pagination.{kind,…}`；`auth.{kind,…}` | ❌ 不一致（`pagination.kind` ≠ schema `pagination.strategy`） |

**实测证据**（feishu_bitable，mock fetch，列名 `MyTitle`）：

```
连接器形状  fieldMapping: { "title": ["fields","MyTitle"] }   →  title = "自定义标题"   ✅
schema 形状 fieldMapping: { "mode":"table", "map":{"title":"MyTitle"} } → title = "(untitled)" ❌
```

> **结论**：接入 `feishu_bitable` / `notion_db` / `generic_api` 时，**以连接器源码为准**（用 §3.3 的示例形状）。`sources.schema.json` 目前仍描述旧的 `{mode,map}` 形状，**二者尚未对齐**。
>
> ⚠️ 连带影响：`npm run validate` 只校验 `config/*.json`，而**当前 `config/sources.json` 里只有 `rss`/`atom` 源**（不含 `fieldMapping` / `pagination`），所以校验通过、**不会暴露该分歧**。一旦你按连接器形状给 `generic_api` 源加 `method` / `itemListPath` / `pagination.kind` / `auth.kind` 等字段，`npm run validate` 可能因 schema 的 `additionalProperties:false` 与枚举不匹配而**报错**。**这会是一个 P4 需要对齐的已知问题**（本文档如实标注，未在本阶段修改任何代码）。

---

## 7. 分页策略（以 `generic_api` 为准，5 种）

`generic_api` 的 `pagination.kind` 支持 5 种（`generic-api.mjs`，均已由集成测试覆盖）：

| `kind` | 行为 | 关键参数 |
|---|---|---|
| `none` | 只请求一次 | — |
| `page` | 页码翻页；`totalPath` 达上限或返回条数 < size 即停 | `paramName`(默认 `page`) / `sizeParamName` / `size`(默认 20) / `startAt`(默认 1) / `totalPath` |
| `offset` | 偏移翻页；返回条数 < limit 即停 | `offsetParam` / `limitParam` / `limit` / `startAt` |
| `cursor` | 游标翻页；无 `next_cursor` 即停 | `cursorParam` / `responsePath`(默认 `["next_cursor"]`) |
| `link_header` | 解析响应 `Link` 头的 `rel="next"` | `headerName`(默认 `Link`) / `relNext`(默认 `next`) |

> `sources.schema.json` 的 `pagination.strategy` 取值集合同为 `none/page/offset/cursor/link_header`，但**键名不同**（`strategy` vs `kind`，参数名也不同）——见 §6。

`feishu_bitable` / `notion_db` 的分页是**内部固定实现**（各用各自官方的 cursor 协议），不受 `pagination` 影响。

---

## 8. 鉴权（`auth`）——密钥只引用，绝不入库明文

**schema 的设计意图**是：`auth` 只放**引用名**，运行时读取环境变量 / GitHub Secrets：

```jsonc
"auth": { "type": "actions_secret", "ref": "FEISHU_APP_TOKEN", "headerName": "Authorization", "scheme": "Bearer" }
```

- `auth.type` 枚举：`none` / `env` / `actions_secret` / `bearer_env` / `header_env` / `query_env`。
- `auth.ref`：**引用名**（本地取 `.env` 变量名，CI 取 Actions Secrets 名）。
- **配置文件内绝不出现明文密钥**（ARCHITECTURE §12.5 硬约束）。

**连接器实际鉴权读取**（同 §6 的分歧）：

- `generic_api`：`auth.kind = bearer` + `tokenEnv`（**引用环境变量**，符合「只引用」原则）；或 `api_key` + `valueEnv`。
- `feishu_bitable`：`auth.appId` / `auth.appSecret`（当前读取**字面值**）。
- `notion_db`：`auth.token`（当前读取**字面值**）。
- Feed / 本地文件类：无鉴权。

> ⚠️ `feishu_bitable` / `notion_db` 当前读取 `auth` 的**字面值**，与 schema 的「`auth.ref` 引用式」设计**不一致**。若要用它们，**务必不要让明文密钥进入 `sources.json`**（应在 CI 里由 Secrets 生成/注入配置，本地用 `.env`）。

---

## 9. 排除规则（三级粒度）

排除规则独立放在 `config/exclusions.json`，由 `scripts/collect/exclude.mjs` 执行。**匹配时机：归一化 + 分类之后、去重之前**（ARCHITECTURE §11.3/§11.6）。

| 粒度 | `level` | 作用对象 | 示例 |
|---|---|---|---|
| ① 整源 / 渠道停用 | `channel`（+ 直接改 `enabled`） | `Source` / `Channel` | 一键停某个渠道 |
| ② 条目级排除 | `item` | 单条 Item（关键词 / 域名 / URL / 标题正则） | 屏蔽「招聘」「广告」、垃圾域名 |
| ③ 分类级排除 | `category` | Channel 的 `category` | 不想看 `podcast` 分类 |

当前 `config/exclusions.json` 实际内容（`rules[]`）：

- `ex-block-jobs`（`level:item`，`type:keyword`，`enabled:true`）：全局屏蔽招聘类关键词（`招聘 / 招人 / Hiring …`）。
- `ex-block-spam-domain`（`level:item`，`type:domain`，`enabled:true`）：屏蔽已知垃圾域名。
- `ex-channel-disabled`（`level:channel`，`enabled:false`，`value:[]`）：**占位**，手动填要停用的 channel id 数组，`enabled` 置 `true` 才生效。
- `ex-block-category-other`（`level:category`，`enabled:false`，`value:[]`）：**占位**，按分类排除。

规则字段：`id / level / scope / type / value[] / matchMode / caseSensitive / enabled / note / hitCount`。每次采集命中会写 `stats/exclusions-<ts>.json`（含逐规则 `hitCount` 与命中样本）。

> `stats/` 目录目前尚不存在，运行时才创建。

---

## 10. 常见源模板（真实 URL，取自 `config/sources.json`）

直接复制，改 `id` / `channelId` 即可。**所有 URL 均取自仓库现有配置**：

| 源 | type | url | 语言 |
|---|---|---|---|
| 阮一峰网络日志 | `atom` | `https://www.ruanyifeng.com/blog/atom.xml` | zh-CN |
| 科技爱好者周刊 | `rss` | `https://www.ruanyifeng.com/blog/weekly/rss.xml` | zh-CN |
| V2EX 热帖 | `rss` | `https://www.v2ex.com/feed/tab/hot.xml` | zh-CN |
| 少数派 | `rss` | `https://sspai.com/feed` | zh-CN |
| Hacker News | `rss` | `https://news.ycombinator.com/rss` | en |
| Hugging Face Blog | `rss` | `https://huggingface.co/blog/feed.xml` | en |
| GitHub Blog | `rss` | `https://github.blog/feed/` | en |
| 内核恐慌播客 | `rss` | `https://kernelpanic.fm/feed.xml` | zh-CN |

```jsonc
// 模板：复制后改 id / channelId / name / url
{
  "id": "<唯一 kebab-case>",
  "channelId": "<已存在的 channel id>",
  "name": "<显示名>",
  "type": "rss",
  "url": "<feed 地址>",
  "enabled": true,
  "language": "zh-CN",
  "interval": 30,
  "createdAt": "2026-10-01T00:00:00Z",
  "updatedAt": "2026-10-01T00:00:00Z"
}
```

> 加源后务必 `npm run collect:once -- --only <id> --dry-run` 验证连通性；连通失败会在 `config/sources.json` 的 `lastStatus` / `lastError` 里留痕。

---

## 11. 明确不在范围内

- **微信公众号源**：**不在范围内**（合规风险，见 `docs/PRD.md`）。不做内置接入。
- **RSSHub 公共实例**：**不内置**（公共实例有限速、历史 CVE、稳定性问题）。如确需，请**自建** RSSHub 后按普通 `rss` 源接入。

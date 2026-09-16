# RSS Radar × garss 整合与整体优化设计方案

> 版本：v1.0（2026-09-16）
> 状态：**设计草案，未改动任何代码**
> 分析输入：`/Users/dushouxin/WorkSpace/github/garss`（只读分析）+ `rss-radar` 现状实测
> 所有数据均为本机实测，非推算。§7 列出需拍板的 4 个决策点。

---

## 0. 结论先行

一句话：**性能问题比渠道问题严重得多，而渠道扩容的方法比渠道数量更重要。**

三件事，按「投入产出比」排序：

| 优先级 | 事项 | 现状 | 目标 | 改动量 |
|---|---|---|---|---|
| **P0** | 换数据通道 + 去 `no-store` | 首屏等 **8 秒**后才降级，全程 **~10.4s** | **1.5s 内** | < 50 行 |
| **P1** | 快照分段投影 + 字段瘦身 | 单次 2.4MB（br 377KB） | **~190KB** | 契约改动 |
| **P1** | 渠道元数据外置（不进 bundle） | 渠道数写死在 JS chunk | 渠道可热更 | 中等 |
| **P2** | 渠道扩容（导入管线） | 32 渠道 | **~200 渠道** | 新增脚本 |
| **P2** | 媒体缩略图 | 完全没有 | 渠道看板可见 | 契约 + 采集 |

**三条最关键的判断，先说破：**

1. **`raw.githubusercontent.com` 不适合当数据主通道**。实测 2.4MB 快照：raw 传输 **13.6~16.4 秒且完全不压缩**，短时间连续请求**约 1/3 直接连接失败**；jsDelivr 同一文件 **brotli 后仅 377KB（-84%）、1.9 秒**。而当前代码是 **raw 优先**。
2. **绝对不能存 `contentHtml`**。实测爱范儿一条 feed 里 **496 个 `<img>` 标签 / 20 条**（每条约 25 张图），全 feed 489KB。若照 garss 那样存 `contentHtml`，903 条快照会从 1.4MB 炸到 **7MB+**。**只存 1 个缩略图 URL（实测均 84 字节）是唯一可行的路。**
3. **garss 的 280 条渠道不能直搬**。抽样 40 条实测**存活率仅 65%**；另有 65 条已指向 Docker 内部地址（`rsshub:1200`）。且 garss 的分类是 **19 个中文自由词**，与 rss-radar 的 **13 个受控 `CategoryKey`** 完全不兼容。**必须走「导入管线」：解析 → 分类映射 → 健康检查 → 白名单落盘。**

---

## 1. 两个项目的家底对照

| 维度 | **rss-radar** | **garss / garss-studio** |
|---|---|---|
| 形态 | 纯静态站（无后端），GitHub Actions 采集 | Docker 单体（React + Express + 内置 RSSHub） |
| 核心价值 | 聚合热榜 + 去重 + 热度算分 + 周期报告 | 渠道清单 + 个人 RSS 阅读器 + README 日报 |
| 渠道规模 | **32 渠道 / 34 源** | **280 真实渠道** + 3118 条 RSSHub 文档模板（默认停用） |
| 数据模型 | `Channel` + `Source` 两层，**9 份 JSON schema + TS 手写镜像** | `Subscription` + `FeedItem` 两层，**TS 接口，无运行时校验** |
| 条目字段 | 19 个字段（含 `dedupKey`/`sourceCount`/`hotScore`/`urlStatus`） | 11 个字段（含 `contentHtml`/`contentText`/`excerpt`） |
| 媒体字段 | **完全没有**（`mediaType` 恒为 `article`） | **有图片代理**（`/api/image-proxy`）+ HTML 消毒 + lazy loading |
| 并发 | `runPool` 连接池（并发 6） | 前端 8 进程池 / 后端 worker 池（1~10 可调） |
| 缓存 | 内存 60s TTL + **`cache:'no-store'`（等于没缓存）** | 后端文件缓存 `reader-cache.json` + 写锁串行化 |
| 鉴权 | 无（公开静态站） | HMAC-SHA256 令牌 + 提取码 + socket.io |
| 导出能力 | **无**（无导出契约） | **有**（`/api/subscriptions/backup` GET/POST，含 `version`/`exportedAt`） |
| 分类体系 | 13 个受控枚举（8 启用 + 5 预留） | 19 个中文自由词，无受控词表 |
| 健康检查 | **成熟**（`url-health.mjs`，6 态机 + `pendingDead` 两轮防抖动） | 无（失败仅 console.error） |

### 1.1 garss 家底的关键数字（实测）

```
真实渠道            280 条（19 个中文分类，275 条 enabled）
  ├─ 直连 URL 型     278 条
  │    ├─ 可用        213 条（域名去重后 202 个不同 host）
  │    └─ 不可用       65 条（指向 Docker 内部 http://rsshub:1200）
  └─ RSSHub 路径型      2 条
RSSHub 文档模板     3118 条（默认停用，不属于「渠道」）
抽样存活率          26/40 = 65%   ← 35% 已失效
与 rss-radar 重合   域重合 25 条 / 名称完全相同 14 条
清单时间戳          2026-04 ~ 2026-05（不算陈旧）
```

### 1.2 rss-radar 现状的关键数字（实测）

```
渠道元数据          单 channel 273B ｜ 单 source 271B ｜ 合计 376B / 实体
快照（deploy 分支）  2,398,630 B ≈ 2.4MB，平均 1,632 B / 条目
快照（本地 fixture） 1,473,698 B / 903 条，summary 均 168 字符
首屏 JS（gzip 后）  index 18.2K + vendor-mui 74.8K + vendor 13.1K
                    + vendor-react 45.5K + vendor-router 8.6K + css 1.0K ≈ 161KB
```

---

## 2. garss 里值得抄的设计（7 条）

### ① 订阅源与条目彻底分离，且 `routePath` 双形态

`Subscription` 只描述「去哪取」，`FeedItem` 只描述「取回了什么」，中间**没有耦合**。`routePath` 同时接受：

- `/36kr/newsflashes`（RSSHub 路径 → 后端拼 `RSSHUB_BASE_URL`）
- `https://iao.su/feed`（直连地址 → 直接抓）

**为什么好**：渠道清单可以独立于采集逻辑演进。rss-radar 目前把「feed 地址」只放在 `Source.url` 里，导致 `Page2Channels.tsx` 得自己反查（`FEED_BY_CHANNEL`），说明「渠道的主 feed」是真实高频需求，但模型没表达。

### ② 备份/导出契约（**这正是需求 1 要的东西**）

```ts
interface SubscriptionsBackupRecord {
  version: 1;
  exportedAt: string;              // ISO
  subscriptions: SubscriptionRecord[];
  categories: string[];
}
```

GET 导出、POST 导入，**导入时做全量校验**：`normalizeBackupSubscriptions` 会检查名称非空、routePath 非空非 `/`、**重复 routePath 报错**、id 冲突自动重生成。还支持 `{ sourceUrl }` 形式——**从远程 URL 拉备份导入**。

**为什么好**：一个自证格式版本、可人读、可迁移、可去重的渠道清单容器。rss-radar **完全缺失**这一层。

### ③ 图片代理的四道防线（**需求 2 的直接参考**）

```
① 协议白名单   只允许 http/https
② 主机黑名单   拒 localhost / 127.0.0.1 / backend / frontend / rsshub / *.localhost
③ 大小上限     声明 content-length + 流式累计双校验，超限即 abort（8MB）
④ Referer 伪造 按目标域名生成 referer，豆瓣特判为 movie.douban.com
```

并返回 `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`。

**为什么好**：把「防盗链」「SSRF 防护」「体积失控」三个坑一次性堵死。rss-radar 无后端，**不能照抄代理**，但这四道防线就是选型时的取舍依据（见 §5.4）。

### ④ 流式读取 + 硬上限（**性能与安全的通用模式**）

`readResponseTextWithinLimit` / `readResponseBufferWithinLimit`：`getReader()` 逐块读，累计超限立刻 `abort()`。feed 限 5MB、图片限 8MB。

**为什么好**：rss-radar 的 `fetchText` 是「读完全部再判断」，一个恶意/异常的巨大 feed 会直接把 Actions 内存吃满。**这条应当直接移植。**

### ⑤ HTML 消毒（准确说是「白名单删标签」）

`sanitizeHtml` 删 `script/style/iframe/object/embed/form/input/...`，剥离所有 `on*` 内联事件与 `style`/`srcset`，把 `href`/`src` 全部绝对化（非 http(s)/mailto 一律置空），最后给 `<a>` 补 `target="_blank" rel="noreferrer"`、给 `<img>` 补 `loading="lazy"`。

**为什么好**：如果哪天要展示富文本，这是现成的清单。**但注意**：即便消毒，也不该把 HTML 存进快照（体积问题），消毒应在**渲染时**做。

### ⑥ 内容三态派生 + 摘要有界

同一份原始 HTML 派生出三个视图：

| 字段 | 用途 | 成本 |
|---|---|---|
| `contentHtml` | 全文渲染 | **高**（爱范儿单条 ~24KB） |
| `contentText` | 纯文本检索 | 中 |
| `excerpt` | **列表摘要，硬截断 220 字符** | 低 |

**为什么好**：「摘要必须有界」这条纪律 rss-radar 已经做对了（`summaryMaxChars: 200` + `stripHtmlShort` 截 300），说明方向一致，**只是 rss-radar 更克制**——这个克制是对的。

### ⑦ 幂等重同步 + 溯源前缀

`editreadme-*` 前缀标记「由脚本生成」，重同步时只覆盖这些项，手工新增的保留。备注明确写着：`已生成订阅源如果内容未变化，会尽量保留原有 enabled 和时间字段`。

**为什么好**：批量导入最大的风险是「覆盖人的手工修改」。rss-radar 如果直接合 280 条渠道，**必须有等价的溯源机制**，否则以后没法安全重跑导入。

---

## 3. garss 里**不该**抄的设计（3 条）

| 不抄 | 原因 |
|---|---|
| **`contentHtml` 进存储** | 实测体积会炸 5 倍以上（§0 结论 2）。garss 是「单用户阅读器 + 后端文件缓存」，它的 2.4MB 只是本地磁盘；rss-radar 是「静态站 + CDN 分发」，同一份数据每次访问都要付流量与解析成本。**场景不同，结论必须不同。** |
| **`storage/*.json` 单文件全量读写** | 每次写都 `JSON.stringify` 全量 + `rename`。3398 条 `subscriptions.json` 已到 2MB 级别，每次改一条都要重写整文件。rss-radar 的 `sources.json` 也已有同样苗头（见 §4.3）。 |
| **前端决定真实拉取时机** | garss 明确记录了这个教训并已改成「后端 cron 调度、前端只显示倒计时」。rss-radar 天然正确（Actions 调度），**保持即可**。 |

---

## 4. 主线 A：渠道整合 + 统一模型 + 可导出

### 4.1 当前模型诊断（答「是否合理」）

**结论：骨架正确，但有三处结构性缺陷 + 三处字段级冗余。**

#### ✅ 做得对的部分

1. **`Channel` / `Source` 两层分离**——这是全部设计里最重要的一步。它让「一个渠道多源」（多语言 / 多 feed 形态 / 主备地址）有了正确表达位。
2. **受控分类 + 自由标签双轨**——`category: CategoryKey[]` 是受控词表（能驱动筛选、配色、统计），`tags: string[]` 是自由标签（承接外部导入的原始标签）。**这个分工精准**，正是合 280 条 garss 渠道时不会撕裂模型的原因。
3. **`Source` 的 `type` 多态 + 扩展位**——8 种连接器 + `auth`/`fieldMapping`/`pagination`，且用 `checkSourceShapes` **语义守卫**兜住「形状填错被静默忽略」的坑。这套比 garss 的单一 `routePath` 强得多。
4. **双校验**（ajv schema + TS 手写镜像 + 语义守卫），比 garss 的纯 TS 接口强一个量级。

#### ❌ 缺陷 1（最严重）：没有溯源字段 → 批量导入无法幂等

`Channel` / `Source` 都没有「我从哪来」的字段。后果：

- 合了 280 条渠道后，**无法区分「garss 导入的」和「手工加的」**
- 重跑导入时**无法安全覆盖**（要么全删重来，要么不敢动）
- garss 用 `editreadme-` **id 前缀**解决了，rss-radar 无对应机制

**优化**：新增三个**可选**字段（不破坏既有 32 条）：

```ts
interface Channel {
  // ...既有字段不动
  origin?: 'manual' | 'garss' | 'rsshub-doc' | 'feishu';
  originRef?: string;          // 外部 id，如 "S001" / "editreadme-faebdd92"
  importBatch?: string;        // 导入批次，如 "garss-2026-04"
}
```

`originRef` + `importBatch` 一起，就能实现 garss 那种「只覆盖我生成的、保留人改的」幂等重同步。

#### ❌ 缺陷 2：渠道元数据被打进 JS bundle

```
src/pages/Page2Channels.tsx:24   import sourcesConfig from '../../config/sources.json';
src/services/channels.ts:4       import sourcesConfig from '../../config/sources.json';
```

后果有两条，第二条更致命：

- **体积**：280 渠道时该 chunk 从 12KB 涨到 **~200KB**（含 sources 侧字段）
- **耦合**：**加一个渠道 = 必须重新构建并部署前端**。但渠道清单本质上和「今天的快照」一样，是**应该可热更的数据**，而不是代码

**优化**：渠道清单移到 `deploy` 分支（数据侧），前端走既有的三层降级去拉；bundle 内只留**最小回退子集**（`id`/`name`/`icon`/`category`，约 165B/渠道）。

#### ❌ 缺陷 3：`sources.json` 一个文件混了两种生命周期

| 内容 | 生命周期 | 写入方 |
|---|---|---|
| `channels[]`、`sources[]` 的静态字段 | **人维护，稳定** | 人工 / 导入脚本 |
| `lastFetchAt` / `lastStatus` / `lastError` / `etag` / `lastModified` | **采集每轮回写，易变** | Actions |

混在一起的后果：**每小时采集都改 `sources.json` → 提交到 master → git 历史噪音 + 文件单调增长**。（当前靠 `--skip-health` 规避，但这是绕，不是解。）

**优化**：拆出 `config/source-health.json`（或 `.ndjson`）承载易变状态，采集只写它。`sources.json` 变为**只在人工/导入时变更**的稳定文件。

#### ⚠️ 字段级冗余（3 处，都在白占体积）

| 冗余 | 实测成本 | 处理 |
|---|---|---|
| `createdAt` + `updatedAt` 逐条重复 | **68B / 实体 = 25%** | 提到文件顶部一次（`generatedAt`），逐条省略 |
| `interval` 挂在 `Source` 上，但采集是**全局每小时** | 13B / 实体，且语义模糊 | 要么删除，要么明确重定义为「期望更新频率」并实际参与调度 |
| `Channel.language` 与 `Source.language` 语义重叠 | 17B / 实体 ×2 | 明确：`Channel.language` = 展示用主语言，`Source.language` = 采集解析用，并在 schema 注释锁死 |

#### 📐 体积推演（答「渠道数据不宜过大」）

按当前 376B/实体线性外推：

| 渠道数 | `sources.json` 全量 | 打进 bundle 后 | 前端实际需要 |
|---|---|---|---|
| 32（当前） | 24 KB | 24 KB | 5 KB |
| 100 | 74 KB | 74 KB | 17 KB |
| **280（全量 garss）** | **206 KB** | **206 KB** | **46 KB** |
| 500 | 368 KB | 368 KB | 83 KB |

**关键洞察：前端只需要 165B/渠道（8 个 UI 字段），而现在把 273B/渠道（13 个字段，含采集专用字段）全打进去了。** 分层后 280 渠道的前端成本 = **46KB raw / ~10KB br**，完全可控。

**因此「渠道数据不宜过大」的答案不是「少加渠道」，而是「分层 + 分片」**：

```
config/sources.json          ← 采集侧全量（人维护，不进 bundle）
config/source-health.json    ← 采集回写状态（与上分离）
deploy/channels.json         ← 前端消费的精简清单（~165B/渠道，UI 8 字段）
deploy/channels/by-cat-*.json← 可选：按分类分片，看板按筛选拉
```

### 4.2 导入管线设计（`scripts/import-channels.mjs`）

**绝不直搬。四阶段流水线，每阶段都有门禁：**

```
┌─ 阶段 0：解析 ──────────────────────────────────────┐
│ 输入优先级：                                         │
│   ① garssInfo.json            （281 条，含 sourceId + category + title + desc + xmlUrl）│
│   ② storage/subscriptions.json（280 条真实渠道，含 enabled 与时间戳）│
│   ③ *.opml                    （238 outline，标准格式，便于未来接其他源）│
│ 统一产出：RawChannel[] { originRef, name, feedUrl, rawCategory, description }│
└──────────────────────┬───────────────────────────────┘
                       ▼
┌─ 阶段 1：清洗 ──────────────────────────────────────┐
│ · 丢弃 routePath 以 / 开头（RSSHub 路径型，2 条）    │
│ · 丢弃含 rsshub:1200 / rsshub.v2fy.com 的 Docker 内部地址（65 条）│
│   ↳ 若有价值，改写为公共 RSSHub 实例再评估，不直接搬  │
│ · URL 归一化（去尾斜杠、小写 host、剥离 utm_*）      │
│ · 同 host 去重（202 个 host / 213 条 URL）           │
│ · 与现有 32 渠道做 host + 名称双重比对 → 标记 overlap│
└──────────────────────┬───────────────────────────────┘
                       ▼
┌─ 阶段 2：分类映射（人工确认，不自动猜） ─────────────┐
│ 19 个中文分类 → 13 个 CategoryKey 的映射表（见 §4.4）│
│ 未命中的落到 other，并输出「待人工归类」清单          │
└──────────────────────┬───────────────────────────────┘
                       ▼
┌─ 阶段 3：健康检查（复用既有 url-health.mjs） ────────┐
│ · 复用 checkUrls()：6 态机 + pendingDead 两轮防抖动   │
│ · 判定标准：HTTP 2xx/3xx 且响应体含 <rss/<feed/<rdf/JSON│
│ · 抽实测存活率 65% → 预计 213 条里约 138 条可用       │
│ · 落 lastStatus，人工复核后只导入 ok / moved 的       │
└──────────────────────┬───────────────────────────────┘
                       ▼
┌─ 阶段 4：落盘（dry-run 默认） ──────────────────────┐
│ · 默认 dry-run，打印：新增 N / 跳过 M / 冲突 K       │
│ · --write 才改 config/sources.json（先过 ajv 校验）  │
│ · 幂等键 = originRef，重跑只覆盖 origin:'garss' 的项 │
│ · 输出导入报告 JSON（供 CI 断言）                    │
└─────────────────────────────────────────────────────┘
```

**预期规模**：

```
280 条 garss 渠道
 -  65 条 Docker 内部地址        → 215
 -  25 条与现有渠道域重合         → 190
 ×  65% 存活率                   → 约 124 条净新增可用
 +  现有 32 条                    → 约 156 渠道
```

**建议做 6 倍扩容（32 → 156）而非 9 倍（→ 280）**：渠道数翻 5 倍时，采集端单轮耗时、快照体积、去重复杂度都会同步上升，需要分级放量（§6 路线图）。

**顺带一个高价值副作用**：garss 的 280 条里含大量**独立中文技术博客**（云风的 BLOG、酷壳/左耳朵耗子、Matrix67、依云's Blog、MacTalk、扔物线、美团技术团队、字节跳动技术博客、游研社、Chiphell、Apple Newsroom…），这批正是 rss-radar「聚合热榜」最缺的**长尾内容**——但注意 `活着的个人独立博客` 单一分类就占 128 条（46%），导入后须防止它把热榜刷屏（靠 `weight` 分层 + `displayLimit` 限流）。

### 4.3 导出与保存设计（答需求 1 的后半句）

**当前：完全没有导出能力。** 建议新增导出契约，设计上对齐 garss 的 backup（已验证可用），但**加上 rss-radar 特有的健康状态**：

```jsonc
// config-exports/channels-<YYYYMMDD>.json  —— 可提交、可人读、可回灌
{
  "format": "rss-radar/channel-registry",   // 自证格式
  "version": 1,
  "exportedAt": "2026-09-16T02:48:50Z",
  "generatedAt": "2026-09-15T00:00:00Z",    // 渠道清单自身版本（替代逐条 createdAt）
  "source": { "repo": "Shonee/rss-radar", "branch": "master", "commit": "abc1234" },
  "counts": { "channels": 156, "sources": 158, "ok": 149, "dead": 7 },
  "categories": ["tech_blog", "ai", "news", "..."],
  "channels": [
    {
      "id": "coolshell",
      "name": "酷壳",
      "homepage": "https://coolshell.cn/",
      "feedUrl": "https://coolshell.cn/feed",        // ← 新增：渠道主 feed（garss 的 routePath 思想）
      "category": ["tech_blog"],
      "enabled": true,
      "weight": 0.8,
      "displayLimit": 10,
      "icon": "酷",
      "language": "zh-CN",
      "origin": "garss",
      "originRef": "S137",
      "importBatch": "garss-2026-04",
      "health": { "status": "ok", "checkedAt": "2026-09-16T02:00:00Z", "lastOkAt": "2026-09-16T02:00:00Z" }
    }
  ]
}
```

配套三条能力：

1. **`npm run export:channels`** —— 从 `sources.json` + health 生成上述文件，落到 `config-exports/`
2. **`npm run import:channels <file|url>`** —— 反向回灌（同样支持 `{ sourceUrl }` 远程拉取，照抄 garss）
3. **OPML 导出** —— 复用 garss 的 v2 模板，把 `feedUrl` 写成 `xmlUrl`，让这份清单能直接喂给任何 RSS 阅读器（**这是「保存渠道数据」最通用的落点**）

**三条新增的门禁断言**（进 `test:regression`）：

- 导出 → 导入 → 再导出，两次结果**逐字节相同**（幂等）
- 导出文件里的每个 `feedUrl` 必须能被 `Source.url` 找到（无孤儿）
- `counts` 与 `channels.length` 一致，且 `ok + dead + pendingDead + ... = sources.length`

### 4.4 分类映射表（19 中文 → 13 受控）

> ⚠️ **后续变更（2026-09-16 实现期）**：本章提议把 `product_design` / `video` / `social`
> 三个预留位一并启用，**实际实现改为只映射到已启用的 8 类**，原始中文分类落 `tags[]`。
> 理由与完整对照见 **§11.3**。另外 `social` 从来没进过 `CategoryKey` 联合类型，
> 原提议本身也不自洽。

| garss 分类 | 条数 | → rss-radar `CategoryKey` | 备注 |
|---|---|---|---|
| 活着的个人独立博客 | 128 | `tech_blog` | **占 46%，需靠 weight 分层** |
| 内容平台 | 35 | `news` + `tech_blog` | |
| 科技类 | 19 | `tech_blog` | |
| Telegram优质频道RSS订阅 | 15 | `other` | 建议新增 `social` 或归 `news` |
| IT团队博客 | 13 | `tech_blog` | 企业技术团队 |
| 软件工具 | 12 | `tech_blog` | 部分归 `other` |
| 设计类 | 10 | `product_design` | **启用预留位** |
| 金融类 | 8 | `finance` | |
| 影视资源 | 6 | `other` | 或启用预留的 `video` |
| 资源类 | 6 | `other` | |
| 摄影 | 6 | `other` | |
| 互联网类 | 5 | `news` | |
| 生活类 | 5 | `other` | |
| 游戏 | 4 | `other` | |
| 数码 | 3 | `tech_blog` | |
| 学习类 | 2 | `other` | |
| 公司官方新闻 | 1 | `news` | |
| 学术类 | 1 | `other` | |
| 未分类 | 1 | `other` | |

**建议只启用 3 个预留位**（`product_design` / `video` / `social`），其余保持预留。同时**原始中文分类写进 `tags[]`**（如 `["摄影"]`），保留可检索性——这正是 `tags` 字段存在的意义。

---

## 5. 主线 B：RSS 源里的媒体内容（答需求 2）

### 5.1 实测事实：源里**确实有**大量图片，但**没有一条用标准媒体标签**

| 源 | `<enclosure>` | `<media:thumbnail>` | `<media:content>` | 裸 `<img>` | 单条均图 |
|---|---|---|---|---|---|
| 爱范儿 | 0 | 0 | 0 | **496**（20 条） | **~25 张** |
| 机核 | 0 | 0 | 0 | 98（20 条） | ~5 张 |
| 阮一峰 | 0 | 0 | 0 | 101（3 条） | ~34 张 |
| GitHub Blog | 0 | 0 | 0 | 21（10 条） | ~2 张 |
| 36kr | 0 | 0 | 0 | 25 | ~1 张 |
| 少数派 | 0 | 0 | 0 | **0** | **0** |
| 奇客 Solidot | 0 | 0 | 0 | 0 | 0 |

**三条硬结论：**

1. **标准媒体标签全军覆没**——`enclosure` / `media:thumbnail` / `media:content` 一个都没有。**唯一可行路径是从 `content:encoded`/`content` 的 HTML 里提取首个 `<img src>`。**
2. **当前采集端连原始 HTML 都没往下传**。`feed-base.mjs` 虽然在 `rss-parser` 里配了 `customFields: [['content:encoded','contentEncoded']]`，但 `mapRssItem()` **从不读取 `contentEncoded`**。所以媒体提取必须新增这一步（改动很小，字段已经解析出来了）。
3. **图量差异巨大**：富文本源（爱范儿 ~25 张/条）vs 纯文本源（少数派 0 张）。**必须允许「无图」是常态**，UI 要有优雅的空态。

**成本实测：**

```
缩略图 URL 长度   均 84B ｜ 中位 76B ｜ p95 188B ｜ max 191B
每条目存 1 个     + 约 100B（含字段名）
903 条目          + 约 90KB raw → br 后 约 +20KB   ✅ 可接受
```

**对照 `contentHtml`：**

```
爱范儿单条 contentHtml ≈ 24KB
若 903 条中有 1/3 来自富文本源 → 300 × 24KB ≈ 7.2MB
当前快照 1.4MB → 膨胀 5 倍以上                     ❌ 绝对不可行
```

### 5.2 存储设计：只存「一个 URL + 一个类型」

**新增 3 个可选字段（全部可选，不破坏既有快照）：**

```ts
interface Item {
  // ...既有 19 字段不动
  /** 缩略图原始 URL（单个，不下载、不转存、不改写） */
  thumbnail?: string;
  /** 该条目的媒体构成（从 HTML 统计，用于 UI 提示，不含原始内容） */
  media?: {
    images: number;      // <img> 计数
    videos: number;      // <video>/<iframe> 计数
    hasAudio: boolean;
  };
  /** mediaType 已有，但在此之前恒为 'article'；新增推断逻辑 */
  // mediaType?: 'article' | 'video' | 'podcast' | 'release' | 'post' | 'other'
}
```

**采集端提取规则（优先级从高到低，取到即止）：**

```
① <enclosure type="image/*">        ← 标准，实测无，但成本为零，保留
② <media:thumbnail url>
③ <media:content url medium="image">
④ item.contentEncoded / item.content 里的首个 <img src>   ← 实测主路径
⑤ item.itunes.image / image.url     ← 播客封面
⑥ 全都没有                → thumbnail 字段缺席（不写 null，省字节）
```

**同时必须做的三件事：**

- **URL 绝对化**：相对路径用 `item.link` 作 base 解析（照抄 garss 的 `normalizeEmbeddedUrl`）
- **协议白名单**：只留 `http(s)`，`data:` 一律丢弃（`data:` URI 动辄几十 KB，是体积炸弹）
- **不写 `null`**：无图就省略字段。903 条里少数派这类无图源占相当比例，省略能省一大截

### 5.3 展示设计：**两页区别对待**（这是体验与性能的平衡点）

**页面1「聚合热榜」→ 默认不展示缩略图。**

理由按重要性排：

1. **阅读模式不同**：热榜是**扫描式**（一眼扫 10~20 条标题找感兴趣的），不是消费式。缩略图会把信息密度压低 3~5 倍，一屏能看的条数从 10 条掉到 3 条。
2. **首屏图片成本不可控**：首屏 20 条若都带图，即使 `loading="lazy"`，视口内那 4~6 张仍会与 JS/数据下载**抢带宽**——而这正是当前最缺的资源。
3. **跨域破图率高**：无后端代理时防盗链无解，破图比没有图更伤体验。
4. **和现有设计语言冲突**：D10 浅色单主题 + 紧凑列表，加图等于换设计语言。

**但提供显式开关**：`site-config.json` 加 `display.itemThumbnails: 'off' | 'compact' | 'on'`，**默认 `off`**。

- `compact`：仅对 `mediaType === 'video'` 的条目显示 16:9 小角标（**视频没有画面就毫无信息量，这条例外值得开**）
- `on`：全部显示 64×64 缩略图

**页面2「渠道看板」→ 展示缩略图，但有严格护栏。**

理由：看板是**消费式**浏览（每卡片 5~10 条，用户在「看这个渠道最近发了啥」），缩略图提供有效视觉锚点，且卡片本身有留白成本，加图不会明显降密度。

护栏（缺一不可）：

| 护栏 | 参数 | 目的 |
|---|---|---|
| **只在卡片前 3 条渲染图** | 第 4 条起纯文字 | 控制单卡片图片数上限 |
| **尺寸硬锁** | `64×64`，`object-fit: cover` | **防止 CLS**（无尺寸的图片加载完会跳版） |
| **横向卡片布局** | 图左 + 文字右 | 不挤压文字行数 |
| **`loading="lazy"`** | 全部 | 未进视口不加载 |
| **`decoding="async"`** | 全部 | 不阻塞主线程解码 |
| **`referrerPolicy="no-referrer"`** | 全部 | 绕过部分防盗链 |
| **`onError` 降级** | 隐藏图片容器，文字独占整行 | **破图不留白**，布局不塌 |
| **占位底色** | 图未加载时显示 `tokens.surface.sunken` | 避免白闪 |

**单卡片最多 3 张 × 可见卡片 4~8 张 = 首屏最多 24 张图**。按平均缩略图 30~80KB 估，视口内实际加载 3~6 张 ≈ 200~500KB。可接受，但**这就是为什么必须锁「前 3 条」**——不锁的话 32 卡片 × 10 条 = 320 张图。

### 5.4 要不要图片代理？（决策点）

| 方案 | 优点 | 缺点 | 建议 |
|---|---|---|---|
| **A. 纯前端 + `no-referrer` + 降级** | 零基础设施，符合「无后端纯静态」定位 | 防盗链站点破图；无缓存控制；无法压缩转码 | ✅ **先上这个** |
| **B. CF Worker 图片代理** | 可伪造 referer（照抄 garss 四道防线）、可改尺寸转码、可边缘缓存 | 引入运行时依赖，与「纯静态」定位冲突；有成本与 SSRF 面 | 🟡 **破图率 > 40% 时再上** |
| **C. 采集端下载 + 转存缩略图** | 完全可控、无破图、可统一压到 WebP | 仓库体积爆炸（每图 10~30KB × 900 条 = 9~27MB/天）；Actions 耗时与带宽成本 | ❌ **不做** |

**建议**：先做 A，并在采集端**统计各源缩略图可达性**（HEAD 探测，带超时的并发池），产出「破图率报表」。用数据决定要不要上 B——**别拍脑袋**。

### 5.5 体积与性能影响汇总

| 项 | 变化 | 说明 |
|---|---|---|
| 快照体积 | +90KB raw / **+20KB br** | 903 条 × ~100B |
| 首屏图片请求 | 页面1：**0** ｜ 页面2：3~6 张 | 靠「前 3 条」+ lazy 双重限制 |
| 采集耗时 | +0 | 无需额外请求，纯本地解析 |
| 解析开销 | 极小 | 首个 `<img>` 正则匹配，遇到即止 |
| **不做的事** | 不存 HTML、不下载图、不转存 | 三条底线 |

---

## 6. 主线 C：CF Pages 加载卡顿的根因与优化（答需求 3）

### 6.1 实测证据

用 `curl` 对同一条生产数据（`deploy` 分支 2.4MB 快照）双通道各测多次：

| 指标 | **raw.githubusercontent.com** | **cdn.jsdelivr.net** |
|---|---|---|
| HTTP 状态（多次） | 200 / **000** / 200 ←**1/3 失败** | 200 / 200 |
| 传输体积 | **2,398,630 B（未压缩）** | **377,607 B（brotli，-84%）** |
| 首字节 TTFB | 0.51 ~ 0.61 s | 0.74 ~ 0.78 s |
| **总耗时** | **13.6 ~ 16.4 s** | **1.9 ~ 2.2 s** |
| `cache-control` | `max-age=300` | `public, max-age=604800, s-maxage=43200` |
| 48KB 小文件（report） | **同样 http=000 失败** | 正常 |
| 边缘缓存 | `x-cache: HIT` | `cf-cache-status: HIT`, `age: 130` |

**`http=000` 表示连接层就失败了**（非 HTTP 错误），且**连 48KB 的小文件也会失败**——这不是「大文件超时」，是**短时间连续请求触发的连接级限流/不稳定**。这解释了「有时能开、有时转圈」。

### 6.2 根因四层（按影响排序）

```
①【通道选错】resolveOrder() 返回 ['raw','jsdelivr','local'] —— raw 优先
              → 2.4MB 未压缩 + 13~16s + 1/3 失败概率，全砸在主通道上
                        ↓
②【白等 8 秒】DEFAULT_TIMEOUT_MS = 8000
              → raw 卡住或失败时，必须干等满 8s 才降级到 jsDelivr
              → 单次页面加载 = 8s（浪费）+ 2s（jsDelivr）≈ 10.4s
                        ↓
③【零缓存】fetchWithTimeout 硬编码 cache:'no-store'
              → 连 jsDelivr 的 max-age=604800 也被浏览器忽略
              → 每次刷新、每次路由切换后重进，全部从头重来
                        ↓
④【主线程解析】2.4MB JSON → JSON.parse 同步阻塞（估计 100~300ms）
              → 之后 Page2 还要做 O(渠道 × 条目) 的 filter 分组（32×903 ≈ 2.9 万次比较）
```

> **注意**：`resourceRegistry` 的 60s TTL 缓存**只是内存内的**。它挡不住「新开标签页 / 硬刷新 / 超 60s 后回来」，而这恰恰是 CF Pages 上「打开就卡」的典型场景。

### 6.3 优化方案

#### P0 —— 改动 < 50 行，收益最大（**先做这三条**）

**P0-1 通道优先级反转**

```ts
// src/services/dataClient.ts  resolveOrder()
- return ['raw', 'jsdelivr', 'local'];
+ return ['jsdelivr', 'raw', 'local'];
```

依据：jsDelivr 有 brotli（-84%）+ 真边缘缓存 + 无连接限流，**在同一次实测中快了 6~8 倍**。raw 降为备用（jsDelivr 有单文件 20MB / 仓库 50MB 限制，极端情况仍需 raw 兜底）。

> ⚠️ 唯一风险：jsDelivr 对**新 commit 的首次请求会回源**（实测 `x-cache: MISS, MISS`）。但 `age: 130` 表明**一分钟内即被边缘缓存**，且 Pointer 里的 `commit` 已用于版本化 URL（`jsdelivrBase(commit)`）——**这套机制本来就在，只是被排在第二位没被用上。** 反转后它才真正生效。

**P0-2 去掉 `no-store`，改成有区分的缓存策略**

```ts
// 指针文件：必须每次校验，但用条件请求（304 只回 237B 的 header）
- { cache: 'no-store' }
+ { cache: 'no-cache' }        // 存本地，但每次带 If-None-Match 校验

// 快照/报告：文件名含日期 → 内容在同一天内会变，用短 TTL 对齐 raw 的 max-age
+ { cache: 'default' }         // 交给 HTTP 头决定（jsDelivr 给 604800）
```

**P0-3 超时从 8000ms 降到 3500ms**

jsDelivr 实测 TTFB 0.74~0.78s、total 1.9~2.2s。3.5s 能覆盖 P95，且**降级链的等待成本直接砍掉 56%**。

**P0 小结：仅这三条，预期从 ~10.4s → 1.5~2.5s（首访），二次访问因缓存命中进入 <300ms 量级。**

#### P1 —— 结构性优化（需要动数据契约）

**P1-1 不可变文件名 + 永久缓存（收益最大的一条）**

当前 `snapshot-2026-09-16.json` 内的内容**每小时被覆盖一次**，所以不能长缓存。改为内容寻址：

```
today/snapshot-2026-09-16-<contenthash8>.json   ← 内容不变则文件名不变
today/latest.json  → { snapshotPath: "...-a1b2c3d4.json", commit, generatedAt }
```

给快照打 `Cache-Control: public, max-age=31536000, immutable`：

- 浏览器**永久命中**，零网络请求
- CDN 边缘永久命中
- 只有 237B 的指针文件需要条件请求（304，几十字节）

> 这是静态数据站的标准做法（Vite 的 hash 产物、npm 的 immutable tarball 都是这个思路）。**一次改动，永久收益。**

**P1-2 两段式投影（首屏只拉需要的）**

当前页面1「今天」档位默认 `page1BatchSize: 20` 条，但**必须先下载全部 903~1470 条并解析完**，才能排序、去重、算今日计数。

```
today/snapshot-digest.json   ← stats + 渠道摘要 + 今日前 20 条完整 item（约 40KB raw / 8KB br）
today/snapshot-full.json     ← 全量（「加载更多」/ 页面2 需要时才拉）
```

- 首屏体积：**2.4MB → 40KB**（-98%）
- 「今日 M 条」计数：`stats.todayCountByChannel` 直接在 digest 里给出，**不再需要全量数据派生**
- 「加载更多」到 40 条时才拉 full，或**再分片**（`snapshot-full-p2.json` …）

**P1-3 字段瘦身（1632B/条 → ~800B/条）**

| 字段 | 处理 | 省 |
|---|---|---|
| `fetchedAt` | 全条目相同 → 提到 snapshot 顶层 | ~30B/条 |
| `duplicateOf: null` | 省略 null 字段 | ~20B/条 |
| `sourceUrl` | 可从 `channels.json` 反查 → 不下发 | ~35B/条 |
| `channelName` | 同上（按 `channelId` 查表） | ~30B/条 |
| `category` | 同上（渠道级属性） | ~30B/条 |
| `guid` | 仅 `id` 不足以溯源时保留 | ~50B/条 |
| `isNew` | 由 `publishedAt` 与快照日期派生 | ~15B/条 |
| `summary` | 已截 200 字符；中文 3B/字符 → 600B。**考虑降到 120 字符** | ~240B/条 |

**预期：2.4MB → ~1.2MB raw / ~190KB br。** 注意这不是「把数据砍掉」，是**去掉冗余与可派生字段**——数据完整性由 `channels.json` 补回。

**P1-4 渠道元数据外置 + 分片**

见 §4.1 缺陷 2。`channels.json`（165B/渠道）走数据分支，280 渠道 = 46KB raw / ~10KB br；bundle 内只留最小回退。

**P1-5 页面2 的分组计算移出主线程热点**

当前 `cards` 的 `useMemo` 里对**每个渠道**都做一次 `allItems.filter(...)` → O(渠道 × 条目) = 32×903 ≈ 2.9 万次；280 渠道时会变成 25 万次。改为：

```ts
// 一次分组，O(n)
const byChannel = new Map<string, Item[]>();
for (const it of allItems) {
  if (it.duplicateOf) continue;
  (byChannel.get(it.channelId) ?? byChannel.set(it.channelId, []).get(it.channelId)!).push(it);
}
```

顺便：既然「今日 M 条」已有统一派生口径（`countByShanghaiDay`），**在 digest 阶段就把每渠道的今日计数算好下发**，页面2 连 filter 都省了。

#### P2 —— 锦上添花（可延后）

| 项 | 收益 | 代价 |
|---|---|---|
| Service Worker + IndexedDB | 离线可读、二次访问 0 请求 | 引入 SW 生命周期复杂度（HashRouter 下还好） |
| 生产 `sourcemap: false` | dist 从 6.2MB → 1.2MB（仅省部署体积，**运行时无影响**） | 线上调试变难；可用 hidden-source-map + 单独上传 |
| MUI 瘦身 | vendor-mui 74.8KB gz 是首屏最大单项（占 46%） | 换 headless 组件库是大改，收益/风险比一般 |
| 采集端自己 gzip 快照 + 前端 `DecompressionStream` | raw 通道也能省 84%，且不依赖 CDN 行为 | 需浏览器支持（现代浏览器 OK）；但 P0-1 反转通道后收益已被 jsDelivr 覆盖 |
| CDN 预热（collect 后主动请求一次 jsDelivr URL） | 消除「新 commit 首次 MISS」的偶发慢首访 | Actions 里加一个 curl，成本极低 |

> **一个小提醒**：jsDelivr 的 br 压缩是它自己做的，raw **不做任何压缩**。如果哪天坚持 raw 优先，唯一解法就是**采集端预压缩 + 前端 `DecompressionStream('gzip')`**——但既然 jsDelivr 免费且更快，没必要绕。

### 6.4 预期收益

| 场景 | 现在 | P0 后 | +P1 后 |
|---|---|---|---|
| 首访（冷缓存） | ~10.4 s | **1.5 ~ 2.5 s** | **~0.6 s** |
| 二次访问（60s 内，同标签） | ~10.4 s | 命中内存 ≈0 | ≈0 |
| 二次访问（新标签 / 硬刷新） | **~10.4 s** | 1.5~2.5 s | **~0.05 s**（304 + 本地缓存） |
| 传输体积 | 2.4 MB | 377 KB | **190 KB + 237 B 指针** |
| 主线程解析阻塞 | ~100~300 ms | 同 | **~15 ms**（digest 40KB） |

---

## 7. 需要拍板的决策点

| # | 决策 | 选项 | 我的建议 |
|---|---|---|---|
| **1** | 数据主通道 | (a) jsDelivr 转正、raw 降备用　(b) 保持 raw 优先 | **(a)** —— 实测快 6~8 倍，且有 br 压缩 + 真边缘缓存。**这是投入产出比最高的一处改动。** |
| **2** | 渠道扩容规模 | (a) 全量 280 → 约 156（去重去死后）　(b) 先只加 `tech_blog`/`news`/`finance` 三个分类（约 60 条）　(c) 先全量导入但 `enabled: false`，人工逐个开 | **(b) 或 (c)** —— 156 渠道相对 32 是 5 倍跃升，采集耗时、快照体积、热榜稀释都会同步变化。**先小批放量验证，再放全量。** |
| **3** | 缩略图展示范围 | (a) 只渠道看板　(b) 两页都上（热榜默认关）　(c) 都不上，只存数据备用 | **(a) + 存数据** —— 先把 `thumbnail` 字段存起来（+20KB br，成本极低），UI 只在渠道看板用。热榜留开关但默认关。**数据先存，展示后议。** |
| **4** | 是否接受 P1 的快照结构变更 | (a) 接受（改契约 + 回归套件 + e2e）　(b) 只做 P0，P1 延后 | **(a) 但分期** —— P0 先上止血（<50 行），P1 拆成「不可变文件名 → 两段式投影 → 字段瘦身」三步独立提交，每步都能单独回滚。 |

---

## 8. 落地路线图

```
第 1 步（止血，0.5 天）  P0：通道反转 + 去 no-store + 超时 3.5s
                      验证：Lighthouse / 手工测首访耗时；回归套件全绿
                      风险：低（3 处小改动，可立即回滚）
                        ↓
第 2 步（1 天）          P1-1 不可变文件名 + immutable 缓存头
                      验证：二次访问应命中 304 / 本地缓存
                        ↓
第 3 步（1 天）          P1-2 digest / full 两段式投影 + P1-5 分组优化
                      验证：首屏请求体积 < 50KB；页面1/2 功能不回退
                        ↓
第 4 步（1 天）          P1-3 字段瘦身 + P1-4 渠道元数据外置
                      验证：快照 < 200KB br；channels.json 走数据分支可热更
                        ↓
第 5 步（1~2 天）        §4.2 导入管线（dry-run 版）+ §4.3 导出契约
                      验证：跑 dry-run 得到「新增/跳过/冲突」报告，人工复核
                        ↓
第 6 步（1 天）          §5 媒体字段采集（thumbnail + media）+ 渠道看板展示
                      验证：903 条里 thumbnail 覆盖率报表；破图率报表
                        ↓
第 7 步（放量）          按决策 2 分批 enabled 新渠道，观察采集耗时与热榜分布
```

**每步的共通纪律**（沿用既有约定）：

- 一次只改一件事，独立 commit
- 结论必须基于 `git show --stat` 核对（不凭汇报）
- 契约类改动必须同步更新对应 `*.schema.json` + `models.ts` + 回归断言
- 改采集频率/基数后，**全仓 grep 旧值 + 重算所有派生阈值**（见 cadence-change-propagation 配方）

---

## 9. 风险与回滚

| 风险 | 触发条件 | 处置 |
|---|---|---|
| jsDelivr 限流 / 不可用 | 请求 429 或持续超时 | 三层降级天然兜底（raw 在第二位）；已在 `resourceRegistry` 有错误态 |
| jsDelivr 对新 commit 冷启动慢 | 首次 MISS 回源 | ① collect 后预热 curl　② 指针 commit 版本化 URL 已有 |
| 快照瘦身导致前端字段缺失 | 遗漏某个消费点 | **先加字段（缩略图）后减字段**；减字段前用 `grep` 穷举全部消费点；schemas + TS 类型双改 |
| 渠道放量后热榜被个人博客刷屏 | 128 条 `tech_blog` 占 46% | `weight` 分层 + `displayLimit` 限流 + 频道白名单；灰度放量 |
| 导入渠道后大量 404 | 实测 35% 已失效 | 阶段 3 健康检查前置；只导入 `ok`/`moved`；保留 `pendingDead` 两轮防抖动 |
| 缩略图破图 | 防盗链站点 | `no-referrer` + `onError` 降级为纯文字；统计破图率，>40% 才考虑 CF Worker 代理 |
| 回归套件无法覆盖 UI 文案 | 既有已知缺口 | 文案改动**必须截图肉眼复核**（这是既有的、未解决的缺口，本次不扩大） |

---

## 10. 附：本次分析发现但对本次方案非必须的问题

1. `public/data/today/snapshot.json` 仍是 P1 fixture（3 条 demo 数据），与真实快照（903~1470 条）并存 → 容易误导本地调试。
2. `docs/SOURCES.md` 头部写「最后与代码同步于 commit `8b9eab8`」，需核对是否已落后。
3. `hot-score` 归一化实现（`min(sourceCount/5,1)` 线性截断）偏离 `ARCHITECTURE §5.1` 的描述，是个已记录但未闭环的口径差。
4. 采集端 `fetchText` 是「读完再判断大小」，缺 garss 那样的**流式读取 + 硬上限**；建议移植（§2 ④）。
5. `vendor-mui` 占首屏 gzip 的 46%（74.8KB），是 JS 侧唯一的显著优化空间，但换库风险高，建议排在最后评估。

---

## 11. 实现纪要（2026-09-16 落地期实测与偏离）

本方案在落地过程中有 **4 处结论被实测推翻**，另有若干设计被细化。按本项目的
「历史结论不重写、只追加变更声明」纪律，前文原文保留，偏离集中记录在此。

### 11.1 ★ 「通道反转」不能一刀切 —— 改为按资源分流

原计划：数据通道做反转，jsDelivr 转正、raw 降兜底。

**实测推翻**：jsDelivr 的分支引用 `@deploy` 返回了 **9 小时前的陈旧内容**
（响应头 `age: 2467`）；且 query string 不参与缓存键；固定文件名 + `max-age=604800`
会让陈旧内容被长缓存。简单反转会引入「用户看到昨天热榜」的**正确性** bug。

**实际实现**：按资源类型分流 + 让内容文件成为「内容寻址」。

| 资源 | 首选 | 理由 |
|---|---|---|
| **指针文件**（`today/latest.json`，几十字节） | **raw** | 必须新鲜；小文件 raw 也不慢 |
| **内容文件**（快照 / 报告，MB 级） | **jsDelivr** | 体积收益巨大；只要 URL 是内容地址就能安全长缓存 |
| 本地兜底 | `./data/` | 不变 |

配套改动：
- 快照/报告文件名追加 **4 位 UTC `HHmm` 后缀**（`snapshot-<date>-<stamp>.json`），
  使 URL 成为**内容地址**，CDN 可安全长缓存；同日旧后缀自动清理，避免 `deploy` 分支堆积。
- 前端 `isValidCommit()` 过滤 `'local'` / `'deploy'` 等占位值 —— 生产指针里的
  `"commit": "local"` 会让 `jsdelivrBase('local')` 构造出 404，导致第二层降级 100% 失效。
- **原 T3（collect 回填 commit）取消**：实测新路径会正常回源，不可变路径方案已覆盖该需求。

### 11.2 ★ feed 内容嗅探不能当硬门禁 —— 降级为排序加权 + 人工复核

原计划（§4.2 阶段 3）：判定标准包含「响应体含 `<rss/<feed/<rdf/JSON`」，不满足则不导入。

**实测推翻**：拿 30 个**已知真实可用**的 feed 做对照实验，三种 UA
（无 UA / 采集端 bot UA / 浏览器 UA）的「非 feed」比例分别是 **10 / 11 / 12**
（差异不显著），但**逐条对比有 23/30 出现分歧**且分歧散乱 —— 连
`ruanyifeng.com/blog/atom.xml` 这种铁定是 feed 的地址都会在某些轮次被判失败。

**结论**：该信号由**网络抖动**主导，不是站点策略。拿它当过滤器会**误杀大量真实源**。

**实际实现**：
- 开闸判定**只看 URL 状态机**（`ok` / `moved`）。
- 嗅探结果用于两件事：**放量排序加权**（识别为 feed 的排在各自分类前面）、
  **输出 `sniffNotFeed` 人工复核清单**。
- 嗅探 UA 改用**采集端那一个**（`DEFAULT_UA`，`rss-radar-bot/1.0`），并加重试
  （"一次成功即定案"）。
- 🔎 **顺带发现一个存量口径不一致**：`url-checker.mjs` 用**浏览器 UA**，
  而采集端 `http.mjs` 用 **bot UA**。这意味着「体检通过」推不出「采集能成功」。
  **本次不改**（会翻动全站健康状态），但建议后续统一。

### 11.3 ★ 分类只映射到已启用的 8 类（不启用预留位）

原计划（§4.4）：启用 `product_design` / `video` / `social` 三个预留位。

**实际实现**：19 个 garss 中文分类**全部映射进已启用的 8 类**，原始词落 `tags[]`。

理由：
1. README 写死了纪律 —— **新增分类必须四处同步**（`config/categories.json` →
   `config/keyword-rules.json` → `sources.schema.json#/definitions/categoryKey` →
   `src/types/models.ts`）。而 `config/categories.json` 是前端筛选 chip 的数据源。
2. **「导入渠道」与「扩分类」是两件事**，不该在一批里揉。放进一个未注册的 key，
   筛选器会渲染出无标签的空 chip。
3. `social` **从来不在 `CategoryKey` 联合类型里**，原 §4.4 的提议不自洽。
4. 可逆性：原始中文分类在 `tags[]` 里，将来若要启用 `product_design`，按 tags 反查即可精准搬迁。

**映射结果**：`tech_blog` 185 / `news` 40 / `other` 45 / `finance` 8（共 278 条去重后候选）。

### 11.4 ★ 「全量导入」的语义要先钉死 —— 3398 vs 281 是两个数量级

`garss-studio/storage/subscriptions.json` 有 **3398 条**，其中 **3123 条是
「RSSHub 文档 / *」目录项**（`enabled:false`，需要自建 RSSHub 实例才能用，不是可直接
采集的 feed URL）；真正在用的是 **275 条**。另一份 `garssInfo.json` 是 **281 条**。

**实际实现**：默认取 `garssInfo.json`（281，= 主理人实际在用的集合）；
`subscriptions.json` 走显式 `--dataset`；「RSSHub 文档 / *」目录项需显式
`--include-rsshub-catalog` 才导入（标注为不推荐）。

### 11.5 内网 RSSHub 地址：默认丢弃（「不直接搬」）

66 条指向 `http://rsshub:1200/...`（garss 自建实例路由），公网 DNS 解析不到，
直搬 100% 失败。默认**丢弃**并在报告中列出；`--keep-internal` 才改写为公共实例
（`--rsshub-base`，默认 `https://rsshub.app`）并纳入体检，溯源标 `rsshub-doc`。

⚠️ 改写时**主页必须用改写后的完整 URL**，不能用 `originOf()` —— 否则 65 条 route
会全部落到 `https://rsshub.app`，**塌成一个名叫 `rsshub` 的巨型渠道**（实测踩到）。

### 11.6 实现期发现并修掉的三个真 bug

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| 1 | 名额 60，**只开出 37 个渠道** | `enabledCount` 数的是**条目**（feed），不是**实体**（渠道）；同主页的多条 feed 吃掉名额 | `selectRollout()` 按**归一化主页**分组取名额；同主页多 feed 同开同关 |
| 2 | 回灌后 **2 个渠道被误关**（31 → 29） | 一条源 `enabled:false` 覆盖了它所属渠道的 `enabled:true` | 父/子开关分离：`preset.enabled`（渠道）与 `preset.sourceEnabled`（源） |
| 3 | 多源渠道的**渠道名被最后一条 feed 覆盖** | `parseRegistryExport` 把候选 `name` 填成了 feed 名 | 候选 `name` = 渠道名；feed 名走 `preset.name` 管 source 名 |

### 11.7 SSOT 收敛：让「存储形态」等于「去重键形态」

导入收尾对**全量** source URL 跑一次规范化。**存量**里存在非规范形态
（`https://www.appinn.com/feed/` 带尾斜杠、`...?mod=guide&view=hot&rss=1` query 未排序），
导致**存储形态 ≠ 去重键形态** —— 同一个源的两种写法可以同时躺着而谁都不报警。

- 逐条写进报告（`{id, from, to}`），不静默改。
- 归一化后**撞车 = 真重复**：报警、**不自动合并**，且撞车条目一条都不改。
- `--no-normalize` 可关闭。

### 11.8 幂等门禁的实际形态（§4.3 三条断言的落地版）

§4.3 原写「导出 → 导入 → 再导出逐字节相同」。落地时发现：**当基线含历史非规范数据时，
`exp1 ≠ exp2` 是正常的**（第一次往返顺带收敛）。真正成立的不变量是**不动点**：

| 断言 | 内容 |
|---|---|
| ① 导出是纯函数 | 同 config + 同 `--now` ⇒ 逐字节相同 |
| ② **不动点** | `exp2 === exp3` 逐字节（往返一次后稳定） |
| ③ 差异可解释 | `exp2 == canonicalizeUrls(exp1)` —— 差异**只允许**是归一化 |
| ④ **回灌 no-op** | 回灌进「已含该配置」的注册表 ⇒ 新增 0、全部落 `duplicate-feed-url` |
| ⑤ 引用完整性 | 每个 `feedUrl` 都能在 `Source.url` 找到；counts 与数组长度自洽 |

为了让 ② 成立，导出必须**无损**，故新增：
- `feeds[]` 展开全部子项（不只一个「主 feedUrl」——那会把多源渠道压成单源）
- 导出 `lastStatus` / `lastFetchAt` / `lastError`，回灌时经 `preset` 原样还原
- 导出 `generatedAt`，回灌时还原（否则被刷成 `now`）
- 回灌时**保序、不重排**（channel id 由创建顺序经 `freeId()` 派生，重排会让 id 对不上）
- `mergeIntoRegistry` 新增 `preset.*` 支持（只在新建立条目时生效，不破坏「只增不改」）

### 11.9 交付物与实测基线

**新增**
- `scripts/lib/channel-registry.mjs` —— 注册表语义与幂等内核（纯函数，零 IO）
- `scripts/import-channels.mjs` —— 四阶段幂等导入管线（`npm run import:channels`）
- `scripts/export-channels.mjs` —— 注册表导出 + OPML（`npm run export:channels`）
- `scripts/reconcile-entities.mjs` —— 实体层重收敛 CLI（`npm run reconcile:entities`，见 §13）
- `scripts/__tests__/channel-registry.test.mjs`（27 用例）
- `scripts/__tests__/import-channels.test.mjs`（57 用例）
- `scripts/__tests__/export-roundtrip.test.mjs`（14 用例，即 §11.8 的五条断言）
- `scripts/__tests__/entity-keys.test.mjs`（19 用例，实体键与重收敛，见 §13）
- `scripts/collect/__tests__/group-sources.test.mjs`（6 用例）
- `docs/imports/garss-2026-09.md` —— 本批次导入的人读报告（含 §12 的实体层审计明细）

**改动**
- `src/services/dataClient.ts` 按资源分流加载 + `isValidCommit`
- `scripts/collect/*`：快照/报告带 UTC `HHmm` 后缀、同 URL 分组只抓一次、dev-bridge 清理
- `docs/data-model/schema/sources.schema.json` + `src/types/models.ts`：
  `origin` / `originRef` / `importBatch` 溯源字段

**测试基线**

| 门禁 | 改造前 | 改造后 |
|---|---|---|
| `test:node` | 327 | **459** |
| `test:vitest` | 62 | **78** |
| `typecheck` | 0 | 0 |
| `validate` | 5/5 | 5/5 |

（2026-09-16 实测复核：440 / 78 / 0 / 5-5。当晚 §13 的实体层重收敛追加 19 条用例 ——
`entity-keys.test.mjs` —— 基线升至 **459** / 78 / 0 / 5-5，实测一致。）

---

## 12. 实体层一致性审计（2026-09-16 复盘）

导入在**条目层**是干净的：228 条 feed URL 唯一、归一化后 0 撞车、`auditRegistry` 六项检查全 0。
但**实体层**留下了两类**方向相反**的失真。完整明细见 `docs/imports/garss-2026-09.md` §七。

### 12.1 根因：主页回退值只对「一站一 feed」成立

`parseGarssInfo` 只映射 `sourceId / title / xmlUrl / category / description`——**不读 homepage 字段**，
于是 `resolveHomepage` 必走回退分支，取 `originOf(feedUrl)`，即 **`协议://主机`，不带路径**。

实测：**182 个 garss 渠道，182 个主页等于 `originOf(首条源 url)`，零例外。**

### 12.2 两类失真

| 方向 | 触发条件 | 实例 | 当前影响 |
|---|---|---|---|
| **误合并**（不同实体 → 一个渠道） | 多家刊物共用 feed 托管域名 | `feedx`（cnBeta + 环球科学 + 摄影世界）、`feeds-feedburner`（书伴 + 可能吧） | 🔴 **已开闸，线上错归属** |
| **误分裂**（同一实体 → 多个渠道） | feed URL 的协议 / www 写法不一致 | `rakuen-thec` / `rakuen-thec-2`（同名双卡）、`ruanyifeng`（同 feed 双写） | 🟡 两张同名卡片 |

渠道名取自**第一条** feed（`String(item.name || ...)`），所以「cnBeta」「书伴」这两个名字都是按到达顺序碰巧选中的。

### 12.3 两个下游结论

1. **两个比较键的归一化策略不该共用。** `normalizeHomepage`（实体聚合键）只做 hostname 小写 + 去尾斜杠，
   **保留协议**；而 `normalizeFeedUrl`（去重键）保留协议是**有意的安全权衡**（不猜协议就不会抓错内容）。
   职责不同却共用一套保守策略，正是「误分裂」的放大器。
2. **「开闸 N 个渠道」≠「N 个实体」。** `feedx` 一个渠道代表 3 个实体、`feeds-feedburner` 一个渠道代表 2 个实体
   → 本轮 60 个渠道实际覆盖 **63** 个实体。名额语义必须写清是「渠道」还是「实体」。

### 12.4 `auditRegistry` 的覆盖缺口

现有 6 项检查全过，但**不检查**「渠道 `enabled: true` 却无任何启用源」。
`ruanyifeng-weekly` 正是此形态（导入前既有、`notes` 记录为有意为之），前端会渲染空渠道，审计拦不下。

### 12.5 处置建议

见 `docs/imports/garss-2026-09.md` §7.4。核心约束：**P1 两条必须同批，且顺序是「先加路径、再加协议归一」**——
只给 `normalizeHomepage` 加协议归一化，会把 feedburner 那组从「侥幸没撞」推成「真的撞上」。

> **后续变更声明（2026-09-16 晚）**：上述两类失真**已全部处置完毕**，本节作为**问题复盘**保留、
> 结论不回改。代码侧改 `deriveHomepageFromFeed`（栏目级推断 + 托管站清单豁免），数据侧用
> `reconcileEntities` 收敛到规范形式。实施细节、偏离与实测数字见 §13。
>
> ⚠️ 一处**措辞更正**：§12.1 写的是「`parseGarssInfo` **不读** homepage 字段」，实测更彻底 ——
> `garssInfo.json` 全部 281 条的字段**就只有** `sourceId / category / title / description / xmlUrl`，
> **根本没有 homepage 可读**。所以「把主页读进来」这条修法不存在，只能**推断**，这一点决定了
> §13 的全部设计。

---

## 13. 实体键与重收敛（2026-09-16 实施纪要）

### 13.1 判据：三层规则 + 一份人工清单

`deriveHomepageFromFeed(feedUrl)` 是**唯一**的主页推断处（`lib/channel-registry.mjs`）：

| 序 | 条件 | 结果 | 为什么 |
|---|---|---|---|
| 1 | 命中 `HOSTED_FEED_HOSTS` | `origin + path`（完整 URL） | 托管站 / 路由站的路径是**订阅标识**，不是站点栏目 |
| 2 | 剥掉尾部 feed 特征段后仍有非 feed 段 | `origin + /首段` | 同栏目的多条 route 归并到一条渠道 |
| 3 | 路径段全是 feed 特征词 | `origin`（裸 host） | 站主 feed，同站唯一 |

第 2 条**只取首段、不继续往后取**是关键：`rakuen.thec.me/PixivRss/{male,female,daily,monthly}-20`
必须全部落到 `…/PixivRss`。取全路径会让它们碎成四个渠道。

「feed 特征段」= `FEED_STOPWORDS` ∪ **以 `.rss/.xml/.atom/.json/.rdf` 结尾**。后半条是实测补上的：
原判据漏了 `posts.rss`、`index.rss`、`all.atom.xml`，直接把 `solidot` 的主页推成 `solidot.org/index.rss`。

### 13.2 托管站清单必须是**人工知识**，不能推导

`feedx.net` 长得和普通站点一模一样，但它的三个路径是**三个不同刊物**（cnBeta / 环球科学 / 摄影世界）；
而 `rakuen.thec.me/PixivRss/*` 是**同一个站点的四个版块**。**从 URL 表面分不出来。**

所以清单（`HOSTED_FEED_HOSTS`，含 feedburner / feedx / 播客托管站 / rsshub）是显式声明的领域知识，
可随实测扩充。原则：**宁可清单不全**（漏了只是"没拆开"，用户看到一条内容混杂的卡片），
也不要乱猜（猜错会把本应分开的实体合掉，那是归属错误）。

### 13.3 两个比较键的分离（落实 §12.3）

| 键 | 函数 | 归一协议？ | 归一 www？ | 判什么 | 猜错的代价 |
|---|---|---|---|---|---|
| **幂等键** | `normalizeFeedUrl` | ❌ | ❌ | 是不是同一份**请求** | 抓错内容 |
| **实体键** | `normalizeHomepage` | ✅ | ✅ | 是不是同一个**内容主体** | 同一实体裂成两张卡片 |

代价不对称 → 策略相反。`normalizeHomepage` 本次改为「去协议 + 去 www + 去尾斜杠、保留端口与 query」。
这是「误分裂」的直接修复。

`originOf`（旧的主页兜底实现）**已删除**，`sync-sources.mjs` 的本地同名实现一并删除 ——
留着它就是留着"回到裸 host"的便捷路径。该文件的文件头本来就写着「同一个概念有两份实现，
是清单类项目最典型的漂移源」。

### 13.4 `reconcileEntities`：先拆后并 → 规范形式 → 幂等

已落盘的数据**不会自己变**，所以需要一个显式的收敛动作：

1. **拆**：一条渠道的源跨多个实体键 → 按键切成多条（首组继承原 id，主页换成派生值）。
2. **并**：同一实体键只留一条渠道，其余渠道的源迁过去、渠道本身删除。

先拆后并的妙处是收敛到**规范形式**（每个键恰好一条渠道），于是第二趟必然无可拆、无可并 →
**幂等**（无变更时原样返回入参对象，不返回等价副本，所以「逐字节相同」是结构上成立的）。

几个刻意的选择：

- **`scope` 默认 `garss`**：历史 32 条是人工配置的。实测放开会把 `v2ex` / `豆瓣` / `开源中国`
  的正确"多栏目一条渠道"结构强行拆开 —— 启发式不该覆盖人工配置。
- **拆出的新渠道继承原渠道开关**（不是一律停用）：拆分**不增加采集请求**（那几条 feed 原本就在抓），
  只是把文章归还给正确的刊名。强制停用会让用户直接丢失「环球科学」「摄影世界」的内容。
- **迁移时丢弃「目标已有同内容」的源**：判据是**去协议后 URL 相同**（`blobUrlKey`）。这是
  「不要重复请求同一个渠道」在本层的落点，`ruanyifeng` 的 http 双写即由此消除。
- **icon 随新名字重取首字**：否则拆出的「环球科学」会顶着 cnBeta 的「c」。

### 13.5 实测处置结果

| 操作 | 对象 | 结果 |
|---|---|---|
| 拆 | `feedx`「cnBeta」 | → `feedx` / `feedx-huanqiukexue-xml`「环球科学」/ `feedx-photoworld-xml`「摄影世界」 |
| 拆 | `feeds-feedburner`「书伴」 | → `feeds-feedburner` / `feeds-feedburner-kenengbarss`「可能吧」 |
| 并 | `rakuen-thec-2` | → `rakuen-thec`（Pixiv 四条 route 归一） |
| 并 | `blog-csdn` | → `bytedance-tech` |
| 并 | `woshipm-2` | → `woshipm` |
| 并 | `ruanyifeng` | → `ruanyifeng-blog`（顺带**丢弃 1 条协议冗余源**） |

净影响：渠道 **214 → 213**、源 **228 → 227**、启用渠道 **91 → 93**（拆出 3 条继承启用、并掉 1 条重复的启用渠道）、
**启用源 104 不变** —— 即**采集请求总数没变**，只是归属修正了。

`deriveChannelId` 的判据**刻意未动**，所以拆出的 id 形如 `feedx-huanqiukexue-xml`（保留了刊物名，
比退化成 `feedx-2` 更有信息量）。

### 13.6 遗留（不阻塞）

- 拆出渠道的 **category 继承原渠道**，未按各自 feed 的真实分类重算（`feedx` 拆出的三条都是 `news`）。
  source 的 `notes` 里存着原始标签（`原始标签：科技类`），可人工校正。
- `feedx.net` / `feeds.feedburner.com` 类渠道的 **homepage 只能是订阅 URL**（点开是 XML）——
  这是我们不知道其真实站点的诚实表达。要更好只能改前端或引入外部解析。
- `blog-csdn` 并入后，`bytedance-tech` 同时有 `rss.csdn.net/.../rss/map` 与
  `blog.csdn.net/.../rss/list` 两条**近重复**源（host 不同，去协议判据不认为是同一内容）。
  后者是停用状态，暂不产生请求，列为**待人工确认**。



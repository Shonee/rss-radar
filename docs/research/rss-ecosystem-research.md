# RSS 生态调研报告（rss-radar 项目）

> 文档性质：市场 / 技术生态调研素材，供 PRD 与架构设计引用。
> 调研时间：2026 年（联网检索）
> 说明：本文所有项目 / 站点均来自公开网络检索，标注来源 URL。**不确定的链接一律标注「待核实」**，禁止直接用于生产而不做连通性验证。

---

## 目录

1. [方向一：RSS 内容特点与能力](#方向一rss-内容特点与能力)
2. [方向二：当前热门 RSS 源清单](#方向二当前热门-rss-源清单)
3. [方向三：RSS 源获取渠道](#方向三rss-源获取渠道)
4. [方向四：开源项目与竞品分析](#方向四开源项目与竞品分析)
5. [方向五：技术可行性佐证](#方向五技术可行性佐证)
6. [综合结论](#综合结论)

---

## 方向一：RSS 内容特点与能力

### 1.1 三种主流规范的差异

| 维度 | RSS 2.0 | Atom 1.0 | JSON Feed 1.1 |
|---|---|---|---|
| 诞生 | 1990s 末期，最古老 | 2005，更正式 | 2017（Manton Reece / Brent Simmons） |
| 载体 | XML | XML | JSON |
| 根元素 | `<rss><channel>` | `<feed>` | JSON 对象 |
| 条目元素 | `item` | `entry` | `items[]` |
| 时间格式 | RFC 822（如 `Sat, 06 Dec 2025 10:00:00 GMT`） | ISO 8601（RFC 3339） | ISO 8601 |
| 必填元素 | title / link / description | id / title / updated | title / version |
| 内容字段 | `description`、`content:encoded`（CDATA） | `summary`、`content`（带 type 属性） | `content_html`、`content_text` |
| 作者支持 | 单值字符串 | 结构化元素 | 对象（单一作者） |
| 多作者 | 有限 | 完整支持 | 不支持（仅首作者） |
| 媒体附件 | `enclosure`（image/audio/video） | `link rel="enclosure"` | `attachments[]`（可多个） |
| 扩展性 | XML namespace | XML namespace | 自定义 JSON 属性 |
| 兼容性 | 所有阅读器 | 所有现代阅读器 | 较新，生态仍在增长 |
| 主要缺点 | 时间格式松散易解析出错、元数据字段少 | 较啰嗦、部分老阅读器不友好 | 老阅读器不支持、社区资源少 |

来源：<https://deepwiki.com/jpmonette/feed/4-feed-formats>、<https://jottings.me/blog/three-feed-formats>、<https://rewordify.com/rwweb.php?userdata=www.jsonfeed.org/mappingrssandatom/>

### 1.2 三格式字段映射（RSS/Atom → JSON Feed）

| RSS 2.0 | Atom 1.0 | JSON Feed |
|---|---|---|
| `channel.title` | `feed.title` | `title` |
| `channel.link` | `link[rel=alternate]` | `home_page_url` |
| `atom:link[rel=self]` | `link[rel=self]` | `feed_url` |
| `channel.description` | `subtitle` | `description` |
| `item.title` | `entry.title` | `items[].title` |
| `item.link` | `link[rel=alternate]` | `items[].url` |
| `item.guid` | `entry.id` | `items[].id` |
| `item.description` / `content:encoded` | `summary` / `content` | `content_text` / `content_html` |
| `item.pubDate` | `published` | `date_published` |
| `item.category` | `entry.category` | `tags` |
| `item.enclosure` | `link[rel=enclosure]` | `attachments` |
| `channel.lastBuildDate` | `feed.updated` | — |

来源：<https://rewordify.com/rwweb.php?userdata=www.jsonfeed.org/mappingrssandatom/>

### 1.3 RSS 相比爬虫：优势与局限

**优势**
- **格式可预测**：结构固定（title / link / date / summary），一个解析器通吃所有源，无需按站点适配。
- **无需鉴权 / 无速率限制**：绝大多数 feed 公开，无需 API Key / OAuth，feed 设计初衷即为周期性消费。
- **天然解决「是否有新内容」**：每条 entry 自带发布时间与唯一 ID，无需对比 HTML 快照或维护哈希。
- **稳定性远高于爬虫**：网页改版会破坏爬虫，但 feed URL 与格式长期稳定（20 年不坏）。
- **法律风险低**：feed 是被明确设计用于公开消费的，尊重条款前提下几乎无版权争议。
- **便于自动化触发**：结构化数据可直接触发 CRM / 数据库 / 通知工作流。

**局限**
- **内容受限**：只能拿到发布者愿意放进 feed 的字段，全文、互动数据、深层元数据常缺失。
- **部分站点已停供**：社交媒体、部分新闻站主动砍掉 RSS。
- **时效性依赖上游**：更新频率由发布方决定，不存在「推送」保证（WebSub 可部分缓解）。
- **字段质量参差**：RSS 2.0 时间格式松散，部分源 title/description 含噪音 HTML。

**对比结论**

| 维度 | RSS | 爬虫(HTML) | API |
|---|---|---|---|
| 稳定性 | 极高 | 低 | 中高 |
| 维护成本 | 近零 | 持续（每源维护） | 中（版本/鉴权变更） |
| 内容丰富度 | 有限 | 完整灵活 | 高 |
| 结构化 | 是（标准） | 否（需自建） | 是 |
| 法律风险 | 无 | 灰色 | 取决于条款 |
| 实时性 | 近实时 | 按需 | 高 |

来源：<https://www.openindex.io/blog/what-is-the-difference-between-web-scraping-and-an-rss-feed>、<https://oshy.tech/en/blog/rss-information-automation-ai-2026>、<https://www.rss.app/guides/what-is-rss/why-use-rss>、<https://dev.to/agenthustler/news-article-scraping-rss-feeds-vs-html-scraping-in-2026-14pb>

### 1.4 常见 RSS 内容形态

| 形态 | 说明 | 典型 feed |
|---|---|---|
| 新闻资讯 | 媒体新闻列表 | 各媒体 `/feed`、`/rss` |
| 博客 | 个人/团队博客 | `blog.example.com/feed.xml`、`atom.xml` |
| 播客 | enclosure 指向音频 | 播客 RSS（`rss.art19.com/...`） |
| 视频 | YouTube 频道隐藏 feed | `youtube.com/feeds/videos.xml?channel_id=...` |
| 社交/社区 | 帖子流 | `reddit.com/r/x.rss`、RSSHub 路由 |
| GitHub 动态 | Release / Commit / Tag | `github.com/{u}/{r}/releases.atom` 等 |
| 排行榜/热榜 | 需 RSSHub 或 API 转 RSS | `rsshub.app/weibo/search/hot` |
| 搜索结果 | 关键词监控 | `hnrss.org/newest?q=AI`、RSSHub search 路由 |

### 1.5 「把非 RSS 页面 RSS 化」的常见做法

| 做法 | 工具示例 | 能力边界 |
|---|---|---|
| 规则模板生成 | Feed43 | 需手写抓取规则，无缓存、无 JS 渲染 |
| 可视化选元素 | RSS.app / FetchRSS / PolitePol | 上手快，付费、跨站多则贵 |
| 开源路由库 | RSSHub（900+ 路由，Puppeteer 渲染） | 覆盖广、可自建；公开实例限速 200 req/IP/小时* |
| 自建桥接 | RSS-Bridge（PHP，无上限） | 完全可控；需自己维护选择器 |
| 变更监控 | Distill.io / changedetection.io | 偏「变化告警」，feed 输出需配置 |
| 自动化编排 | Huginn | 最灵活但需复杂配置 |
| 微信封闭生态 | wewe-rss / we-mp-rss | 依赖微信读书登录态，有账号风险；wewe-rss 已于 2026-03 归档，继任者 we-mp-rss 活跃 |

*RSSHub 公开实例限速数字来自第三方博客，**待核实**（不同部署配置不同）。
来源：<https://blog.brightcoding.dev/2025/11/17/...>、<https://www.techbloat.com/7-best-tools-to-generate-rss-for-any-website-in-2025.html>、<https://bingqiangzhou.github.io/posts/wechat-mp-article-anti-crawl/>

---

## 方向二：当前热门 RSS 源清单

> ⚠️ 以下 feed URL 来自公开整理清单（awesome 仓库、掘金社区帖），**生产使用前需逐个做连通性验证**；带「待核实」的为不确定项。

### 2.1 中文 / 国内热门源

#### 综合技术社区 / 资讯

| 名称 | Feed URL | 分类 |
|---|---|---|
| 阮一峰的网络日志 | <https://www.ruanyifeng.com/blog/atom.xml> | 技术博客 |
| 科技爱好者周刊（阮一峰） | <https://www.ruanyifeng.com/blog/weekly/rss.xml> | 技术周刊 |
| 少数派 | <https://sspai.com/feed> | 产品与效率 |
| 美团技术团队 | <https://tech.meituan.com/feed> | 技术博客 |
| V2EX | <https://www.v2ex.com/index.xml> | 开发者社区 |
| V2EX 热帖 | <https://www.v2ex.com/feed/tab/hot.xml> | 开发者社区 |
| LinuxDo | <https://linux.do/latest.rss> | 开发者社区 |
| 酷壳 CoolShell | <https://coolshell.cn/feed> | 技术博客 |
| 爱范儿 | <https://www.ifanr.com/feed> | 科技媒体 |
| 36氪 | <https://36kr.com/feed> | 科技财经 |
| IT之家 | <https://www.ithome.com/rss/> | 科技媒体 |
| 奇客 Solidot | <https://www.solidot.org/index.rss> | 科技资讯 |
| 机核 GCORES | <https://www.gcores.com/rss> | 游戏文化 |
| 小众软件 | <https://www.appinn.com/feed/> | 软件工具 |
| 虎嗅网 | <https://www.huxiu.com/rss/0.xml> | 商业科技 |
| 极客公园 | <https://www.geekpark.net/rss> | 科技媒体 |
| 开源中国 | <https://www.oschina.net/news/rss>（待核实） | 开发者社区 |
| SegmentFault | <https://segmentfault.com/feeds> | 开发者社区 |
| CSDN 最新博客 | <https://blog.csdn.net/rss/newest> | 技术博客 |
| 腾讯云开发者社区 | <https://cloud.tencent.com/developer/column/2/rss> | 云技术 |
| 阿里云开发者社区 | <https://developer.aliyun.com/rss>（待核实） | 云技术 |
| HelloGitHub 月刊 | <https://hellogithub.com/rss>（待核实） | 开源 |
| 张鑫旭-鑫空间 | <https://www.zhangxinxu.com/wordpress/feed/> | 前端博客 |
| 云风的 BLOG | <https://blog.codingnow.com/atom.xml> | 技术博客 |
| 廖雪峰的官方网站 | <https://www.liaoxuefeng.com/feed> | 技术教程 |
| 唐巧的博客 | <https://blog.devtang.com/atom.xml> | 技术博客 |
| 有赞技术团队 | <https://tech.youzan.com/rss/> | 技术博客 |

#### RSSHub 中文热榜路由（需自建或使用公共实例）

| 名称 | 路由 | 完整示例 |
|---|---|---|
| 微博热搜 | `/weibo/search/hot` | `https://rsshub.app/weibo/search/hot` |
| 知乎热榜 | `/zhihu/hot`（另有 `/zhihu/hotlist`，待核实差异） | `https://rsshub.app/zhihu/hot` |
| B 站排行榜 | `/bilibili/ranking/0/3/1` | `https://rsshub.app/bilibili/ranking/0/3/1` |
| GitHub Trending | `/github/trending/daily` | `https://rsshub.app/github/trending/daily` |
| 掘金热榜 | `/juejin/trending/all/weekly` | `https://rsshub.app/juejin/trending/all/weekly` |
| 知乎日报 | `/zhihu/daily` | `https://rsshub.app/zhihu/daily` |

来源：<https://github.com/zerahchu/rsslist>、<https://juejin.cn/post/7490554094413447220>、<https://juejin.cn/post/7459966392429101067>、<https://github.com/jp0id/top-rss-list>、<https://github.com/JackyST0/awesome-rsshub-routes>

### 2.2 国际热门源

#### 科技媒体

| 名称 | Feed URL | 分类 |
|---|---|---|
| TechCrunch | <https://techcrunch.com/feed/> | 科技媒体 |
| The Verge | <https://www.theverge.com/rss/index.xml> | 科技媒体 |
| Wired | <https://www.wired.com/feed/rss> | 科技媒体 |
| Ars Technica | <https://feeds.arstechnica.com/arstechnica/index> | 科技媒体 |
| MIT Technology Review | <https://www.technologyreview.com/feed/> | 科技媒体 |
| Engadget | <https://www.engadget.com/rss.xml> | 科技媒体 |
| The Next Web | <https://thenextweb.com/feed/> | 科技媒体 |
| VentureBeat | <https://feeds.feedburner.com/venturebeat/SZYF> | 科技商业 |
| Gizmodo | <https://gizmodo.com/rss> | 科技媒体 |
| Slashdot | <http://rss.slashdot.org/Slashdot/slashdotMain> | 科技社区 |
| Stratechery | <https://stratechery.com/feed/> | 科技商业分析 |

#### 开发者社区

| 名称 | Feed URL | 分类 |
|---|---|---|
| Hacker News | <https://news.ycombinator.com/rss> | 开发者社区 |
| Hacker News (hnrss 增强) | <https://hnrss.org/frontpage> | 开发者社区 |
| Lobsters | <https://lobste.rs/rss> | 开发者社区 |
| Dev.to | <https://dev.to/feed> | 开发者社区 |
| CSS-Tricks | <https://css-tricks.com/feed/> | 前端 |
| Smashing Magazine | <https://www.smashingmagazine.com/feed/> | 前端/设计 |
| A List Apart | <https://alistapart.com/main/feed/> | Web 标准 |
| Codrops | <https://tympanus.net/codrops/feed/> | 前端创意 |
| Reddit r/programming | <https://www.reddit.com/r/programming.rss> | 社区 |

#### AI 领域

| 名称 | Feed URL | 分类 |
|---|---|---|
| OpenAI Blog | <https://openai.com/blog/rss.xml>（**待核实**，OpenAI 已多次调整博客结构） | AI |
| Google DeepMind | <https://deepmind.google/blog/rss.xml> | AI |
| Google AI Blog | <https://blog.google/technology/ai/rss/> | AI |
| Hugging Face Blog | <https://huggingface.co/blog/feed.xml> | AI 开源 |
| Meta AI Blog | <https://ai.meta.com/blog/rss/> | AI |
| Microsoft Research | <https://www.microsoft.com/en-us/research/feed/> | AI/科研 |
| arXiv cs.AI | <https://rss.arxiv.org/rss/cs.AI> | AI 论文 |
| Hacker News AI | <https://hnrss.org/newest?q=AI> | AI 讨论 |
| Anthropic News | **待核实**（未找到稳定官方 feed） | AI |

#### 大厂工程博客

| 名称 | Feed URL | 分类 |
|---|---|---|
| GitHub Blog | <https://github.blog/feed/> | 工程博客 |
| GitHub Changelog | <https://github.blog/changelog/feed/> | 产品更新 |
| Netflix Tech Blog | <https://netflixtechblog.com/feed> | 工程博客 |
| AWS Blog | <https://aws.amazon.com/blogs/aws/feed/> | 云工程 |
| Cloudflare Blog | <https://blog.cloudflare.com/rss/> | 云工程 |
| Google Developers | <https://developers.googleblog.com/feeds/posts/default/> | 工程博客 |
| Mozilla Hacks | <https://hacks.mozilla.org/feed/> | 工程博客 |
| Vercel Blog | <https://vercel.com/atom> | 工程博客 |
| Supabase Blog | <https://supabase.com/rss.xml> | 工程博客 |
| Stripe Blog | <https://stripe.com/blog/feed.rss> | 工程博客 |
| Spotify Engineering | <https://engineering.atspotify.com/feed/> | 工程博客 |
| Meta Engineering | <https://engineering.fb.com/feed/> | 工程博客 |

#### 语言 / 框架官方博客

| 名称 | Feed URL |
|---|---|
| React | <https://react.dev/rss.xml> |
| Vue | <https://blog.vuejs.org/feed.rss> |
| Rust | <https://blog.rust-lang.org/feed.xml> |
| Go | <https://go.dev/blog/feed.atom> |
| Python | <https://blog.python.org/feeds/posts/default> |
| Node.js | <https://nodejs.org/en/feed/blog.xml> |
| Deno | <https://deno.com/blog/feed.xml> |
| TypeScript | <https://devblogs.microsoft.com/typescript/feed/> |
| Swift | <https://www.swift.org/atom.xml> |
| Kotlin | <https://blog.jetbrains.com/kotlin/feed/> |

#### 安全 / 设计 / 产品

| 名称 | Feed URL | 分类 |
|---|---|---|
| Krebs on Security | <https://krebsonsecurity.com/feed/> | 安全 |
| The Hacker News | <https://feeds.feedburner.com/TheHackersNews> | 安全 |
| Schneier on Security | <https://www.schneier.com/feed/> | 安全 |
| CISA News | <https://www.cisa.gov/news.xml> | 安全 |
| Google Security Blog | <https://security.googleblog.com/atom.xml> | 安全 |
| FreeBuf | <https://www.freebuf.com/feed> | 安全（中文） |
| Dribbble Popular | <https://dribbble.com/shots/popular.rss> | 设计 |
| Product Hunt | <https://www.producthunt.com/feed> | 产品 |

#### 播客 / 视频

| 名称 | Feed URL | 分类 |
|---|---|---|
| Accidental Tech Podcast | <https://atp.fm/rss> | 播客（科技） |
| The Tim Ferriss Show | <https://rss.art19.com/tim-ferriss-show> | 播客 |
| This Week in Tech | <https://feeds.twit.tv/twit.xml> | 播客（科技） |
| YouTube 任意频道 | `https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}` | 视频 |

#### 平台型 feed（模板）

| 类型 | 模板 |
|---|---|
| GitHub Release | `https://github.com/{user}/{repo}/releases.atom` |
| GitHub Commit | `https://github.com/{user}/{repo}/commits.atom` |
| GitHub Tag | `https://github.com/{user}/{repo}/tags.atom` |
| Reddit 子版 | `https://www.reddit.com/r/{sub}.rss` |

来源：<https://github.com/JackyST0/awesome-rsshub-routes>、<https://www.electricpants.com/best-rss-feeds/>、<https://bsheepcoder.github.io/2026/06/17/rss-source-collection>、<https://github.com/The-Tech-Margin/awesome-rss-feeds>

> 合计约 **90+ 个真实 feed 条目**，覆盖新闻/科技媒体/技术博客/AI/开发者社区/设计/安全/播客/视频等分类。

---

## 方向三：RSS 源获取渠道

| 渠道 | 类型 | 能力 | 边界 / 风险 |
|---|---|---|---|
| **站点自带约定** | 原生 | `/feed`、`/rss`、`/atom.xml`、`/index.xml`、`/feeds/posts/default` | 覆盖主流博客/CMS；部分站点已移除 |
| **页面 `<link rel="alternate">`** | 原生发现 | 浏览器扩展/discovery 自动发现 feed | 需抓取 HTML head |
| **RSSHub** | 开源生成器 | 900+ 内置路由，可代码扩展，Puppeteer 渲染 JS 页面；AGPL-3.0 | 公开实例限速；历史 SSRF/CVE（CVE-2023-22493，CVSS 8.8）、正则回溯 CVE-2022-31110 → 建议自建并隔离 |
| **RSS-Bridge** | 开源桥接 | PHP，可选桥接数量多，无上限；自建可控 | 需自维护选择器；官方部分桥接依赖站点结构 |
| **Feed43** | 规则模板 | 按 URL 模式抽取 | 无缓存、无 JS 渲染；免费版限速 |
| **RSS.app / FetchRSS / PolitePol** | 托管视觉生成 | 点选元素生成 feed、widget、聚合、翻译、导出 CSV/JSON/OPML | 付费/限额；依赖其服务 |
| **Feedly / Inoreader** | 阅读器源库 | 提供源发现、搜索、OPML 导入导出 | 数据在第三方；免费额度受限（Feedly 免费 100 源） |
| **awesome-rss 类清单** | 社区清单 | GitHub 上大量策划清单（如 The-Tech-Margin/awesome-rss-feeds、zerahchu/rsslist、JackyST0/awesome-rsshub-routes） | 时效性需自行验证 |
| **微信公众号转 RSS** | 灰产边缘 | wewe-rss（2026-03 已归档）、we-mp-rss（活跃）基于微信读书登录态 | 需微信读书账号，有封号风险；全文缓存有版权风险；**不应用于商业公开转载** |
| **GitHub / Reddit / YouTube** | 平台模板 | `.atom`、`.rss`、`videos.xml` | 平台政策可能变更 |
| **变更监控类** | Distill.io / changedetection.io | 偏告警，也输出 RSS | 非标准 RSS-first |

来源：<https://blog.brightcoding.dev/2025/11/17/the-ultimate-guide-to-generating-rss-feeds-for-any-website-even-if-they-don-t-want-you-to>、<https://www.techbloat.com/7-best-tools-to-generate-rss-for-any-website-in-2025.html>、<https://tsight.io/articles/14564285>、<https://bingqiangzhou.github.io/posts/wechat-mp-article-anti-crawl/>

**合规提示**：微信公众号、社交平台抓取处于法律灰色地带；本项目坚持「只存元数据 + 原文链接、不存全文」，并遵守 robots.txt 与站点条款。

---

## 方向四：开源项目与竞品分析

### 4.1 RSS 阅读器 / 聚合器

| 项目 | 定位 | 技术栈 | 存储 | 静态部署 | 可借鉴点 |
|---|---|---|---|---|---|
| **FreshRSS** | 自托管全功能阅读器（Feedly 替代） | PHP | SQLite / MySQL / PostgreSQL | 否（需服务端） | 支持 1M+ 文章 / 50K+ 源；WebSub 秒级更新；内置网页抓取生成 feed；OPML 导入导出；多用户；扩展体系 |
| **Miniflux** | 极简、高性能阅读器 | Go + PostgreSQL | PostgreSQL | 否 | 单二进制、~20MB 内存；Fever / Google Reader API；全文抓取；25+ 第三方集成 |
| **Tiny Tiny RSS (TT-RSS)** | 全功能、插件驱动 | PHP | MySQL / PostgreSQL | 否 | 插件生态、智能 feed（保存搜索）、正则过滤；2025 原开发者退出，社区 fork 维护 |
| **NewsBlur** | 带社交/智能推荐的阅读器 | Python + PostgreSQL/Mongo/Redis/ES | 多组件 | 否 | Web Feeds 监控无 RSS 的页面；「intelligence」训练式过滤 |
| **Stringer** | 极简反社交阅读器 | Ruby | PostgreSQL | 否 | Fever API 兼容；最小功能集 |
| **yarr** | 单文件 RSS 阅读器 | Go | SQLite | 否（单机） | 零依赖、单用户 |
| **CommaFeed** | Google Reader 风格 | Java | — | 否 | 轻量自托管 |

来源：<https://itsfoss.com/self-hosted-rss-feed-readers>、<https://selfhosting.sh/replace/feedly/>、<https://brave2049.com/p/1236>

### 4.2 桌面 / 移动阅读器

| 项目 | 平台 | 技术栈 | License | Star（约） | 借鉴点 |
|---|---|---|---|---|---|
| **NetNewsWire** | macOS / iOS | Swift | MIT | ~9.5K | 原生体验、开源阅读器标杆 |
| **Reeder**（商用） | macOS / iOS | 原生 | 闭源 | — | 交互与视觉标杆 |
| **Fluent Reader** | 桌面 | TypeScript | BSD-3 | ~9K | Fluent UI、跨平台桌面 |
| **Raven Reader** | 桌面 | Vue | MIT | ~2.8K | 现代 Web 技术桌面壳 |
| **RSS Guard** | 桌面 | C++ | GPL-3 | ~2.4K | 播客支持 |

### 4.3 新一代 AI 阅读器 / 生成器

| 项目 | 定位 | 技术栈 | License | 借鉴点 |
|---|---|---|---|---|
| **RSSHub** | 「万物皆可 RSS」生成器 | TypeScript | AGPL-3.0 | 路由机制（`shared/pre-sources` 式配置）、缓存、可扩展路由；本项目可参考其「源路由 + 缓存」思路 |
| **RSS-Bridge** | 自建桥接生成器 | PHP | Unlicense | 无上限自托管；桥接抽象 |
| **Folo（原 Follow）** | AI 信息中枢阅读器 | TypeScript | AGPL-3.0 | AI 翻译/摘要、动态内容、跨平台；**竞品定位最接近「AI + RSS」** |
| **Omnivore** | 稍后读（已关停） | TypeScript | AGPL-3.0 | 全文归档思路（反面教材：关停风险） |

来源：<https://gist.github.com/kevinmichaelchen/9d40fde5b8408fc0417f187359e07001>

### 4.4 「热榜聚合」类项目

| 项目 | 定位 | 技术栈 | 存储 | 静态部署 | 借鉴点 |
|---|---|---|---|---|---|
| **DailyHotApi**（imsyy） | 聚合 60+ 平台热榜的 API | Node/TS | 内存 + Redis 缓存（默认 60 分钟） | 支持 Vercel | 模块化路由（每平台一个路由文件 + 统一 `handleRoute` / `RouterData` 结构）；支持 RSS 模式；双层缓存 |
| **DailyHot**（imsyy） | DailyHotApi 的前端页面 | 前端 | — | — | 热榜可视化 |
| **NewsNow**（ourongxing） | 52+ 中文热榜聚合阅读器 | TypeScript | SQLite 缓存 `cache(id, updated, data)` | **支持 Cloudflare Pages 部署** | 每源独立 `interval`（最短 2 分钟/默认 10 分钟/TTL 30 分钟）；`shared/sources.json` 配置源；分层缓存（缓存 + 强制刷新）；**与本项目架构最接近** |
| **hot-news / 其他** | 热榜聚合 | 多样 | — | — | — |

来源：<https://blog.csdn.net/gitblog_00969/article/details/158599413>、<https://newsnow.busiyi.world/>、<https://ima.qq.com/wiki/?shareId=...>

### 4.5 「静态站点 + 定时任务生成数据」类

| 参考 | 做法 | 借鉴点 |
|---|---|---|
| Village Finder（零服务器开放数据站） | GitHub Actions 每日抓取 → 写入**独立无历史数据分支**（`git push --force` 初始提交，历史不膨胀）→ 前端从 `raw.githubusercontent.com`（自带 `Access-Control-Allow-Origin: *`）直接 fetch | **避免主仓库变胖+规避每日 commit 噪音的关键技巧** |
| 银价数据静态站（Aaron Saray） | Actions cron 拉 API → 覆盖 `data.json` → 提交 → GitHub Pages 重建 | 最小可行闭环示范 |
| awesome-copilot 数据管线 | 构建期生成 JSON manifest，前端 `fetch()` 读取；关键数据内嵌页面 | 混合渲染（构建期 + 运行时）最佳实践 |

来源：<https://dev.to/mchittineni/a-self-updating-open-data-site-with-zero-servers-github-actions-pages-and-branches-as-a-cdn-4bgh>、<https://aaronsaray.com/2021/github-actions-pages-scheduled-data-updates>、<https://deepwiki.com/github/awesome-copilot/10.3-data-generation-pipeline>

---

## 方向五：技术可行性佐证

### 5.1 GitHub Actions 定时任务

| 约束 | 数值 / 结论 | 来源 |
|---|---|---|
| 最小间隔 | **5 分钟**（`*/5 * * * *`；`*/30 * * * *` 即每 30 分钟完全合法） | GitHub Docs |
| 时区 | 默认 UTC，可用 IANA timezone 字段 | GitHub Docs |
| 免费额度 | **公开仓库无限分钟**；私有仓库 2,000 分钟/月 | GitHub Docs |
| 延迟 | 高负载（尤其整点）可能延迟 **5–30 分钟甚至更久**，极端情况丢任务 | GitHub Docs / 第三方 |
| 稳定性技巧 | 避开整点（用 7、13、23 分等）可显著降低延迟 | 第三方 |
| 60 天不活跃 | 公开仓库 schedule 会被**自动禁用** | GitHub Docs |
| 分支 | 只运行默认分支（main）上的 workflow 文件 | GitHub Docs |
| Fork | 默认不运行 schedule | 第三方 |
| Token 权限 | 默认只读，提交需显式 `permissions: contents: write` | 第三方/DZone |

**结论：每 30 分钟跑一次完全可行，且在公开仓库免费。** 但需接受「非精确定时」——本项目「当天数据分析」对精度要求低，完全可接受。

来源：<https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows>、<https://crongenerator.dev/cron-github-actions>、<https://juejin.cn/post/7631099920204136454>、<https://cronuru.com/guides/github-actions-scheduled-workflows>

### 5.2 把数据提交回仓库：仓库体积 / commit 噪音

- **提交方式**：`git config` 设置 bot 身份 → `git add` → 仅在变更时 `git commit -m "... [skip ci]"` → `git push`（需 `contents: write`）。`[skip ci]` 防止自触发死循环。
- **commit 噪音问题**：每天多次提交会污染历史。解决方案：
  1. 每天**一个**快照文件（按日期命名，当日覆盖同一天的提交或次日生成新文件）；
  2. 或使用**独立无历史数据分支** + `git push --force`（Village Finder 方案），主仓库 `.git` 不膨胀；
  3. 或每日仅一次 commit（当日快照），半小时任务只覆盖当日文件，减少提频。
- **仓库体积**：GitHub 单仓库软上限建议 **1 GB**，单文件 **100 MB**。只存元数据（不含全文）时，每天 JSON 体量小，可持续很久。

来源：<https://dzone.com/articles/build-daily-job-alert-pipeline>、<https://dev.to/mchittineni/a-self-updating-open-data-site-with-zero-servers-github-actions-pages-and-branches-as-a-cdn-4bgh>

### 5.3 GitHub Pages vs Cloudflare Pages

| 维度 | GitHub Pages | Cloudflare Pages |
|---|---|---|
| 价格 | 完全免费，无付费档 | 免费档 + Pro $20/月（年付） |
| 带宽 | 100 GB/月（软限制） | **无限** |
| 构建 | 原生仅 Jekyll；其它 SSG 走 Actions；公开仓库 Actions 分钟无限 | 500 次构建/月，1 并发，每次最多 20 分钟；自动识别框架 |
| 站点数 | 1 用户站 + 无限项目站 | 无限项目 |
| 自定义域名 | 支持（CNAME） | 支持，最多 100 个/项目 |
| Serverless | 无 | Workers（含边缘函数） |
| 国内访问 | 较慢 | 较快（300+ 节点） |
| 部署方式 | 推送分支 / Actions | Git 连接 / `wrangler pages deploy` |

**结论**：两者都支持静态站 + Git 自动部署。GH Pages 零配置、免费无上限适合兜底；Cloudflare Pages 国内速度和无限带宽更优，且支持 Workers（未来可做动态能力）。**建议双端配置，同一静态产物同时部署。**

来源：<https://freetier.co/compare/cloudflare-pages-vs-github-pages>、<https://cloud.tencent.com/developer/article/2667365>、<https://easyprotools.com/blog/github-pages-vs-gitlab-pages-vs-cloudflare-pages/>

### 5.4 静态站能否满足「当日热点分析」

| 方案 | 分析时机 | 优点 | 缺点 |
|---|---|---|---|
| **构建期（推荐主方案）** | Actions 抓取后、构建时计算好报告 JSON | 首屏快、SEO 好、纯静态、零运行时成本 | 数据滞后至下次构建（≤30 分钟） |
| 浏览器运行时 | 前端 `fetch` 当日快照 JSON 后计算 | 数据总是最新 | 首屏依赖网络、SEO 差、移动端算力受限 |
| 混合（最佳实践） | 构建期预渲染报告页 HTML + 运行时刷新 | 兼顾首屏与新鲜度 | 实现稍复杂 |

**结论**：本项目的「当日热点分析/榜单/词云」规模小（几十源、每源几十条，当天数百~数千条），**构建期预计算 + 浏览器运行时轻量重算** 完全可行，无需任何服务端。趋势分析（跨天）在静态站上做则意义有限——正好匹配「只做当天」的产品边界。

来源：<https://dev.to/jonesrussell/three-tiers-of-data-freshness-in-a-sveltekit-static-site-8j4>、<https://umatechnology.org/how-to-set-up-static-site-hosting-backed-by-real-world-data/>

---

## 综合结论

1. **RSS 是最稳定的信息接入协议**：格式统一、无鉴权、维护成本近零，适合作为本项目的一等公民数据源；对无 feed 的站点再叠加 RSSHub/RSS-Bridge。
2. **热门源生态丰富**：中文侧技术社区 + 科技媒体 + RSSHub 热榜齐全；国际侧 AI（OpenAI/DeepMind/HuggingFace/arXiv）、工程博客、开发者社区覆盖充分，可直接组成初始内置源清单。
3. **技术方案完全可行且零成本**：GitHub Actions 每 30 分钟抓取（免费）→ 当天快照 JSON/CSV 落盘 → 去重 → 构建期生成报告 → 双端静态部署（GitHub Pages + Cloudflare Pages）。
4. **最贴近的竞品是 NewsNow**（热榜聚合 + 静态部署 + 分层缓存），差异化空间在于：**多源接入（本地 JSON/CSV、飞书、Notion、API）+ 三页面产品化 + 当天热点报告**。
5. **主要风险**：① 部分站点无 feed 或反爬；② 微信等封闭生态合规风险；③ GitHub Actions 非精确定时与 60 天不活跃禁用；④ 数据版权——**务必只存元数据与原文链接**。

---

*本文件为调研素材，具体技术选型与 JSON Schema 由架构师在后续阶段确定。*

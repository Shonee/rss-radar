/* =============================================================================
 * RSS Radar — Mock 数据（原型专用）
 * -----------------------------------------------------------------------------
 * ⚠️ 本文件是「原型」的假数据源。结构严格对齐：
 *    docs/data-model/examples/
 *      ├ sources.example.json      → channels[] / sources[]
 *      ├ snapshot.example.json     → items[]（含 sources/sourceCount/duplicateOf 等）
 *      ├ report.example.json       → report
 *      ├ history-index.example.json→ historyIndex
 *      └ site-config.example.json  → site / display / history 配置
 *    docs/ARCHITECTURE.md §13.1     → historyMonths / daySnapshots / archives
 *
 * ⚠️ 为什么数据内联在 JS 里（不用 fetch 读本地 JSON）：
 *    原型要求双击 HTML 即可离线打开；file:// 协议下 fetch 本地 JSON 会被 CORS 拦截。
 *
 * ⚠️ 时间锚点：所有时间围绕固定的 NOW 生成，使「相对时间」展示稳定可复现。
 * ========================================================================== */

window.RR_MOCK = (function () {
  'use strict';

  /** 全局时间锚点 —— 页面3 报告日期、相对时间均以此为基准。 */
  var NOW = '2026-09-12T10:30:00Z';
  var TODAY = '2026-09-12';

  /* -------------------------------------------------------------------------
   * 分类元数据（对齐 sources.example.json → categories）
   * ---------------------------------------------------------------------- */
  var categories = [
    { key: 'tech_blog',      label: '技术博客',   color: '#7b1fa2' },
    { key: 'tech_media',     label: '科技媒体',   color: '#1976d2' },
    { key: 'ai',             label: 'AI',         color: '#00897b' },
    { key: 'dev_community',  label: '开发者社区', color: '#f57c00' },
    { key: 'product_design', label: '产品与设计', color: '#c2185b' },
    { key: 'news',           label: '新闻资讯',   color: '#455a64' },
    { key: 'opensource',     label: '开源',       color: '#388e3c' },
    { key: 'podcast',        label: '播客',       color: '#6d4c41' },
    { key: 'video',          label: '视频',       color: '#e53935' },
    { key: 'security',       label: '安全',       color: '#5d4037' },
    { key: 'other',          label: '其他',       color: '#757575' }
  ];

  /* -------------------------------------------------------------------------
   * 站点配置（对齐 site-config.example.json）
   * ---------------------------------------------------------------------- */
  var site = {
    schemaVersion: '1.0',
    today: TODAY,
    site: {
      title: 'RSS Radar',
      slogan: '把散落在各处的 RSS 源，汇聚成一份每天更新的信息雷达与热点报告',
      baseUrl: 'https://raw.githubusercontent.com/example-owner/rss-radar/deploy',
      dataBranch: 'deploy',
      timezone: 'Asia/Shanghai',
      footer: '数据仅存储标题/摘要/链接等元数据，版权归原作者所有；点击条目跳转原文。'
    },
    display: {
      defaultChannels: [],
      cardLimit: 10,
      page1BatchSize: 20,
      defaultSort: 'updatedAt',
      hotListSize: 10,
      showWordCloud: false,
      showSummary: true,
      density: 'comfortable'
    },
    history: {
      windowDays: 90,
      windowOptions: [90, 180, 365],
      visibleDays: 365,
      showArchive: true,
      indexPath: 'history/history-index.json',
      archiveIndexPath: 'history/archive-index.json'
    },
    notify: {
      dailyReportTime: '08:00',
      quietHours: '23:00-07:00',
      realtime: { enabled: false, hotScoreThreshold: 0.8, sourceCountThreshold: 3, maxPerDay: 10 }
    }
  };

  /* -------------------------------------------------------------------------
   * 渠道（channels[]，对齐 sources.example.json）
   * ---------------------------------------------------------------------- */
  var channels = [
    { id: 'ruanyifeng-blog', name: '阮一峰的网络日志', homepage: 'https://www.ruanyifeng.com/blog/', category: ['tech_blog'], enabled: true, displayLimit: 10, icon: '阮', language: 'zh-CN', weight: 0.8 },
    { id: 'v2ex',            name: 'V2EX',             homepage: 'https://www.v2ex.com/',          category: ['dev_community'], enabled: true, displayLimit: 10, icon: 'V', language: 'zh-CN', weight: 0.6 },
    { id: 'sspai',           name: '少数派',           homepage: 'https://sspai.com/',              category: ['product_design', 'tech_media'], enabled: true, displayLimit: 10, icon: '少', language: 'zh-CN', weight: 0.6 },
    { id: 'meituan-tech',    name: '美团技术团队',     homepage: 'https://tech.meituan.com/',       category: ['tech_blog'], enabled: true, displayLimit: 10, icon: '美', language: 'zh-CN', weight: 0.7 },
    { id: 'hacker-news',     name: 'Hacker News',      homepage: 'https://news.ycombinator.com/',   category: ['dev_community'], enabled: true, displayLimit: 10, icon: 'Y', language: 'en', weight: 0.9 },
    { id: 'huggingface-blog',name: 'Hugging Face Blog',homepage: 'https://huggingface.co/blog',     category: ['ai', 'opensource'], enabled: true, displayLimit: 10, icon: '🤗', language: 'en', weight: 0.8 },
    { id: 'techcrunch',      name: 'TechCrunch',       homepage: 'https://techcrunch.com/',         category: ['tech_media', 'news'], enabled: true, displayLimit: 10, icon: 'TC', language: 'en', weight: 0.7 },
    { id: 'arxiv-cs-ai',     name: 'arXiv cs.AI',      homepage: 'https://arxiv.org/list/cs.AI/recent', category: ['ai'], enabled: true, displayLimit: 15, icon: 'arXiv', language: 'en', weight: 0.6 },
    { id: 'ithome',          name: 'IT之家',           homepage: 'https://www.ithome.com/',         category: ['news', 'tech_media'], enabled: true, displayLimit: 10, icon: 'IT', language: 'zh-CN', weight: 0.5 },
    { id: '36kr',            name: '36氪',             homepage: 'https://36kr.com/',               category: ['news', 'tech_media'], enabled: true, displayLimit: 10, icon: '氪', language: 'zh-CN', weight: 0.6 },
    { id: 'openai-blog',     name: 'OpenAI Blog',      homepage: 'https://openai.com/blog',         category: ['ai'], enabled: true, displayLimit: 10, icon: 'O', language: 'en', weight: 0.9 },
    { id: 'github-blog',     name: 'GitHub Blog',      homepage: 'https://github.blog/',            category: ['opensource', 'dev_community'], enabled: true, displayLimit: 10, icon: 'GH', language: 'en', weight: 0.6 },
    { id: 'podcast-core',    name: '内核恐慌（播客）', homepage: 'https://kernelpanic.fm/',         category: ['podcast'], enabled: true, displayLimit: 10, icon: 'KP', language: 'zh-CN', weight: 0.4 },
    { id: 'my-feishu-sources', name: '我的飞书源表',   homepage: 'https://example.feishu.cn/base/', category: ['other'], enabled: false, displayLimit: 10, icon: '飞', language: 'zh-CN', weight: 0.5 }
  ];

  /* -------------------------------------------------------------------------
   * 源（sources[]，含健康状态；对齐 sources.example.json）
   * ---------------------------------------------------------------------- */
  function src(id, channelId, name, type, url, opts) {
    var o = opts || {};
    return {
      id: id, channelId: channelId, name: name, type: type, url: url,
      enabled: o.enabled !== false,
      language: o.language || 'zh-CN',
      interval: o.interval || 30,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      lastFetchAt: o.lastFetchAt || '2026-09-12T10:20:05Z',
      lastStatus: o.lastStatus || 'ok',
      lastError: o.lastError || null
    };
  }

  var sources = [
    src('ruanyifeng-blog-atom', 'ruanyifeng-blog', '阮一峰 Atom', 'atom', 'https://www.ruanyifeng.com/blog/atom.xml', { lastFetchAt: '2026-09-12T10:20:06Z' }),
    src('ruanyifeng-weekly-rss', 'ruanyifeng-blog', '科技爱好者周刊', 'rss', 'https://www.ruanyifeng.com/blog/weekly/rss.xml', { interval: 60, lastFetchAt: '2026-09-12T10:20:07Z' }),
    src('v2ex-index', 'v2ex', 'V2EX 首页', 'atom', 'https://www.v2ex.com/index.xml', { lastFetchAt: '2026-09-12T10:20:08Z' }),
    src('v2ex-hot', 'v2ex', 'V2EX 热帖', 'rss', 'https://www.v2ex.com/feed/tab/hot.xml', { lastFetchAt: '2026-09-12T10:20:09Z' }),
    src('sspai-feed', 'sspai', '少数派 Feed', 'rss', 'https://sspai.com/feed', { lastFetchAt: '2026-09-12T10:20:10Z' }),
    src('meituan-tech-rss', 'meituan-tech', '美团技术团队 RSS', 'rss', 'https://tech.meituan.com/feed', { interval: 60, lastFetchAt: '2026-09-12T10:20:11Z' }),
    src('hn-frontpage', 'hacker-news', 'Hacker News 首页', 'rss', 'https://news.ycombinator.com/rss', { language: 'en', lastFetchAt: '2026-09-12T10:20:12Z' }),
    src('huggingface-blog-feed', 'huggingface-blog', 'Hugging Face Blog', 'rss', 'https://huggingface.co/blog/feed.xml', { language: 'en', lastFetchAt: '2026-09-12T10:20:13Z' }),
    src('techcrunch-feed', 'techcrunch', 'TechCrunch', 'rss', 'https://techcrunch.com/feed/', { language: 'en', lastFetchAt: '2026-09-12T10:20:14Z' }),
    src('arxiv-cs-ai-feed', 'arxiv-cs-ai', 'arXiv cs.AI', 'rss', 'https://rss.arxiv.org/rss/cs.AI', { language: 'en', interval: 180, lastFetchAt: '2026-09-12T10:20:15Z' }),
    src('ithome-rss', 'ithome', 'IT之家 RSS', 'rss', 'https://www.ithome.com/rss/', { lastFetchAt: '2026-09-12T10:20:16Z' }),
    src('36kr-rss', '36kr', '36氪 RSS', 'rss', 'https://36kr.com/feed', { lastFetchAt: '2026-09-12T10:20:17Z' }),
    src('openai-blog-feed', 'openai-blog', 'OpenAI Blog Feed', 'rss', 'https://openai.com/blog/rss.xml', { language: 'en', lastStatus: 'error', lastError: 'HTTP 522 Connection timed out after 15000ms', lastFetchAt: '2026-09-12T10:20:18Z' }),
    src('github-blog-feed', 'github-blog', 'GitHub Blog Feed', 'rss', 'https://github.blog/feed/', { language: 'en', lastFetchAt: '2026-09-12T10:20:19Z' }),
    src('kernelpanic-feed', 'podcast-core', '内核恐慌 Feed', 'rss', 'https://kernelpanic.fm/feed.xml', { lastStatus: 'empty', lastFetchAt: '2026-09-12T10:20:20Z' }),
    src('my-feishu-source-table', 'my-feishu-sources', '飞书源表（app_token + table_id）', 'feishu_bitable', 'https://open.feishu.cn/open-apis/bitable/v1/apps/FLYER_APP_TOKEN/tables/tblXXXXXXXX/records', { enabled: false, lastStatus: 'empty', lastFetchAt: null })
  ];

  /* -------------------------------------------------------------------------
   * 便捷索引（供报告派生口径使用，须在 items 之前建立）
   * ---------------------------------------------------------------------- */
  var channelById = {};
  channels.forEach(function (c) { channelById[c.id] = c; });
  var sourceByChannel = {};
  sources.forEach(function (s) { (sourceByChannel[s.channelId] = sourceByChannel[s.channelId] || []).push(s); });
  var catByKey = {};
  categories.forEach(function (c) { catByKey[c.key] = c; });

  /* -------------------------------------------------------------------------
   * 条目（items[]，对齐 snapshot.example.json）
   * makeItem 仅补齐默认字段，显式字段保持与示例一致。
   * ---------------------------------------------------------------------- */
  function makeItem(o) {
    var item = Object.assign({
      author: '',
      summary: '',
      tags: [],
      sourceType: 'rss',
      language: 'zh-CN',
      mediaType: 'article',
      sourceCount: 1,
      duplicateOf: null,
      isNew: true,
      hotScore: null
    }, o);
    item.dedupKey = item.dedupKey || ('dk_' + item.id);
    item.fetchedAt = item.fetchedAt || item.updatedAt;
    if (!item.sources) {
      item.sources = [{ channelId: item.channelId, channelName: item.channelName, url: item.url, publishedAt: item.publishedAt }];
    }
    return item;
  }

  var items = [
    /* --- 阮一峰的网络日志 --- */
    makeItem({ id: 'it_9f2c1a7b3e5d', guid: 'https://www.ruanyifeng.com/blog/2026/09/weekly-324.html',
      title: '科技爱好者周刊（第 324 期）：AI 编程助手的一年', url: 'https://www.ruanyifeng.com/blog/2026/09/weekly-324.html?utm_source=rss&utm_medium=rss',
      summary: '本期主题是 AI 编程助手落地一年后的真实体验：哪些环节真被加速，哪些反而是负担。同时收录本周值得读的开源项目与技术文章。',
      author: '阮一峰', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog'],
      publishedAt: '2026-09-12T00:05:00Z', updatedAt: '2026-09-12T10:16:00Z', fetchedAt: '2026-09-12T10:20:06Z',
      sourceUrl: 'https://www.ruanyifeng.com/blog/weekly/rss.xml', tags: ['AI', '编程助手', '周刊'],
      sourceCount: 2, hotScore: 0.87, mediaType: 'article',
      sources: [
        { channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/2026/09/weekly-324.html', publishedAt: '2026-09-12T00:05:00Z' },
        { channelId: 'v2ex', channelName: 'V2EX', url: 'https://www.v2ex.com/t/9000001', publishedAt: '2026-09-12T01:10:00Z' }
      ] }),
    makeItem({ id: 'it_ruanyifeng_ops', guid: 'https://www.ruanyifeng.com/blog/2026/09/db-migration.html',
      title: '一次数据库迁移的复盘：从 MySQL 到 PostgreSQL 的五个教训', url: 'https://www.ruanyifeng.com/blog/2026/09/db-migration.html',
      summary: '把核心库从 MySQL 迁到 PostgreSQL，我们踩了五个坑：自增主键、大小写敏感、并发模型、连接池与在线回滚。',
      author: '阮一峰', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog'],
      publishedAt: '2026-09-12T02:40:00Z', updatedAt: '2026-09-12T02:40:00Z',
      sourceUrl: 'https://www.ruanyifeng.com/blog/atom.xml', tags: ['数据库', 'PostgreSQL', '复盘'], hotScore: 0.62 }),
    makeItem({ id: 'it_ruanyifeng_rust', guid: 'https://www.ruanyifeng.com/blog/2026/09/rust-ecosystem.html',
      title: 'Rust 生态这一年：工具链、异步运行时与 WASM', url: 'https://www.ruanyifeng.com/blog/2026/09/rust-ecosystem.html',
      summary: '梳理过去一年 Rust 在生产环境中的进展，重点看异步运行时的收敛与 WASM 工具链的成熟度。',
      author: '阮一峰', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog'],
      publishedAt: '2026-09-11T23:10:00Z', updatedAt: '2026-09-11T23:10:00Z', isNew: false,
      sourceUrl: 'https://www.ruanyifeng.com/blog/atom.xml', tags: ['Rust', 'WASM'], hotScore: null }),
    makeItem({ id: 'it_ruanyifeng_opensource', guid: 'https://www.ruanyifeng.com/blog/2026/09/os-picks.html',
      title: '本周开源项目精选：终端、数据库与本地优先软件', url: 'https://www.ruanyifeng.com/blog/2026/09/os-picks.html',
      summary: '本周挑出八个值得关注的开源项目，覆盖终端工具、嵌入式数据库与本地优先同步方案。',
      author: '阮一峰', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog', 'opensource'],
      publishedAt: '2026-09-11T22:30:00Z', updatedAt: '2026-09-11T22:30:00Z', isNew: false,
      sourceUrl: 'https://www.ruanyifeng.com/blog/weekly/rss.xml', tags: ['开源', '推荐'], hotScore: null }),

    /* --- V2EX --- */
    makeItem({ id: 'it_0d9e8f7a6b5c', guid: 'https://www.v2ex.com/t/9000001',
      title: '科技爱好者周刊（第 324 期）：AI 编程助手的一年', url: 'https://www.v2ex.com/t/9000001',
      summary: '转载阮一峰周刊第 324 期，讨论区补充了不少一线开发者的实测经验。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community'],
      publishedAt: '2026-09-12T01:10:00Z', updatedAt: '2026-09-12T01:10:00Z',
      sourceUrl: 'https://www.v2ex.com/feed/tab/hot.xml', tags: ['周刊', 'AI'],
      duplicateOf: 'it_9f2c1a7b3e5d', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_v2ex_remote', guid: 'https://www.v2ex.com/t/9000002',
      title: '远程办公两年后的体会：效率、孤独与边界', url: 'https://www.v2ex.com/t/9000002',
      summary: '在家办公两年，效率确实高了，但最难的是划清工作与生活的边界。分享几个我用过有效的方法。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community'],
      publishedAt: '2026-09-12T03:22:00Z', updatedAt: '2026-09-12T04:22:00Z',
      sourceUrl: 'https://www.v2ex.com/index.xml', tags: ['远程办公', '效率'], hotScore: 0.58, mediaType: 'post' }),
    makeItem({ id: 'it_v2ex_macbook', guid: 'https://www.v2ex.com/t/9000003',
      title: 'M 系列芯片下 Docker 性能实测：谁在拖后腿', url: 'https://www.v2ex.com/t/9000003',
      summary: '在同一台机器上对比了几种容器方案的构建与运行性能，结论可能和直觉相反。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community'],
      publishedAt: '2026-09-12T05:05:00Z', updatedAt: '2026-09-12T09:48:00Z',
      sourceUrl: 'https://www.v2ex.com/feed/tab/hot.xml', tags: ['Docker', 'Apple'], sourceCount: 2, hotScore: 0.51,
      sources: [
        { channelId: 'v2ex', channelName: 'V2EX', url: 'https://www.v2ex.com/t/9000003', publishedAt: '2026-09-12T05:05:00Z' },
        { channelId: 'hacker-news', channelName: 'Hacker News', url: 'https://news.ycombinator.com/item?id=42000099', publishedAt: '2026-09-12T06:00:00Z' }
      ], mediaType: 'post' }),
    makeItem({ id: 'it_v2ex_llm_router', guid: 'https://www.v2ex.com/t/9000004',
      title: '开源 LLM 路由项目推荐：一个入口调用多家模型', url: 'https://www.v2ex.com/t/9000004',
      summary: '自荐一个我们开源的路由网关，支持按成本、延迟和可用性自动选择模型，兼容 OpenAI 接口。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community', 'opensource'],
      publishedAt: '2026-09-12T06:15:00Z', updatedAt: '2026-09-12T06:15:00Z',
      sourceUrl: 'https://www.v2ex.com/index.xml', tags: ['LLM', '开源'], hotScore: 0.47, mediaType: 'post' }),
    makeItem({ id: 'it_v2ex_interview', guid: 'https://www.v2ex.com/t/9000005',
      title: '面了一个「全栈」岗位，我准备了三个月', url: 'https://www.v2ex.com/t/9000005',
      summary: '记录这次面试的完整流程与题目方向，供后来者参考。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community'],
      publishedAt: '2026-09-11T14:00:00Z', updatedAt: '2026-09-11T14:00:00Z', isNew: false,
      sourceUrl: 'https://www.v2ex.com/index.xml', tags: ['面试'], mediaType: 'post' }),
    makeItem({ id: 'it_v2ex_homelab', guid: 'https://www.v2ex.com/t/9000006',
      title: '折腾家庭实验室：从树莓派到二手服务器', url: 'https://www.v2ex.com/t/9000006',
      summary: '两年时间从树莓派一路升级到二手机架服务器，聊聊性价比与噪音控制。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community'],
      publishedAt: '2026-09-11T09:30:00Z', updatedAt: '2026-09-11T09:30:00Z', isNew: false,
      sourceUrl: 'https://www.v2ex.com/feed/tab/hot.xml', tags: ['homelab'], mediaType: 'post' }),

    /* --- 少数派 --- */
    makeItem({ id: 'it_sspai_workflow', guid: 'https://sspai.com/post/90001',
      title: '我的 2026 年数字工作流：从收集到输出', url: 'https://sspai.com/post/90001',
      summary: '把「收集 → 消化 → 输出」拆成三个阶段，每一段只用一个工具，反而比全功能方案更高效。',
      author: '少数派编辑部', channelId: 'sspai', channelName: '少数派', category: ['product_design'],
      publishedAt: '2026-09-12T01:35:00Z', updatedAt: '2026-09-12T01:35:00Z',
      sourceUrl: 'https://sspai.com/feed', tags: ['工作流', '效率'], hotScore: 0.55 }),
    makeItem({ id: 'it_sspai_keyboard', guid: 'https://sspai.com/post/90002',
      title: '一把键盘用了五年之后，我换回了最普通的配置', url: 'https://sspai.com/post/90002',
      summary: '从客制化一路折腾回薄膜键盘，我发现「够用」比「极致」更适合长期使用。',
      author: '少数派编辑部', channelId: 'sspai', channelName: '少数派', category: ['product_design'],
      publishedAt: '2026-09-12T04:50:00Z', updatedAt: '2026-09-12T04:50:00Z',
      sourceUrl: 'https://sspai.com/feed', tags: ['键盘', '外设'], hotScore: null }),
    makeItem({ id: 'it_sspai_ai_pkm', guid: 'https://sspai.com/post/90003',
      title: 'AI 时代的知识管理：工具、方法与陷阱', url: 'https://sspai.com/post/90003',
      summary: '当 AI 能替你总结一切，知识管理还有意义吗？本文给出一个务实的答案。',
      author: '少数派编辑部', channelId: 'sspai', channelName: '少数派', category: ['product_design', 'ai'],
      publishedAt: '2026-09-12T07:10:00Z', updatedAt: '2026-09-12T07:10:00Z',
      sourceUrl: 'https://sspai.com/feed', tags: ['知识管理', 'AI'], hotScore: 0.6 }),
    makeItem({ id: 'it_sspai_notes', guid: 'https://sspai.com/post/90004',
      title: '笔记软件的选择困难症：我用一个方法解决了', url: 'https://sspai.com/post/90004',
      summary: '不要选最强的工具，要选最容易迁移的工具。本文说明为什么数据可导出比功能多更重要。',
      author: '少数派编辑部', channelId: 'sspai', channelName: '少数派', category: ['product_design'],
      publishedAt: '2026-09-11T16:20:00Z', updatedAt: '2026-09-11T16:20:00Z', isNew: false,
      sourceUrl: 'https://sspai.com/feed', tags: ['笔记'], hotScore: null }),

    /* --- 美团技术团队 --- */
    makeItem({ id: 'it_meituan_kv', guid: 'https://tech.meituan.com/2026/09/kv-capacity.html',
      title: '千万 QPS 下 KV 存储的容量规划与热点打散', url: 'https://tech.meituan.com/2026/09/kv-capacity.html',
      summary: '面对千万级 QPS，容量规划的关键不是堆机器，而是识别热点并做读写分离与分片再平衡。',
      author: '美团基础架构团队', channelId: 'meituan-tech', channelName: '美团技术团队', category: ['tech_blog'],
      publishedAt: '2026-09-12T02:00:00Z', updatedAt: '2026-09-12T02:00:00Z',
      sourceUrl: 'https://tech.meituan.com/feed', tags: ['KV', '容量规划', '高并发'], hotScore: 0.66 }),
    makeItem({ id: 'it_meituan_flink', guid: 'https://tech.meituan.com/2026/09/realtime-warehouse.html',
      title: '实时数仓在美团外卖的落地实践', url: 'https://tech.meituan.com/2026/09/realtime-warehouse.html',
      summary: '介绍外卖实时数仓的架构演进，以及如何用 Flink + 湖仓一体控制成本与延迟。',
      author: '美团数据平台团队', channelId: 'meituan-tech', channelName: '美团技术团队', category: ['tech_blog'],
      publishedAt: '2026-09-12T05:30:00Z', updatedAt: '2026-09-12T05:30:00Z',
      sourceUrl: 'https://tech.meituan.com/feed', tags: ['Flink', '实时数仓'], hotScore: 0.52 }),
    makeItem({ id: 'it_meituan_llm_infra', guid: 'https://tech.meituan.com/2026/09/llm-serving.html',
      title: '大模型推理服务的显存优化与批处理调度', url: 'https://tech.meituan.com/2026/09/llm-serving.html',
      summary: '从显存碎片、KV Cache 管理到连续批处理，系统梳理推理服务的端到端优化手段。',
      author: '美团 AI 平台团队', channelId: 'meituan-tech', channelName: '美团技术团队', category: ['tech_blog', 'ai'],
      publishedAt: '2026-09-11T18:40:00Z', updatedAt: '2026-09-11T18:40:00Z', isNew: false,
      sourceUrl: 'https://tech.meituan.com/feed', tags: ['LLM', '推理', '性能'], hotScore: null }),

    /* --- Hacker News --- */
    makeItem({ id: 'it_1c3d5e7f9a0b', guid: 'https://news.ycombinator.com/item?id=42000001',
      title: 'Show HN: A static RSS aggregator with zero backend', url: 'https://news.ycombinator.com/item?id=42000001',
      summary: 'I built a static-site RSS aggregator that runs entirely on GitHub Actions and Pages. Feedback welcome on the dedup approach.',
      author: 'hn_user42', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T03:15:00Z', updatedAt: '2026-09-12T10:02:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['static-site', 'RSS', 'show-hn'],
      sourceCount: 2, hotScore: 0.72, language: 'en', mediaType: 'post',
      sources: [
        { channelId: 'hacker-news', channelName: 'Hacker News', url: 'https://news.ycombinator.com/item?id=42000001', publishedAt: '2026-09-12T03:15:00Z' },
        { channelId: 'github-blog', channelName: 'GitHub Blog', url: 'https://github.blog/2026-09-12-static-rss/', publishedAt: '2026-09-12T04:40:00Z' }
      ] }),
    makeItem({ id: 'it_hn_rust', guid: 'https://news.ycombinator.com/item?id=42000010',
      title: 'Rust 1.90 released', url: 'https://news.ycombinator.com/item?id=42000010',
      summary: 'This release stabilizes several long-awaited library features and improves compile times on incremental builds.',
      author: 'rust_fan', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T06:40:00Z', updatedAt: '2026-09-12T06:40:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['Rust', 'release'], hotScore: 0.49, language: 'en', mediaType: 'post' }),
    makeItem({ id: 'it_hn_sqlite', guid: 'https://news.ycombinator.com/item?id=42000011',
      title: 'SQLite on the edge: a practical guide', url: 'https://news.ycombinator.com/item?id=42000011',
      summary: 'A practical walkthrough of running SQLite at the edge, including replication options and failure modes.',
      author: 'edge_dev', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T08:05:00Z', updatedAt: '2026-09-12T08:05:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['SQLite', 'edge'], hotScore: 0.45, language: 'en', mediaType: 'post' }),
    makeItem({ id: 'it_hn_meta', guid: 'https://news.ycombinator.com/item?id=42000012',
      title: 'Ask HN: How do you keep up with RSS in 2026?', url: 'https://news.ycombinator.com/item?id=42000012',
      summary: 'Curious how people here manage hundreds of feeds without burning out. What is your workflow?',
      author: 'curious_reader', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T08:45:00Z', updatedAt: '2026-09-12T08:45:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['RSS', 'ask-hn'], hotScore: 0.53, language: 'en', mediaType: 'post' }),
    makeItem({ id: 'it_hn_lan', guid: 'https://news.ycombinator.com/item?id=42000013',
      title: 'Show HN: A local-first note app with CRDT sync', url: 'https://news.ycombinator.com/item?id=42000013',
      summary: 'Notes that work offline and sync via CRDTs. Would love feedback on conflict handling.',
      author: 'crdt_builder', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T09:30:00Z', updatedAt: '2026-09-12T09:30:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['CRDT', 'local-first'], hotScore: 0.5, language: 'en', mediaType: 'post' }),
    makeItem({ id: 'it_hn_zig', guid: 'https://news.ycombinator.com/item?id=42000014',
      title: 'Zig in production: two years later', url: 'https://news.ycombinator.com/item?id=42000014',
      summary: 'A team shares what it was like shipping a Zig-based service and where the language still hurts.',
      author: 'zig_user', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-11T20:00:00Z', updatedAt: '2026-09-11T20:00:00Z', isNew: false,
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['Zig'], language: 'en', mediaType: 'post' }),

    /* --- Hugging Face Blog --- */
    makeItem({ id: 'it_4a2b8c0d6e1f', guid: 'tag:huggingface.co,2026:blog/smol-course',
      title: 'Smol Course: training small language models from scratch', url: 'https://huggingface.co/blog/smol-course',
      summary: 'A hands-on course on training small language models. Covers data curation, tokenizer training, and efficient fine-tuning on consumer GPUs.',
      author: 'Hugging Face', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai', 'opensource'],
      publishedAt: '2026-09-11T15:40:00Z', updatedAt: '2026-09-12T02:00:00Z',
      sourceUrl: 'https://huggingface.co/blog/feed.xml', tags: ['LLM', 'training', 'course'],
      hotScore: 0.79, language: 'en' }),
    makeItem({ id: 'it_hf_inference', guid: 'tag:huggingface.co,2026:blog/inference-v3',
      title: '新版推理框架发布：吞吐提升 2.3 倍', url: 'https://huggingface.co/blog/inference-v3',
      summary: '新版本引入连续批处理与分页 KV Cache，官方基准显示在同等硬件下吞吐提升 2.3 倍。',
      author: 'Hugging Face', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai', 'opensource'],
      publishedAt: '2026-09-12T03:00:00Z', updatedAt: '2026-09-12T10:08:00Z',
      sourceUrl: 'https://huggingface.co/blog/feed.xml', tags: ['推理', '性能'],
      sourceCount: 3, hotScore: 0.74, language: 'en',
      sources: [
        { channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', url: 'https://huggingface.co/blog/inference-v3', publishedAt: '2026-09-12T03:00:00Z' },
        { channelId: 'hacker-news', channelName: 'Hacker News', url: 'https://news.ycombinator.com/item?id=42000077', publishedAt: '2026-09-12T04:10:00Z' },
        { channelId: 'v2ex', channelName: 'V2EX', url: 'https://www.v2ex.com/t/9000009', publishedAt: '2026-09-12T04:55:00Z' }
      ] }),
    makeItem({ id: 'it_hf_datasets', guid: 'tag:huggingface.co,2026:blog/zh-instruct',
      title: '用 30 行代码构建你自己的中文指令数据集', url: 'https://huggingface.co/blog/zh-instruct',
      summary: '一个可复现的流程：从公开语料清洗、模板化到质量过滤，构建小规模高质量中文指令集。',
      author: 'Hugging Face', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai'],
      publishedAt: '2026-09-12T06:20:00Z', updatedAt: '2026-09-12T06:20:00Z',
      sourceUrl: 'https://huggingface.co/blog/feed.xml', tags: ['数据集', '中文'], hotScore: 0.44, language: 'en' }),
    makeItem({ id: 'it_hf_transformers', guid: 'tag:huggingface.co,2026:blog/transformers-v5',
      title: 'Transformers v5 路线图：更快的推理与更简单的 API', url: 'https://huggingface.co/blog/transformers-v5',
      summary: '官方公布 v5 的主要方向：统一推理后端、简化配置与更好的多模态支持。',
      author: 'Hugging Face', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai', 'opensource'],
      publishedAt: '2026-09-11T13:00:00Z', updatedAt: '2026-09-11T13:00:00Z', isNew: false,
      sourceUrl: 'https://huggingface.co/blog/feed.xml', tags: ['transformers'], language: 'en' }),

    /* --- TechCrunch --- */
    makeItem({ id: 'it_3e2d1c0b9a8f', guid: 'https://techcrunch.com/?p=2900001',
      title: 'OpenAI unveils cheaper inference tier for developers', url: 'https://techcrunch.com/2026/09/12/openai-cheaper-inference-tier/',
      summary: 'The new pricing tier targets high-volume workloads, cutting per-token cost for batch inference. Availability starts next week.',
      author: 'Jane Reporter', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'],
      publishedAt: '2026-09-12T06:45:00Z', updatedAt: '2026-09-12T07:10:00Z',
      sourceUrl: 'https://techcrunch.com/feed/', tags: ['OpenAI', 'pricing', 'inference'],
      hotScore: 0.68, language: 'en' }),
    makeItem({ id: 'it_tc_apple', guid: 'https://techcrunch.com/?p=2900002',
      title: 'Apple 或将在下一代芯片中集成更多端侧 AI 能力', url: 'https://techcrunch.com/2026/09/12/apple-on-device-ai/',
      summary: '据供应链消息，下一代芯片将显著增强神经引擎，端侧推理能力提升明显。',
      author: 'Jane Reporter', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'],
      publishedAt: '2026-09-12T08:15:00Z', updatedAt: '2026-09-12T08:15:00Z',
      sourceUrl: 'https://techcrunch.com/feed/', tags: ['Apple', '端侧AI'], hotScore: 0.61, language: 'en' }),
    makeItem({ id: 'it_tc_startup', guid: 'https://techcrunch.com/?p=2900003',
      title: '这家做 AI 编程助手的初创公司完成了 B 轮融资', url: 'https://techcrunch.com/2026/09/12/ai-coding-startup-series-b/',
      summary: '该公司称其企业客户数在过去一年增长了三倍，融资将用于基础设施与团队扩张。',
      author: 'Jane Reporter', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'],
      publishedAt: '2026-09-12T09:05:00Z', updatedAt: '2026-09-12T09:05:00Z',
      sourceUrl: 'https://techcrunch.com/feed/', tags: ['融资', 'AI编程'], hotScore: 0.57, language: 'en' }),
    makeItem({ id: 'it_tc_regulation', guid: 'https://techcrunch.com/?p=2900004',
      title: '欧盟 AI 法案进入执行阶段，首批合规清单出炉', url: 'https://techcrunch.com/2026/09/11/eu-ai-act-enforcement/',
      summary: '首批合规义务开始生效，面向高风险系统的提供方需在规定期限内完成备案。',
      author: 'Jane Reporter', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'],
      publishedAt: '2026-09-11T17:30:00Z', updatedAt: '2026-09-11T17:30:00Z', isNew: false,
      sourceUrl: 'https://techcrunch.com/feed/', tags: ['监管', '欧盟'], language: 'en' }),

    /* --- arXiv cs.AI --- */
    makeItem({ id: 'it_arxiv_agent', guid: 'https://arxiv.org/abs/2509.01234',
      title: '2509.01234: A Survey on Autonomous Agent Memory', url: 'https://arxiv.org/abs/2509.01234',
      summary: 'We survey memory mechanisms for autonomous agents, taxonomizing short-term, episodic and semantic memory.',
      author: 'Z. Chen et al.', channelId: 'arxiv-cs-ai', channelName: 'arXiv cs.AI', category: ['ai'],
      publishedAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
      sourceUrl: 'https://rss.arxiv.org/rss/cs.AI', tags: ['Agent', 'survey'], hotScore: 0.56, language: 'en' }),
    makeItem({ id: 'it_arxiv_eval', guid: 'https://arxiv.org/abs/2509.04567',
      title: '2509.04567: Rethinking Evaluation for Long-Context LLMs', url: 'https://arxiv.org/abs/2509.04567',
      summary: 'Existing long-context benchmarks overstate capability; we propose a task-based evaluation protocol.',
      author: 'L. Wang et al.', channelId: 'arxiv-cs-ai', channelName: 'arXiv cs.AI', category: ['ai'],
      publishedAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
      sourceUrl: 'https://rss.arxiv.org/rss/cs.AI', tags: ['长上下文', '评测'], hotScore: 0.42, language: 'en' }),
    makeItem({ id: 'it_arxiv_rag', guid: 'https://arxiv.org/abs/2509.07890',
      title: '2509.07890: GraphRAG Revisited: When Graphs Help', url: 'https://arxiv.org/abs/2509.07890',
      summary: 'We study when graph-based retrieval outperforms dense retrieval, and offer guidance on graph construction.',
      author: 'M. Garcia et al.', channelId: 'arxiv-cs-ai', channelName: 'arXiv cs.AI', category: ['ai'],
      publishedAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', isNew: false,
      sourceUrl: 'https://rss.arxiv.org/rss/cs.AI', tags: ['RAG', 'graph'], language: 'en' }),

    /* --- IT之家 --- */
    makeItem({ id: 'it_ithome_chip', guid: 'https://www.ithome.com/0/900/001.htm',
      title: '国产 GPU 厂商发布新一代架构，主打训练与推理一体', url: 'https://www.ithome.com/0/900/001.htm',
      summary: '新架构强调训练与推理统一，官方称在典型大模型负载下能效比提升明显。',
      author: 'IT之家', channelId: 'ithome', channelName: 'IT之家', category: ['news', 'tech_media'],
      publishedAt: '2026-09-12T07:40:00Z', updatedAt: '2026-09-12T07:40:00Z',
      sourceUrl: 'https://www.ithome.com/rss/', tags: ['芯片', 'GPU'], hotScore: 0.59 }),
    makeItem({ id: 'it_ithome_os', guid: 'https://www.ithome.com/0/900/002.htm',
      title: '新一代操作系统开始内测，主打端侧大模型', url: 'https://www.ithome.com/0/900/002.htm',
      summary: '新系统将大模型能力下沉到端侧，强调隐私与离线可用性。',
      author: 'IT之家', channelId: 'ithome', channelName: 'IT之家', category: ['news', 'tech_media'],
      publishedAt: '2026-09-12T09:20:00Z', updatedAt: '2026-09-12T09:20:00Z',
      sourceUrl: 'https://www.ithome.com/rss/', tags: ['操作系统', '端侧AI'], hotScore: 0.5 }),
    makeItem({ id: 'it_ithome_ev', guid: 'https://www.ithome.com/0/900/003.htm',
      title: '新能源车企月销数据出炉：头部格局继续分化', url: 'https://www.ithome.com/0/900/003.htm',
      summary: '多家车企公布上月交付数据，部分新势力环比增长显著，竞争进入淘汰赛阶段。',
      author: 'IT之家', channelId: 'ithome', channelName: 'IT之家', category: ['news'],
      publishedAt: '2026-09-12T10:05:00Z', updatedAt: '2026-09-12T10:05:00Z',
      sourceUrl: 'https://www.ithome.com/rss/', tags: ['新能源'], hotScore: null }),
    makeItem({ id: 'it_ithome_push', guid: 'https://www.ithome.com/0/900/004.htm',
      title: '主流安卓厂商统一推送标准，明年落地', url: 'https://www.ithome.com/0/900/004.htm',
      summary: '统一推送标准有望解决消息推送混乱与耗电问题，首批厂商将于明年适配。',
      author: 'IT之家', channelId: 'ithome', channelName: 'IT之家', category: ['news', 'tech_media'],
      publishedAt: '2026-09-11T11:00:00Z', updatedAt: '2026-09-11T11:00:00Z', isNew: false,
      sourceUrl: 'https://www.ithome.com/rss/', tags: ['安卓'], hotScore: null }),

    /* --- 36氪 --- */
    makeItem({ id: 'it_36kr_funding', guid: 'https://36kr.com/p/9000001',
      title: '大模型赛道融资回暖：本周三起亿元级融资', url: 'https://36kr.com/p/9000001',
      summary: '沉寂数月后，大模型与应用层项目重新获得资本关注，本周出现三起亿元级融资。',
      author: '36氪', channelId: '36kr', channelName: '36氪', category: ['news', 'tech_media'],
      publishedAt: '2026-09-12T06:30:00Z', updatedAt: '2026-09-12T06:30:00Z',
      sourceUrl: 'https://36kr.com/feed', tags: ['融资', '大模型'], hotScore: 0.6 }),
    makeItem({ id: 'it_36kr_agent', guid: 'https://36kr.com/p/9000002',
      title: 'Agent 创业热潮：是风口还是内卷？', url: 'https://36kr.com/p/9000002',
      summary: '大量团队涌入 Agent 赛道，但真正的差异化与商业化路径仍在摸索之中。',
      author: '36氪', channelId: '36kr', channelName: '36氪', category: ['news'],
      publishedAt: '2026-09-12T08:00:00Z', updatedAt: '2026-09-12T08:00:00Z',
      sourceUrl: 'https://36kr.com/feed', tags: ['Agent', '创业'], hotScore: 0.48 }),
    makeItem({ id: 'it_36kr_cloud', guid: 'https://36kr.com/p/9000003',
      title: '云厂商价格战再起，推理成本持续下探', url: 'https://36kr.com/p/9000003',
      summary: '头部云厂商接连下调推理价格，中小厂商被迫跟进，行业进入规模优先阶段。',
      author: '36氪', channelId: '36kr', channelName: '36氪', category: ['news', 'tech_media'],
      publishedAt: '2026-09-12T09:40:00Z', updatedAt: '2026-09-12T09:40:00Z',
      sourceUrl: 'https://36kr.com/feed', tags: ['云计算', '价格战'], hotScore: 0.46 }),
    makeItem({ id: 'it_36kr_hardware', guid: 'https://36kr.com/p/9000004',
      title: '智能硬件出海：哪些品类在悄悄增长', url: 'https://36kr.com/p/9000004',
      summary: '在消费电子整体承压的背景下，几个细分品类仍保持两位数增长。',
      author: '36氪', channelId: '36kr', channelName: '36氪', category: ['news'],
      publishedAt: '2026-09-11T12:30:00Z', updatedAt: '2026-09-11T12:30:00Z', isNew: false,
      sourceUrl: 'https://36kr.com/feed', tags: ['出海', '硬件'], hotScore: null }),

    /* --- GitHub Blog --- */
    makeItem({ id: 'it_gh_copilot', guid: 'https://github.blog/2026-09-12-copilot-context/',
      title: 'GitHub Copilot 更新：更好的代码库上下文理解', url: 'https://github.blog/2026-09-12-copilot-context/',
      summary: 'Copilot 现在能更好地利用整个代码库的上下文，显著提升跨文件改动的准确率。',
      author: 'GitHub', channelId: 'github-blog', channelName: 'GitHub Blog', category: ['opensource', 'dev_community'],
      publishedAt: '2026-09-12T04:40:00Z', updatedAt: '2026-09-12T04:40:00Z',
      sourceUrl: 'https://github.blog/feed/', tags: ['Copilot', 'AI'], language: 'en', hotScore: 0.64 }),
    makeItem({ id: 'it_gh_actions', guid: 'https://github.blog/2026-09-12-actions-cache/',
      title: 'Actions 新的缓存策略与计费说明', url: 'https://github.blog/2026-09-12-actions-cache/',
      summary: '本次更新改进了缓存命中率，并明确了公开仓库与私有仓库的计费差异。',
      author: 'GitHub', channelId: 'github-blog', channelName: 'GitHub Blog', category: ['opensource', 'dev_community'],
      publishedAt: '2026-09-12T07:55:00Z', updatedAt: '2026-09-12T07:55:00Z',
      sourceUrl: 'https://github.blog/feed/', tags: ['Actions', 'CI'], language: 'en', hotScore: null }),
    makeItem({ id: 'it_gh_security', guid: 'https://github.blog/2026-09-11-supply-chain/',
      title: '供应链安全：如何用 SBOM 管理依赖风险', url: 'https://github.blog/2026-09-11-supply-chain/',
      summary: '介绍如何生成并消费 SBOM，把依赖风险纳入日常的 CI 检查流程。',
      author: 'GitHub', channelId: 'github-blog', channelName: 'GitHub Blog', category: ['opensource', 'security'],
      publishedAt: '2026-09-11T19:10:00Z', updatedAt: '2026-09-11T19:10:00Z', isNew: false,
      sourceUrl: 'https://github.blog/feed/', tags: ['SBOM', '供应链'], language: 'en', hotScore: null }),
    makeItem({ id: 'it_gh_octoverse', guid: 'https://github.blog/2026-09-11-octoverse/',
      title: 'Octoverse 2026 报告：AI 项目增长最快', url: 'https://github.blog/2026-09-11-octoverse/',
      summary: '年度报告显示，AI 相关仓库的贡献者增速在各语言与领域中位居首位。',
      author: 'GitHub', channelId: 'github-blog', channelName: 'GitHub Blog', category: ['opensource'],
      publishedAt: '2026-09-11T10:00:00Z', updatedAt: '2026-09-11T10:00:00Z', isNew: false,
      sourceUrl: 'https://github.blog/feed/', tags: ['Octoverse'], language: 'en', hotScore: null }),

    /* --- 补充条目（补足 40+ 条，覆盖更长时间窗） --- */
    makeItem({ id: 'it_extra_1', guid: 'https://sspai.com/post/90005',
      title: '用自动化脚本整理 RSS 阅读列表：一个可复制的方案', url: 'https://sspai.com/post/90005',
      summary: '把 RSS 聚合与规则过滤自动化，每天只留 20 条真正值得读的内容。',
      author: '少数派编辑部', channelId: 'sspai', channelName: '少数派', category: ['product_design'],
      publishedAt: '2026-09-12T00:20:00Z', updatedAt: '2026-09-12T00:20:00Z',
      sourceUrl: 'https://sspai.com/feed', tags: ['RSS', '自动化'], hotScore: null }),
    makeItem({ id: 'it_extra_2', guid: 'https://news.ycombinator.com/item?id=42000015',
      title: 'The case for boring technology', url: 'https://news.ycombinator.com/item?id=42000015',
      summary: 'A reminder that mature, well-understood tools often beat shiny new ones for long-lived systems.',
      author: 'boring_eng', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T01:50:00Z', updatedAt: '2026-09-12T01:50:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['engineering'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_extra_3', guid: 'https://tech.meituan.com/2026/09/observability.html',
      title: '可观测性实践：从指标到根因定位', url: 'https://tech.meituan.com/2026/09/observability.html',
      summary: '介绍如何把日志、指标与链路追踪打通，让排障从「猜」变成「看」。',
      author: '美团技术团队', channelId: 'meituan-tech', channelName: '美团技术团队', category: ['tech_blog'],
      publishedAt: '2026-09-12T02:40:00Z', updatedAt: '2026-09-12T02:40:00Z',
      sourceUrl: 'https://tech.meituan.com/feed', tags: ['可观测性'], hotScore: null }),
    makeItem({ id: 'it_extra_4', guid: 'https://36kr.com/p/9000005',
      title: 'AI 芯片供应链的新变量', url: 'https://36kr.com/p/9000005',
      summary: '先进封装与高带宽存储的产能分配，正在成为影响 AI 芯片出货的关键变量。',
      author: '36氪', channelId: '36kr', channelName: '36氪', category: ['news'],
      publishedAt: '2026-09-12T03:30:00Z', updatedAt: '2026-09-12T03:30:00Z',
      sourceUrl: 'https://36kr.com/feed', tags: ['芯片', '供应链'], hotScore: null }),
    makeItem({ id: 'it_extra_5', guid: 'https://huggingface.co/blog/2026/09/vision-encoder',
      title: 'A practical guide to vision encoders for multimodal models', url: 'https://huggingface.co/blog/vision-encoder',
      summary: 'We compare popular vision encoders and show how to pick one for your multimodal pipeline.',
      author: 'Hugging Face', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai'],
      publishedAt: '2026-09-12T05:10:00Z', updatedAt: '2026-09-12T05:10:00Z',
      sourceUrl: 'https://huggingface.co/blog/feed.xml', tags: ['多模态', 'vision'], language: 'en', hotScore: null }),
    makeItem({ id: 'it_extra_6', guid: 'https://www.ithome.com/0/900/005.htm',
      title: '无线充电新标准发布，功率上限提升', url: 'https://www.ithome.com/0/900/005.htm',
      summary: '新标准统一了磁吸与通用方案的兼容性，并提高了最大功率上限。',
      author: 'IT之家', channelId: 'ithome', channelName: 'IT之家', category: ['news'],
      publishedAt: '2026-09-12T06:05:00Z', updatedAt: '2026-09-12T06:05:00Z',
      sourceUrl: 'https://www.ithome.com/rss/', tags: ['硬件'], hotScore: null }),
    makeItem({ id: 'it_extra_7', guid: 'https://www.ruanyifeng.com/blog/2026/09/http3.html',
      title: 'HTTP/3 落地现状：收益与代价', url: 'https://www.ruanyifeng.com/blog/2026/09/http3.html',
      summary: 'QUIC 与 HTTP/3 在真实网络中的表现如何，哪些场景收益明显，哪些场景反而更慢。',
      author: '阮一峰', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog'],
      publishedAt: '2026-09-12T07:20:00Z', updatedAt: '2026-09-12T07:20:00Z',
      sourceUrl: 'https://www.ruanyifeng.com/blog/atom.xml', tags: ['HTTP/3', '网络'], hotScore: null }),
    makeItem({ id: 'it_extra_8', guid: 'https://github.blog/2026-09-12-codespaces/',
      title: 'Codespaces 现在支持更快的启动', url: 'https://github.blog/2026-09-12-codespaces/',
      summary: '通过预构建镜像与更激进的缓存，开发环境的冷启动时间显著缩短。',
      author: 'GitHub', channelId: 'github-blog', channelName: 'GitHub Blog', category: ['opensource', 'dev_community'],
      publishedAt: '2026-09-12T08:30:00Z', updatedAt: '2026-09-12T08:30:00Z',
      sourceUrl: 'https://github.blog/feed/', tags: ['Codespaces'], language: 'en', hotScore: null }),
    makeItem({ id: 'it_extra_9', guid: 'https://www.v2ex.com/t/9000007',
      title: '你们公司的技术文档都放在哪？', url: 'https://www.v2ex.com/t/9000007',
      summary: '想了解一下大家是怎么组织团队技术文档的：仓库内 Markdown、Wiki 还是专门的文档平台？',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community'],
      publishedAt: '2026-09-12T06:50:00Z', updatedAt: '2026-09-12T06:50:00Z',
      sourceUrl: 'https://www.v2ex.com/index.xml', tags: ['文档'], hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_extra_10', guid: 'https://techcrunch.com/?p=2900005',
      title: 'Chipmakers race to secure advanced packaging capacity', url: 'https://techcrunch.com/2026/09/12/advanced-packaging/',
      summary: 'Demand for advanced packaging outstrips supply, reshaping who can ship AI accelerators next year.',
      author: 'Jane Reporter', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'],
      publishedAt: '2026-09-12T04:15:00Z', updatedAt: '2026-09-12T04:15:00Z',
      sourceUrl: 'https://techcrunch.com/feed/', tags: ['chip', 'packaging'], language: 'en', hotScore: null }),
    makeItem({ id: 'it_extra_11', guid: 'https://techcrunch.com/?p=2900006',
      title: 'Why startups are rethinking the RAG stack', url: 'https://techcrunch.com/2026/09/11/rethinking-rag/',
      summary: 'Teams are moving beyond naive retrieval, mixing keyword, graph and reranking approaches.',
      author: 'Jane Reporter', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'],
      publishedAt: '2026-09-11T21:40:00Z', updatedAt: '2026-09-11T21:40:00Z', isNew: false,
      sourceUrl: 'https://techcrunch.com/feed/', tags: ['RAG'], language: 'en', hotScore: null }),
    makeItem({ id: 'it_extra_12', guid: 'https://sspai.com/post/90006',
      title: '一个下午做的静态站点：从想法到上线', url: 'https://sspai.com/post/90006',
      summary: '用一个下午把想法做成可访问的静态站点，记录选型、搭建与部署的全过程。',
      author: '少数派编辑部', channelId: 'sspai', channelName: '少数派', category: ['product_design'],
      publishedAt: '2026-09-11T15:00:00Z', updatedAt: '2026-09-11T15:00:00Z', isNew: false,
      sourceUrl: 'https://sspai.com/feed', tags: ['静态站点'], hotScore: null }),
    makeItem({ id: 'it_extra_13', guid: 'https://arxiv.org/abs/2509.99999',
      title: '2509.99999: Efficient Fine-Tuning under Memory Constraints', url: 'https://arxiv.org/abs/2509.99999',
      summary: 'We propose a memory-efficient fine-tuning method that reduces peak GPU memory without accuracy loss.',
      author: 'H. Kim et al.', channelId: 'arxiv-cs-ai', channelName: 'arXiv cs.AI', category: ['ai'],
      publishedAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', isNew: false,
      sourceUrl: 'https://rss.arxiv.org/rss/cs.AI', tags: ['微调'], language: 'en', hotScore: null }),

    /* --- Hacker News 补充（使单渠道今日条数 > 每卡片默认 10 条，演示「查看全部 →」） --- */
    makeItem({ id: 'it_hn_tools', guid: 'https://news.ycombinator.com/item?id=42000020',
      title: 'Show HN: I made a tiny, dependency-free RSS reader', url: 'https://news.ycombinator.com/item?id=42000020',
      summary: 'No frameworks, no build step — just HTML, CSS and a bit of vanilla JS. Feedback welcome.',
      author: 'tiny_dev', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T04:00:00Z', updatedAt: '2026-09-12T04:00:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['RSS', 'show-hn'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_lang', guid: 'https://news.ycombinator.com/item?id=42000021',
      title: 'Ask HN: What language would you learn in 2026?', url: 'https://news.ycombinator.com/item?id=42000021',
      summary: 'If you had to start fresh today, which language would you invest in and why?',
      author: 'curious_dev', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T04:45:00Z', updatedAt: '2026-09-12T04:45:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['ask-hn', 'languages'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_regex', guid: 'https://news.ycombinator.com/item?id=42000022',
      title: 'You probably do not need that regex engine', url: 'https://news.ycombinator.com/item?id=42000022',
      summary: 'A look at when a hand-written parser beats a heavyweight regular-expression engine.',
      author: 'parser_fan', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T05:30:00Z', updatedAt: '2026-09-12T05:30:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['regex', 'parsing'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_monorepo', guid: 'https://news.ycombinator.com/item?id=42000023',
      title: 'A pragmatic guide to monorepos in 2026', url: 'https://news.ycombinator.com/item?id=42000023',
      summary: 'When monorepos help, when they hurt, and the tooling that has actually matured.',
      author: 'build_tooling', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T06:20:00Z', updatedAt: '2026-09-12T06:20:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['monorepo', 'tooling'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_dns', guid: 'https://news.ycombinator.com/item?id=42000024',
      title: 'Why your DNS resolver matters more than you think', url: 'https://news.ycombinator.com/item?id=42000024',
      summary: 'Latency, privacy and reliability trade-offs of the resolver you silently depend on.',
      author: 'net_ops', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T07:15:00Z', updatedAt: '2026-09-12T07:15:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['DNS', 'networking'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_postgres', guid: 'https://news.ycombinator.com/item?id=42000025',
      title: 'Postgres 18: what is new for application developers', url: 'https://news.ycombinator.com/item?id=42000025',
      summary: 'A practical tour of the changes that will actually affect how you write queries.',
      author: 'db_reader', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T07:50:00Z', updatedAt: '2026-09-12T07:50:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['Postgres', 'database'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_wasm', guid: 'https://news.ycombinator.com/item?id=42000026',
      title: 'WebAssembly beyond the browser: a field report', url: 'https://news.ycombinator.com/item?id=42000026',
      summary: 'Teams running Wasm on the server share what worked and what they would not repeat.',
      author: 'wasm_eng', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T08:40:00Z', updatedAt: '2026-09-12T08:40:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['WASM', 'server'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_abstraction', guid: 'https://news.ycombinator.com/item?id=42000027',
      title: 'The hidden cost of premature abstraction', url: 'https://news.ycombinator.com/item?id=42000027',
      summary: 'Every abstraction is a bet about the future. Here is how to make fewer bad ones.',
      author: 'arch_notes', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T09:10:00Z', updatedAt: '2026-09-12T09:10:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['architecture'], language: 'en', hotScore: null, mediaType: 'post' })
  ];

  /* -------------------------------------------------------------------------
   * 派生口径（唯一事实来源）
   * 所有「今日条数」类汇总均由 items[] 统一派生，避免跨页数字漂移。
   * 约定：条目属多个分类时归入「主分类」category[0]，故分类条数之和恒等于总条数。
   * ---------------------------------------------------------------------- */
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function cnDateKey(iso) {
    var d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
  }

  var mainItems = items.filter(function (it) { return !it.duplicateOf; });
  var todayAll = items.filter(function (it) { return cnDateKey(it.updatedAt) === TODAY; });
  var todayItems = todayAll.filter(function (it) { return !it.duplicateOf; });
  var todayDropped = todayAll.length - todayItems.length;

  function buildCategoryStats(list) {
    var byKey = {};
    list.forEach(function (it) {
      var key = (it.category && it.category[0]) || 'other';
      if (!byKey[key]) { byKey[key] = { count: 0, channels: {} }; }
      byKey[key].count += 1;
      byKey[key].channels[it.channelId] = true;
    });
    var total = list.length || 1;
    return Object.keys(byKey).map(function (key) {
      var meta = catByKey[key] || { label: key };
      return {
        category: key,
        label: meta.label || key,
        itemCount: byKey[key].count,
        channelCount: Object.keys(byKey[key].channels).length,
        ratio: Math.round((byKey[key].count / total) * 1000) / 1000
      };
    }).sort(function (a, b) { return b.itemCount - a.itemCount; });
  }

  function buildChannelActivity(list) {
    var byCh = {};
    list.forEach(function (it) {
      if (!byCh[it.channelId]) { byCh[it.channelId] = { count: 0, last: it.updatedAt }; }
      byCh[it.channelId].count += 1;
      if (it.updatedAt > byCh[it.channelId].last) { byCh[it.channelId].last = it.updatedAt; }
    });
    var rows = Object.keys(byCh).map(function (cid) {
      var ch = channelById[cid] || { name: cid, category: [] };
      return { channelId: cid, channelName: ch.name, category: ch.category || [], itemCount: byCh[cid].count, lastUpdatedAt: byCh[cid].last, activityScore: byCh[cid].count };
    });
    var max = rows.reduce(function (m, r) { return Math.max(m, r.itemCount); }, 1);
    rows.forEach(function (r) { r.activityScore = Math.round((r.itemCount / max) * 100) / 100; });
    return rows.sort(function (a, b) { return b.itemCount - a.itemCount; });
  }

  /* -------------------------------------------------------------------------
   * 当天快照统计（对齐 snapshot.example.json → stats；数值均由 items 派生）
   * ---------------------------------------------------------------------- */
  var snapshotStats = {
    date: TODAY,
    timezone: 'Asia/Shanghai',
    generatedAt: '2026-09-12T10:20:19Z',
    sourceTotal: sources.length,
    sourceOk: sources.filter(function (s) { return s.lastStatus === 'ok'; }).length,
    sourceFailed: sources.filter(function (s) { return s.lastStatus === 'error'; }).length,
    sourceEmpty: sources.filter(function (s) { return s.lastStatus === 'empty'; }).length,
    itemsBeforeDedup: todayAll.length,
    itemsAfterDedup: todayItems.length,
    mergedCount: todayDropped,
    durationMs: 8421
  };

  /* -------------------------------------------------------------------------
   * 报告（对齐 report.example.json；热点榜扩到 10 条、6 个分类）
   * ---------------------------------------------------------------------- */
  var report = {
    schemaVersion: '1.0',
    date: TODAY,
    timezone: 'Asia/Shanghai',
    generatedAt: '2026-09-12T10:20:20Z',
    windowStart: '2026-09-11T16:00:00Z',
    windowEnd: '2026-09-12T10:20:20Z',
    weights: { sourceOverlap: 0.4, frequency: 0.2, recency: 0.25, channelWeight: 0.1, keywordHeat: 0.05, halfLifeHours: 6 },
    hotList: [
      { rank: 1, id: 'it_9f2c1a7b3e5d', title: '科技爱好者周刊（第 324 期）：AI 编程助手的一年', url: 'https://www.ruanyifeng.com/blog/2026/09/weekly-324.html', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog'], hotScore: 0.87, sourceCount: 2, channelNames: ['阮一峰的网络日志', 'V2EX'], publishedAt: '2026-09-12T00:05:00Z', components: { sourceOverlap: 0.63, frequency: 0.41, recency: 0.35, channelWeight: 0.8, keywordHeat: 0.3 } },
      { rank: 2, id: 'it_4a2b8c0d6e1f', title: 'Smol Course: training small language models from scratch', url: 'https://huggingface.co/blog/smol-course', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai', 'opensource'], hotScore: 0.79, sourceCount: 1, channelNames: ['Hugging Face Blog'], publishedAt: '2026-09-11T15:40:00Z', components: { sourceOverlap: 0.0, frequency: 0.52, recency: 0.62, channelWeight: 0.8, keywordHeat: 0.66 } },
      { rank: 3, id: 'it_hf_inference', title: '新版推理框架发布：吞吐提升 2.3 倍', url: 'https://huggingface.co/blog/inference-v3', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai', 'opensource'], hotScore: 0.74, sourceCount: 3, channelNames: ['Hugging Face Blog', 'Hacker News', 'V2EX'], publishedAt: '2026-09-12T03:00:00Z', components: { sourceOverlap: 0.81, frequency: 0.44, recency: 0.55, channelWeight: 0.8, keywordHeat: 0.6 } },
      { rank: 4, id: 'it_1c3d5e7f9a0b', title: 'Show HN: A static RSS aggregator with zero backend', url: 'https://news.ycombinator.com/item?id=42000001', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'], hotScore: 0.72, sourceCount: 2, channelNames: ['Hacker News', 'GitHub Blog'], publishedAt: '2026-09-12T03:15:00Z', components: { sourceOverlap: 0.52, frequency: 0.38, recency: 0.58, channelWeight: 0.9, keywordHeat: 0.44 } },
      { rank: 5, id: 'it_3e2d1c0b9a8f', title: 'OpenAI unveils cheaper inference tier for developers', url: 'https://techcrunch.com/2026/09/12/openai-cheaper-inference-tier/', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'], hotScore: 0.68, sourceCount: 1, channelNames: ['TechCrunch'], publishedAt: '2026-09-12T06:45:00Z', components: { sourceOverlap: 0.0, frequency: 0.47, recency: 0.51, channelWeight: 0.7, keywordHeat: 0.55 } },
      { rank: 6, id: 'it_meituan_kv', title: '千万 QPS 下 KV 存储的容量规划与热点打散', url: 'https://tech.meituan.com/2026/09/kv-capacity.html', channelId: 'meituan-tech', channelName: '美团技术团队', category: ['tech_blog'], hotScore: 0.66, sourceCount: 1, channelNames: ['美团技术团队'], publishedAt: '2026-09-12T02:00:00Z', components: { sourceOverlap: 0.0, frequency: 0.36, recency: 0.7, channelWeight: 0.7, keywordHeat: 0.42 } },
      { rank: 7, id: 'it_gh_copilot', title: 'GitHub Copilot 更新：更好的代码库上下文理解', url: 'https://github.blog/2026-09-12-copilot-context/', channelId: 'github-blog', channelName: 'GitHub Blog', category: ['opensource', 'dev_community'], hotScore: 0.64, sourceCount: 1, channelNames: ['GitHub Blog'], publishedAt: '2026-09-12T04:40:00Z', components: { sourceOverlap: 0.0, frequency: 0.33, recency: 0.6, channelWeight: 0.6, keywordHeat: 0.5 } },
      { rank: 8, id: 'it_ruanyifeng_ops', title: '一次数据库迁移的复盘：从 MySQL 到 PostgreSQL 的五个教训', url: 'https://www.ruanyifeng.com/blog/2026/09/db-migration.html', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog'], hotScore: 0.62, sourceCount: 1, channelNames: ['阮一峰的网络日志'], publishedAt: '2026-09-12T02:40:00Z', components: { sourceOverlap: 0.0, frequency: 0.3, recency: 0.66, channelWeight: 0.8, keywordHeat: 0.35 } },
      { rank: 9, id: 'it_tc_apple', title: 'Apple 或将在下一代芯片中集成更多端侧 AI 能力', url: 'https://techcrunch.com/2026/09/12/apple-on-device-ai/', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'], hotScore: 0.61, sourceCount: 1, channelNames: ['TechCrunch'], publishedAt: '2026-09-12T08:15:00Z', components: { sourceOverlap: 0.0, frequency: 0.31, recency: 0.72, channelWeight: 0.7, keywordHeat: 0.4 } },
      { rank: 10, id: 'it_36kr_funding', title: '大模型赛道融资回暖：本周三起亿元级融资', url: 'https://36kr.com/p/9000001', channelId: '36kr', channelName: '36氪', category: ['news', 'tech_media'], hotScore: 0.6, sourceCount: 1, channelNames: ['36氪'], publishedAt: '2026-09-12T06:30:00Z', components: { sourceOverlap: 0.0, frequency: 0.29, recency: 0.5, channelWeight: 0.6, keywordHeat: 0.5 } }
    ],
    keywords: [
      { word: 'AI', count: 42, weight: 1.0 },
      { word: '编程助手', count: 18, weight: 0.43 },
      { word: '开源', count: 16, weight: 0.38 },
      { word: '大模型', count: 14, weight: 0.33 },
      { word: '推理', count: 12, weight: 0.29 },
      { word: 'Agent', count: 10, weight: 0.24 },
      { word: 'Rust', count: 9, weight: 0.21 },
      { word: '芯片', count: 8, weight: 0.19 }
    ],
    crossSource: [
      { topic: 'AI 编程助手的一年', sourceCount: 2, itemIds: ['it_9f2c1a7b3e5d', 'it_0d9e8f7a6b5c'], channelNames: ['阮一峰的网络日志', 'V2EX'] },
      { topic: '新版推理框架发布', sourceCount: 3, itemIds: ['it_hf_inference'], channelNames: ['Hugging Face Blog', 'Hacker News', 'V2EX'] },
      { topic: 'Show HN: 静态 RSS 聚合器', sourceCount: 2, itemIds: ['it_1c3d5e7f9a0b'], channelNames: ['Hacker News', 'GitHub Blog'] },
      { topic: 'M 系列芯片 Docker 性能', sourceCount: 2, itemIds: ['it_v2ex_macbook'], channelNames: ['V2EX', 'Hacker News'] }
    ]
  };

  /* -------------------------------------------------------------------------
   * 报告派生字段（totalItems / activeChannels / categoryStats / channelActivity / summary）
   * 全部由 items[] 统一派生 —— 保证页面1「今日条数」与页面3「数据覆盖条数」恒等。
   * ---------------------------------------------------------------------- */
  report.totalItems = todayItems.length;
  report.categoryStats = buildCategoryStats(todayItems);
  report.channelActivity = buildChannelActivity(todayItems);
  report.activeChannels = report.channelActivity.length;
  report.summary = '今日共采集 ' + report.totalItems + ' 条（去重后），' +
    (report.categoryStats[0] ? report.categoryStats[0].label + '与' + (report.categoryStats[1] ? report.categoryStats[1].label : '') + '最活跃；' : '') +
    '阮一峰周刊「AI 编程助手的一年」被 2 个渠道同时报道，位列热点榜首位；Hugging Face 新版推理框架获 3 家渠道转载。';

  /* -------------------------------------------------------------------------
   * 历史趋势索引（对齐 history-index.example.json）
   * 生成最近 365 天（含今天）的天级聚合，确定性伪随机。
   * 使页面4 的 90 / 180 / 365 天窗口切换有真实差异（PRD §6.4）。
   * ---------------------------------------------------------------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function seeded(n) { // 简单确定性伪随机 [0,1)
    var x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function buildHistoryIndex(daysCount) {
    var end = new Date(TODAY + 'T00:00:00Z');
    var days = [];
    var kwPool = ['AI', 'Agent', '开源', 'Rust', '大模型', 'MCP', 'TypeScript', '推理', '芯片', '数据库', 'RAG', '云原生'];
    var catKeys = ['ai', 'news', 'tech_blog', 'dev_community', 'product_design', 'opensource', 'other'];
    for (var i = daysCount - 1; i >= 0; i--) {
      var d = new Date(end.getTime() - i * 86400000);
      var dow = d.getUTCDay();
      var weekend = (dow === 0 || dow === 6) ? 0.72 : 1;   // 周末信息量略低
      var wobble = 0.85 + seeded(i + 7) * 0.4;             // 波动
      var base = 190 * weekend * wobble;
      var total = Math.round(base);
      var active = Math.max(6, Math.min(14, Math.round(9 + seeded(i + 31) * 4)));
      var cats = {};
      var remaining = total;
      catKeys.forEach(function (k, idx) {
        var share = [0.23, 0.18, 0.16, 0.15, 0.12, 0.1, 0.06][idx];
        var v = Math.round(total * share * (0.85 + seeded(i * 3 + idx) * 0.3));
        cats[k] = Math.min(remaining, v);
        remaining -= cats[k];
      });
      var kws = kwPool.filter(function (_, idx) { return seeded(i * 5 + idx) > 0.55; }).slice(0, 4);
      if (kws.length === 0) { kws = ['AI', '开源']; }
      days.push({
        date: isoDate(d),
        totalItems: total,
        activeChannels: active,
        categoryStats: cats,
        topKeywords: kws,
        topIds: [],
        sourceOk: active,
        sourceFailed: Math.round(seeded(i + 99) * 2)
      });
    }
    return days;
  }

  var historyIndex = {
    schemaVersion: '1.0',
    updatedAt: '2026-09-12T10:20:20Z',
    days: buildHistoryIndex(365)
  };

  /* -------------------------------------------------------------------------
   * 月度明细（下钻用；模拟 history/YYYY/MM/items.ndjson 的精简行）
   * ---------------------------------------------------------------------- */
  function miniItem(id, title, channelId, channelName, category, publishedAt, sourceCount, hotScore) {
    return {
      id: id, title: title, channelId: channelId, channelName: channelName,
      category: category, publishedAt: publishedAt, sourceCount: sourceCount || 1,
      hotScore: (hotScore === undefined ? null : hotScore)
    };
  }

  var historyMonths = {
    '2026-09': [
      miniItem('it_h_0901', '九月开局：AI 应用层的三个新趋势', '36kr', '36氪', ['news'], '2026-09-12T06:30:00Z', 1, 0.6),
      miniItem('it_h_0902', '科技爱好者周刊（第 324 期）：AI 编程助手的一年', 'ruanyifeng-blog', '阮一峰的网络日志', ['tech_blog'], '2026-09-12T00:05:00Z', 2, 0.87),
      miniItem('it_h_0903', '新版推理框架发布：吞吐提升 2.3 倍', 'huggingface-blog', 'Hugging Face Blog', ['ai', 'opensource'], '2026-09-12T03:00:00Z', 3, 0.74),
      miniItem('it_h_0904', '千万 QPS 下 KV 存储的容量规划', 'meituan-tech', '美团技术团队', ['tech_blog'], '2026-09-12T02:00:00Z', 1, 0.66),
      miniItem('it_h_0905', '面了一个「全栈」岗位，我准备了三个月', 'v2ex', 'V2EX', ['dev_community'], '2026-09-11T14:00:00Z', 1, null),
      miniItem('it_h_0906', 'Rust 1.90 released', 'hacker-news', 'Hacker News', ['dev_community'], '2026-09-12T06:40:00Z', 1, 0.49)
    ],
    '2026-08': [
      miniItem('it_h_0801', '八月复盘：开源模型的追赶与分化', '36kr', '36氪', ['news'], '2026-08-28T09:00:00Z', 1, 0.55),
      miniItem('it_h_0802', '从单体到微服务再回来：一次架构回退', 'meituan-tech', '美团技术团队', ['tech_blog'], '2026-08-25T03:00:00Z', 1, 0.52),
      miniItem('it_h_0803', 'Why we moved our search off Elasticsearch', 'hacker-news', 'Hacker News', ['dev_community'], '2026-08-21T11:00:00Z', 2, 0.61),
      miniItem('it_h_0804', '本地优先软件这一年', 'sspai', '少数派', ['product_design'], '2026-08-18T02:00:00Z', 1, null),
      miniItem('it_h_0805', 'A guide to on-device inference', 'huggingface-blog', 'Hugging Face Blog', ['ai'], '2026-08-12T05:00:00Z', 1, 0.58)
    ],
    '2026-07': [
      miniItem('it_h_0701', '七月：Agent 框架的收敛', '36kr', '36氪', ['news'], '2026-07-30T08:00:00Z', 1, 0.5),
      miniItem('it_h_0702', 'The rise of edge databases', 'hacker-news', 'Hacker News', ['dev_community'], '2026-07-24T10:00:00Z', 1, 0.47),
      miniItem('it_h_0703', '一个被低估的调试技巧', 'ruanyifeng-blog', '阮一峰的网络日志', ['tech_blog'], '2026-07-19T01:00:00Z', 1, null),
      miniItem('it_h_0704', '少数派年度效率工具盘点（上半年）', 'sspai', '少数派', ['product_design'], '2026-07-10T03:00:00Z', 1, 0.44)
    ]
  };

  /* -------------------------------------------------------------------------
   * 某天快照（回看用；对齐 snapshot.example.json，精简）
   * 含三种状态：有数据 / 无数据 / 已归档（>1 年）
   * ---------------------------------------------------------------------- */
  var daySnapshots = {
    '2026-09-12': {
      status: 'ok',
      date: '2026-09-12',
      totalItems: 168,
      activeChannels: 12,
      topItems: [
        { rank: 1, title: '科技爱好者周刊（第 324 期）：AI 编程助手的一年', channelName: '阮一峰的网络日志', hotScore: 0.87, url: 'https://www.ruanyifeng.com/blog/2026/09/weekly-324.html' },
        { rank: 2, title: 'Smol Course: training small language models from scratch', channelName: 'Hugging Face Blog', hotScore: 0.79, url: 'https://huggingface.co/blog/smol-course' },
        { rank: 3, title: '新版推理框架发布：吞吐提升 2.3 倍', channelName: 'Hugging Face Blog', hotScore: 0.74, url: 'https://huggingface.co/blog/inference-v3' }
      ]
    },
    '2026-09-11': {
      status: 'ok',
      date: '2026-09-11',
      totalItems: 154,
      activeChannels: 12,
      topItems: [
        { rank: 1, title: 'Why startups are rethinking the RAG stack', channelName: 'TechCrunch', hotScore: 0.71, url: 'https://techcrunch.com/2026/09/11/rethinking-rag/' },
        { rank: 2, title: 'Transformers v5 路线图：更快的推理与更简单的 API', channelName: 'Hugging Face Blog', hotScore: 0.68, url: 'https://huggingface.co/blog/transformers-v5' },
        { rank: 3, title: 'Octoverse 2026 报告：AI 项目增长最快', channelName: 'GitHub Blog', hotScore: 0.6, url: 'https://github.blog/2026-09-11-octoverse/' }
      ]
    },
    // 无数据（当天未采集 / 源全部失败）
    '2026-08-30': { status: 'empty', date: '2026-08-30', totalItems: 0, activeChannels: 0, topItems: [] },
    '2026-08-31': { status: 'empty', date: '2026-08-31', totalItems: 0, activeChannels: 0, topItems: [] },
    // 已归档（>1 年，站内只读元数据 + 跳 Release）
    '2025-08-15': { status: 'archived', date: '2025-08-15', year: 2025, totalItems: 0, activeChannels: 0, topItems: [], releaseTag: 'archive-2025' }
  };

  /* -------------------------------------------------------------------------
   * 归档索引（对齐 history-index.example.json → archives）
   * ---------------------------------------------------------------------- */
  var archives = [
    {
      year: 2025,
      releaseTag: 'archive-2025',
      releaseUrl: 'https://github.com/example-owner/rss-radar/releases/tag/archive-2025',
      generatedAt: '2026-01-01T00:05:00Z',
      months: [
        { month: '2025-07', itemCount: 6890, bytes: 1732440 },
        { month: '2025-08', itemCount: 7180, bytes: 1802344 },
        { month: '2025-09', itemCount: 7421, bytes: 1832444 },
        { month: '2025-10', itemCount: 7610, bytes: 1890112 },
        { month: '2025-11', itemCount: 7302, bytes: 1811220 },
        { month: '2025-12', itemCount: 7544, bytes: 1866330 }
      ]
    }
  ];

  return {
    NOW: NOW,
    TODAY: TODAY,
    site: site,
    categories: categories,
    channels: channels,
    sources: sources,
    items: items,
    snapshotStats: snapshotStats,
    report: report,
    historyIndex: historyIndex,
    historyMonths: historyMonths,
    daySnapshots: daySnapshots,
    archives: archives,
    channelById: channelById,
    sourceByChannel: sourceByChannel,
    catByKey: catByKey
  };
})();

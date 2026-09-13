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
    makeItem({ id: 'it_9f2c1a7b3e5d', guid: 'https://www.ruanyifeng.com/blog/2026/09/weekly-issue-412.html',
      title: '科技爱好者周刊（第 412 期）：禁止 issue，只用 PR', url: 'https://www.ruanyifeng.com/blog/2026/09/weekly-issue-412.html',
      summary: '本期主题是禁止 issue 只用 PR 的开发流程讨论，同时收录本周值得读的开源项目与技术文章。',
      author: '阮一峰', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog'],
      publishedAt: '2026-09-12T00:05:00Z', updatedAt: '2026-09-12T10:16:00Z', fetchedAt: '2026-09-12T10:20:06Z',
      sourceUrl: 'https://www.ruanyifeng.com/blog/weekly/rss.xml', tags: ['开源', 'PR', '周刊'],
      sourceCount: 2, hotScore: 0.87, mediaType: 'article',
      sources: [
        { channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/2026/09/weekly-issue-412.html', publishedAt: '2026-09-12T00:05:00Z' },
        { channelId: 'v2ex', channelName: 'V2EX', url: 'https://www.v2ex.com/t/1241336', publishedAt: '2026-09-12T01:10:00Z' }
      ] }),
    makeItem({ id: 'it_ruanyifeng_ops', guid: 'https://www.ruanyifeng.com/blog/2026/09/weekly-issue-411.html',
      title: '科技爱好者周刊（第 411 期）：OpenClaw 2.0 是一个缩影', url: 'https://www.ruanyifeng.com/blog/2026/09/weekly-issue-411.html',
      summary: '本期主题是 OpenClaw 2.0 的发布与开源生态趋势，同时收录本周值得读的技术文章。',
      author: '阮一峰', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog'],
      publishedAt: '2026-09-12T02:40:00Z', updatedAt: '2026-09-12T02:40:00Z',
      sourceUrl: 'https://www.ruanyifeng.com/blog/atom.xml', tags: ['开源', 'OpenClaw'], hotScore: 0.62 }),
    makeItem({ id: 'it_ruanyifeng_rust', guid: 'https://www.ruanyifeng.com/blog/2026/08/weekly-issue-410.html',
      title: '科技爱好者周刊（第 410 期）：你需要知道的 AI 三种机制', url: 'https://www.ruanyifeng.com/blog/2026/08/weekly-issue-410.html',
      summary: '本期介绍 AI 的三种核心机制：注意力、RLHF 与蒸馏，以及它们对开发者的实际影响。',
      author: '阮一峰', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog'],
      publishedAt: '2026-09-11T23:10:00Z', updatedAt: '2026-09-11T23:10:00Z', isNew: false,
      sourceUrl: 'https://www.ruanyifeng.com/blog/atom.xml', tags: ['AI', '机制'], hotScore: null }),
    makeItem({ id: 'it_ruanyifeng_opensource', guid: 'https://www.ruanyifeng.com/blog/2026/08/weekly-issue-409.html',
      title: '科技爱好者周刊（第 409 期）：程序员的职业未来', url: 'https://www.ruanyifeng.com/blog/2026/08/weekly-issue-409.html',
      summary: '本期讨论 AI 时代程序员的职业前景与转型方向。',
      author: '阮一峰', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog', 'opensource'],
      publishedAt: '2026-09-11T22:30:00Z', updatedAt: '2026-09-11T22:30:00Z', isNew: false,
      sourceUrl: 'https://www.ruanyifeng.com/blog/weekly/rss.xml', tags: ['职业', 'AI'], hotScore: null }),

    /* --- V2EX --- */
    makeItem({ id: 'it_0d9e8f7a6b5c', guid: 'https://www.v2ex.com/t/1241336',
      title: '有人买了中转站 6TB 的数据，里面有大量的服务器账号安全数据', url: 'https://www.v2ex.com/t/1241336',
      summary: 'V2EX 用户讨论中转站数据泄露事件，涉及大量服务器账号安全数据。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community'],
      publishedAt: '2026-09-12T01:10:00Z', updatedAt: '2026-09-12T01:10:00Z',
      sourceUrl: 'https://www.v2ex.com/feed/tab/hot.xml', tags: ['安全', '泄露'],
      duplicateOf: 'it_9f2c1a7b3e5d', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_v2ex_remote', guid: 'https://www.v2ex.com/t/1241328',
      title: '为一个弱智的问题 大家怎么插入的图片', url: 'https://www.v2ex.com/t/1241328',
      summary: 'V2EX 用户讨论在帖子中插入图片的各种方法与插件推荐。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community'],
      publishedAt: '2026-09-12T03:22:00Z', updatedAt: '2026-09-12T04:22:00Z',
      sourceUrl: 'https://www.v2ex.com/index.xml', tags: ['工具', '图片'], hotScore: 0.58, mediaType: 'post' }),
    makeItem({ id: 'it_v2ex_macbook', guid: 'https://www.v2ex.com/t/1240932',
      title: '你们觉得现在用哪个技术栈还重要吗？', url: 'https://www.v2ex.com/t/1240932',
      summary: 'V2EX 用户讨论 AI 时代技术栈选择是否仍然重要，观点分化明显。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community'],
      publishedAt: '2026-09-12T05:05:00Z', updatedAt: '2026-09-12T09:48:00Z',
      sourceUrl: 'https://www.v2ex.com/feed/tab/hot.xml', tags: ['技术栈', 'AI'], sourceCount: 2, hotScore: 0.51,
      sources: [
        { channelId: 'v2ex', channelName: 'V2EX', url: 'https://www.v2ex.com/t/1240932', publishedAt: '2026-09-12T05:05:00Z' },
        { channelId: 'hacker-news', channelName: 'Hacker News', url: 'https://news.ycombinator.com/item?id=49676820', publishedAt: '2026-09-12T06:00:00Z' }
      ], mediaType: 'post' }),
    makeItem({ id: 'it_v2ex_llm_router', guid: 'https://www.v2ex.com/t/1240169',
      title: '一个约 1800 行的 agent 框架内核：为了真正搞懂 LangGraph', url: 'https://www.v2ex.com/t/1240169',
      summary: '一个教学性质的 agent 框架内核项目，用约 1800 行代码实现核心调度逻辑。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community', 'opensource'],
      publishedAt: '2026-09-12T06:15:00Z', updatedAt: '2026-09-12T06:15:00Z',
      sourceUrl: 'https://www.v2ex.com/index.xml', tags: ['Agent', '开源'], hotScore: 0.47, mediaType: 'post' }),
    makeItem({ id: 'it_v2ex_interview', guid: 'https://www.v2ex.com/t/1239995',
      title: '[后续] 上星期发帖当天吐槽然后跑去面试，拿到 offer 了', url: 'https://www.v2ex.com/t/1239995',
      summary: 'V2EX 用户分享面试后续：吐槽后去面试，意外拿到 offer，听听前辈建议。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community'],
      publishedAt: '2026-09-11T14:00:00Z', updatedAt: '2026-09-11T14:00:00Z', isNew: false,
      sourceUrl: 'https://www.v2ex.com/index.xml', tags: ['面试'], mediaType: 'post' }),
    makeItem({ id: 'it_v2ex_homelab', guid: 'https://www.v2ex.com/t/1240153',
      title: 'SparkCloud 国际网络加速的又一次升级', url: 'https://www.v2ex.com/t/1240153',
      summary: 'V2EX 用户分享国际网络加速服务的最新升级与使用体验。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community'],
      publishedAt: '2026-09-11T09:30:00Z', updatedAt: '2026-09-11T09:30:00Z', isNew: false,
      sourceUrl: 'https://www.v2ex.com/feed/tab/hot.xml', tags: ['网络'], mediaType: 'post' }),

    /* --- 少数派 --- */
    makeItem({ id: 'it_sspai_workflow', guid: 'https://sspai.com/post/114461',
      title: '与 AI 搏斗失败后重新开始找工作：经验分享与半可靠避雷指南', url: 'https://sspai.com/post/114461',
      summary: '作者分享被 AI 影响后的求职经历与实用避雷指南，来自 Matrix 写作社区。',
      author: '程天冲', channelId: 'sspai', channelName: '少数派', category: ['product_design'],
      publishedAt: '2026-09-12T01:35:00Z', updatedAt: '2026-09-12T01:35:00Z',
      sourceUrl: 'https://sspai.com/feed', tags: ['求职', 'AI'], hotScore: 0.55 }),
    makeItem({ id: 'it_sspai_keyboard', guid: 'https://sspai.com/post/114458',
      title: '本周看什么 | 最近值得一看的 7 部作品', url: 'https://sspai.com/post/114458',
      summary: '少数派编辑部推荐本周值得观看的 7 部影视作品，含《哥斯拉-0.0》等新片。',
      author: '少数派编辑部', channelId: 'sspai', channelName: '少数派', category: ['product_design'],
      publishedAt: '2026-09-12T04:50:00Z', updatedAt: '2026-09-12T04:50:00Z',
      sourceUrl: 'https://sspai.com/feed', tags: ['影视', '推荐'], hotScore: null }),
    makeItem({ id: 'it_sspai_ai_pkm', guid: 'https://sspai.com/post/114449',
      title: 'iPhone 18 和 Duo 发布会上，Apple 没告诉你的那些事', url: 'https://sspai.com/post/114449',
      summary: '整理 Apple 秋季发布会中未提及的细节与注意事项，供感兴趣的用户参考。',
      author: '宛潼', channelId: 'sspai', channelName: '少数派', category: ['product_design', 'ai'],
      publishedAt: '2026-09-12T07:10:00Z', updatedAt: '2026-09-12T07:10:00Z',
      sourceUrl: 'https://sspai.com/feed', tags: ['Apple', 'iPhone'], hotScore: 0.6 }),
    makeItem({ id: 'it_sspai_notes', guid: 'https://sspai.com/post/113605',
      title: '「正常」已是不易：聊聊不那么标新立异的理想 i6', url: 'https://sspai.com/post/113605',
      summary: '理想 i6 作为一辆「正常」的新能源车，适合长期持有的使用体验分享。',
      author: '别惹小炸毛', channelId: 'sspai', channelName: '少数派', category: ['product_design'],
      publishedAt: '2026-09-11T16:20:00Z', updatedAt: '2026-09-11T16:20:00Z', isNew: false,
      sourceUrl: 'https://sspai.com/feed', tags: ['汽车', '新能源'], hotScore: null }),

    /* --- 美团技术团队 --- */
    makeItem({ id: 'it_meituan_kv', guid: 'https://tech.meituan.com/2026/09/10/Agent-Evaluation-White-Paper-01.html',
      title: '《Agent 评测白皮书》系列01：Agent 评测全览', url: 'https://tech.meituan.com/2026/09/10/Agent-Evaluation-White-Paper-01.html',
      summary: '美团推出 Agent 评测白皮书系列博客，体系化讲解 Agent 评测的落地指南。',
      author: '美团技术团队', channelId: 'meituan-tech', channelName: '美团技术团队', category: ['tech_blog'],
      publishedAt: '2026-09-12T02:00:00Z', updatedAt: '2026-09-12T02:00:00Z',
      sourceUrl: 'https://tech.meituan.com/feed', tags: ['Agent', '评测'], hotScore: 0.66 }),
    makeItem({ id: 'it_meituan_flink', guid: 'https://tech.meituan.com/2026/09/03/meituan-Digital-Human-practice.html',
      title: '美团智播——数字人直播技术创新与实践', url: 'https://tech.meituan.com/2026/09/03/meituan-Digital-Human-practice.html',
      summary: '美团智播围绕 AI 主播构建完整技术闭环，以推理加速技术支撑万路并发开播。',
      author: '美团技术团队', channelId: 'meituan-tech', channelName: '美团技术团队', category: ['tech_blog'],
      publishedAt: '2026-09-12T05:30:00Z', updatedAt: '2026-09-12T05:30:00Z',
      sourceUrl: 'https://tech.meituan.com/feed', tags: ['数字人', '直播'], hotScore: 0.52 }),
    makeItem({ id: 'it_meituan_llm_infra', guid: 'https://tech.meituan.com/2026/08/27/ACL-Outstanding-Paper-GeoRA.html',
      title: 'GeoRA: 为RLVR设计的LoRA——ACL 2026杰出论文解析', url: 'https://tech.meituan.com/2026/08/27/ACL-Outstanding-Paper-GeoRA.html',
      summary: '介绍美团履约技术团队获 ACL 2026 杰出论文奖的成果 GeoRA 及其在业务 Agentic RL 中的落地经验。',
      author: '美团技术团队', channelId: 'meituan-tech', channelName: '美团技术团队', category: ['tech_blog', 'ai'],
      publishedAt: '2026-09-11T18:40:00Z', updatedAt: '2026-09-11T18:40:00Z', isNew: false,
      sourceUrl: 'https://tech.meituan.com/feed', tags: ['ACL', 'LoRA'], hotScore: null }),

    /* --- Hacker News --- */
    makeItem({ id: 'it_1c3d5e7f9a0b', guid: 'https://news.ycombinator.com/item?id=49672510',
      title: 'We must pace the frontier', url: 'https://news.ycombinator.com/item?id=49672510',
      summary: 'Dario Amodei argues for controlling the pace of AI frontier development. 557 points, 785 comments.',
      author: 'dario_fan', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T03:15:00Z', updatedAt: '2026-09-12T10:02:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['AI', 'policy'],
      sourceCount: 2, hotScore: 0.72, language: 'en', mediaType: 'post',
      sources: [
        { channelId: 'hacker-news', channelName: 'Hacker News', url: 'https://news.ycombinator.com/item?id=49672510', publishedAt: '2026-09-12T03:15:00Z' },
        { channelId: 'github-blog', channelName: 'GitHub Blog', url: 'https://github.blog/ai-and-ml/github-copilot/project-hydrafusion-frontier-quality-via-multi-model-orchestration/', publishedAt: '2026-09-12T04:40:00Z' }
      ] }),
    makeItem({ id: 'it_hn_rust', guid: 'https://news.ycombinator.com/item?id=49625056',
      title: 'Stabilizing Rust\'s Never Type', url: 'https://news.ycombinator.com/item?id=49625056',
      summary: 'LWN article discussing the stabilization of Rust\'s never type (!).',
      author: 'rust_fan', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T06:40:00Z', updatedAt: '2026-09-12T06:40:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['Rust'], hotScore: 0.49, language: 'en', mediaType: 'post' }),
    makeItem({ id: 'it_hn_sqlite', guid: 'https://news.ycombinator.com/item?id=49629624',
      title: 'Vintage Scientific Papers with LaTeX', url: 'https://news.ycombinator.com/item?id=49629624',
      summary: 'GitHub project for typesetting classic scientific papers in vintage LaTeX style.',
      author: 'latex_fan', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T08:05:00Z', updatedAt: '2026-09-12T08:05:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['LaTeX', 'typesetting'], hotScore: 0.45, language: 'en', mediaType: 'post' }),
    makeItem({ id: 'it_hn_meta', guid: 'https://news.ycombinator.com/item?id=49673098',
      title: 'Nvidia is the central bank of AI', url: 'https://news.ycombinator.com/item?id=49673098',
      summary: 'The Economist article comparing Nvidia\'s role in the AI industry to a central bank.',
      author: 'econ_reader', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T08:45:00Z', updatedAt: '2026-09-12T08:45:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['Nvidia', 'AI'], hotScore: 0.53, language: 'en', mediaType: 'post' }),
    makeItem({ id: 'it_hn_lan', guid: 'https://news.ycombinator.com/item?id=49674050',
      title: 'Make your first edit to OpenStreetMap', url: 'https://news.ycombinator.com/item?id=49674050',
      summary: 'A guided tool to help newcomers make their first edit to OpenStreetMap.',
      author: 'osm_helper', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T09:30:00Z', updatedAt: '2026-09-12T09:30:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['OpenStreetMap'], hotScore: 0.5, language: 'en', mediaType: 'post' }),
    makeItem({ id: 'it_hn_zig', guid: 'https://news.ycombinator.com/item?id=49619848',
      title: 'Apple iPod Engraver (2019)', url: 'https://news.ycombinator.com/item?id=49619848',
      summary: 'A tool from 2019 for replicating Apple\'s iPod engraving effect.',
      author: 'retro_apple', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-11T20:00:00Z', updatedAt: '2026-09-11T20:00:00Z', isNew: false,
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['Apple', 'retro'], language: 'en', mediaType: 'post' }),

    /* --- Hugging Face Blog --- */
    makeItem({ id: 'it_4a2b8c0d6e1f', guid: 'tag:huggingface.co,2026:blog/rl-environments-2026',
      title: 'One sandbox per rollout, or how labs run RL for agents in 2026', url: 'https://huggingface.co/blog/sergiopaniego/rl-environments-2026',
      summary: 'A deep dive into how AI labs structure RL environments for agent training, covering sandbox design, trainer decoupling, and infrastructure.',
      author: 'Hugging Face', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai', 'opensource'],
      publishedAt: '2026-09-11T15:40:00Z', updatedAt: '2026-09-12T02:00:00Z',
      sourceUrl: 'https://huggingface.co/blog/feed.xml', tags: ['RL', 'agent', 'infrastructure'],
      hotScore: 0.79, language: 'en' }),
    makeItem({ id: 'it_hf_inference', guid: 'tag:huggingface.co,2026:blog/there-is-no-ai-arms-race',
      title: 'There Is No AI Arms Race. There\'s a Browser War.', url: 'https://huggingface.co/blog/sheebz/there-is-no-ai-arms-race',
      summary: 'Analysis arguing that AI competition is more about user lock-in and harness context than an arms race between labs.',
      author: 'Hugging Face', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai', 'opensource'],
      publishedAt: '2026-09-12T03:00:00Z', updatedAt: '2026-09-12T10:08:00Z',
      sourceUrl: 'https://huggingface.co/blog/feed.xml', tags: ['AI', 'policy', 'competition'],
      sourceCount: 3, hotScore: 0.74, language: 'en',
      sources: [
        { channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', url: 'https://huggingface.co/blog/sheebz/there-is-no-ai-arms-race', publishedAt: '2026-09-12T03:00:00Z' },
        { channelId: 'hacker-news', channelName: 'Hacker News', url: 'https://news.ycombinator.com/item?id=49678783', publishedAt: '2026-09-12T04:10:00Z' },
        { channelId: 'v2ex', channelName: 'V2EX', url: 'https://www.v2ex.com/t/1240836', publishedAt: '2026-09-12T04:55:00Z' }
      ] }),
    makeItem({ id: 'it_hf_datasets', guid: 'tag:huggingface.co,2026:blog/huggingface-hub-release-ci',
      title: 'Hugging Face Hub: Weekly Release CI Automation', url: 'https://huggingface.co/blog/huggingface-hub-release-ci',
      summary: 'How Hugging Face automated their weekly release process using CI pipelines with deterministic verification.',
      author: 'Hugging Face', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai'],
      publishedAt: '2026-09-12T06:20:00Z', updatedAt: '2026-09-12T06:20:00Z',
      sourceUrl: 'https://huggingface.co/blog/feed.xml', tags: ['CI', 'release'], hotScore: 0.44, language: 'en' }),
    makeItem({ id: 'it_hf_transformers', guid: 'tag:huggingface.co,2026:blog/github-ci-hf-jobs',
      title: '将 GitHub CI 迁移到 Hugging Face Jobs', url: 'https://huggingface.co/blog/github-ci-hf-jobs',
      summary: 'Migrating GitHub CI workflows to Hugging Face Jobs infrastructure for better integration with the HF ecosystem.',
      author: 'Hugging Face', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai', 'opensource'],
      publishedAt: '2026-09-11T13:00:00Z', updatedAt: '2026-09-11T13:00:00Z', isNew: false,
      sourceUrl: 'https://huggingface.co/blog/feed.xml', tags: ['CI', 'GitHub'], language: 'en' }),

    /* --- TechCrunch --- */
    makeItem({ id: 'it_3e2d1c0b9a8f', guid: 'https://techcrunch.com/?p=automattic-mullenweg',
      title: 'Automattic confirms Mullenweg has returned as CEO after attempted ouster by board', url: 'https://techcrunch.com/2026/09/12/automattic-confirms-mullenweg-has-returned-as-ceo-after-attempted-ouster-by-board/',
      summary: 'Automattic confirms Matt Mullenweg has returned as CEO after an attempted board ouster, with full board support.',
      author: 'TechCrunch', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'],
      publishedAt: '2026-09-12T06:45:00Z', updatedAt: '2026-09-12T07:10:00Z',
      sourceUrl: 'https://techcrunch.com/feed/', tags: ['Automattic', 'CEO'],
      hotScore: 0.68, language: 'en' }),
    makeItem({ id: 'it_tc_apple', guid: 'https://techcrunch.com/?p=openai-ipo-altman',
      title: 'OpenAI\'s Sam Altman says it would be \'ill-advised\' to go public in 2026', url: 'https://techcrunch.com/2026/09/12/openais-sam-altman-says-it-would-be-ill-advised-to-go-public-in-2026/',
      summary: 'Sam Altman says going public in 2026 would be ill-advised despite a secret IPO filing.',
      author: 'TechCrunch', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'],
      publishedAt: '2026-09-12T08:15:00Z', updatedAt: '2026-09-12T08:15:00Z',
      sourceUrl: 'https://techcrunch.com/feed/', tags: ['OpenAI', 'IPO'], hotScore: 0.61, language: 'en' }),
    makeItem({ id: 'it_tc_startup', guid: 'https://techcrunch.com/?p=anthropic-pace-frontier',
      title: 'Anthropic CEO outlines plan to pace the frontier', url: 'https://techcrunch.com/2026/09/12/anthropic-ceo-outlines-plan-to-pace-the-frontier/',
      summary: 'Dario Amodei proposes a plan to slow AI frontier development, aligning with Sam Altman on pacing.',
      author: 'TechCrunch', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'],
      publishedAt: '2026-09-12T09:05:00Z', updatedAt: '2026-09-12T09:05:00Z',
      sourceUrl: 'https://techcrunch.com/feed/', tags: ['Anthropic', 'AI'], hotScore: 0.57, language: 'en' }),
    makeItem({ id: 'it_tc_regulation', guid: 'https://techcrunch.com/?p=tesla-roadster-2',
      title: 'Tesla says it will finally unveil the second generation Roadster on October 1', url: 'https://techcrunch.com/2026/09/12/tesla-says-it-will-finally-unveil-the-second-generation-roadster-on-october-1/',
      summary: 'Tesla announces the second-generation Roadster will be unveiled on October 1, nearly a decade after its initial reveal.',
      author: 'TechCrunch', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'],
      publishedAt: '2026-09-11T17:30:00Z', updatedAt: '2026-09-11T17:30:00Z', isNew: false,
      sourceUrl: 'https://techcrunch.com/feed/', tags: ['Tesla', 'EV'], language: 'en' }),

    /* --- arXiv cs.AI --- */
    makeItem({ id: 'it_arxiv_agent', guid: 'https://arxiv.org/abs/2609.11916',
      title: '2609.11916: Can Edge-Deployable Vision-Language Models Identify Species?', url: 'https://arxiv.org/abs/2609.11916',
      summary: 'This paper studies whether edge-deployable vision-language models can accurately identify biological species.',
      author: 'arXiv', channelId: 'arxiv-cs-ai', channelName: 'arXiv cs.AI', category: ['ai'],
      publishedAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
      sourceUrl: 'https://rss.arxiv.org/rss/cs.AI', tags: ['VLM', 'edge'], hotScore: 0.56, language: 'en' }),
    makeItem({ id: 'it_arxiv_eval', guid: 'https://arxiv.org/abs/2609.11911',
      title: '2609.11911: Artificial Id: Drive and Persistent Alignment in Agentic AI', url: 'https://arxiv.org/abs/2609.11911',
      summary: 'This paper explores the concept of "artificial id" in agentic AI, studying drive mechanisms and persistent alignment.',
      author: 'arXiv', channelId: 'arxiv-cs-ai', channelName: 'arXiv cs.AI', category: ['ai'],
      publishedAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
      sourceUrl: 'https://rss.arxiv.org/rss/cs.AI', tags: ['Agent', 'alignment'], hotScore: 0.42, language: 'en' }),
    makeItem({ id: 'it_arxiv_rag', guid: 'https://arxiv.org/abs/2609.11900',
      title: '2609.11900: MindTopo: Can Foundation Models Reason in Topological Space?', url: 'https://arxiv.org/abs/2609.11900',
      summary: 'This paper proposes MindTopo, examining whether foundation models can reason in topological space.',
      author: 'arXiv', channelId: 'arxiv-cs-ai', channelName: 'arXiv cs.AI', category: ['ai'],
      publishedAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', isNew: false,
      sourceUrl: 'https://rss.arxiv.org/rss/cs.AI', tags: ['reasoning', 'topology'], language: 'en' }),

    /* --- IT之家 --- */
    makeItem({ id: 'it_ithome_chip', guid: 'https://www.ithome.com/1/001/698.htm',
      title: '绿联海外发布 Nexode Air Slim 100W 超薄充电器，2C+1A', url: 'https://www.ithome.com/1/001/698.htm',
      summary: '绿联在英国推出卡片式设计的 Nexode Air Slim 100W 氮化镓充电器，售价 59.99 英镑。',
      author: 'IT之家', channelId: 'ithome', channelName: 'IT之家', category: ['news', 'tech_media'],
      publishedAt: '2026-09-12T07:40:00Z', updatedAt: '2026-09-12T07:40:00Z',
      sourceUrl: 'https://www.ithome.com/rss/', tags: ['充电器', '绿联'], hotScore: 0.59 }),
    makeItem({ id: 'it_ithome_os', guid: 'https://www.ithome.com/1/001/697.htm',
      title: '小米 SU7L 长轴轿车谍照再曝：支持后轮转向、侧面新增雷达', url: 'https://www.ithome.com/1/001/697.htm',
      summary: '疑似小米 SU7L 长轴版测试车谍照曝光，显示支持后轮转向且侧面新增雷达。',
      author: 'IT之家', channelId: 'ithome', channelName: 'IT之家', category: ['news', 'tech_media'],
      publishedAt: '2026-09-12T09:20:00Z', updatedAt: '2026-09-12T09:20:00Z',
      sourceUrl: 'https://www.ithome.com/rss/', tags: ['小米', '汽车'], hotScore: 0.5 }),
    makeItem({ id: 'it_ithome_ev', guid: 'https://www.ithome.com/1/001/695.htm',
      title: '唯卓仕推出 4 款 L 卡口全画幅镜头', url: 'https://www.ithome.com/1/001/695.htm',
      summary: '唯卓仕在 IBC 2026 展会发布四款 L 卡口全画幅镜头，覆盖旅拍、Vlog、人像等场景。',
      author: 'IT之家', channelId: 'ithome', channelName: 'IT之家', category: ['news'],
      publishedAt: '2026-09-12T10:05:00Z', updatedAt: '2026-09-12T10:05:00Z',
      sourceUrl: 'https://www.ithome.com/rss/', tags: ['镜头', '摄影'], hotScore: null }),
    makeItem({ id: 'it_ithome_push', guid: 'https://www.ithome.com/1/001/694.htm',
      title: 'OPPO、一加、真我确认首批同步升级 ColorOS 17 系统', url: 'https://www.ithome.com/1/001/694.htm',
      summary: 'OPPO、一加、真我三品牌将首批同步升级 ColorOS 17，具体适配机型名单将于 9 月 17 日公布。',
      author: 'IT之家', channelId: 'ithome', channelName: 'IT之家', category: ['news', 'tech_media'],
      publishedAt: '2026-09-11T11:00:00Z', updatedAt: '2026-09-11T11:00:00Z', isNew: false,
      sourceUrl: 'https://www.ithome.com/rss/', tags: ['OPPO', 'ColorOS'], hotScore: null }),

    /* --- 36氪 --- */
    makeItem({ id: 'it_36kr_funding', guid: 'https://36kr.com/p/3981147673345033',
      title: '获达晨财智、元禾璞华数千万投资，这家物理AI企业自研WMM世界机理模型', url: 'https://36kr.com/p/3981147673345033',
      summary: '工业物理AI公司"元始智能"完成数千万元Pre-A及Pre-A+轮融资，为存量工业装备提供智能化升级方案。',
      author: '36氪', channelId: '36kr', channelName: '36氪', category: ['news', 'tech_media'],
      publishedAt: '2026-09-12T06:30:00Z', updatedAt: '2026-09-12T06:30:00Z',
      sourceUrl: 'https://36kr.com/feed', tags: ['融资', '物理AI'], hotScore: 0.6 }),
    makeItem({ id: 'it_36kr_agent', guid: 'https://36kr.com/p/3980309439265793',
      title: '外滩大会：AI新人类，登场', url: 'https://36kr.com/p/3980309439265793',
      summary: '2026外滩大会聚焦95后创业者、青年科学家乃至9岁黑客松冠军等年轻一代。',
      author: '36氪', channelId: '36kr', channelName: '36氪', category: ['news'],
      publishedAt: '2026-09-12T08:00:00Z', updatedAt: '2026-09-12T08:00:00Z',
      sourceUrl: 'https://36kr.com/feed', tags: ['外滩大会', 'AI'], hotScore: 0.48 }),
    makeItem({ id: 'it_36kr_cloud', guid: 'https://36kr.com/p/3978950863485960',
      title: '主题演讲：中国太空钙钛矿光伏与新一代空间能源系统开拓者', url: 'https://36kr.com/p/3978950863485960',
      summary: '烁威光电CTO介绍太空钙钛矿光伏技术的行业前景与商业化路径。',
      author: '36氪', channelId: '36kr', channelName: '36氪', category: ['news', 'tech_media'],
      publishedAt: '2026-09-12T09:40:00Z', updatedAt: '2026-09-12T09:40:00Z',
      sourceUrl: 'https://36kr.com/feed', tags: ['光伏', '太空'], hotScore: 0.46 }),
    makeItem({ id: 'it_36kr_hardware', guid: 'https://36kr.com/p/3977590035119112',
      title: '情感智能珠宝硬件公司完成天使轮融资', url: 'https://36kr.com/p/3977590035119112',
      summary: '情感智能珠宝品牌SHAKESPEARE完成数千万元天使轮融资，主打融合珠宝工艺与情绪感知算法。',
      author: '36氪', channelId: '36kr', channelName: '36氪', category: ['news'],
      publishedAt: '2026-09-11T12:30:00Z', updatedAt: '2026-09-11T12:30:00Z', isNew: false,
      sourceUrl: 'https://36kr.com/feed', tags: ['硬件', '融资'], hotScore: null }),

    /* --- GitHub Blog --- */
    makeItem({ id: 'it_gh_copilot', guid: 'https://github.blog/ai-and-ml/github-copilot/marketing-ops-as-code/',
      title: 'Marketing ops as code: Automating events from planning to follow-up on GitHub', url: 'https://github.blog/ai-and-ml/github-copilot/marketing-ops-as-code-automating-events-from-planning-to-follow-up-on-github/',
      summary: 'How to automate marketing event workflows from planning to follow-up using GitHub and Copilot.',
      author: 'GitHub', channelId: 'github-blog', channelName: 'GitHub Blog', category: ['opensource', 'dev_community'],
      publishedAt: '2026-09-12T04:40:00Z', updatedAt: '2026-09-12T04:40:00Z',
      sourceUrl: 'https://github.blog/feed/', tags: ['Copilot', 'automation'], language: 'en', hotScore: 0.64 }),
    makeItem({ id: 'it_gh_actions', guid: 'https://github.blog/ai-and-ml/github-copilot/github-copilot-app-for-beginners-using-the-diff-terminal-and-browser/',
      title: 'GitHub Copilot app for Beginners: Using the diff, terminal, and browser', url: 'https://github.blog/ai-and-ml/github-copilot/github-copilot-app-for-beginners-using-the-diff-terminal-and-browser/',
      summary: 'A beginner\'s guide to using GitHub Copilot\'s diff, terminal, and browser features.',
      author: 'GitHub', channelId: 'github-blog', channelName: 'GitHub Blog', category: ['opensource', 'dev_community'],
      publishedAt: '2026-09-12T07:55:00Z', updatedAt: '2026-09-12T07:55:00Z',
      sourceUrl: 'https://github.blog/feed/', tags: ['Copilot', 'tutorial'], language: 'en', hotScore: null }),
    makeItem({ id: 'it_gh_security', guid: 'https://github.blog/news-insights/company-news/github-availability-report-august-2026/',
      title: 'GitHub availability report: August 2026', url: 'https://github.blog/news-insights/company-news/github-availability-report-august-2026/',
      summary: 'GitHub\'s monthly availability report covering uptime and incident details for August 2026.',
      author: 'GitHub', channelId: 'github-blog', channelName: 'GitHub Blog', category: ['opensource', 'security'],
      publishedAt: '2026-09-11T19:10:00Z', updatedAt: '2026-09-11T19:10:00Z', isNew: false,
      sourceUrl: 'https://github.blog/feed/', tags: ['availability', 'report'], language: 'en', hotScore: null }),
    makeItem({ id: 'it_gh_octoverse', guid: 'https://github.blog/ai-and-ml/github-copilot/project-hydrafusion-frontier-quality-via-multi-model-orchestration/',
      title: 'Project HydraFusion: Frontier quality via multi-model orchestration', url: 'https://github.blog/ai-and-ml/github-copilot/project-hydrafusion-frontier-quality-via-multi-model-orchestration/',
      summary: 'GitHub\'s Project HydraFusion achieves frontier quality through multi-model orchestration.',
      author: 'GitHub', channelId: 'github-blog', channelName: 'GitHub Blog', category: ['opensource'],
      publishedAt: '2026-09-11T10:00:00Z', updatedAt: '2026-09-11T10:00:00Z', isNew: false,
      sourceUrl: 'https://github.blog/feed/', tags: ['AI', 'multi-model'], language: 'en', hotScore: null }),

    /* --- 补充条目（补足 40+ 条，覆盖更长时间窗） --- */
    makeItem({ id: 'it_extra_1', guid: 'https://sspai.com/post/114414',
      title: '新 iPhone 配件精选：多种组合一次配齐', url: 'https://sspai.com/post/114414',
      summary: '围绕新 iPhone 的五种常用配件组合推荐，覆盖防护、充电、数据连接和磁吸支撑。',
      author: '什么陈', channelId: 'sspai', channelName: '少数派', category: ['product_design'],
      publishedAt: '2026-09-12T00:20:00Z', updatedAt: '2026-09-12T00:20:00Z',
      sourceUrl: 'https://sspai.com/feed', tags: ['iPhone', '配件'], hotScore: null }),
    makeItem({ id: 'it_extra_2', guid: 'https://news.ycombinator.com/item?id=49636479',
      title: 'Getting 50 GB/S Back from the Apple Neural Engine', url: 'https://news.ycombinator.com/item?id=49636479',
      summary: 'Technical article on recovering 50 GB/s bandwidth from Apple\'s Neural Engine through DMA optimization.',
      author: 'ane_dev', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T01:50:00Z', updatedAt: '2026-09-12T01:50:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['Apple', 'Neural Engine'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_extra_3', guid: 'https://tech.meituan.com/2026/08/20/01-meituan-Query-3.0.html',
      title: '美团搜索3.0：LLM 语义表征在排序模型的探索与应用', url: 'https://tech.meituan.com/2026/08/20/01-meituan-Query-3.0.html',
      summary: '聚焦 LLM 语义表征在服务零售排序场景的三期实践，探索语义匹配信号在搜索排序中的应用路径。',
      author: '美团技术团队', channelId: 'meituan-tech', channelName: '美团技术团队', category: ['tech_blog'],
      publishedAt: '2026-09-12T02:40:00Z', updatedAt: '2026-09-12T02:40:00Z',
      sourceUrl: 'https://tech.meituan.com/feed', tags: ['搜索', 'LLM'], hotScore: null }),
    makeItem({ id: 'it_extra_4', guid: 'https://36kr.com/p/3979727038004226',
      title: '9点1氪丨房贷延长到40年但申请人不能超过35岁？', url: 'https://36kr.com/p/3979727038004226',
      summary: '36氪每日早报，汇总房贷期限延长新政、长鑫存储利润率登顶、戴尔股价创新高等热点。',
      author: '36氪', channelId: '36kr', channelName: '36氪', category: ['news'],
      publishedAt: '2026-09-12T03:30:00Z', updatedAt: '2026-09-12T03:30:00Z',
      sourceUrl: 'https://36kr.com/feed', tags: ['早报'], hotScore: null }),
    makeItem({ id: 'it_extra_5', guid: 'https://huggingface.co/blog/ffasr-leaderboard',
      title: 'FFASR Leaderboard: Real-World ASR Benchmarking', url: 'https://huggingface.co/blog/ffasr-leaderboard',
      summary: 'A new leaderboard for benchmarking automatic speech recognition on real-world audio.',
      author: 'Hugging Face', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai'],
      publishedAt: '2026-09-12T05:10:00Z', updatedAt: '2026-09-12T05:10:00Z',
      sourceUrl: 'https://huggingface.co/blog/feed.xml', tags: ['ASR', 'benchmark'], language: 'en', hotScore: null }),
    makeItem({ id: 'it_extra_6', guid: 'https://www.ithome.com/1/001/693.htm',
      title: '澳大利亚两所大学新研究：能救人的"半机械蟑螂"', url: 'https://www.ithome.com/1/001/693.htm',
      summary: '澳大利亚两所大学公布可通过远程控制的"半机械蟑螂"研究成果，可在灾难废墟中寻找幸存者。',
      author: 'IT之家', channelId: 'ithome', channelName: 'IT之家', category: ['news'],
      publishedAt: '2026-09-12T06:05:00Z', updatedAt: '2026-09-12T06:05:00Z',
      sourceUrl: 'https://www.ithome.com/rss/', tags: ['科研'], hotScore: null }),
    makeItem({ id: 'it_extra_7', guid: 'https://www.ruanyifeng.com/blog/2026/08/weekly-issue-408.html',
      title: '科技爱好者周刊（第 408 期）：你需要知道的 AI 缓存知识', url: 'https://www.ruanyifeng.com/blog/2026/08/weekly-issue-408.html',
      summary: '本期梳理 AI 推理中的缓存机制：KV Cache、语义缓存与边缘缓存。',
      author: '阮一峰', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog'],
      publishedAt: '2026-09-12T07:20:00Z', updatedAt: '2026-09-12T07:20:00Z',
      sourceUrl: 'https://www.ruanyifeng.com/blog/atom.xml', tags: ['AI', '缓存'], hotScore: null }),
    makeItem({ id: 'it_extra_8', guid: 'https://github.blog/ai-and-ml/github-copilot/github-copilot-app-for-beginners-run-several-agents-at-once/',
      title: 'GitHub Copilot app for Beginners: Run several agents at once', url: 'https://github.blog/ai-and-ml/github-copilot/github-copilot-app-for-beginners-run-several-agents-at-once/',
      summary: 'A tutorial on running multiple AI agents simultaneously in GitHub Copilot.',
      author: 'GitHub', channelId: 'github-blog', channelName: 'GitHub Blog', category: ['opensource', 'dev_community'],
      publishedAt: '2026-09-12T08:30:00Z', updatedAt: '2026-09-12T08:30:00Z',
      sourceUrl: 'https://github.blog/feed/', tags: ['Copilot', 'agent'], language: 'en', hotScore: null }),
    makeItem({ id: 'it_extra_9', guid: 'https://www.v2ex.com/t/1240659',
      title: 'Agent 时代的独立开发经验分享', url: 'https://www.v2ex.com/t/1240659',
      summary: '独立开发者分享 Agent 辅助编程时代的项目结构与文档管理经验。',
      author: 'v2ex_user', channelId: 'v2ex', channelName: 'V2EX', category: ['dev_community'],
      publishedAt: '2026-09-12T06:50:00Z', updatedAt: '2026-09-12T06:50:00Z',
      sourceUrl: 'https://www.v2ex.com/index.xml', tags: ['Agent', '独立开发'], hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_extra_10', guid: 'https://techcrunch.com/?p=revolut-data-breach',
      title: 'Revolut confirms customer data breach through fake government requests', url: 'https://techcrunch.com/2026/09/12/revolut-confirms-customer-data-breach-through-fake-government-requests/',
      summary: 'Revolut confirms a customer data breach caused by fake government data requests, affecting an undisclosed number of users.',
      author: 'TechCrunch', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'],
      publishedAt: '2026-09-12T04:15:00Z', updatedAt: '2026-09-12T04:15:00Z',
      sourceUrl: 'https://techcrunch.com/feed/', tags: ['security', 'breach'], language: 'en', hotScore: null }),
    makeItem({ id: 'it_extra_11', guid: 'https://techcrunch.com/?p=mecka-ai-500m',
      title: 'Mecka AI nears $500M valuation in Sequoia-led deal amid rush for robot training data', url: 'https://techcrunch.com/2026/09/11/mecka-ai-nears-500m-valuation-in-sequoia-led-deal-amid-rush-for-robot-training-data/',
      summary: 'Robot training data startup Mecka AI nears $500M valuation in a Sequoia-led funding round.',
      author: 'TechCrunch', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'],
      publishedAt: '2026-09-11T21:40:00Z', updatedAt: '2026-09-11T21:40:00Z', isNew: false,
      sourceUrl: 'https://techcrunch.com/feed/', tags: ['robot', 'funding'], language: 'en', hotScore: null }),
    makeItem({ id: 'it_extra_12', guid: 'https://sspai.com/post/114439',
      title: '派早报：商务部回应美国 AI 蒸馏指控', url: 'https://sspai.com/post/114439',
      summary: '少数派早报汇总当日科技要闻：商务部回应 AI 蒸馏指控、DeepSeek V4.1 发布等。',
      author: '少数派编辑部', channelId: 'sspai', channelName: '少数派', category: ['product_design'],
      publishedAt: '2026-09-11T15:00:00Z', updatedAt: '2026-09-11T15:00:00Z', isNew: false,
      sourceUrl: 'https://sspai.com/feed', tags: ['早报'], hotScore: null }),
    makeItem({ id: 'it_extra_13', guid: 'https://arxiv.org/abs/2609.11876',
      title: '2609.11876: On the Regularization Landscape for the Linear Recommendation Models', url: 'https://arxiv.org/abs/2609.11876',
      summary: 'This paper analyzes the regularization landscape for linear recommendation models.',
      author: 'arXiv', channelId: 'arxiv-cs-ai', channelName: 'arXiv cs.AI', category: ['ai'],
      publishedAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', isNew: false,
      sourceUrl: 'https://rss.arxiv.org/rss/cs.AI', tags: ['recommendation'], language: 'en', hotScore: null }),

    /* --- Hacker News 补充（使单渠道今日条数 > 每卡片默认 10 条，演示「查看全部 →」） --- */
    makeItem({ id: 'it_hn_tools', guid: 'https://news.ycombinator.com/item?id=49676820',
      title: 'Real-SWE: Benchmarking AI models on private, real-world, enterprise codebases', url: 'https://news.ycombinator.com/item?id=49676820',
      summary: 'A benchmark for evaluating AI models on real enterprise codebases, addressing limitations of public benchmarks.',
      author: 'swe_bench', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T04:00:00Z', updatedAt: '2026-09-12T04:00:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['benchmark', 'AI'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_lang', guid: 'https://news.ycombinator.com/item?id=49678783',
      title: 'Align AI and Mathematics–To Something Else', url: 'https://news.ycombinator.com/item?id=49678783',
      summary: 'Lior Pachter\'s blog post on aligning AI and mathematics to something beyond both.',
      author: 'math_blog', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T04:45:00Z', updatedAt: '2026-09-12T04:45:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['AI', 'math'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_regex', guid: 'https://news.ycombinator.com/item?id=49678683',
      title: 'Everyone should slow down AI development except for me', url: 'https://news.ycombinator.com/item?id=49678683',
      summary: 'Xe Iaso\'s satirical essay on the "everyone should slow down AI except me" mindset.',
      author: 'xe_iaso', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T05:30:00Z', updatedAt: '2026-09-12T05:30:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['AI', 'satire'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_monorepo', guid: 'https://news.ycombinator.com/item?id=49678548',
      title: 'Recurrent Looped Transformer', url: 'https://news.ycombinator.com/item?id=49678548',
      summary: 'A project page for the Recurrent Looped Transformer model architecture.',
      author: 'rlt_dev', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T06:20:00Z', updatedAt: '2026-09-12T06:20:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['transformer', 'model'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_dns', guid: 'https://news.ycombinator.com/item?id=49678432',
      title: 'No Atlantic hurricanes by Sept. 12 breaks a 60-year record', url: 'https://news.ycombinator.com/item?id=49678432',
      summary: 'Weather report: no Atlantic hurricanes by Sept 12 breaks a 60-year record.',
      author: 'weather_watch', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T07:15:00Z', updatedAt: '2026-09-12T07:15:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['weather', 'record'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_postgres', guid: 'https://news.ycombinator.com/item?id=49645480',
      title: 'LG denies TV spying claims, says tracking and snooping concerns \'not true\'', url: 'https://news.ycombinator.com/item?id=49645480',
      summary: 'LG denies its TVs spy on users, calling tracking and snooping concerns untrue.',
      author: 'lg_official', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T07:50:00Z', updatedAt: '2026-09-12T07:50:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['LG', 'privacy'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_wasm', guid: 'https://news.ycombinator.com/item?id=49678435',
      title: 'AgentsDock: An IDE designed for agentic AI research', url: 'https://news.ycombinator.com/item?id=49678435',
      summary: 'An IDE specifically designed for agentic AI research workflows.',
      author: 'agentsdock', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T08:40:00Z', updatedAt: '2026-09-12T08:40:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['IDE', 'agent'], language: 'en', hotScore: null, mediaType: 'post' }),
    makeItem({ id: 'it_hn_abstraction', guid: 'https://news.ycombinator.com/item?id=49674498',
      title: 'Will There Be a 7G?', url: 'https://news.ycombinator.com/item?id=49674498',
      summary: 'An arXiv paper exploring the possibility of 7G mobile communication technology.',
      author: 'telecom_researcher', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'],
      publishedAt: '2026-09-12T09:10:00Z', updatedAt: '2026-09-12T09:10:00Z',
      sourceUrl: 'https://news.ycombinator.com/rss', tags: ['7G', 'telecom'], language: 'en', hotScore: null, mediaType: 'post' })
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
      { rank: 1, id: 'it_9f2c1a7b3e5d', title: '科技爱好者周刊（第 412 期）：禁止 issue，只用 PR', url: 'https://www.ruanyifeng.com/blog/2026/09/weekly-issue-412.html', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog'], hotScore: 0.87, sourceCount: 2, channelNames: ['阮一峰的网络日志', 'V2EX'], publishedAt: '2026-09-12T00:05:00Z', components: { sourceOverlap: 0.63, frequency: 0.41, recency: 0.35, channelWeight: 0.8, keywordHeat: 0.3 } },
      { rank: 2, id: 'it_4a2b8c0d6e1f', title: 'One sandbox per rollout, or how labs run RL for agents in 2026', url: 'https://huggingface.co/blog/sergiopaniego/rl-environments-2026', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai', 'opensource'], hotScore: 0.79, sourceCount: 1, channelNames: ['Hugging Face Blog'], publishedAt: '2026-09-11T15:40:00Z', components: { sourceOverlap: 0.0, frequency: 0.52, recency: 0.62, channelWeight: 0.8, keywordHeat: 0.66 } },
      { rank: 3, id: 'it_hf_inference', title: 'There Is No AI Arms Race. There\'s a Browser War.', url: 'https://huggingface.co/blog/sheebz/there-is-no-ai-arms-race', channelId: 'huggingface-blog', channelName: 'Hugging Face Blog', category: ['ai', 'opensource'], hotScore: 0.74, sourceCount: 3, channelNames: ['Hugging Face Blog', 'Hacker News', 'V2EX'], publishedAt: '2026-09-12T03:00:00Z', components: { sourceOverlap: 0.81, frequency: 0.44, recency: 0.55, channelWeight: 0.8, keywordHeat: 0.6 } },
      { rank: 4, id: 'it_1c3d5e7f9a0b', title: 'We must pace the frontier', url: 'https://news.ycombinator.com/item?id=49672510', channelId: 'hacker-news', channelName: 'Hacker News', category: ['dev_community'], hotScore: 0.72, sourceCount: 2, channelNames: ['Hacker News', 'GitHub Blog'], publishedAt: '2026-09-12T03:15:00Z', components: { sourceOverlap: 0.52, frequency: 0.38, recency: 0.58, channelWeight: 0.9, keywordHeat: 0.44 } },
      { rank: 5, id: 'it_3e2d1c0b9a8f', title: 'Automattic confirms Mullenweg has returned as CEO after attempted ouster by board', url: 'https://techcrunch.com/2026/09/12/automattic-confirms-mullenweg-has-returned-as-ceo-after-attempted-ouster-by-board/', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'], hotScore: 0.68, sourceCount: 1, channelNames: ['TechCrunch'], publishedAt: '2026-09-12T06:45:00Z', components: { sourceOverlap: 0.0, frequency: 0.47, recency: 0.51, channelWeight: 0.7, keywordHeat: 0.55 } },
      { rank: 6, id: 'it_meituan_kv', title: '《Agent 评测白皮书》系列01：Agent 评测全览', url: 'https://tech.meituan.com/2026/09/10/Agent-Evaluation-White-Paper-01.html', channelId: 'meituan-tech', channelName: '美团技术团队', category: ['tech_blog'], hotScore: 0.66, sourceCount: 1, channelNames: ['美团技术团队'], publishedAt: '2026-09-12T02:00:00Z', components: { sourceOverlap: 0.0, frequency: 0.36, recency: 0.7, channelWeight: 0.7, keywordHeat: 0.42 } },
      { rank: 7, id: 'it_gh_copilot', title: 'Marketing ops as code: Automating events from planning to follow-up on GitHub', url: 'https://github.blog/ai-and-ml/github-copilot/marketing-ops-as-code-automating-events-from-planning-to-follow-up-on-github/', channelId: 'github-blog', channelName: 'GitHub Blog', category: ['opensource', 'dev_community'], hotScore: 0.64, sourceCount: 1, channelNames: ['GitHub Blog'], publishedAt: '2026-09-12T04:40:00Z', components: { sourceOverlap: 0.0, frequency: 0.33, recency: 0.6, channelWeight: 0.6, keywordHeat: 0.5 } },
      { rank: 8, id: 'it_ruanyifeng_ops', title: '科技爱好者周刊（第 411 期）：OpenClaw 2.0 是一个缩影', url: 'https://www.ruanyifeng.com/blog/2026/09/weekly-issue-411.html', channelId: 'ruanyifeng-blog', channelName: '阮一峰的网络日志', category: ['tech_blog'], hotScore: 0.62, sourceCount: 1, channelNames: ['阮一峰的网络日志'], publishedAt: '2026-09-12T02:40:00Z', components: { sourceOverlap: 0.0, frequency: 0.3, recency: 0.66, channelWeight: 0.8, keywordHeat: 0.35 } },
      { rank: 9, id: 'it_tc_apple', title: 'OpenAI\'s Sam Altman says it would be \'ill-advised\' to go public in 2026', url: 'https://techcrunch.com/2026/09/12/openais-sam-altman-says-it-would-be-ill-advised-to-go-public-in-2026/', channelId: 'techcrunch', channelName: 'TechCrunch', category: ['tech_media', 'news'], hotScore: 0.61, sourceCount: 1, channelNames: ['TechCrunch'], publishedAt: '2026-09-12T08:15:00Z', components: { sourceOverlap: 0.0, frequency: 0.31, recency: 0.72, channelWeight: 0.7, keywordHeat: 0.4 } },
      { rank: 10, id: 'it_36kr_funding', title: '获达晨财智、元禾璞华数千万投资，这家物理AI企业自研WMM世界机理模型', url: 'https://36kr.com/p/3981147673345033', channelId: '36kr', channelName: '36氪', category: ['news', 'tech_media'], hotScore: 0.6, sourceCount: 1, channelNames: ['36氪'], publishedAt: '2026-09-12T06:30:00Z', components: { sourceOverlap: 0.0, frequency: 0.29, recency: 0.5, channelWeight: 0.6, keywordHeat: 0.5 } }
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
      { topic: '科技爱好者周刊（第 412 期）：禁止 issue，只用 PR', sourceCount: 2, itemIds: ['it_9f2c1a7b3e5d', 'it_0d9e8f7a6b5c'], channelNames: ['阮一峰的网络日志', 'V2EX'] },
      { topic: 'There Is No AI Arms Race. There\'s a Browser War.', sourceCount: 3, itemIds: ['it_hf_inference'], channelNames: ['Hugging Face Blog', 'Hacker News', 'V2EX'] },
      { topic: 'We must pace the frontier', sourceCount: 2, itemIds: ['it_1c3d5e7f9a0b'], channelNames: ['Hacker News', 'GitHub Blog'] },
      { topic: '你们觉得现在用哪个技术栈还重要吗？', sourceCount: 2, itemIds: ['it_v2ex_macbook'], channelNames: ['V2EX', 'Hacker News'] }
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
    '阮一峰周刊「禁止 issue，只用 PR」被 2 个渠道同时报道，位列热点榜首位；Hugging Face「AI 军备竞赛还是浏览器战争」获 3 家渠道转载。';

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
      miniItem('it_h_0901', '外滩大会：AI新人类，登场', '36kr', '36氪', ['news'], '2026-09-12T06:30:00Z', 1, 0.6),
      miniItem('it_h_0902', '科技爱好者周刊（第 412 期）：禁止 issue，只用 PR', 'ruanyifeng-blog', '阮一峰的网络日志', ['tech_blog'], '2026-09-12T00:05:00Z', 2, 0.87),
      miniItem('it_h_0903', 'There Is No AI Arms Race. There\'s a Browser War.', 'huggingface-blog', 'Hugging Face Blog', ['ai', 'opensource'], '2026-09-12T03:00:00Z', 3, 0.74),
      miniItem('it_h_0904', '《Agent 评测白皮书》系列01：Agent 评测全览', 'meituan-tech', '美团技术团队', ['tech_blog'], '2026-09-12T02:00:00Z', 1, 0.66),
      miniItem('it_h_0905', '[后续] 上星期发帖当天吐槽然后跑去面试，拿到 offer 了', 'v2ex', 'V2EX', ['dev_community'], '2026-09-11T14:00:00Z', 1, null),
      miniItem('it_h_0906', 'Stabilizing Rust\'s Never Type', 'hacker-news', 'Hacker News', ['dev_community'], '2026-09-12T06:40:00Z', 1, 0.49)
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
        { rank: 1, title: '科技爱好者周刊（第 412 期）：禁止 issue，只用 PR', channelName: '阮一峰的网络日志', hotScore: 0.87, url: 'https://www.ruanyifeng.com/blog/2026/09/weekly-issue-412.html' },
        { rank: 2, title: 'One sandbox per rollout, or how labs run RL for agents in 2026', channelName: 'Hugging Face Blog', hotScore: 0.79, url: 'https://huggingface.co/blog/sergiopaniego/rl-environments-2026' },
        { rank: 3, title: 'There Is No AI Arms Race. There\'s a Browser War.', channelName: 'Hugging Face Blog', hotScore: 0.74, url: 'https://huggingface.co/blog/sheebz/there-is-no-ai-arms-race' }
      ]
    },
    '2026-09-11': {
      status: 'ok',
      date: '2026-09-11',
      totalItems: 154,
      activeChannels: 12,
      topItems: [
        { rank: 1, title: 'Mecka AI nears $500M valuation in Sequoia-led deal', channelName: 'TechCrunch', hotScore: 0.71, url: 'https://techcrunch.com/2026/09/11/mecka-ai-nears-500m-valuation-in-sequoia-led-deal-amid-rush-for-robot-training-data/' },
        { rank: 2, title: '将 GitHub CI 迁移到 Hugging Face Jobs', channelName: 'Hugging Face Blog', hotScore: 0.68, url: 'https://huggingface.co/blog/github-ci-hf-jobs' },
        { rank: 3, title: 'Project HydraFusion: Frontier quality via multi-model orchestration', channelName: 'GitHub Blog', hotScore: 0.6, url: 'https://github.blog/ai-and-ml/github-copilot/project-hydrafusion-frontier-quality-via-multi-model-orchestration/' }
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

// scripts/__tests__/import-channels.test.mjs
//
// 覆盖「外部渠道清单 → config/sources.json」导入管线的**纯函数**部分。
//
// 主理人 2026-09-16 拍板的两条硬要求，这里是它们在导入侧的落点：
//   ① 「所有其他渠道 + 导入的都要最终落到这里」→ 清洗 / 合并语义
//   ② 「不要重复请求同一个渠道获取 rss 信息」→ 幂等键（归一化 feed URL）去重
//
// 只测纯函数：解析、清洗、分类映射、放量选取。网络体检（runHealth / sniffUrls）
// 与 CLI 落盘由端到端脚本覆盖，不在这里发请求。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  GARSS_CATEGORY_MAP,
  ENABLED_CATEGORIES,
  CLEAN_REASONS,
  parseGarssInfo,
  parseGarssSubscriptions,
  parseRegistryExport,
  parseOpml,
  detectFormat,
  cleanCandidates,
  rewriteRsshubUrl,
  mapCategory,
  orderForRollout,
  selectRollout,
  enableRollout,
  canonicalizeSourceUrls,
  sniffFeedMarker,
} from '../import-channels.mjs';
import { normalizeFeedUrl, normalizeHomepage } from '../lib/channel-registry.mjs';

// ---------------------------------------------------------------------------
// 阶段 0：解析适配器
// ---------------------------------------------------------------------------

describe('parseGarssInfo — garss 实际在用的那份清单', () => {
  test('抽取 5 个字段', () => {
    const out = parseGarssInfo({
      garssInfo: [
        { sourceId: 'S001', category: '软件工具', title: '不死鸟', description: '专注分享优质资源', xmlUrl: 'https://iao.su/feed' },
      ],
    });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], {
      originRef: 'S001',
      name: '不死鸟',
      feedUrl: 'https://iao.su/feed',
      rawCategory: '软件工具',
      description: '专注分享优质资源',
    });
  });

  test('缺字段不炸：title 空则退回 sourceId', () => {
    const out = parseGarssInfo({ garssInfo: [{ sourceId: 'S002', xmlUrl: 'https://a.com/feed' }] });
    assert.equal(out[0].name, 'S002');
    assert.equal(out[0].rawCategory, '');
  });

  test('形状不对返回空数组，而不是抛异常', () => {
    assert.deepEqual(parseGarssInfo(null), []);
    assert.deepEqual(parseGarssInfo({ garssInfo: 'nope' }), []);
  });
});

describe('parseGarssSubscriptions — 全量 3398 条里挑出真正在用的', () => {
  const fixture = [
    { id: 'editreadme-aaa', name: 'A', routePath: 'https://a.com/feed', category: '科技类', enabled: true },
    { id: 'editreadme-bbb', name: 'B', routePath: 'https://b.com/feed', category: '科技类', enabled: false },
    { id: 'rsshub-doc-1', name: 'C', routePath: 'https://rsshub.app/c/1', category: 'RSSHub 文档 / 高校', enabled: false },
    { id: 'rsshub-doc-2', name: 'D', routePath: 'https://rsshub.app/c/2', category: 'RSSHub 文档 / 新媒体', enabled: true },
  ];

  test('默认只取 enabled 且排除「RSSHub 文档 / *」目录项', () => {
    const out = parseGarssSubscriptions(fixture);
    assert.deepEqual(out.map((x) => x.name), ['A']);
  });

  test('includeRsshubCatalog 打开后，enabled 的目录项也进来', () => {
    const out = parseGarssSubscriptions(fixture, { includeRsshubCatalog: true });
    assert.deepEqual(out.map((x) => x.name).sort(), ['A', 'D']);
  });

  test('onlyEnabled:false 时 disabled 的普通渠道也进来（但目录项仍被排除）', () => {
    const out = parseGarssSubscriptions(fixture, { onlyEnabled: false });
    assert.deepEqual(out.map((x) => x.name).sort(), ['A', 'B']);
  });

  test('裸数组也认（subscriptions.json 顶层就是数组）', () => {
    const out = parseGarssSubscriptions([fixture[0]]);
    assert.equal(out.length, 1);
  });
});

describe('parseRegistryExport — 导出回灌的入口', () => {
  test('只有 feedUrl 的旧式导出也能读，且候选名是**渠道名**', () => {
    const out = parseRegistryExport({
      format: 'rss-radar/channel-registry',
      channels: [{
        id: 'coolshell', name: '酷壳', homepage: 'https://coolshell.cn/',
        feedUrl: 'https://coolshell.cn/feed', category: ['tech_blog'],
      }],
    });
    assert.equal(out.length, 1);
    // 候选的 name 必须是渠道名 —— merge 用它命名 channel；
    // 若这里给成 feed 名，多源渠道的渠道名会被最后一条 feed 覆盖（实测踩过）
    assert.equal(out[0].name, '酷壳');
    assert.equal(out[0].feedUrl, 'https://coolshell.cn/feed');
    assert.deepEqual(out[0]._presetCategory, ['tech_blog']);
    // 渠道级未标溯源时，originRef 就该是空的 —— 不能拿渠道 id 冒充外部来源锚点
    assert.equal(out[0].originRef, undefined);
  });

  test('★ 渠道开关与源开关分开读，源开关不会污染渠道开关', () => {
    const out = parseRegistryExport({
      format: 'rss-radar/channel-registry',
      channels: [{
        id: 'a', name: 'A', homepage: 'https://a.com', category: ['other'],
        enabled: true,   // 渠道开着
        feeds: [
          { id: 'a-1', url: 'https://a.com/1', type: 'rss', enabled: true },
          { id: 'a-2', url: 'https://a.com/2', type: 'rss', enabled: false }, // 这条源单独关着
        ],
      }],
    });
    assert.equal(out.length, 2);
    // 渠道开关
    assert.equal(out[0]._preset.enabled, true);
    assert.equal(out[1]._preset.enabled, true, '渠道开关不该被任何一条 feed 覆盖');
    // 源开关各自独立
    assert.equal(out[0]._preset.sourceEnabled, true);
    assert.equal(out[1]._preset.sourceEnabled, false);
    // 源级 id 进 preset.sourceId，而不是拿去当渠道溯源
    assert.equal(out[0]._preset.sourceId, 'a-1');
    assert.equal(out[1]._preset.sourceId, 'a-2');
  });

  test('feeds[] 全展开 —— 多源渠道不会被还原成单源', () => {
    const out = parseRegistryExport({
      channels: [{
        id: 'a', name: 'A', homepage: 'https://a.com', category: ['other'],
        feeds: [
          { id: 'a-1', url: 'https://a.com/1' },
          { id: 'a-2', url: 'https://a.com/2' },
          { id: 'a-3', url: 'https://a.com/3' },
        ],
      }],
    });
    assert.deepEqual(out.map((x) => x.feedUrl), ['https://a.com/1', 'https://a.com/2', 'https://a.com/3']);
  });
});

describe('parseOpml — 容错解析，不引 XML 依赖', () => {
  const opml = `<?xml version="1.0"?>
<opml version="2.0"><body>
  <outline text="技术">
    <outline text="酷壳" type="rss" xmlUrl="https://coolshell.cn/feed"/>
    <outline text="云风" type="rss" xmlUrl="https://blog.codingnow.com/atom.xml"/>
  </outline>
  <outline text="独立" type="rss" xmlUrl="https://iao.su/feed"/>
</body></opml>`;

  test('嵌套 outline 的父级 text 作为分类', () => {
    const out = parseOpml(opml);
    assert.equal(out.length, 3);
    const byName = Object.fromEntries(out.map((o) => [o.name, o]));
    assert.equal(byName['酷壳'].rawCategory, '技术');
    assert.equal(byName['云风'].feedUrl, 'https://blog.codingnow.com/atom.xml');
    assert.equal(byName['独立'].rawCategory, '');
  });

  test('实体转义会被还原', () => {
    const out = parseOpml('<outline text="A &amp; B" xmlUrl="https://a.com/feed"/>');
    assert.equal(out[0].name, 'A & B');
  });

  test('非 OPML 输入返回空数组', () => {
    assert.deepEqual(parseOpml('{"a":1}'), []);
    assert.deepEqual(parseOpml(''), []);
  });
});

describe('detectFormat — 内容优先于扩展名', () => {
  test('按内容识别，不看文件名', () => {
    assert.equal(detectFormat('{"garssInfo":[]}', 'whatever.json'), 'garss-info');
    assert.equal(detectFormat('{"format":"rss-radar/channel-registry","channels":[]}', 'x.json'), 'registry-export');
    assert.equal(detectFormat('[]', 'anything.json'), 'garss-subscriptions');
    assert.equal(detectFormat('<opml version="2.0"><body/></opml>', 'x.txt'), 'opml');
    assert.equal(detectFormat('not json at all', 'x.txt'), 'unknown');
  });

  test('同一个 .json 是 garssInfo 还是注册表导出，靠结构区分', () => {
    // 两者都是 .json，扩展名给不出任何信息 —— 这正是「内容优先」的意义
    assert.equal(detectFormat('{"channels":[{"feedUrl":"https://a.com/f"}]}', 'a.json'), 'registry-export');
    assert.equal(detectFormat('{"garssInfo":[{"xmlUrl":"https://a.com/f"}]}', 'a.json'), 'garss-info');
  });
});

// ---------------------------------------------------------------------------
// 阶段 1：清洗
// ---------------------------------------------------------------------------

describe('rewriteRsshubUrl — 内网地址改写', () => {
  test('Docker 内网主机 → 公共实例', () => {
    assert.deepEqual(rewriteRsshubUrl('http://rsshub:1200/iplay/home'), {
      url: 'https://rsshub.app/iplay/home', kind: 'internal',
    });
  });

  test('纯路径型 → 公共实例', () => {
    assert.deepEqual(rewriteRsshubUrl('/1point3acres/section/379/hot'), {
      url: 'https://rsshub.app/1point3acres/section/379/hot', kind: 'path-only',
    });
  });

  test('localhost / 127.0.0.1 也算内网', () => {
    assert.ok(rewriteRsshubUrl('http://localhost:1200/zhihu/hot'));
    assert.ok(rewriteRsshubUrl('http://127.0.0.1:1200/zhihu/hot'));
  });

  test('query 一并带过去（RSSHub 路由常靠 query 区分）', () => {
    const r = rewriteRsshubUrl('http://rsshub:1200/1point3acres/section/379/hot?limit=50');
    assert.equal(r.url, 'https://rsshub.app/1point3acres/section/379/hot?limit=50');
  });

  test('正常公网 feed 不命中（返回 null）', () => {
    assert.equal(rewriteRsshubUrl('https://iao.su/feed'), null);
    assert.equal(rewriteRsshubUrl('https://coolshell.cn/feed'), null);
    // 关键：公网的 rsshub.app 不该被当成「内网」再改一次
    assert.equal(rewriteRsshubUrl('https://rsshub.app/zhihu/hot'), null);
  });
});

describe('cleanCandidates — 清洗与批内去重', () => {
  test('默认丢弃 Docker 内网地址（公网抓不到，直搬必然全灭）', () => {
    const { kept, dropped } = cleanCandidates([
      { name: 'A', feedUrl: 'https://a.com/feed' },
      { name: '内网', feedUrl: 'http://rsshub:1200/iplay/home' },
    ]);
    assert.deepEqual(kept.map((k) => k.feedUrl), ['https://a.com/feed']);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].reason, CLEAN_REASONS.INTERNAL_DROPPED);
  });

  test('keep-internal（dropInternal:false）改写后保留', () => {
    const { kept, dropped } = cleanCandidates(
      [{ name: '内网', feedUrl: 'http://rsshub:1200/iplay/home' }],
      { dropInternal: false },
    );
    assert.equal(dropped.length, 0);
    assert.equal(kept[0].feedUrl, 'https://rsshub.app/iplay/home');
    assert.equal(kept[0].fromRsshubRewrite, true);
  });

  test('★ 改写后的语料不会塌成同一个渠道', () => {
    // 实测踩到的坑：65 条 route 若都用 originOf() 当主页，会全部落到
    // https://rsshub.app 上，塌成一个名叫 rsshub 的巨型渠道。
    const { kept } = cleanCandidates(
      [
        { name: 'A', feedUrl: 'http://rsshub:1200/iplay/home' },
        { name: 'B', feedUrl: 'http://rsshub:1200/amazon/kindle/software-updates' },
        { name: 'C', feedUrl: 'http://rsshub:1200/openai/chatgpt/release-notes' },
      ],
      { dropInternal: false },
    );
    const homepages = new Set(kept.map((k) => k.homepage));
    assert.equal(homepages.size, 3, '三条 route 必须是三个不同主页');
    assert.ok([...homepages].every((h) => h.includes('rsshub.app/')), '主页应保留路由路径以区分');
  });

  test('缺失 / 非法 / 非 http 协议 分别落到不同原因', () => {
    const { dropped } = cleanCandidates([
      { name: 'no-url' },
      { name: 'bad', feedUrl: 'not a url' },
      { name: 'ftp', feedUrl: 'ftp://a.com/feed' },
    ]);
    assert.deepEqual(dropped.map((d) => d.reason), [
      CLEAN_REASONS.MISSING_URL,
      CLEAN_REASONS.INVALID_URL,
      CLEAN_REASONS.UNSUPPORTED_PROTOCOL,
    ]);
  });

  test('★ 批内去重：同归一化 URL 只留首个（「不要重复请求同一个渠道」）', () => {
    const { kept, dropped } = cleanCandidates([
      { name: '首个', feedUrl: 'https://example.com/feed' },
      { name: '大小写+尾斜杠', feedUrl: 'https://EXAMPLE.com/feed/' },
      { name: '带跟踪参数', feedUrl: 'https://example.com/feed?utm_source=x' },
    ]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].name, '首个');
    assert.equal(dropped.length, 2);
    assert.ok(dropped.every((d) => d.reason === CLEAN_REASONS.DUPLICATE_IN_BATCH));
    assert.equal(dropped[0].duplicateOf, '首个', '报告要说清「和谁重了」');
  });

  test('落盘的 URL 是归一化后的形态（幂等重跑的前提）', () => {
    const { kept } = cleanCandidates([{ name: 'A', feedUrl: 'https://EXAMPLE.com/feed/?utm_source=nl#x' }]);
    assert.equal(kept[0].feedUrl, normalizeFeedUrl('https://EXAMPLE.com/feed/?utm_source=nl#x'));
    assert.equal(kept[0].feedUrl, 'https://example.com/feed');
  });

  test('homepage 在清洗阶段就定死，且是**栏目级**而非裸 host', () => {
    // 旧实现回落到 `new URL(feedUrl).origin`（裸 host），把同 host 下的不同栏目、
    // 以及 feed 托管站上的不同刊物都压成一条渠道（实测：feedx 三刊合一、
    // feedburner 两站合一）。新判据剥掉尾部 feed 特征段后取首个有区分度的段。
    const { kept } = cleanCandidates([{ name: 'A', feedUrl: 'https://a.com/path/feed' }]);
    assert.equal(kept[0].homepage, 'https://a.com/path');

    // 路径段全是 feed 特征词 → 退回 host（站主 feed，同站唯一）
    const main = cleanCandidates([{ name: 'B', feedUrl: 'https://b.com/feed' }]);
    assert.equal(main.kept[0].homepage, 'https://b.com');

    // feed 托管站的路径是「订阅标识」而不是站点栏目 → 退回完整 URL，保住区分度
    const hosted = cleanCandidates([
      { name: 'C', feedUrl: 'https://feedx.net/rss/a.xml' },
      { name: 'D', feedUrl: 'https://feedx.net/rss/b.xml' },
    ]);
    assert.equal(hosted.kept[0].homepage, 'https://feedx.net/rss/a.xml');
    assert.equal(hosted.kept[1].homepage, 'https://feedx.net/rss/b.xml');
    assert.notEqual(hosted.kept[0].homepage, hosted.kept[1].homepage);

    // 同栏目下的多条 route 必须归并到同一个主页（否则会碎成多个渠道）
    const routes = cleanCandidates([
      { name: 'E', feedUrl: 'https://e.com/Col/male-20' },
      { name: 'F', feedUrl: 'https://e.com/Col/monthly-20' },
    ]);
    assert.equal(routes.kept[0].homepage, routes.kept[1].homepage);
    assert.equal(routes.kept[0].homepage, 'https://e.com/Col');
  });

  test('显式 homepage 优先于从 feedUrl 推导', () => {
    const { kept } = cleanCandidates([{ name: 'A', feedUrl: 'https://feed.a.com/rss', homepage: 'https://a.com' }]);
    assert.equal(kept[0].homepage, 'https://a.com');
  });

  test('★ 溯源字段原样穿过清洗阶段（否则往返会静默丢 origin）', () => {
    // 实测踩过：parseRegistryExport 把渠道级溯源写进 `_origin`，而 cleanCandidates
    // 是从 `item.origin` 读的 → 同名不同字段，`origin` 在清洗阶段被静默抹掉。
    // 而 `originRef` / `importBatch` 走 `_preset` 活了下来，所以症状很像"导出行丢字段"。
    const { kept } = cleanCandidates([
      { name: 'A', feedUrl: 'https://a.com/feed', origin: 'garss', originRef: 'S001', _preset: { importBatch: 'b1' } },
    ]);
    assert.equal(kept[0]._origin, 'garss', '渠道级 origin 必须被搬进 _origin');
    assert.deepEqual(kept[0]._preset, { importBatch: 'b1' });
    assert.equal(kept[0].originRef, 'S001');
  });

  test('未给 origin 的候选不会被塞上默认值（保持缺省语义）', () => {
    const { kept } = cleanCandidates([{ name: 'A', feedUrl: 'https://a.com/feed' }]);
    assert.equal(kept[0]._origin, undefined);
  });
});

// ---------------------------------------------------------------------------
// SSOT 收敛：历史 URL 拉齐到去重键形态
// ---------------------------------------------------------------------------

describe('canonicalizeSourceUrls — 让「存储形态」等于「去重键形态」', () => {
  test('★ 尾斜杠 / 大小写 / 跟踪参数 / query 乱序 都被收敛', () => {
    const cfg = {
      sources: [
        { id: 's1', url: 'https://www.appinn.com/feed/' },
        { id: 's2', url: 'https://iui.su/feed/' },
        { id: 's3', url: 'https://www.52pojie.cn/forum.php?mod=guide&view=hot&rss=1' },
        { id: 's4', url: 'https://example.com/feed?utm_source=nl' },
      ],
    };
    const { changed, conflicts } = canonicalizeSourceUrls(cfg);
    assert.equal(conflicts.length, 0);
    assert.equal(changed.length, 4);
    assert.equal(cfg.sources[0].url, 'https://www.appinn.com/feed');
    assert.equal(cfg.sources[1].url, 'https://iui.su/feed');
    assert.equal(cfg.sources[2].url, 'https://www.52pojie.cn/forum.php?mod=guide&rss=1&view=hot');
    assert.equal(cfg.sources[3].url, 'https://example.com/feed');
  });

  test('每个改动都写进报告（可人工复核，不静默改）', () => {
    const cfg = { sources: [{ id: 's1', url: 'https://a.com/feed/' }] };
    const { changed } = canonicalizeSourceUrls(cfg);
    assert.deepEqual(changed, [{ id: 's1', from: 'https://a.com/feed/', to: 'https://a.com/feed' }]);
  });

  test('已规范的 URL 不动，也不进报告（幂等）', () => {
    const cfg = { sources: [{ id: 's1', url: 'https://a.com/feed' }] };
    const { changed } = canonicalizeSourceUrls(cfg);
    assert.equal(changed.length, 0);
    // 再跑一次仍然无改动
    assert.equal(canonicalizeSourceUrls(cfg).changed.length, 0);
  });

  test('★ 归一化后撞车 = 真重复 → 报警且不自动合并（宁可报警不可乱删）', () => {
    const cfg = {
      sources: [
        { id: 's1', url: 'https://a.com/feed' },
        { id: 's2', url: 'https://a.com/feed/' },
      ],
    };
    const { changed, conflicts } = canonicalizeSourceUrls(cfg);
    assert.equal(conflicts.length, 1);
    assert.deepEqual(conflicts[0].ids, ['s1', 's2']);
    assert.equal(changed.length, 0, '撞车的条目一个都不许改，否则会制造出两条同 URL 的源');
    assert.equal(cfg.sources[1].url, 'https://a.com/feed/', '原样保留，等人工裁决');
  });

  test('非绝对 URL / 空值不参与，原样跳过', () => {
    const cfg = { sources: [{ id: 's1', url: './local/feed.json' }, { id: 's2', url: '' }] };
    const { changed, conflicts } = canonicalizeSourceUrls(cfg);
    assert.equal(changed.length, 0);
    assert.equal(conflicts.length, 0);
    assert.equal(cfg.sources[0].url, './local/feed.json');
  });

  test('config 没有 sources 也不炸', () => {
    assert.deepEqual(canonicalizeSourceUrls({}).changed, []);
    assert.deepEqual(canonicalizeSourceUrls(null).conflicts, []);
  });
});

// ---------------------------------------------------------------------------
// 阶段 2：分类映射
// ---------------------------------------------------------------------------

describe('mapCategory — 未命中不猜，落到 other 并留痕', () => {
  test('命中映射表', () => {
    assert.deepEqual(mapCategory('金融类'), { category: ['finance'], tags: ['金融类'], known: true });
    assert.deepEqual(mapCategory('活着的个人独立博客'), { category: ['tech_blog'], tags: ['活着的个人独立博客'], known: true });
  });

  test('★ 未命中 → other，且原始词进 tags（保留可检索性）', () => {
    const r = mapCategory('火星文分类');
    assert.deepEqual(r.category, ['other']);
    assert.deepEqual(r.tags, ['火星文分类']);
    assert.equal(r.known, false);
  });

  test('已是受控 key 时直接透传（回灌注册表导出的路径）', () => {
    assert.deepEqual(mapCategory('tech_blog').category, ['tech_blog']);
    assert.deepEqual(mapCategory('ai').category, ['ai']);
  });

  test('逗号分隔的多分类都能映射', () => {
    assert.deepEqual(mapCategory('科技类,金融类').category.sort(), ['finance', 'tech_blog']);
  });

  test('空值 → other', () => {
    assert.deepEqual(mapCategory('').category, ['other']);
    assert.deepEqual(mapCategory(undefined).category, ['other']);
  });

  test('★ 映射表覆盖 garss 全部 19 个中文分类，且值都在"已启用"集里', () => {
    const GARSS_CATEGORIES = [
      '软件工具', '活着的个人独立博客', '数码', 'IT团队博客', '公司官方新闻', '互联网类',
      '金融类', '科技类', '学习类', '学术类', '生活类', '设计类', '内容平台', '影视资源',
      '游戏', '资源类', 'Telegram优质频道RSS订阅', '摄影', '未分类',
    ];
    assert.equal(GARSS_CATEGORIES.length, 19);
    for (const c of GARSS_CATEGORIES) {
      assert.ok(GARSS_CATEGORY_MAP[c], `映射表缺少 garss 分类「${c}」`);
    }
    // 值必须落在已启用的 8 类里 —— 否则 config/categories.json 没注册，
    // 前端筛选器会渲染出无标签的空 chip（README「新增分类需四处同步」的纪律）
    for (const [from, to] of Object.entries(GARSS_CATEGORY_MAP)) {
      assert.ok(ENABLED_CATEGORIES.includes(to), `「${from}」映射到了未启用的分类 ${to}`);
    }
    assert.equal(ENABLED_CATEGORIES.length, 8);
  });
});

// ---------------------------------------------------------------------------
// 放量：排序与选取
// ---------------------------------------------------------------------------

describe('orderForRollout — 按分类轮转，防止单一品类刷屏', () => {
  test('garss 的 46% 个人博客不会霸占前面所有位置', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => ({ name: `blog${i}`, category: ['tech_blog'] })),
      ...Array.from({ length: 2 }, (_, i) => ({ name: `news${i}`, category: ['news'] })),
      { name: 'fin0', category: ['finance'] },
    ];
    const out = orderForRollout(items);
    assert.equal(out.length, 8);
    // 前 3 个必须是 3 个不同分类
    assert.equal(new Set(out.slice(0, 3).map((x) => x.category[0])).size, 3);
    assert.deepEqual(out.slice(0, 3).map((x) => x.name), ['blog0', 'news0', 'fin0']);
  });

  test('不改入参', () => {
    const items = [{ name: 'a', category: ['x'] }, { name: 'b', category: ['y'] }];
    const snapshot = JSON.stringify(items);
    orderForRollout(items);
    assert.equal(JSON.stringify(items), snapshot);
  });
});

describe('selectRollout — 名额按「渠道」算，不按 feed 算', () => {
  test('★ 名额数 = 开出来的渠道数（不是 feed 数）', () => {
    // 一个主页挂 2 条 feed：应只占 1 个名额
    const items = [
      { name: 'a1', homepage: 'https://a.com', feedUrl: 'https://a.com/rss' },
      { name: 'a2', homepage: 'https://a.com', feedUrl: 'https://a.com/atom' },
      { name: 'b', homepage: 'https://b.com', feedUrl: 'https://b.com/feed' },
      { name: 'c', homepage: 'https://c.com', feedUrl: 'https://c.com/feed' },
    ];
    const { chosen, rest } = selectRollout(items, 2);
    // 2 个名额 → a 和 b 两个渠道；a 的两条 feed 一起进
    assert.deepEqual(chosen.map((x) => x.name), ['a1', 'a2', 'b']);
    assert.deepEqual(rest.map((x) => x.name), ['c']);
  });

  test('同一主页的 feed 必须同开同关（不能开一半）', () => {
    const items = [
      { name: 'a1', homepage: 'https://a.com', feedUrl: 'https://a.com/1' },
      { name: 'b1', homepage: 'https://b.com', feedUrl: 'https://b.com/1' },
      { name: 'a2', homepage: 'https://a.com', feedUrl: 'https://a.com/2' },
    ];
    const { chosen } = selectRollout(items, 2);
    assert.deepEqual(chosen.map((x) => x.name), ['a1', 'b1', 'a2']);
  });

  test('主页大小写 / 尾斜杠差异视为同一渠道', () => {
    const items = [
      { name: 'a1', homepage: 'https://A.com/', feedUrl: 'https://a.com/1' },
      { name: 'a2', homepage: 'https://a.com', feedUrl: 'https://a.com/2' },
      { name: 'b', homepage: 'https://b.com', feedUrl: 'https://b.com/1' },
    ];
    const { chosen } = selectRollout(items, 2);
    assert.deepEqual(chosen.map((x) => x.name), ['a1', 'a2', 'b']);
  });

  test('★ 与现有注册表同主页的走 rideAlong：不占名额、不被擅自开关', () => {
    const items = [
      { name: 'v2ex-new', homepage: 'https://v2ex.com', feedUrl: 'https://v2ex.com/feed/new' },
      { name: 'a', homepage: 'https://a.com', feedUrl: 'https://a.com/feed' },
    ];
    // `existingHomepages` 的契约是「**已归一化**的主页键」，所以这里用同一个函数
    // 生成，而不是硬编码字面量 —— 后者会把测试绑死在某版归一化规则上（协议 / www
    // 归一化一上，字面量就失配了），而它真正想断言的是"命中既有渠道 → 走 rideAlong"。
    const existing = new Set([normalizeHomepage('https://v2ex.com')]);
    const { chosen, rideAlong } = selectRollout(items, 1, existing);
    assert.deepEqual(chosen.map((x) => x.name), ['a'], 'v2ex 不占名额');
    assert.deepEqual(rideAlong.map((x) => x.name), ['v2ex-new']);
  });

  test('名额 0 或负数 → 全部落 rest，一个都不开', () => {
    const items = [{ name: 'a', homepage: 'https://a.com', feedUrl: 'https://a.com/f' }];
    assert.deepEqual(selectRollout(items, 0).chosen, []);
    assert.deepEqual(selectRollout(items, 0).rest.length, 1);
    assert.deepEqual(selectRollout(items, -5).chosen, []);
  });

  test('候选少于名额 → 有几个开几个，不报错', () => {
    const items = [{ name: 'a', homepage: 'https://a.com', feedUrl: 'https://a.com/f' }];
    const { chosen } = selectRollout(items, 60);
    assert.equal(chosen.length, 1);
  });
});

describe('enableRollout — 渠道与其全部 source 同开', () => {
  const cfg = () => ({
    channels: [
      { id: 'a', homepage: 'https://a.com', enabled: false },
      { id: 'v2ex', homepage: 'https://v2ex.com', enabled: false },
    ],
    sources: [
      { id: 'a-1', channelId: 'a', enabled: false },
      { id: 'a-2', channelId: 'a', enabled: false },
      { id: 'v2ex-1', channelId: 'v2ex', enabled: false },
    ],
  });

  test('★ 选中渠道的全部 source 一起开（不留半开的渠道）', () => {
    const c = cfg();
    const ids = enableRollout(c, { chosen: [{ homepage: 'https://a.com', feedUrl: 'https://a.com/1' }] });
    assert.deepEqual(ids, ['a']);
    assert.equal(c.channels[0].enabled, true);
    assert.equal(c.sources[0].enabled, true);
    assert.equal(c.sources[1].enabled, true, '同渠道的第 2 条 feed 也必须开');
    // 没选中的纹丝不动
    assert.equal(c.channels[1].enabled, false);
    assert.equal(c.sources[2].enabled, false);
  });

  test('★ rideAlong 跟随既有渠道的开关，不被擅自打开', () => {
    const c = cfg();
    enableRollout(c, { chosen: [], rideAlong: [{ homepage: 'https://v2ex.com', feedUrl: 'https://v2ex.com/f' }] });
    assert.equal(c.channels[1].enabled, false, '人工关掉的渠道，导入不该擅自打开');
    assert.equal(c.sources[2].enabled, false, '新 source 跟随渠道状态');
  });

  test('rideAlong 遇到已启用的渠道 → 新 source 也启用（同渠道应该一致）', () => {
    const c = cfg();
    c.channels[1].enabled = true;
    c.sources[2].enabled = true;
    enableRollout(c, { chosen: [], rideAlong: [{ homepage: 'https://v2ex.com', feedUrl: 'https://v2ex.com/f2' }] });
    assert.equal(c.sources[2].enabled, true);
  });

  test('空入参不炸', () => {
    const c = cfg();
    assert.deepEqual(enableRollout(c, {}), []);
    assert.deepEqual(enableRollout(c, { chosen: [], rideAlong: [] }), []);
  });
});

// ---------------------------------------------------------------------------
// feed 内容嗅探（纯函数部分）
// ---------------------------------------------------------------------------

describe('sniffFeedMarker — 判断「这到底是不是一个 feed」', () => {
  test('四种 feed 形态都认得', () => {
    assert.equal(sniffFeedMarker('<?xml version="1.0"?><rss version="2.0">'), true);
    assert.equal(sniffFeedMarker('<feed xmlns="http://www.w3.org/2005/Atom">'), true);
    assert.equal(sniffFeedMarker('<?xml?><rdf:RDF xmlns="...">'), true);
    assert.equal(sniffFeedMarker('{"version":"https://jsonfeed.org/version/1","items":[]}'), true);
  });

  test('HTML 页面不算 feed（200 不等于可用）', () => {
    assert.equal(sniffFeedMarker('<!DOCTYPE html><html><head><title>x</title>'), false);
    assert.equal(sniffFeedMarker(''), false);
    assert.equal(sniffFeedMarker(null), false);
  });

  test('只嗅前 8KB，避免把整篇正文读进内存', () => {
    const padded = 'a'.repeat(9000) + '<rss>';
    assert.equal(sniffFeedMarker(padded), false, '标记在 8KB 之后就不该认——这是刻意的上限');
  });
});

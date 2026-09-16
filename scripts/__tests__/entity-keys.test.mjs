// scripts/__tests__/entity-keys.test.mjs
//
// 覆盖「实体键」与「实体层重收敛」三件事：
//   - deriveHomepageFromFeed：从 feed URL 推断**栏目级**主页（托管站退回完整 URL）
//   - normalizeHomepage：实体键归一化（协议 / www **要**归一，与幂等键策略相反）
//   - reconcileEntities：拆「误合并」、并「误分裂」，且幂等
//
// 为什么值得单独一份测试：2026-09-16 审计实测到 6 处实体层失真，全部出自同一个
// 根因 —— 主页被回落到裸 host（`new URL(feedUrl).origin`）。本文件把该根因的
// **两个相反方向**都锁住：
//     误合并（不同刊物被压成一条渠道，用户看到归属错）
//     误分裂（同一实体被拆成两条卡片，用户看到重复）
// 只测一个方向是不够的 —— 把合并判据放松即可"修好误分裂"，同时引入误合并。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveHomepageFromFeed,
  normalizeHomepage,
  normalizeFeedUrl,
  reconcileEntities,
  mergeIntoRegistry,
  HOSTED_FEED_HOSTS,
  _internal,
} from '../lib/channel-registry.mjs';

const EMPTY = { schemaVersion: '1.0', generatedAt: 'T', channels: [], sources: [] };
const ch = (id, homepage, extra = {}) => ({
  id, name: id, homepage, category: ['other'], enabled: true, displayLimit: 10,
  icon: '?', language: 'zh-CN', weight: 0.5, createdAt: 'T', updatedAt: 'T', ...extra,
});
const src = (id, channelId, url, extra = {}) => ({
  id, channelId, name: id, type: 'rss', url, enabled: true, language: 'zh-CN',
  interval: 30, createdAt: 'T', updatedAt: 'T', ...extra,
});

// ---------------------------------------------------------------------------
// deriveHomepageFromFeed
// ---------------------------------------------------------------------------

describe('deriveHomepageFromFeed — 从 feed URL 推断栏目级主页', () => {
  test('自建站：剥掉尾部 feed 特征段后取首个有区分度的段', () => {
    assert.equal(deriveHomepageFromFeed('https://www.ruanyifeng.com/blog/atom.xml'), 'https://www.ruanyifeng.com/blog');
    assert.equal(deriveHomepageFromFeed('http://www.woshipm.com/category/pmd/feed'), 'http://www.woshipm.com/category');
    assert.equal(deriveHomepageFromFeed('https://blog.csdn.net/ByteDanceTech/rss/list'), 'https://blog.csdn.net/ByteDanceTech');
  });

  test('自建站：路径段全是 feed 特征词 → 退回 host（站主 feed，同站唯一）', () => {
    assert.equal(deriveHomepageFromFeed('https://iao.su/feed'), 'https://iao.su');
    assert.equal(deriveHomepageFromFeed('https://www.solidot.org/index.rss'), 'https://www.solidot.org');
    assert.equal(deriveHomepageFromFeed('https://weekly.pychina.org/feeds/all.atom.xml'), 'https://weekly.pychina.org');
    assert.equal(deriveHomepageFromFeed('https://blog.lilydjwg.me/posts.rss'), 'https://blog.lilydjwg.me');
  });

  test('★ 同栏目下的多条 route 归并到同一主页（否则会碎成多个渠道）', () => {
    const a = deriveHomepageFromFeed('https://rakuen.thec.me/PixivRss/male-20');
    const b = deriveHomepageFromFeed('http://rakuen.thec.me/PixivRss/monthly-20');
    assert.equal(a, 'https://rakuen.thec.me/PixivRss');
    assert.equal(b, 'http://rakuen.thec.me/PixivRss');
    assert.equal(normalizeHomepage(a), normalizeHomepage(b), '两条 route 必须有同一个实体键');
  });

  test('★ feed 托管 / 路由站：路径是订阅标识而非站点栏目 → 完整 URL，绝不压缩', () => {
    const cnbeta = deriveHomepageFromFeed('https://feedx.net/rss/cnbetatop.xml');
    const science = deriveHomepageFromFeed('https://feedx.net/rss/huanqiukexue.xml');
    assert.equal(cnbeta, 'https://feedx.net/rss/cnbetatop.xml');
    assert.notEqual(normalizeHomepage(cnbeta), normalizeHomepage(science), '同一托管站上的两个刊物不得同键');

    assert.notEqual(
      normalizeHomepage(deriveHomepageFromFeed('https://feeds.feedburner.com/bookfere')),
      normalizeHomepage(deriveHomepageFromFeed('https://feeds.feedburner.com/kenengbarss')),
    );

    // RSSHub 是路由站：路径 = 路由名，同样退回完整 URL
    assert.equal(deriveHomepageFromFeed('https://rsshub.app/iplay/xml'), 'https://rsshub.app/iplay/xml');
  });

  test('边界：空 / 非法输入原样返回，不抛错', () => {
    assert.equal(deriveHomepageFromFeed(''), '');
    assert.equal(deriveHomepageFromFeed(null), '');
    assert.equal(deriveHomepageFromFeed('not a url'), 'not a url');
    assert.equal(deriveHomepageFromFeed('/relative/path'), '/relative/path');
  });

  test('托管站清单覆盖已知的 feed 托管 / 路由站', () => {
    for (const h of ['feeds.feedburner.com', 'feedburner.com', 'feedx.net', 'rsshub.app']) {
      assert.ok(HOSTED_FEED_HOSTS.has(h), `清单缺少 ${h}`);
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeHomepage — 实体键
// ---------------------------------------------------------------------------

describe('normalizeHomepage — 实体键的归一化', () => {
  test('协议与 www 归一到同一实体键', () => {
    assert.equal(
      normalizeHomepage('http://rakuen.thec.me/PixivRss'),
      normalizeHomepage('https://rakuen.thec.me/PixivRss'),
    );
    assert.equal(
      normalizeHomepage('https://www.ruanyifeng.com/blog/'),
      normalizeHomepage('https://ruanyifeng.com/blog'),
    );
    assert.equal(normalizeHomepage('https://A.com/X/'), 'a.com/x');
  });

  test('保留有语义的 query 与端口', () => {
    assert.equal(
      normalizeHomepage('https://www.52pojie.cn/forum.php?mod=guide&view=hot'),
      '52pojie.cn/forum.php?mod=guide&view=hot',
    );
    assert.notEqual(normalizeHomepage('http://a.com:8080/x'), normalizeHomepage('http://a.com/x'));
  });

  test('★ 与 normalizeFeedUrl 的策略差异是**有意**的（两个比较键，两种代价）', () => {
    // 幂等键：http→https 是"猜"，猜错就抓错内容 → 不归一
    assert.notEqual(normalizeFeedUrl('http://a.com/feed'), normalizeFeedUrl('https://a.com/feed'));
    // 实体键：协议不同显然是同一个站 → 归一到同键，否则同一实体被拆成两张卡片
    assert.equal(normalizeHomepage('http://a.com/feed'), normalizeHomepage('https://a.com/feed'));
  });

  test('isFeedSegment 双向判定（认得出 feed 文件后缀，也不误伤普通栏目名）', () => {
    const { isFeedSegment } = _internal;
    for (const s of ['feed', 'rss', 'atom', 'index', 'feeds', 'feed.xml', 'index.rss', 'posts.rss', 'all.atom.xml', 'index.json']) {
      assert.ok(isFeedSegment(s), `应判为 feed 段：${s}`);
    }
    for (const s of ['blog', 'category', 'ByteDanceTech', 'PixivRss', 'male-20', 'news', 'forum.php']) {
      assert.ok(!isFeedSegment(s), `不该判为 feed 段：${s}`);
    }
  });
});

// ---------------------------------------------------------------------------
// reconcileEntities
// ---------------------------------------------------------------------------

describe('reconcileEntities — 实体层重收敛', () => {
  test('★ 拆：一条渠道的源跨多个实体键 → 按键切成多条渠道', () => {
    const cfg = {
      channels: [
        ch('feedx', 'https://feedx.net', { name: 'cnBeta', origin: 'garss' }),
        ch('keep', 'https://keep.com', { name: '历史渠道' }),
      ],
      sources: [
        src('feedx-rss', 'feedx', 'https://feedx.net/rss/cnbetatop.xml', { name: 'cnBeta' }),
        src('feedx-rss-2', 'feedx', 'https://feedx.net/rss/huanqiukexue.xml', { name: '环球科学' }),
        src('feedx-rss-3', 'feedx', 'https://feedx.net/rss/photoworld.xml', { name: '摄影世界' }),
        src('keep-rss', 'keep', 'https://keep.com/feed'),
      ],
    };
    const { config: next, report } = reconcileEntities(cfg, { now: 'T2' });

    assert.equal(report.splits.length, 1);
    assert.equal(next.channels.length, 4);
    assert.equal(next.sources.length, 4, '拆分绝不丢源');

    // 主组继承原 id、原主页被改成派生值（保证下次导入能搭同一趟车）
    const primary = next.channels.find((c) => c.id === 'feedx');
    assert.equal(primary.homepage, 'https://feedx.net/rss/cnbetatop.xml');
    assert.deepEqual(
      next.sources.filter((s) => s.channelId === 'feedx').map((s) => s.url),
      ['https://feedx.net/rss/cnbetatop.xml'],
    );

    // 拆出的两条：主页互不相同、名称取自各自的首条源、icon 随名字重取
    const others = next.channels.filter((c) => c.origin === 'garss' && c.id !== 'feedx');
    assert.equal(others.length, 2);
    assert.equal(new Set(others.map((c) => c.homepage)).size, 2, '拆出的渠道主页必须互不相同');
    assert.deepEqual(others.map((c) => c.name).sort(), ['摄影世界', '环球科学']);
    assert.deepEqual(others.map((c) => c.icon).sort(), ['摄', '环']);
    // 继承原渠道开关：拆分不增加采集请求，也不该让用户丢内容
    assert.ok(others.every((c) => c.enabled === true));

    // 历史渠道完全不受影响
    assert.deepEqual(next.channels.find((c) => c.id === 'keep'), cfg.channels[1]);
  });

  test('★ 并：同一实体被协议拆成两条渠道 → 合成一条（两条真源都留）', () => {
    const cfg = {
      channels: [
        ch('rakuen', 'https://rakuen.thec.me', { name: 'Pixiv', origin: 'garss' }),
        ch('rakuen-2', 'http://rakuen.thec.me', { name: 'Pixiv', origin: 'garss' }),
      ],
      sources: [
        src('r-1', 'rakuen', 'https://rakuen.thec.me/PixivRss/male-20'),
        src('r-2', 'rakuen-2', 'http://rakuen.thec.me/PixivRss/daily-20'),
      ],
    };
    const { config: next, report } = reconcileEntities(cfg, { now: 'T2' });

    assert.equal(next.channels.length, 1);
    assert.equal(next.channels[0].id, 'rakuen', '保留更早出现的那条');
    assert.equal(report.merges.length, 1);
    assert.equal(report.merges[0].into, 'rakuen');
    assert.equal(next.sources.length, 2, '两条是不同 route，都该保留');
    assert.ok(next.sources.every((s) => s.channelId === 'rakuen'));
  });

  test('★ 并时丢弃「目标已有同内容」的源 —— 不重复请求同一个渠道', () => {
    const cfg = {
      channels: [
        ch('blog', 'https://www.ruanyifeng.com/blog/', { name: '阮一峰的网络日志' }),
        ch('blog2', 'http://www.ruanyifeng.com', { name: '阮一峰的网络日志', origin: 'garss' }),
      ],
      sources: [
        src('blog-atom', 'blog', 'https://www.ruanyifeng.com/blog/atom.xml'),
        src('blog2-atom', 'blog2', 'http://www.ruanyifeng.com/blog/atom.xml'),
      ],
    };
    const { config: next, report } = reconcileEntities(cfg, { now: 'T2' });

    assert.equal(next.channels.length, 1);
    assert.equal(next.sources.length, 1, 'http 变体与 https 同内容 → 丢弃冗余');
    assert.equal(next.sources[0].id, 'blog-atom');
    assert.equal(report.droppedSources.length, 1);
    assert.equal(report.droppedSources[0].reason, 'same-content-as-target');
  });

  test('★ scope 默认 garss：历史渠道的"多栏目"结构不被动刀', () => {
    // v2ex 的两条源实体键不同（v2ex.com/feed/tab vs v2ex.com），
    // 但它是人工配的一条渠道，默认 scope 下不该被拆
    const cfg = {
      channels: [ch('v2ex', 'https://www.v2ex.com/', { name: 'V2EX' })],
      sources: [
        src('v2ex-hot', 'v2ex', 'https://www.v2ex.com/feed/tab/hot.xml'),
        src('v2ex-rss', 'v2ex', 'https://www.v2ex.com/index.xml'),
      ],
    };
    const dflt = reconcileEntities(cfg, { now: 'T2' });
    assert.equal(dflt.report.splits.length, 0);
    assert.equal(dflt.config, cfg, '无变更时原样返回入参');
    assert.equal(dflt.config.channels.length, 1);

    // 显式 scope=all 时才动手
    const all = reconcileEntities(cfg, { now: 'T2', scope: 'all' });
    assert.equal(all.report.splits.length, 1);
    assert.equal(all.config.channels.length, 2);
  });

  test('★ 幂等：第二趟无可拆、无可并，且原样返回入参', () => {
    const cfg = {
      channels: [
        ch('feedx', 'https://feedx.net', { name: 'cnBeta', origin: 'garss' }),
        ch('rakuen', 'https://rakuen.thec.me', { name: 'Pixiv', origin: 'garss' }),
        ch('rakuen-2', 'http://rakuen.thec.me', { name: 'Pixiv', origin: 'garss' }),
      ],
      sources: [
        src('f-1', 'feedx', 'https://feedx.net/rss/cnbetatop.xml', { name: 'cnBeta' }),
        src('f-2', 'feedx', 'https://feedx.net/rss/huanqiukexue.xml', { name: '环球科学' }),
        src('r-1', 'rakuen', 'https://rakuen.thec.me/PixivRss/male-20'),
        src('r-2', 'rakuen-2', 'http://rakuen.thec.me/PixivRss/daily-20'),
      ],
    };
    const first = reconcileEntities(cfg, { now: 'T2' });
    assert.ok(first.report.splits.length > 0 && first.report.merges.length > 0);

    const second = reconcileEntities(first.config, { now: 'T3' });
    assert.equal(second.report.splits.length, 0);
    assert.equal(second.report.merges.length, 0);
    assert.equal(second.report.droppedSources.length, 0);
    // 无变更时必须把**入参本身**返回（而不是一份等价副本），
    // 这样「第二趟逐字节相同」才是结构上成立的，而不是靠 luck
    assert.equal(second.config, first.config);
  });

  test('★ 收敛后不变式：无重复 id / 无孤儿源 / 无空壳渠道 / 无重复 URL', () => {
    const cfg = {
      channels: [
        ch('feedx', 'https://feedx.net', { name: 'cnBeta', origin: 'garss' }),
        ch('rakuen', 'https://rakuen.thec.me', { name: 'Pixiv', origin: 'garss' }),
        ch('rakuen-2', 'http://rakuen.thec.me', { name: 'Pixiv', origin: 'garss' }),
        ch('blog', 'https://www.ruanyifeng.com/blog/', { name: '阮一峰' }),
        ch('blog2', 'http://www.ruanyifeng.com', { name: '阮一峰', origin: 'garss' }),
      ],
      sources: [
        src('f-1', 'feedx', 'https://feedx.net/rss/cnbetatop.xml'),
        src('f-2', 'feedx', 'https://feedx.net/rss/huanqiukexue.xml'),
        src('r-1', 'rakuen', 'https://rakuen.thec.me/PixivRss/male-20'),
        src('r-2', 'rakuen-2', 'http://rakuen.thec.me/PixivRss/daily-20'),
        src('b-1', 'blog', 'https://www.ruanyifeng.com/blog/atom.xml'),
        src('b-2', 'blog2', 'http://www.ruanyifeng.com/blog/atom.xml'),
      ],
    };
    const { config: next } = reconcileEntities(cfg, { now: 'T2' });

    const ids = next.channels.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, '渠道 id 不得重复');
    const sids = next.sources.map((s) => s.id);
    assert.equal(new Set(sids).size, sids.length, '源 id 不得重复');
    assert.ok(next.sources.every((s) => ids.includes(s.channelId)), '不得有孤儿源');
    assert.ok(next.channels.every((c) => next.sources.some((s) => s.channelId === c.id)), '不得有空壳渠道');
    const urls = next.sources.map((s) => s.url);
    assert.equal(new Set(urls).size, urls.length, '同 config 内不得有两条完全相同的 URL');
  });

  test('★ 闭环：收敛后的 config 再走一次导入是 no-op（与幂等键咬合）', () => {
    const cfg = {
      channels: [ch('feedx', 'https://feedx.net', { name: 'cnBeta', origin: 'garss' })],
      sources: [
        src('f-1', 'feedx', 'https://feedx.net/rss/cnbetatop.xml', { name: 'cnBeta' }),
        src('f-2', 'feedx', 'https://feedx.net/rss/huanqiukexue.xml', { name: '环球科学' }),
      ],
    };
    const { config: canon } = reconcileEntities(cfg, { now: 'T2' });
    // 把收敛后的源当作"重新导入"的输入（homepage 取所属渠道的）
    const incoming = canon.sources.map((s) => ({
      name: s.name,
      feedUrl: s.url,
      homepage: canon.channels.find((c) => c.id === s.channelId)?.homepage,
      origin: 'garss',
    }));
    const r = mergeIntoRegistry(canon, incoming, { now: 'T2', enabledCount: 0 });
    assert.equal(r.report.addedChannels.length, 0, '收敛后重复导入不该新建渠道');
    assert.equal(r.report.addedSources.length, 0, '收敛后重复导入不该新建源');
    assert.ok(r.report.skipped.every((s) => s.reason === 'duplicate-feed-url'));
  });
});

// ---------------------------------------------------------------------------
// mergeIntoRegistry 的兜底 —— 反向锁（防"修过度"）
// ---------------------------------------------------------------------------

describe('mergeIntoRegistry 的主页兜底', () => {
  test('★ 托管站上的两条订阅 → 必须是两条渠道（旧实现会合成一条）', () => {
    const r = mergeIntoRegistry(EMPTY, [
      { name: 'cnBeta', feedUrl: 'https://feedx.net/rss/cnbetatop.xml' },
      { name: '环球科学', feedUrl: 'https://feedx.net/rss/huanqiukexue.xml' },
    ], { now: 'T', enabledCount: 0 });
    assert.equal(r.report.addedChannels.length, 2);
    assert.equal(new Set(r.config.channels.map((c) => c.homepage)).size, 2);
  });

  test('★ 自建站同一栏目（仅协议不同）→ 必须是一条渠道（旧实现会拆成两条）', () => {
    const r = mergeIntoRegistry(EMPTY, [
      { name: 'Pixiv male', feedUrl: 'https://rakuen.thec.me/PixivRss/male-20' },
      { name: 'Pixiv daily', feedUrl: 'http://rakuen.thec.me/PixivRss/daily-20' },
    ], { now: 'T', enabledCount: 0 });
    assert.equal(r.report.addedChannels.length, 1);
    assert.equal(r.config.sources.length, 2, '两条 feed 都该保留');
  });
});

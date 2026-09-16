// scripts/lib/channel-registry.mjs — 渠道注册表的**单一事实源**语义与幂等内核
//
// ── 这份文件为什么存在 ────────────────────────────────────────────────────
//
// 主理人 2026-09-16 拍板的原话：
//   「只需要做好最终一致性，即需要在项目中维护最终的一版实际使用的 rss 数据，
//     所有其他渠道 + 导入的都要最终落到这里，一定做好一致性和重复问题的处理，
//     不要重复请求同一个渠道获取 rss 信息。」
//
// 这句话被翻译成三条**可执行的契约**，本模块是它们的唯一实现处：
//
//   ① **SSOT**：`config/sources.json` 是唯一权威。任何外部清单（garss / 飞书 /
//      OPML / 手工录入）都只是「输入」，最终必须收敛到它。禁止在别处维护第二份
//      生效中的渠道清单 —— 一旦有两份，就必然漂移。
//
//   ② **幂等键 = 归一化后的 feed URL**，不是 id、不是名称。理由：「不要重复请求
//      同一个渠道」的充要条件就是 URL 唯一。id 可以不同、名称可以改，但凡两个
//      source 指向同一 URL，就是同一份重复请求。
//
//   ③ **合并幂等**：同一份输入跑 N 次，结果与跑 1 次逐字节一致。这是导入管线敢被
//      反复执行、失败能直接重跑的前提。
//
// ── 边界 ─────────────────────────────────────────────────────────────────
//
// 本模块**只做纯函数**（零 IO、零网络），便于单测与在任意上下文复用。
// 落盘、健康检查、分类映射等有副作用的事由调用方（import-channels.mjs /
// export-channels.mjs / sync-sources.mjs）负责。

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// 一、feed URL 归一化（幂等键的构造）
// ---------------------------------------------------------------------------

/**
 * 归一化时要剥掉的跟踪参数。
 *
 * 只列**明确无副作用**的营销/统计参数。刻意保持克制：
 * feed 地址的 query 常常是有语义的（如 `forum.php?mod=guide&view=hot&rss=1`），
 * 误删会导致抓错内容 —— 而「漏合并」只是少一次去重，代价小得多。
 */
const FEED_TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name',
  'fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid', 'yclid', '_ga', '_gl', '_hsenc', '_hsmi',
  'spm', 'share_source', 'share_medium', 'share_token', 'weibo_id',
]);

/**
 * feed URL 归一化 —— 幂等键的基础。
 *
 * 规则（刻意**保守**）：
 *   - protocol / host 转小写
 *   - 去 fragment
 *   - 去默认端口（:80 / :443）
 *   - 剥离已知跟踪参数，其余 query 按 key 字典序重排
 *     （保证 `?a=1&b=2` 与 `?b=2&a=1` 落在同一个键上）
 *   - 去尾斜杠（path 长度 > 1 时）
 *
 * **刻意不做**的两件事：
 *   - 不去 `www.`：`example.com/feed` 与 `www.example.com/feed` 可能是两个不同的
 *     站点（也可能是同一个），无法在不发请求的前提下判定。宁可漏合并。
 *   - 不把 `http:` 改写成 `https:`：改写可能直接 404（很多老站只有 http），
 *     而这是「猜」，不是「归一」。
 *
 * 非绝对 URL（本地文件路径、相对路径）原样返回 —— 它们不参与 URL 去重。
 *
 * @param {string} input
 * @returns {string} 归一化后的 URL；非法/空输入返回空串
 */
export function normalizeFeedUrl(input) {
  if (!input || typeof input !== 'string') return '';
  const raw = input.trim();
  if (!raw) return '';

  let u;
  try {
    u = new URL(raw);
  } catch {
    return raw; // 非绝对 URL：原样保留，交由调用方判定
  }

  try {
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    if (
      (u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')
    ) {
      u.port = '';
    }
    u.hash = '';

    const params = Array.from(u.searchParams.entries()).filter(([k]) => {
      const lower = k.toLowerCase();
      return !FEED_TRACKING_PARAMS.has(lower) && !lower.startsWith('utm_');
    });
    params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    u.search = '';
    for (const [k, v] of params) u.searchParams.append(k, v);

    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }

    let out = u.toString();
    if (out.endsWith('?')) out = out.slice(0, -1);
    return out;
  } catch {
    return raw;
  }
}

/**
 * 幂等键：归一化 feed URL 的哈希。
 *
 * 用哈希而非裸 URL 做 Map 键，是为了让日志/报告里的键长度可控（URL 可长达数百字符），
 * 同时保留可比较性。需要人读的场合请直接用 `normalizeFeedUrl()`。
 *
 * @param {string} url
 * @returns {string} 16 位十六进制；非法输入返回 `''`
 */
export function feedKey(url) {
  const n = normalizeFeedUrl(url);
  if (!n) return '';
  return createHash('sha256').update(n).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// 二、id 派生（从 sync-sources.mjs 收敛而来，全仓唯一实现）
// ---------------------------------------------------------------------------

/** channel / source id 的合法形状（与 docs/data-model/schema/sources.schema.json 一致） */
export const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** 通用 feed 词停用表：path 段若是这些则不参与 id 派生（无区分度） */
const FEED_STOPWORDS = new Set([
  'feed', 'rss', 'atom', 'index', 'feeds',
  'feed.xml', 'rss.xml', 'atom.xml', 'index.html',
]);

/** 取 URL 的 host（含端口）；失败则原样返回。导出以便各调用方共用同一实现 */
export function hostOf(u) {
  try {
    return new URL(u).host;
  } catch {
    return String(u || '');
  }
}

function pathSegmentsOf(u) {
  try {
    return new URL(u).pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 一·五、从 feed URL 推断「渠道主页」（实体键的构造）
// ---------------------------------------------------------------------------
//
// ── 为什么需要这一层 ────────────────────────────────────────────────────
//
// `garssInfo.json` 只有 5 个字段：sourceId / category / title / description /
// xmlUrl。**它不提供 homepage**。所以导入时的渠道主页只能从 feed URL 推断。
// 实测：182 个 garss 渠道的主页 100% 等于「协议://主机」的裸 host —— 因为
// 原实现直接用了 `new URL(feedUrl).origin`，把路径整个丢掉了。
//
// 丢掉路径的代价是**方向相反的两类错**（2026-09-16 审计实测）：
//
//   误合并 —— `feedx.net/rss/cnbetatop.xml`、`.../huanqiukexue.xml`、
//     `.../photoworld.xml` 都是「`feedx.net`」→ 三个**不同刊物**（cnBeta /
//     环球科学 / 摄影世界）被塞进一条名叫「cnBeta」的渠道，且已开闸上线。
//     同理 `feeds.feedburner.com` 把「书伴」和「可能吧」混在一起。
//
//   误分裂 —— `https://rakuen.thec.me/PixivRss/male-20` 与
//     `http://rakuen.thec.me/PixivRss/daily-20` 因**协议不同**被判成两个渠道，
//     前端出现两张同名卡片；`ruanyifeng` 与 `ruanyifeng-blog` 是同一个 feed
//     的 http / https 两种写法，也各占一个渠道。
//
// ── 判据 ────────────────────────────────────────────────────────────────
//
// 大部分站点：feed 挂在**栏目路径**下（`/blog/atom.xml`、`/category/pmd/feed`、
// `/ByteDanceTech/rss/list`），把「尾部 feed 特征段」剥掉后剩下的**第一段**
// 就是该 feed 所属的栏目 —— 同一栏目的多条 feed 共用一个渠道，这是对的。
//
// 但有一类站点，**路径段是「订阅标识」而不是「站点栏目」**：feed 托管站
// （feedburner / feedx）、播客托管站、RSS 路由站（rsshub）。
// `feeds.feedburner.com/bookfere` 与 `.../kenengbarss` 路径不同，却是**两个
// 毫不相干的刊物**；`feedx.net/rss/*.xml` 同理。对它们必须**退回完整 URL**
// 作为实体键，否则就是误合并。
//
// 关键点：**这两类无法从 URL 表面区分**。`feedx.net` 长得和普通站点一样。
// 所以清单是**人工维护的领域知识**，不是可以推导出来的东西。宁可清单不全
// （漏了只是"没拆开"，用户看到的是一条内容混杂的卡片）也不要乱猜 ——
// 猜错会把本应分开的实体合掉。清单可随实测逐步扩充。
//
// ── 与 normalizeFeedUrl 的分工 ──────────────────────────────────────────
//
// `normalizeFeedUrl` 是**幂等键**，刻意不归一协议、不去 www（见其注释）。
// 本节的产物是**实体键**，判的是「是不是同一个渠道」，语义不同，因此
// `normalizeHomepage` 反而**要**把协议与 www 归掉 —— 两个比较键职责不同，
// 不该共用一套保守策略。

/** feed 文件后缀 —— 这类路径段不表示站点栏目结构 */
const FEED_FILE_EXT_RE = /\.(rss|xml|atom|json|rdf|rss2)$/i;

/** 路径段是否为「feed 特征段」（无区分度，不参与栏目推断） */
function isFeedSegment(seg) {
  const s = String(seg).toLowerCase();
  return FEED_STOPWORDS.has(s) || FEED_FILE_EXT_RE.test(s);
}

/**
 * 路径**不表示站点栏目结构**的域名清单（人工维护，可扩充）。
 *
 * 命中即退回完整 URL 作为实体键：同站多条 feed 视为**各自独立的渠道**。
 * 反例见本节注释：feedx.net 的三个不同刊物、feedburner 的两个不同站点。
 */
export const HOSTED_FEED_HOSTS = new Set([
  // 通用 feed 托管 / 中转
  'feedburner.com',
  'feeds.feedburner.com',
  'feedproxy.google.com',
  'feedblitz.com',
  'feeds.feedblitz.com',
  'feedx.net',
  // 播客托管
  'anchor.fm',
  'libsyn.com',
  'buzzsprout.com',
  'podbean.com',
  'simplecast.com',
  'feeds.simplecast.com',
  'megaphone.fm',
  'redcircle.com',
  'transistor.fm',
  'fireside.fm',
  'blubrry.com',
  // RSS 路由（路径 = 路由名，不是站点栏目）
  'rsshub.app',
]);

/**
 * 从 feed URL 推断渠道主页 —— 导入时 `homepage` 缺省的**唯一**兜底处。
 *
 * 规则（顺序即优先级）：
 *   1. 命中 `HOSTED_FEED_HOSTS` → 返回 `origin + path`（完整 URL，保留区分度）
 *   2. 去掉尾部 feed 特征段后，取**首个**非 feed 段作为栏目 → `origin + /首段`
 *   3. 全部路径段都是 feed 特征段 → 返回 `origin`（站主 feed，同站唯一）
 *
 * 第 2 步只取首段、**不继续往后取**，是为了让同栏目下的多条 route 归并：
 * `rakuen.thec.me/PixivRss/{male,female,daily,monthly}-20` 全部落到
 * `rakuen.thec.me/PixivRss`。若取全路径，它们会碎成四个渠道。
 *
 * @param {string} feedUrl
 * @returns {string} 绝对 URL；无法解析时原样返回入参
 */
export function deriveHomepageFromFeed(feedUrl) {
  const raw = String(feedUrl || '').trim();
  if (!raw) return '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  const bare = u.hostname.toLowerCase().replace(/^www\./, '');
  if (HOSTED_FEED_HOSTS.has(bare)) {
    return (u.origin + u.pathname).replace(/\/+$/, '') || u.origin;
  }
  const segs = u.pathname.split('/').filter(Boolean);
  const first = segs.findIndex((s) => !isFeedSegment(s));
  if (first < 0) return u.origin;
  return `${u.origin}/${segs.slice(0, first + 1).join('/')}`;
}

/**
 * 由 homepage（网站地址）派生 channel id。
 *
 *   - 取 host：小写、去 `www.` 前缀、剥掉最后一个 label（TLD）
 *     —— 这是 rss-radar 现有约定（`appinn.com` → `appinn`）
 *   - 取 path 中**第一个有区分度的段**拼到 host 之后（区分「同域挂多博主」场景，
 *     如 `blog.csdn.net/ByteDanceTech`）。「有区分度」= 非空、不在 FEED_STOPWORDS、
 *     且非纯数字/纯符号段
 *   - 非字母数字 → `-`，折叠连续 `-`，转小写，去首尾 `-`，长度兜底 ≥ 2
 *   - 必须匹配 `ID_RE`；不合法直接抛错（防回归护栏）
 *
 * @param {string} homepage
 * @returns {string}
 */
export function deriveChannelId(homepage) {
  let host = hostOf(homepage) || String(homepage || '');
  host = host.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  const lastDot = host.lastIndexOf('.');
  if (lastDot > 0) host = host.slice(0, lastDot);
  let base = host.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  for (const seg of pathSegmentsOf(homepage)) {
    const raw = String(seg).toLowerCase();
    if (!raw || FEED_STOPWORDS.has(raw)) continue;
    const cleaned = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!cleaned) continue;
    if (/^[0-9-]+$/.test(cleaned)) continue;
    base = `${base}-${cleaned}`;
    break;
  }

  let id = base.toLowerCase().replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (id.length < 2) id = (id + 'xx').slice(0, Math.max(id.length, 2));

  if (!ID_RE.test(id)) {
    throw new Error(`deriveChannelId: 派生 id 非法 "${id}"（来自 homepage=${homepage}）`);
  }
  return id;
}

/**
 * 在已占用集合里取一个空闲 id（冲突则追加 `-2` / `-3` …），并**登记占用**。
 *
 * 幂等性由「同输入 + 同已占用集合 ⇒ 同输出」保证；调用方必须按输入顺序串行调用。
 *
 * @param {string} base
 * @param {Set<string>} taken 会被就地修改
 * @returns {string}
 */
export function freeId(base, taken) {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  const id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/**
 * 解析外部清单里的「标签」列。
 *
 * 该列格式历史上不统一：可能是 JSON 数组（`["Mac","软件下载"]`），
 * 也可能是 Python repr 单引号（`['Mac', '软件下载']`），还可能已是数组。
 * 解析不出/空 → 返回 null（调用方据此「只有非空才写入 tags」）。
 *
 * @param {unknown} raw
 * @returns {string[]|null}
 */
export function parseTags(raw) {
  if (Array.isArray(raw)) {
    const arr = raw.map((x) => String(x).trim()).filter(Boolean);
    return arr.length ? arr : null;
  }
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      const arr = parsed.map((x) => String(x).trim()).filter(Boolean);
      return arr.length ? arr : null;
    }
  } catch {
    /* 非 JSON，往下走 */
  }

  const m = s.match(/['"]([^'"]+)['"]/g);
  if (m) {
    const arr = m.map((tok) => tok.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean);
    return arr.length ? arr : null;
  }
  return null;
}

/**
 * homepage 归一化 —— **仅用于「是否同一个渠道」的判定**（实体键）。
 *
 * 规则：去协议（http / https 视为同一实体）、去 `www.`、去尾斜杠、小写。
 * 保留端口与 query（少数站点靠它们区分）。
 *
 * 为什么这里**要**归一协议，而 `normalizeFeedUrl` **不要**？（见文件头分隔说明）
 *   - `normalizeFeedUrl` 判的是「同一份请求」——把 http 改写成 https 可能直接
 *     404，是「猜」，猜错的代价是**抓错内容**。
 *   - 本函数判的是「同一个内容主体」——`http://rakuen.thec.me/PixivRss` 与
 *     `https://rakuen.thec.me/PixivRss` 显然是同一个站。不归一的代价是
 *     **同一实体被拆成两张卡片**（实测：rakuen-thec / rakuen-thec-2）。
 * 代价不对称，所以策略相反。
 */
export function normalizeHomepage(u) {
  if (!u || typeof u !== 'string') return '';
  const loose = (s) => String(s).trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  try {
    const x = new URL(u.trim());
    const host = x.host.toLowerCase().replace(/^www\./, '');
    return `${host}${x.pathname}${x.search || ''}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return loose(u);
  }
}

// ---------------------------------------------------------------------------
// 三、一致性审计
// ---------------------------------------------------------------------------

/**
 * 审计 `config/sources.json` 的一致性，产出可机读的问题清单。
 *
 * 覆盖 6 类问题：
 *   1. `duplicateChannelIds`  同一 channel.id 出现多次
 *   2. `duplicateSourceIds`   同一 source.id 出现多次
 *   3. `duplicateFeedUrls`    **多个 source 指向同一归一化 URL**
 *      —— 这就是「重复请求同一个渠道」，是审计里最要紧的一项
 *   4. `orphanSources`        source.channelId 指向不存在的 channel
 *   5. `emptyChannels`        没有任何 source 的 channel（采集永远为空）
 *   6. `invalidIds`           id 不符合 ID_RE
 *
 * @param {{channels?: Array, sources?: Array}} config
 * @returns {{ok: boolean, counts: Object, problems: Object}}
 */
export function auditRegistry(config) {
  const channels = Array.isArray(config?.channels) ? config.channels : [];
  const sources = Array.isArray(config?.sources) ? config.sources : [];

  const channelIdSeen = new Map();
  const sourceIdSeen = new Map();
  const feedSeen = new Map();
  const invalidIds = [];

  for (const c of channels) {
    const id = c?.id;
    if (id) channelIdSeen.set(id, (channelIdSeen.get(id) ?? 0) + 1);
    if (!id || !ID_RE.test(String(id))) invalidIds.push({ kind: 'channel', id: String(id ?? ''), name: c?.name });
  }
  for (const s of sources) {
    const id = s?.id;
    if (id) sourceIdSeen.set(id, (sourceIdSeen.get(id) ?? 0) + 1);
    if (!id || !ID_RE.test(String(id))) invalidIds.push({ kind: 'source', id: String(id ?? ''), url: s?.url });
    const n = normalizeFeedUrl(s?.url);
    if (n) {
      if (!feedSeen.has(n)) feedSeen.set(n, []);
      feedSeen.get(n).push(String(s?.id ?? ''));
    }
  }

  const channelIds = new Set(channels.map((c) => c?.id).filter(Boolean));
  const channelsWithSource = new Set(sources.map((s) => s?.channelId).filter(Boolean));

  const problems = {
    duplicateChannelIds: [...channelIdSeen.entries()].filter(([, n]) => n > 1).map(([id, n]) => ({ id, count: n })),
    duplicateSourceIds: [...sourceIdSeen.entries()].filter(([, n]) => n > 1).map(([id, n]) => ({ id, count: n })),
    duplicateFeedUrls: [...feedSeen.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([feedUrl, ids]) => ({ feedUrl, sourceIds: ids })),
    orphanSources: sources
      .filter((s) => s?.channelId && !channelIds.has(s.channelId))
      .map((s) => ({ sourceId: s.id, channelId: s.channelId })),
    emptyChannels: channels
      .filter((c) => c?.id && !channelsWithSource.has(c.id))
      .map((c) => ({ channelId: c.id, name: c.name })),
    invalidIds,
  };

  const ok = Object.values(problems).every((arr) => arr.length === 0);

  return {
    ok,
    counts: {
      channels: channels.length,
      sources: sources.length,
      uniqueFeedUrls: feedSeen.size,
      enabledChannels: channels.filter((c) => c?.enabled !== false).length,
      enabledSources: sources.filter((s) => s?.enabled !== false).length,
    },
    problems,
  };
}

// ---------------------------------------------------------------------------
// 四、幂等合并（导入管线的落点）
// ---------------------------------------------------------------------------

/** source.lastStatus 的合法取值（与 sources.schema.json 的 enum 逐字一致） */
const LAST_STATUS = new Set(['ok', 'moved', 'blocked', 'dead', 'pendingDead', 'unknown']);

/**
 * @typedef {Object} IncomingChannel
 * @property {string}   name            渠道名
 * @property {string}   feedUrl         feed 地址（幂等键来源，必填）
 * @property {string}   [homepage]      网站地址（缺省由 feedUrl 的 origin 兜底）
 * @property {string[]} [category]      受控 CategoryKey[]
 * @property {string[]} [tags]          自由标签（承接外部清单的原始分类）
 * @property {string}   [description]
 * @property {string}   [language]
 * @property {number}   [weight]
 * @property {string}   [origin]        'garss' | 'feishu' | 'manual' | …
 * @property {string}   [originRef]     外部系统里的 id
 * @property {string}   [importBatch]   导入批次，如 'garss-2026-04'
 * @property {string}   [feedType]      'rss' | 'atom'，缺省按 URL 后缀猜
 * @property {Object}   [preset]        恢复备份用：还原派生字段（**仅新建时生效**）
 * @property {string}   [preset.id]         指定 channel id（须过 ID_RE）
 * @property {string}   [preset.sourceId]   指定 source id（须过 ID_RE）
 * @property {string}   [preset.name]       source 显示名
 * @property {string}   [preset.icon]
 * @property {number}   [preset.weight]
 * @property {number}   [preset.displayLimit]
 * @property {number}   [preset.interval]
 * @property {boolean}  [preset.enabled]    还原**渠道**开/关（覆盖 enabledCount 的放量判定）
 * @property {string}   [preset.language]
 * @property {string}   [preset.importBatch] 还原渠道的导入批次
 * @property {boolean}  [preset.sourceEnabled]    还原**单条 source** 的开关（独立于渠道）
 * @property {string}   [preset.sourceOrigin]     源级溯源（可与渠道级不同）
 * @property {string}   [preset.sourceOriginRef]
 * @property {string}   [preset.sourceImportBatch]
 * @property {string}   [preset.lastStatus]  还原健康状态（须在 schema enum 内）
 * @property {string}   [preset.lastFetchAt]
 * @property {string}   [preset.lastError]
 */

/**
 * 把外部渠道批量**幂等**并入注册表。
 *
 * 语义要点（这四条共同构成「最终一致性」）：
 *   1. **只增不改**：已存在的 channel / source 一律不动（人改过的字段不会被覆盖）。
 *      重跑同一份输入 ⇒ 全部落进 `skipped`，结果逐字节不变。
 *   2. **URL 唯一**：并入前先按归一化 feed URL 判重，同 URL 直接跳过。
 *   3. **顺序稳定**：已有条目保持原顺序，新增按输入顺序追加。
 *   4. **不修改入参**：返回新对象，便于 dry-run 与回滚。
 *
 * `enabledCount` 用于「全量导入但先只开 N 个」的放量策略：只对**本次新增**的渠道
 * 计数，第 N+1 个起落 `enabled: false`（连同其 source）。已存在的渠道不受影响。
 *
 * @param {{channels?: Array, sources?: Array, schemaVersion?: string, generatedAt?: string}} config 现有注册表
 * @param {IncomingChannel[]} incoming
 * @param {Object} [options]
 * @param {string} [options.now]           生成时间（ISO UTC）。固定它可让幂等断言可复现。
 * @param {string} [options.batch]         导入批次名 → 写入 `importBatch`
 * @param {number} [options.enabledCount]  本次新增里前 N 个启用（缺省 0 = 全部停用）
 * @param {string} [options.defaultCategory='other']
 * @param {number} [options.displayLimit=10]
 * @param {number} [options.weight=0.5]
 * @param {string} [options.language='zh-CN']
 * @returns {{config: Object, report: {addedChannels: string[], addedSources: string[], skipped: Array, enabledNew: number}}}
 */
export function mergeIntoRegistry(config, incoming, options = {}) {
  const now = options.now || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const batch = options.batch;
  const defaultCategory = options.defaultCategory || 'other';
  const enabledCount = Number.isInteger(options.enabledCount) && options.enabledCount > 0
    ? options.enabledCount
    : 0;
  const displayLimit = options.displayLimit ?? 10;
  const defaultWeight = options.weight ?? 0.5;
  const defaultLanguage = options.language ?? 'zh-CN';

  const channels = Array.isArray(config?.channels) ? config.channels.slice() : [];
  const sources = Array.isArray(config?.sources) ? config.sources.slice() : [];

  // ---- 索引：URL 幂等键 / homepage / id 占用 ----
  const feedIndex = new Map(); // 归一化 URL → 已有 source（取首个）
  for (const s of sources) {
    const n = normalizeFeedUrl(s?.url);
    if (n && !feedIndex.has(n)) feedIndex.set(n, s);
  }
  const homepageIndex = new Map();
  for (const c of channels) {
    const h = normalizeHomepage(c?.homepage);
    if (h && !homepageIndex.has(h)) homepageIndex.set(h, c);
  }
  const takenChannelIds = new Set(channels.map((c) => c?.id).filter(Boolean));
  const takenSourceIds = new Set(sources.map((s) => s?.id).filter(Boolean));

  const addedChannels = [];
  const addedSources = [];
  const skipped = [];
  let newCount = 0;

  for (const item of Array.isArray(incoming) ? incoming : []) {
    const feedUrl = item?.feedUrl;
    if (!feedUrl || typeof feedUrl !== 'string') {
      skipped.push({ name: item?.name ?? '', reason: 'missing-feed-url' });
      continue;
    }

    // ① URL 唯一性：同归一化 URL 已存在 → 跳过。
    //    这是「不要重复请求同一个渠道」在**注册表层**的落点；
    //    采集层的同 URL 只抓一次见 scripts/collect/main.mjs。
    const norm = normalizeFeedUrl(feedUrl);
    if (feedIndex.has(norm)) {
      skipped.push({
        name: item.name ?? '',
        feedUrl,
        normalizedFeedUrl: norm,
        reason: 'duplicate-feed-url',
        existingSourceId: feedIndex.get(norm)?.id,
      });
      continue;
    }

    // 主页兜底：从 feed URL 推断栏目级主页，而不是原来的 `originOf(feedUrl)`。
    // 原兜底会丢掉整个路径，把同站的不同栏目 / 托管站的不同刊物压成一条渠道
    // （实测：feedx 三刊合一、feedburner 两站合一）。详见 deriveHomepageFromFeed。
    const homepage = item.homepage || deriveHomepageFromFeed(feedUrl) || feedUrl;

    // 预置字段：**恢复备份**（回灌本仓库的注册表导出）时用来还原 id / 权重 / 开关。
    // 只在**新建**条目时生效，已存在的条目一律不动 —— 所以它不破坏「只增不改」。
    // 不传 preset 时行为与从前完全一致。
    const preset = (item.preset && typeof item.preset === 'object') ? item.preset : {};

    // ② 同 homepage 复用已有 channel（一个渠道可挂多个 feed）
    const existingChannel = homepageIndex.get(normalizeHomepage(homepage));
    let channelId;
    if (existingChannel) {
      channelId = existingChannel.id;
    } else {
      let base;
      try {
        base = deriveChannelId(homepage);
      } catch {
        // 派生失败（homepage 极端畸形）→ 用 feed host 的净化形式兜底
        base = `ch-${feedKey(feedUrl).slice(0, 8)}`;
      }
      // 预置 id 优先，但必须过 ID_RE —— 不能让一份脏导出把非法 id 灌进注册表
      if (preset.id && ID_RE.test(String(preset.id))) base = String(preset.id);
      channelId = freeId(base, takenChannelIds);
    }

    // ③ 放量：只对本次新增计数
    newCount += 1;
    const enabled = newCount <= enabledCount;

    if (!existingChannel) {
      const channel = {
        id: channelId,
        name: String(item.name || hostOf(homepage) || channelId),
        homepage,
        category: Array.isArray(item.category) && item.category.length > 0
          ? item.category.slice()
          : [defaultCategory],
        enabled: typeof preset.enabled === 'boolean' ? preset.enabled : enabled,
        displayLimit: Number.isInteger(preset.displayLimit) ? preset.displayLimit : displayLimit,
        icon: String(preset.icon || String(item.name || channelId).trim().charAt(0) || '?'),
        language: preset.language || item.language || defaultLanguage,
        weight: typeof preset.weight === 'number'
          ? preset.weight
          : (typeof item.weight === 'number' ? item.weight : defaultWeight),
        createdAt: now,
        updatedAt: now,
      };
      if (Array.isArray(item.tags) && item.tags.length > 0) channel.tags = item.tags.slice();
      if (item.description) channel.description = String(item.description);
      // 溯源字段（可选，不破坏既有 32 条）：让「重跑导入只覆盖我生成的」成为可能
      if (item.origin) channel.origin = item.origin;
      if (item.originRef) channel.originRef = String(item.originRef);
      if (preset.importBatch) channel.importBatch = String(preset.importBatch);
      else if (batch) channel.importBatch = batch;

      channels.push(channel);
      homepageIndex.set(normalizeHomepage(homepage), channel);
      addedChannels.push(channelId);
    }

    const source = {
      id: freeId(
        (preset.sourceId && ID_RE.test(String(preset.sourceId))) ? String(preset.sourceId) : `${channelId}-rss`,
        takenSourceIds,
      ),
      channelId,
      name: String(preset.name || item.name || hostOf(feedUrl) || channelId),
      type: item.feedType || guessFeedType(feedUrl),
      url: feedUrl,
      // source 的开关**独立于** channel：一个渠道可以开着，但其中某条 feed 被单独关掉。
      // 优先取 `preset.sourceEnabled`；只给了 `preset.enabled` 时退化为跟随渠道（兼容旧调用方）。
      enabled: typeof preset.sourceEnabled === 'boolean'
        ? preset.sourceEnabled
        : (typeof preset.enabled === 'boolean' ? preset.enabled : enabled),
      language: preset.language || item.language || defaultLanguage,
      interval: Number.isInteger(preset.interval) ? preset.interval : 30,
      createdAt: now,
      updatedAt: now,
    };
    if (Array.isArray(item.tags) && item.tags.length > 0) source.notes = `原始标签：${item.tags.join('/')}`;
    // 源级溯源可独立于渠道级（schema 注释：「同一渠道的多个 feed 可能来自不同批次」）
    const srcOrigin = preset.sourceOrigin !== undefined ? preset.sourceOrigin : item.origin;
    const srcOriginRef = preset.sourceOriginRef !== undefined ? preset.sourceOriginRef : item.originRef;
    if (srcOrigin) source.origin = srcOrigin;
    if (srcOriginRef) source.originRef = String(srcOriginRef);
    if (preset.sourceImportBatch) source.importBatch = String(preset.sourceImportBatch);
    else if (preset.importBatch) source.importBatch = String(preset.importBatch);
    else if (batch) source.importBatch = batch;
    // 健康状态也随备份还原 —— 否则「导出 → 导入 → 再导出」必然逐字节不一致
    if (LAST_STATUS.has(preset.lastStatus)) source.lastStatus = preset.lastStatus;
    if (preset.lastFetchAt) source.lastFetchAt = String(preset.lastFetchAt);
    if (preset.lastError) source.lastError = String(preset.lastError);

    sources.push(source);
    feedIndex.set(norm, source);
    addedSources.push(source.id);
  }

  return {
    config: {
      ...config,
      schemaVersion: config?.schemaVersion || '1.0',
      generatedAt: now,
      channels,
      sources,
    },
    report: {
      addedChannels,
      addedSources,
      skipped,
      enabledNew: Math.min(newCount, enabledCount),
    },
  };
}

// ---------------------------------------------------------------------------
// 四、实体层重收敛（reconcile）
// ---------------------------------------------------------------------------

/** 去协议的 URL 键：判「同一份内容被两种写法引用」（如 http / https 双写） */
function blobUrlKey(u) {
  try {
    const x = new URL(String(u || ''));
    return `${x.hostname}${x.pathname}${x.search || ''}`.toLowerCase();
  } catch {
    return String(u || '');
  }
}

/**
 * 渠道的实体键集合 = homepage 自身键 ∪ 各源派生键。
 *
 * 两个都要：历史渠道的 homepage 与源派生值可能不同源（`bytedance-tech` 的
 * homepage 在 `blog.csdn.net`，源却挂在 `rss.csdn.net`），只取其一都会漏判。
 */
function entityKeysOf(channel, sources) {
  const keys = new Set([normalizeHomepage(channel?.homepage)]);
  for (const s of sources) {
    if (s?.channelId !== channel?.id) continue;
    const k = normalizeHomepage(deriveHomepageFromFeed(s.url));
    if (k) keys.add(k);
  }
  keys.delete('');
  return keys;
}

/**
 * 实体层重收敛 —— 修正两类**结构残留**（2026-09-16 审计实测到的 6 处）：
 *
 *   误合并（不同实体压成一条渠道）：
 *     `feedx`「cnBeta」里混着 cnBeta / 环球科学 / 摄影世界 三个刊物；
 *     `feeds-feedburner`「书伴」里混着「可能吧」。
 *   误分裂（同一实体拆成多条渠道）：
 *     `rakuen-thec` / `rakuen-thec-2` 同名两张卡片；
 *     `ruanyifeng` / `ruanyifeng-blog` 是同一 feed 的 http / https 两种写法。
 *
 * 做法：**先拆后并** ——
 *   ① 拆：一条渠道的源若跨多个实体键，按键切成多条渠道（首组继承原 id）。
 *   ② 并：同一实体键只保留**一个**渠道，其余渠道的源迁过去、渠道本身删除。
 * 先拆后并的妙处是收敛到**规范形式**（每个键恰好一个渠道），于是第二趟必然
 * 无可拆、无可并 → 天然幂等。
 *
 * 几个刻意的保守选择：
 *   - `scope` 默认只处理 `origin === 'garss'`：历史 32 条是人工配置的，其 homepage
 *     是显式给的，不该被启发式覆盖（实测若放开会把 v2ex / 豆瓣 / 开源中国等
 *     正确渠道的多个栏目强行拆开）。
 *   - 拆出的新渠道**继承原渠道的开关**，而不是一律停用：拆分**不增加采集请求**
 *     （原本那几条 feed 就在抓），只是把文章归还给正确的刊名。若强制停用，代价
 *     是用户直接丢失「环球科学」「摄影世界」的内容 —— 比"卡片归属错"更重。
 *   - 迁移时若目标渠道已有「去协议后同 URL」的源，直接丢弃新来者 —— 这正是
 *     「不要重复请求同一个渠道」的落点（如 `ruanyifeng` 的 http 源）。
 *
 * @param {object} config 注册表（**不就地修改**）
 * @param {{ now?: string, scope?: 'garss'|'all' }} [opts]
 * @returns {{ config: object, report: { scope, splits: Array, merges: Array, droppedSources: Array } }}
 *   无任何变更时原样返回入参 config（保证「第二趟逐字节相同」）
 */
export function reconcileEntities(config, opts = {}) {
  const now = opts.now || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const scope = opts.scope || 'garss';
  const inScope = (c) => (scope === 'all' ? true : c?.origin === 'garss');

  let channels = (Array.isArray(config?.channels) ? config.channels : []).map((c) => ({ ...c }));
  let sources = (Array.isArray(config?.sources) ? config.sources : []).map((s) => ({ ...s }));
  const takenChannelIds = new Set(channels.map((c) => c?.id).filter(Boolean));

  const splits = [];
  const merges = [];
  const droppedSources = [];

  // ── 阶段 1：拆（跨键渠道 → 每个键一条渠道）────────────────────────────
  {
    const out = [];
    for (const c of channels) {
      const ss = sources.filter((s) => s.channelId === c.id);
      const groups = new Map();
      for (const s of ss) {
        const k = normalizeHomepage(deriveHomepageFromFeed(s.url));
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(s);
      }
      if (groups.size <= 1 || !inScope(c)) {
        out.push(c);
        continue;
      }

      const entries = [...groups.entries()];
      const primaryKey = normalizeHomepage(deriveHomepageFromFeed(ss[0].url));
      const pi = Math.max(0, entries.findIndex(([k]) => k === primaryKey));
      const ordered = [entries[pi], ...entries.filter((_, i) => i !== pi)];

      // 主组继承原渠道。homepage 一并改成派生值 —— 否则它与源的派生键不一致，
      // 下一次导入会判定「搭不上车」而重复新建一条渠道。
      out.push({ ...c, homepage: deriveHomepageFromFeed(ss[0].url), updatedAt: now });

      const newIds = [];
      for (let i = 1; i < ordered.length; i += 1) {
        const [, arr] = ordered[i];
        const home = deriveHomepageFromFeed(arr[0].url);
        let base;
        try {
          base = deriveChannelId(home);
        } catch {
          base = `ch-${feedKey(arr[0].url).slice(0, 8)}`;
        }
        const id = freeId(base, takenChannelIds);
        takenChannelIds.add(id);
        for (const s of arr) s.channelId = id;
        const ncName = String(arr[0].name || hostOf(home) || id);
        out.push({
          ...c,
          id,
          homepage: home,
          name: ncName,
          // icon 随名字重取首字，否则拆出的「环球科学」会顶着 cnBeta 的「c」
          icon: ncName.trim().charAt(0) || c.icon || '?',
          updatedAt: now,
        });
        newIds.push(id);
      }
      splits.push({ id: c.id, into: [c.id, ...newIds] });
    }
    channels = out;
  }

  // ── 阶段 2：并（同一实体键只留一条渠道）──────────────────────────────
  {
    // 键归属优先级：人工配置（非 scope）> 更早出现的 scope 渠道。
    // 反过来的话 scope 渠道会抢占历史渠道的键，"该并入历史渠道"会错判成"自成一派"。
    const ranked = [...channels.filter((c) => !inScope(c)), ...channels.filter(inScope)];
    const keyOwner = new Map();
    for (const c of ranked) {
      for (const k of entityKeysOf(c, sources)) {
        if (!keyOwner.has(k)) keyOwner.set(k, c.id);
      }
    }

    const removed = new Set();
    for (const c of channels) {
      if (!inScope(c)) continue;
      const ss = sources.filter((s) => s.channelId === c.id);
      if (!ss.length) continue;

      const owners = new Set();
      let absorbable = true;
      for (const s of ss) {
        const o = keyOwner.get(normalizeHomepage(deriveHomepageFromFeed(s.url)));
        if (!o || o === c.id) { absorbable = false; break; }
        owners.add(o);
      }
      // 只处理「整条渠道都能被同一个目标吸收」的情形；部分吸收说明分组还没收敛，
      // 留给下一趟（阶段 1 已把它拆开了）
      if (!absorbable || owners.size !== 1) continue;

      const targetId = [...owners][0];
      if (!channels.some((x) => x.id === targetId)) continue;

      const seenBlobs = new Set(
        sources.filter((s) => s.channelId === targetId).map((s) => blobUrlKey(s.url)),
      );
      const moved = [];
      for (const s of ss) {
        const b = blobUrlKey(s.url);
        if (seenBlobs.has(b)) {
          droppedSources.push({ id: s.id, url: s.url, reason: 'same-content-as-target', target: targetId });
          s.channelId = '';
          continue;
        }
        seenBlobs.add(b);
        s.channelId = targetId;
        moved.push(s.id);
      }
      removed.add(c.id);
      merges.push({ id: c.id, into: targetId, moved, dropped: ss.length - moved.length });
    }

    channels = channels.filter((c) => !removed.has(c.id));
    sources = sources.filter((s) => s.channelId !== '');
  }

  const changed = splits.length > 0 || merges.length > 0;
  if (!changed) {
    return { config, report: { scope, splits, merges, droppedSources } };
  }
  return {
    config: { ...config, generatedAt: now, channels, sources },
    report: { scope, splits, merges, droppedSources },
  };
}

/** 按 URL 后缀猜 feed 类型（探不到内容时的缺省；健康检查后可再校正） */
export function guessFeedType(url) {
  const u = String(url || '').toLowerCase();
  if (u.endsWith('.atom') || u.includes('atom.xml') || u.endsWith('/atom')) return 'atom';
  return 'rss';
}

/**
 * 仅暴露「不便公开、但测试与既有调用方需要」的符号。
 *
 * ⚠️ `originOf` 已被**刻意移除**：它是"主页回落到裸 host"这个根因的实现，
 * 留着它，下一个人写兜底时还会顺手抓它。现在推断主页只有一条路 ——
 * `deriveHomepageFromFeed`。
 */
export const _internal = {
  isFeedSegment,
  FEED_STOPWORDS,
  FEED_TRACKING_PARAMS,
};

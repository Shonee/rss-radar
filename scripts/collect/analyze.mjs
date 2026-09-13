// scripts/collect/analyze.mjs — 分析层（ARCHITECTURE §5.1~§5.5）
// 从 snapshot 派生 hotList / categoryStats / channelActivity / crossSource / keywords / summary
import { hotScoreAll } from './lib/hot-score.mjs';
import { topKeywords, keywordHitsByItem, loadStopwords } from './lib/keyword.mjs';
import { nowIso, windowStartUtc } from './lib/time.mjs';

const CATEGORY_LABEL_ZH = {
  tech_blog: '科技博客',
  ai: 'AI',
  news: '新闻',
  dev_community: '开发者社区',
  podcast: '播客',
  newsletter: '周报',
  finance: '财经',
  video: '视频',
  security: '安全',
  opensource: '开源',
  other: '其他',
};

const DEFAULT_HOT_LIST_SIZE = 10;
const DEFAULT_KEYWORDS_TOP = 20;
const DEFAULT_SUMMARY_LENGTH = 80;

/**
 * 主入口：从 snapshot → 分析报告（不落盘）
 *
 * @param {Object} snapshot   折叠 + dedup 后的 projection snapshot
 * @param {Object} [opts]
 * @param {Object<string,number>} [opts.channelWeights]  渠道权重（来自 siteConfig）
 * @param {Object} [opts.weights]                        5 维度权重
 * @param {number} [opts.halfLifeHours=6]
 * @param {number} [opts.hotListSize=10]
 * @param {number} [opts.keywordsTop=20]
 * @param {Object<string,string>} [opts.categoryLabels] 自定义分类标签
 * @returns {{
 *   totalItems, activeChannels, windowStart, windowEnd, weights,
 *   categoryStats, hotList, keywords, crossSource, channelActivity, summary,
 *   _private: { hotMap, hotMax }
 * }}
 */
export function analyzeSnapshot(snapshot, opts = {}) {
  const items = snapshot.items ?? [];
  const stats = snapshot.stats ?? {};
  const totalItems = items.length;

  // --- 渠道统计 ---
  const channelMap = new Map();
  for (const it of items) {
    const k = it.channelId;
    if (!channelMap.has(k)) {
      channelMap.set(k, {
        channelId: it.channelId,
        channelName: it.channelName,
        category: it.category ?? [],
        itemCount: 0,
        lastUpdatedAt: it.updatedAt ?? it.publishedAt,
      });
    }
    const ch = channelMap.get(k);
    ch.itemCount += 1;
    // 滚动最大 updatedAt
    if (it.updatedAt && (!ch.lastUpdatedAt || it.updatedAt > ch.lastUpdatedAt)) {
      ch.lastUpdatedAt = it.updatedAt;
    }
  }
  const channelActivity = Array.from(channelMap.values())
    .sort((a, b) => b.itemCount - a.itemCount)
    .map((ch) => ({ ...ch, activityScore: ch.itemCount / Math.max(1, totalItems) }));

  const activeChannels = channelMap.size;

  // --- 关键词 ---
  const stopwords = loadStopwords();
  const keywords = topKeywords(items, {
    topN: opts.keywordsTop ?? DEFAULT_KEYWORDS_TOP,
    stopwords,
  });
  const kwHits = keywordHitsByItem(items, keywords);

  // --- 热度分 ---
  const hotMap = hotScoreAll(items, {
    now: snapshot.generatedAt ? new Date(snapshot.generatedAt) : new Date(),
    channelWeights: opts.channelWeights ?? {},
    weights: opts.weights ?? {},
    halfLifeHours: opts.halfLifeHours ?? 6,
    keywordHits: kwHits,
  });

  // 写回 items[].hotScore（destruct-friendly：用 fresh array）
  for (const it of items) {
    it.hotScore = hotMap.normalize(it.id);
  }

  const hotList = items
    .map((it) => ({
      it,
      score: it.hotScore,
      components: hotMap.byId.get(it.id)?.components,
    }))
    .sort(compareHot)
    .slice(0, opts.hotListSize ?? DEFAULT_HOT_LIST_SIZE)
    .map((row, i) => buildHotItem(row, i + 1));

  // --- 分类统计 ---
  const categoryStatsRaw = new Map();
  for (const it of items) {
    for (const c of it.category ?? ['other']) {
      if (!categoryStatsRaw.has(c)) categoryStatsRaw.set(c, { category: c, itemCount: 0, channelSet: new Set() });
      const e = categoryStatsRaw.get(c);
      e.itemCount += 1;
      e.channelSet.add(it.channelId);
    }
  }
  const categoryStats = Array.from(categoryStatsRaw.values())
    .map((c) => ({
      category: c.category,
      label: opts.categoryLabels?.[c.category] ?? CATEGORY_LABEL_ZH[c.category] ?? c.category,
      itemCount: c.itemCount,
      channelCount: c.channelSet.size,
      ratio: totalItems === 0 ? 0 : c.itemCount / totalItems,
    }))
    .sort((a, b) => b.itemCount - a.itemCount);

  // --- 跨源重合（sourceCount ≥ 2）---
  const crossSource = items
    .filter((it) => (it.sourceCount ?? 1) >= 2)
    .map((it) => ({
      topic: it.title,
      sourceCount: it.sourceCount,
      itemIds: [it.id],
      channelNames: (it.sources ?? []).map((s) => s.channelName).filter(Boolean),
    }));

  // --- 一句话 summary（模板 + 第一个热点标题 + 第一个高频词）---
  const summary = buildSummary({ hotList, keywords, crossSource });

  // --- 时间窗 ---
  const windowStart = windowStartUtc(snapshot.date);
  const windowEnd = snapshot.generatedAt ?? nowIso();

  // 不写盘；只 return 对象
  return {
    totalItems,
    activeChannels,
    windowStart,
    windowEnd,
    weights: hotMap.weights,
    categoryStats,
    hotList,
    keywords,
    crossSource,
    channelActivity,
    summary,
    _private: { hotMap, hotMax: hotMap.maxScore },
  };
}

function compareHot(a, b) {
  if (a.score !== b.score) return b.score - a.score; // 倒序
  if ((a.it.sourceCount ?? 1) !== (b.it.sourceCount ?? 1)) {
    return (b.it.sourceCount ?? 1) - (a.it.sourceCount ?? 1);
  }
  if ((a.it.publishedAt ?? '') !== (b.it.publishedAt ?? '')) {
    return (a.it.publishedAt ?? '') > (b.it.publishedAt ?? '') ? -1 : 1;
  }
  return (a.it.id || '').localeCompare(b.it.id || '');
}

function buildHotItem(row, rank) {
  const it = row.it;
  return {
    rank,
    id: it.id,
    title: it.title,
    url: it.url,
    channelId: it.channelId,
    channelName: it.channelName,
    category: it.category ?? [],
    hotScore: row.score,
    sourceCount: it.sourceCount ?? 1,
    channelNames: dedupArr((it.sources ?? []).map((s) => s.channelName).concat(it.channelName ? [it.channelName] : [])),
    publishedAt: it.publishedAt,
    components: simplifyComponents(row.components),
  };
}

function simplifyComponents(c) {
  if (!c) return {};
  const { zSource, decay, zChannel, zKw, weights } = c;
  return {
    zSource: round3(zSource),
    decay: round3(decay),
    zChannel: round3(zChannel),
    zKw: round3(zKw),
    w1: weights?.sourceOverlap,
    w2: weights?.recency,
    w3: weights?.frequency,
    w4: weights?.channelWeight,
    w5: weights?.keywordHeat,
  };
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function dedupArr(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

/**
 * summary 模板：简短陈述 + 第一条热点 + 第一个高频词
 */
function buildSummary({ hotList, keywords, crossSource }) {
  if (!hotList || hotList.length === 0) return '今日暂无热门内容。';
  const top1 = hotList[0];
  const w = keywords?.[0]?.word;
  const cross = crossSource && crossSource.length > 0 ? `；${crossSource.length} 个跨源主题` : '';
  const phrase = w ? `，关键词「${w}」热度居前` : '';
  let s = `今日热度榜首《${top1.title}》（来自 ${top1.channelName}，hotScore=${round3(top1.hotScore)}）${phrase}${cross}。`;
  if (s.length > 200) s = s.slice(0, 197) + '…';
  return s;
}

export const _internal = { compareHot, simplifyComponents, buildSummary, CATEGORY_LABEL_ZH };

// scripts/collect/dedup.mjs — L1~L5 分级去重引擎（ARCHITECTURE §4.3~§4.5）
// 严格按 ARCH §4.6「读-合并-写」幂等原则
import { normalizeUrl, titleFingerprint } from './lib/url-norm.mjs';
import { deriveKeyAndId } from './lib/dedup-key.mjs';
import { computeSimHash64, buildLSH, candidatePairs } from './lib/simhash.mjs';
import { diceSafe } from './lib/dice.mjs';

/**
 * L1~L5 去重（ARCH §4.3）：
 *   L1 dedupKey 分组
 *   L2 标题完全一致
 *   L3 SimHash LSH 预筛 + Dice 精算（阈值默认 0.9）
 *   L4 跨源标记（group.sourceCount）
 *   L5 主题重合（关键词 Jaccard，不合并只标记）— 留 P2 报告阶段用
 *
 * @param {Item[]} items 原始归一化后的 items
 * @param {Object} opts
 * @param {number} [opts.threshold=0.9] Dice 相似度阈值
 * @param {Object<string,number>} [opts.channelWeights] 渠道权重（channelId→0..1）
 * @param {Object<string,string>} [opts.lang] 渠道语言（中文/英文等）— 简化版未用，留接口
 * @returns {{groups: Group[], stats: {l1Hits, l2Hits, l3Hits, totalMerged}}}
 */
export function dedup(items, opts = {}) {
  const threshold = opts.threshold ?? 0.9;
  const channelWeights = opts.channelWeights ?? {};

  // 给每个 item 赋 dedupKey + id（如果未带）
  const prepared = items.map((it) => {
    const { key, id } = it.dedupKey && it.id
      ? { key: it.dedupKey, id: it.id }
      : deriveKeyAndId(it);
    return { ...it, dedupKey: key, id };
  });

  // ===== L1：按 dedupKey 分组 =====
  const l1Groups = new Map();
  for (const it of prepared) {
    const k = it.dedupKey;
    let g = l1Groups.get(k);
    if (!g) {
      g = [];
      l1Groups.set(k, g);
    }
    g.push(it);
  }
  let l1Hits = 0;
  for (const g of l1Groups.values()) if (g.length > 1) l1Hits += g.length - 1;

  // ===== L2：标题完全一致分组（同一 L1 group 内不再重复）=====
  const l2Groups = new Map();
  for (const g of l1Groups.values()) {
    if (g.length === 1) {
      const it = g[0];
      const t = titleFingerprint(it.title);
      let g2 = l2Groups.get(t);
      if (!g2) {
        g2 = [];
        l2Groups.set(t, g2);
      }
      g2.push(...g);
      continue;
    }
    // 已经是 L1 同 dedupKey，合并为一个 group（不再按 title 拆）
    const t = titleFingerprint(g[0].title);
    let g2 = l2Groups.get(t);
    if (!g2) {
      g2 = [];
      l2Groups.set(t, g2);
    }
    g2.push(...g);
  }
  // 计算 L2 hits：将「K 个不同 dedupKey 的逻辑组」合并成 1 组，需要 K-1 次合并。
  //
  // 口径修复（T-P2-fix）：原式 `g.length - uniqueKeys.size` 统计的是「组内被 L1 吸收的
  // 重复条目数」——那部分 L1 已经计过（`l1Hits += g.length - 1`），导致：
  //   跨源同标题（2 条 item、2 个不同 dedupKey）时 `2 - 2 = 0`，
  //   即**真发生了合并却计数为 0**；`totalMerged` 因此恒偏小，
  //   并经由 `project-snapshot.mjs` 写进 `snapshot.stats.mergedCount`（用户可见统计）。
  // 单位与 L1/L3 统一为「合并次数」：K 个逻辑节点塌缩为 1 → K-1 次。
  let l2Hits = 0;
  for (const g of l2Groups.values()) {
    const uniqueKeys = new Set(g.map((it) => it.dedupKey));
    if (uniqueKeys.size > 1) l2Hits += uniqueKeys.size - 1;
  }

  // ===== L3：SimHash 预筛 + Dice 精算 =====
  // 取出当前尚未合并的「单一 title group」（l2Groups size=1 且 l1Group size=1）
  const singles = [];
  for (const [, g] of l2Groups) {
    if (g.length === 1) singles.push(g[0]);
  }

  // 算 simhash
  const hashes = singles.map((it) => {
    const h = computeSimHash64(titleFingerprint(it.title));
    return { ...it, _simhash: h };
  });
  const lsh = buildLSH(hashes.map((s) => s._simhash));
  const pairs = candidatePairs(lsh);

  let l3Hits = 0;
  // Union-find
  const parent = new Map();
  for (let i = 0; i < singles.length; i += 1) parent.set(i, i);
  function find(x) {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(ra, rb);
      return true;
    }
    return false;
  }

  for (const [ai, bi] of pairs) {
    const itA = singles[ai];
    const itB = singles[bi];
    if (find(ai) === find(bi)) continue;
    const sim = diceSafe(itA.title, itB.title);
    if (sim >= threshold) {
      if (union(ai, bi)) l3Hits += 1;
    }
  }

  // ===== L3 fallback：LSH miss 的条目按 hamming 距离 ≤ 12 再试 =====
  // 原因：simhash 用 localHash 派生，4×16 LSH 对 hamming 11-12 仍可能 0 shared。
  // 兜底：n 较小时（≤200）跑 all-pairs hamming 距离，O(n²) 可控。
  // n 较大时跳过兜底，让 LSH 主路径负责（5000 条秒级）。
  const HAMMING_FLOORBACK_THRESHOLD = 12;
  if (singles.length <= 200) {
    for (let i = 0; i < singles.length; i += 1) {
      for (let j = i + 1; j < singles.length; j += 1) {
        if (find(i) === find(j)) continue;
        const hi = singles[i]._simhash ^ singles[j]._simhash;
        let d = 0;
        let x = hi;
        while (x > 0n) { d += Number(x & 1n); x >>= 1n; }
        if (d > HAMMING_FLOORBACK_THRESHOLD) continue;
        const sim = diceSafe(singles[i].title, singles[j].title);
        if (sim >= threshold) {
          if (union(i, j)) l3Hits += 1;
        }
      }
    }
  }

  // 合并 L3 groups
  const l3GroupMap = new Map();
  for (let i = 0; i < singles.length; i += 1) {
    const root = find(i);
    if (!l3GroupMap.has(root)) l3GroupMap.set(root, []);
    l3GroupMap.get(root).push(singles[i]);
  }

  // 合并 L2 groups 与 L3 groups
  const finalGroups = [];
  const consumedL2Keys = new Set();
  // 先处理 l2Groups 中 size > 1 的（L1+L2 命中）
  for (const [t, g] of l2Groups) {
    if (g.length === 1) continue; // 等 L3 处理
    finalGroups.push(pickMain(g, channelWeights));
    consumedL2Keys.add(t);
  }
  // 处理 singles 群体（L3 命中）
  for (const g of l3GroupMap.values()) {
    finalGroups.push(pickMain(g, channelWeights));
  }
  // L3 groupMap 中 size=1 的已经走 candidatePairs 不会 union，OK

  const totalMerged = l1Hits + l2Hits + l3Hits;

  return {
    groups: finalGroups,
    stats: { l1Hits, l2Hits, l3Hits, totalMerged },
  };
}

/**
 * 选主条目（ARCH §4.5 compare）：
 *   1) updatedAt 最新
 *   2) 完整度（summary/author/tags/guid 非空数）
 *   3) channelWeight 高
 *   4) id 字典序（确定性）
 */
function pickMain(group, channelWeights = {}) {
  if (group.length === 1) return buildMain(group[0]);
  const sorted = [...group].sort((a, b) => compare(a, b, channelWeights));
  return buildMain(sorted[0], sorted.slice(1));
}

function compare(a, b, cw) {
  // 1) updatedAt 最新
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  // 2) 完整度
  const ca = completeness(a);
  const cb = completeness(b);
  if (ca !== cb) return cb - ca;
  // 3) channelWeight
  const wa = cw[a.channelId] ?? 0.5;
  const wb = cw[b.channelId] ?? 0.5;
  if (wa !== wb) return wb - wa;
  // 4) id 字典序
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function completeness(it) {
  return ['summary', 'author', 'tags', 'guid'].reduce((n, k) => {
    const v = it[k];
    if (Array.isArray(v)) return v.length > 0 ? n + 1 : n;
    if (typeof v === 'string') return v.length > 0 ? n + 1 : n;
    return n;
  }, 0);
}

/**
 * 把主条目 + 被合并条目 → 主条目（sourceCount + sources[] 合并）
 */
function buildMain(main, others = []) {
  if (others.length === 0) {
    return {
      ...main,
      sourceCount: main.sourceCount ?? 1,
      sources: main.sources && main.sources.length > 0 ? main.sources : [
        { channelId: main.channelId, channelName: main.channelName, url: main.url, publishedAt: main.publishedAt },
      ],
    };
  }
  const all = [main, ...others];
  const sourcesMap = new Map();
  for (const it of all) {
    const arr = it.sources && it.sources.length > 0
      ? it.sources
      : [{ channelId: it.channelId, channelName: it.channelName, url: it.url, publishedAt: it.publishedAt }];
    for (const s of arr) {
      const key = `${s.channelId}|${s.url}`;
      if (!sourcesMap.has(key)) sourcesMap.set(key, s);
    }
  }
  const sources = Array.from(sourcesMap.values());
  return {
    ...main,
    sourceCount: sources.length,
    sources,
  };
}
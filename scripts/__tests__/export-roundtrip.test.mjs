// scripts/__tests__/export-roundtrip.test.mjs
//
// 导出 / 回灌的**幂等门禁**。这三条断言是「维护最终一版实际使用的 rss 数据」
// 这句话能被机器验证的部分：
//
//   ① 导出是 config 的纯函数 —— 同输入 + 同 --now ⇒ 逐字节相同
//   ② 导出 → 导入 → 再导出 ⇒ 逐字节相同（导入自己产出的导出必须是 no-op）
//   ③ 引用完整性 —— 导出里每个 feedUrl 都能在 Source.url 找到；counts 自洽
//
// 为什么「逐字节」而不是「集合相等」？因为只有逐字节才能证明**没有静默丢字段**。
// 集合相等会放过「id 变了 / weight 丢了 / enabled 翻面了」这类问题 ——
// 而这些恰恰是回灌备份最容易出的错。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildExport, toOpml, EXPORT_FORMAT, EXPORT_VERSION } from '../export-channels.mjs';
import {
  parseRegistryExport,
  cleanCandidates,
  mapCategory,
  selectRollout,
  enableRollout,
  canonicalizeSourceUrls,
} from '../import-channels.mjs';
import { mergeIntoRegistry, normalizeFeedUrl } from '../lib/channel-registry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXED_NOW = '2026-09-16T00:00:00Z';
const FIXED_COMMIT = 'abc1234';

function loadConfig() {
  return JSON.parse(readFileSync(resolve(ROOT, 'config/sources.json'), 'utf8'));
}

/**
 * 复刻 import-channels.mjs 的**还原路径**（registry-export 分支）。
 * 刻意与 CLI 保持相同的步骤顺序 —— 测试若只测「函数各自对不对」，
 * 就测不出「串起来跑会不会漂移」。
 */
function restoreInto(baseline, exportPayload) {
  const raw = parseRegistryExport(exportPayload);
  const { kept } = cleanCandidates(raw, {});
  const mapped = kept.map((c) => {
    const m = c._presetCategory && c._presetCategory.length > 0
      ? { category: c._presetCategory.slice(), tags: c._presetTags || [], known: true }
      : mapCategory(c.rawCategory);
    return { ...c, category: m.category, tags: m.tags };
  });
  const ordered = mapped; // 还原模式：保序，不重排
  const { chosen, rideAlong, rest } = selectRollout(ordered, 0, new Set());
  const passA = mergeIntoRegistry(
    baseline,
    [...chosen, ...rideAlong, ...rest].map((c) => ({
      name: c.name,
      homepage: c.homepage,
      feedUrl: c.feedUrl,
      category: c.category,
      tags: c.tags,
      description: c.description,
      origin: c._origin,
      originRef: c.originRef || undefined,
      preset: c._preset,
    })),
    { now: FIXED_NOW, batch: undefined, enabledCount: 0 },
  );
  const cfg = passA.config;
  if (exportPayload.generatedAt) cfg.generatedAt = exportPayload.generatedAt;
  enableRollout(cfg, { chosen, rideAlong });
  // 与 CLI 一致：收尾把 URL 拉齐到去重键形态
  canonicalizeSourceUrls(cfg);
  return cfg;
}

describe('① 导出是 config 的纯函数', () => {
  test('同一份 config + 同一 --now ⇒ 逐字节相同', () => {
    const cfg = loadConfig();
    const a = JSON.stringify(buildExport(cfg, { now: FIXED_NOW, commit: FIXED_COMMIT }));
    const b = JSON.stringify(buildExport(cfg, { now: FIXED_NOW, commit: FIXED_COMMIT }));
    assert.equal(a, b);
  });

  test('不带任何采集回写字段的噪声（同 config 多次导出稳定）', () => {
    const cfg = loadConfig();
    const a = buildExport(cfg, { now: FIXED_NOW, commit: FIXED_COMMIT });
    // 打乱源顺序之外的字段不应被改写：再导一次仍然是同一个对象
    assert.deepEqual(a, buildExport(cfg, { now: FIXED_NOW, commit: FIXED_COMMIT }));
  });

  test('自证格式标记齐全（脱离本仓库也能判断这是什么）', () => {
    const e = buildExport(loadConfig(), { now: FIXED_NOW, commit: FIXED_COMMIT });
    assert.equal(e.format, EXPORT_FORMAT);
    assert.equal(e.version, EXPORT_VERSION);
    assert.equal(e.exportedAt, FIXED_NOW);
    assert.ok(e.source.repo);
    assert.ok(Array.isArray(e.categories));
  });
});

describe('② 导出 → 导入 → 再导出：一次往返即进入不动点', () => {
  test('★ 第二次与第三次导出逐字节相同（不动点）', () => {
    const cfg = loadConfig();
    const exp1 = buildExport(cfg, { now: FIXED_NOW, commit: FIXED_COMMIT });

    const empty = { schemaVersion: '1.0', generatedAt: cfg.generatedAt, channels: [], sources: [] };
    const cfg2 = restoreInto(empty, exp1);
    const exp2 = buildExport(cfg2, { now: FIXED_NOW, commit: FIXED_COMMIT });

    const cfg3 = restoreInto(empty, exp2);
    const exp3 = buildExport(cfg3, { now: FIXED_NOW, commit: FIXED_COMMIT });

    // 逐字节比较 —— 任何字段丢失 / 顺序变化 / 开关翻面都会在这里炸出来
    assert.equal(JSON.stringify(exp3, null, 2), JSON.stringify(exp2, null, 2));
  });

  test('★ exp2 与 exp1 的差异**只允许**是 URL 规范形态差异', () => {
    const cfg = loadConfig();
    const exp1 = buildExport(cfg, { now: FIXED_NOW, commit: FIXED_COMMIT });
    const empty = { schemaVersion: '1.0', generatedAt: cfg.generatedAt, channels: [], sources: [] };
    const exp2 = buildExport(restoreInto(empty, exp1), { now: FIXED_NOW, commit: FIXED_COMMIT });

    // 把 exp1 的 URL 也归一化后，两者必须完全一致。
    // 换句话说：往返过程除了「把历史遗留的非规范 URL 收敛掉」之外，不许改动任何东西。
    const canon = JSON.parse(JSON.stringify(exp1));
    for (const c of canon.channels) {
      if (c.feedUrl) c.feedUrl = normalizeFeedUrl(c.feedUrl);
      for (const f of c.feeds) f.url = normalizeFeedUrl(f.url);
    }
    assert.equal(JSON.stringify(exp2, null, 2), JSON.stringify(canon, null, 2));
  });

  test('★ 已含该 config 时，回灌是 no-op（全部落 skipped，config 不变）', () => {
    const cfg = loadConfig();
    const exp = buildExport(cfg, { now: FIXED_NOW, commit: FIXED_COMMIT });
    const raw = parseRegistryExport(exp);
    const { kept } = cleanCandidates(raw, {});
    const incoming = kept.map((c) => ({
      name: c.name, homepage: c.homepage, feedUrl: c.feedUrl,
      category: [], tags: c.tags, origin: c._origin, originRef: c.originRef,
    }));
    const r = mergeIntoRegistry(cfg, incoming, { now: FIXED_NOW, enabledCount: 0 });
    assert.equal(r.report.addedChannels.length, 0, '不该新增任何渠道');
    assert.equal(r.report.addedSources.length, 0, '不该新增任何源');
    assert.equal(r.report.skipped.length, kept.length, '应全部按重复 URL 跳过');
    assert.ok(r.report.skipped.every((s) => s.reason === 'duplicate-feed-url'));
  });

  test('id / weight / displayLimit / enabled 都随快照还原，不是重新派生', () => {
    const cfg = loadConfig();
    const exp = buildExport(cfg, { now: FIXED_NOW, commit: FIXED_COMMIT });
    const rebuilt = restoreInto(
      { schemaVersion: '1.0', generatedAt: cfg.generatedAt, channels: [], sources: [] },
      exp,
    );
    for (const before of cfg.channels) {
      const after = rebuilt.channels.find((c) => c.id === before.id);
      assert.ok(after, `渠道 ${before.id} 丢失`);
      assert.equal(after.name, before.name);
      assert.equal(after.homepage, before.homepage);
      assert.equal(after.weight, before.weight, `${before.id} 的 weight 应原样还原`);
      assert.equal(after.displayLimit, before.displayLimit);
      assert.equal(after.icon, before.icon);
      assert.equal(after.enabled, before.enabled, `${before.id} 的开关应原样还原`);
      assert.deepEqual(after.category, before.category);
    }
    for (const before of cfg.sources) {
      const after = rebuilt.sources.find((s) => s.id === before.id);
      assert.ok(after, `源 ${before.id} 丢失`);
      // URL 比的是**规范形态**：还原会顺带把历史遗留的非规范 URL 收敛掉（见 exp2/exp1 那条用例）
      assert.equal(after.url, normalizeFeedUrl(before.url));
      assert.equal(after.type, before.type);
      assert.equal(after.enabled, before.enabled);
      assert.equal(after.interval, before.interval);
      assert.equal(after.lastStatus, before.lastStatus);
    }
  });

  test('多源渠道不会被还原成单源（feeds[] 展开）', () => {
    const cfg = loadConfig();
    const multi = cfg.channels.find((c) => cfg.sources.filter((s) => s.channelId === c.id).length > 1);
    if (!multi) return; // fixture 里没有多源渠道就跳过
    const exp = buildExport(cfg, { now: FIXED_NOW, commit: FIXED_COMMIT });
    const rebuilt = restoreInto(
      { schemaVersion: '1.0', generatedAt: cfg.generatedAt, channels: [], sources: [] },
      exp,
    );
    const before = cfg.sources.filter((s) => s.channelId === multi.id).length;
    const after = rebuilt.sources.filter((s) => s.channelId === multi.id).length;
    assert.equal(after, before, `渠道 ${multi.id} 的源数量从 ${before} 变成了 ${after}`);
  });
});

describe('③ 引用完整性', () => {
  test('★ 导出里每个 feedUrl 都能在 Source.url 找到（无孤儿）', () => {
    const cfg = loadConfig();
    const exp = buildExport(cfg, { now: FIXED_NOW, commit: FIXED_COMMIT });
    const urls = new Set(cfg.sources.map((s) => s.url));
    for (const c of exp.channels) {
      for (const f of c.feeds) {
        assert.ok(urls.has(f.url), `导出里的 ${f.url} 在 sources.json 里找不到对应源`);
      }
      if (c.feedUrl) assert.ok(urls.has(c.feedUrl), `渠道主 feed ${c.feedUrl} 找不到对应源`);
    }
  });

  test('counts 与数组长度自洽', () => {
    const cfg = loadConfig();
    const exp = buildExport(cfg, { now: FIXED_NOW, commit: FIXED_COMMIT });
    assert.equal(exp.counts.channels, exp.channels.length);
    assert.equal(exp.counts.sources, cfg.sources.length);
    assert.equal(exp.counts.enabledChannels, exp.channels.filter((c) => c.enabled).length);
    assert.equal(exp.counts.enabledSources, cfg.sources.filter((s) => s.enabled !== false).length);
    const feedTotal = exp.channels.reduce((n, c) => n + c.feeds.length, 0);
    assert.equal(feedTotal, cfg.sources.length, '每个源必须恰好归属一个渠道');
  });

  test('每个渠道至少一条 feed（没有空壳渠道混进导出）', () => {
    const exp = buildExport(loadConfig(), { now: FIXED_NOW, commit: FIXED_COMMIT });
    for (const c of exp.channels) {
      assert.ok(c.feeds.length > 0, `渠道 ${c.id} 没有任何 feed`);
    }
  });
});

describe('OPML 导出', () => {
  test('结构合法、XML 转义、按分类分组', () => {
    const opml = toOpml(loadConfig(), { now: FIXED_NOW });
    assert.ok(opml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(opml.includes('<opml version="2.0">'));
    assert.ok(opml.trimEnd().endsWith('</opml>'));
    // 每个源都应有 xmlUrl
    const cfg = loadConfig();
    const count = (opml.match(/xmlUrl=/g) || []).length;
    assert.equal(count, cfg.sources.length, 'OPML 的 xmlUrl 数量应等于源数');
    assert.ok(opml.includes('rssradar:id='), '带本仓库自己的 id 便于回灌定位');
  });

  test('含 & 的名称被转义（否则阅读器解析直接失败）', () => {
    const cfg = {
      channels: [{ id: 'a', name: 'A & B', homepage: 'https://a.com', category: ['other'], enabled: true }],
      sources: [{ id: 'a-rss', channelId: 'a', name: 'A & B', type: 'rss', url: 'https://a.com/feed', enabled: true }],
    };
    const opml = toOpml(cfg, { now: FIXED_NOW });
    assert.ok(opml.includes('A &amp; B'));
    assert.ok(!/text="A & B"/.test(opml));
  });

  test('确定性：同一 config 两次导出逐字节相同', () => {
    const cfg = loadConfig();
    assert.equal(toOpml(cfg, { now: FIXED_NOW }), toOpml(cfg, { now: FIXED_NOW }));
  });
});

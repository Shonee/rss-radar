// scripts/collect/__tests__/warm-cdn.test.mjs
// jsDelivr 边缘预热契约。背景（2026-09-16 实测，杭州）：
//
//   同一个快照 URL（3.55MB 源文件 / brotli 608KB）：
//     冷（Shield 也没）→ `x-cache: MISS, MISS`  TTFB **10.4s**
//     盾热（预热过）  → `x-cache: MISS, HIT`   TTFB **0.46s**
//   11 倍差距；而文件名每轮带时间戳 ⇒ **每小时都是全新 URL** ⇒ 每小时的第一位访客
//   必然付费 10.4s。这就是「第一次打开很慢、之后就快了」的直接来源。
//
// 本套件锁三件事：
//   ① 只预热「每轮唯一」的产物（snapshot / report）——**刻意不预热指针**
//   ② URL 构造与前端 CDN 基址一致
//   ③ 任一条失败都不抛出（warn-not-throw），否则预热会把数据发布带崩
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  BROWSER_ACCEPT_ENCODING,
  DEFAULT_HOSTS,
  parseArgs,
  parseRepoSlug,
  warmAll,
  warmTargets,
  warmUrl,
} from '../warm-cdn.mjs';

describe('warmTargets — 只挑每轮唯一的产物', () => {
  it('取 snapshotPath + reportPath', () => {
    const t = warmTargets({
      snapshotPath: 'today/snapshot-2026-09-16-0925.json',
      reportPath: 'today/report-2026-09-16-0925.json',
    });
    assert.deepEqual(t, [
      'today/snapshot-2026-09-16-0925.json',
      'today/report-2026-09-16-0925.json',
    ]);
  });

  it('② 刻意排除指针：稳定文件名预热无效，只会制造"已预热"的错觉', () => {
    const t = warmTargets({
      // 指针里同时带着指针自己的路径与日期 —— 都不该被预热
      pointerPath: 'today/latest.json',
      date: '2026-09-16',
      snapshotPath: 'today/snapshot-2026-09-16-0925.json',
    });
    assert.equal(t.includes('today/latest.json'), false);
    assert.equal(t.length, 1);
  });

  it('去重、丢空值与非字符串（报告缺位时 reportPath 可能为空串）', () => {
    assert.deepEqual(warmTargets({ snapshotPath: 'a.json', reportPath: '' }), ['a.json']);
    assert.deepEqual(warmTargets({ snapshotPath: 'a.json', reportPath: 'a.json' }), ['a.json']);
    assert.deepEqual(warmTargets({ snapshotPath: '   ', reportPath: 123 }), []);
    assert.deepEqual(warmTargets({}), []);
    assert.deepEqual(warmTargets(null), []);
    assert.deepEqual(warmTargets(undefined), []);
  });
});

describe('warmUrl — 与前端 CDN 基址同构', () => {
  it('形如 https://<host>/gh/<owner>/<repo>@<branch>/<rel>', () => {
    const url = warmUrl(
      'fastly.jsdelivr.net',
      { owner: 'Shonee', repo: 'rss-radar', branch: 'deploy' },
      'today/snapshot-2026-09-16-0925.json',
    );
    assert.equal(
      url,
      'https://fastly.jsdelivr.net/gh/Shonee/rss-radar@deploy/today/snapshot-2026-09-16-0925.json',
    );
  });

  it('默认主机列表与前端 CDN_HOSTS 顺序一致（fastly 打头）', () => {
    assert.deepEqual(DEFAULT_HOSTS, [
      'fastly.jsdelivr.net',
      'gcore.jsdelivr.net',
      'cdn.jsdelivr.net',
    ]);
  });

  it('编码协商串必须与浏览器一致 —— 边缘缓存变体是 vary: Accept-Encoding', () => {
    // 实测响应头 `vary: Accept-Encoding`：换 UA 仍 MISS,HIT，说明变体只按编码切。
    // 若这里写成别的串（如只 gzip），预热的是另一个变体，浏览器请求照样冷 MISS。
    assert.equal(BROWSER_ACCEPT_ENCODING, 'gzip, deflate, br');
  });
});

describe('warmAll — warn-not-throw', () => {
  it('逐条返回结果，顺序与入参一致', async () => {
    const urls = ['https://a/1', 'https://a/2'];
    const res = await warmAll({
      urls,
      fetchOne: async (url) => ({ ok: true, status: 200, bytes: 10, ttfbMs: 1, ms: 2, url }),
    });
    assert.deepEqual(res.map((r) => r.url), urls);
    assert.equal(res.every((r) => r.ok), true);
  });

  it('注入式 fetcher 抛错时**不得**让整批失败（否则会带崩数据发布）', async () => {
    const res = await warmAll({
      urls: ['https://a/1', 'https://a/2'],
      fetchOne: async (url) => {
        if (url.endsWith('/1')) throw new Error('boom');
        return { ok: true, status: 200, bytes: 1, ttfbMs: 1, ms: 1, url };
      },
    });
    assert.equal(res[0].ok, false);
    assert.match(res[0].error, /boom/);
    assert.equal(res[1].ok, true);
  });

  it('内建实现只 resolve 不 reject：网络错误也表现为 ok:false', async () => {
    // 指向一个必然解析失败的主机名，验证错误被收敛成结果对象而非异常。
    const res = await warmAll({ urls: ['https://no-such-host.invalid/gh/x/y@z/a.json'] });
    assert.equal(res.length, 1);
    assert.equal(res[0].ok, false);
    assert.equal(typeof res[0].error, 'string');
  });
});

describe('parseArgs / parseRepoSlug', () => {
  it('解析 --k v 与裸 flag', () => {
    assert.deepEqual(parseArgs(['--pointer', 'today/latest.json', '--dry-run']), {
      pointer: 'today/latest.json',
      'dry-run': true,
    });
  });

  it('忽略未知参数（CI 里拼错不该让整步失败）', () => {
    assert.deepEqual(parseArgs(['--nope', 'x', 'positional']), { nope: 'x' });
  });

  it('从 GITHUB_REPOSITORY 拆 owner/repo', () => {
    assert.deepEqual(parseRepoSlug('Shonee/rss-radar'), { owner: 'Shonee', repo: 'rss-radar' });
    assert.equal(parseRepoSlug('no-slash'), null);
    assert.equal(parseRepoSlug('a/b/c'), null);
    assert.equal(parseRepoSlug(undefined), null);
  });
});

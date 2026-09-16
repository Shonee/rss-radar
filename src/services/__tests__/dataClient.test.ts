// T-P3-01 前端基础设施 — dataClient 加载策略单测
//
// 2026-09-16 契约变更：从「三层整链降级」改为「按资源分流」
// （见 src/services/dataClient.ts 文件头）。本文件覆盖：
//   ① commit 有效性过滤（'local' 占位 / 分支名 / 非法值）
//   ② 指针与内容各自的来源顺序
//   ③ 指针走 raw + 内容走 jsdelivr@<commit> 的正常路径
//   ④ commit 无效 → 内容退回 raw（此前的 @local → 404 死路）
//   ⑤ jsDelivr 内容失败 → 降级 raw
//   ⑥ 指针 raw 失败 → 降级 jsDelivr@branch
//   ⑦ report 缺位不算失败 / dev bridge 内联快照 / local 兜底 / 全失败抛错
//   ⑧ stale 判定边界
import { describe, it, expect } from 'vitest';
import {
  loadLatest,
  isStale,
  isValidCommit,
  isImmutablePath,
  resolvePointerOrder,
  resolveContentOrder,
  resolveOrder,
  DEFAULT_TIMEOUT_MS,
  CONTENT_TIMEOUT_MS,
} from '../dataClient';
import type { FetchLike } from '../dataClient';

const RAW = 'https://raw.githubusercontent.com/Shonee/rss-radar/deploy/';
const JSD_BRANCH = 'https://cdn.jsdelivr.net/gh/Shonee/rss-radar@deploy/';
const COMMIT = 'abc1234';
const JSD_COMMIT = `https://cdn.jsdelivr.net/gh/Shonee/rss-radar@${COMMIT}/`;
const LOCAL = './data/';

function makeSnapshot(
  date = '2026-09-14',
  generatedAt = '2026-09-14T00:00:00Z',
  reportPath?: string,
) {
  return {
    schemaVersion: '1.0',
    date,
    timezone: 'Asia/Shanghai',
    generatedAt,
    // 2026-09-16 起采集端在快照里声明同轮次报告路径；缺省表示"老快照"。
    ...(reportPath ? { reportPath } : {}),
    stats: { sourceTotal: 1, sourceOk: 1, sourceFailed: 0, itemsBeforeDedup: 1, itemsAfterDedup: 1 },
    items: [],
  };
}

function makePointer(
  date = '2026-09-14',
  generatedAt = '2026-09-14T00:00:00Z',
  commit: string | undefined = COMMIT,
) {
  return {
    date,
    generatedAt,
    snapshotPath: `today/snapshot-${date}.json`,
    reportPath: `today/report-${date}.json`,
    eventPath: `today/events-${date}.ndjson`,
    ...(commit === undefined ? {} : { commit }),
  };
}

function makeReport(date = '2026-09-14') {
  return {
    schemaVersion: '1.0',
    date,
    timezone: 'Asia/Shanghai',
    generatedAt: `${date}T00:00:00Z`,
    totalItems: 0,
    activeChannels: 0,
    categoryStats: [],
    hotList: [],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const notFound = (): Response => new Response('not found', { status: 404 });

describe('isValidCommit — 占位值必须被拦下', () => {
  it("'local' 是 project-snapshot.mjs 的默认占位，不能拿去构造 jsDelivr URL", () => {
    expect(isValidCommit('local')).toBe(false);
  });

  it('分支名本身不是内容地址（@deploy 会被长期缓存 → 陈旧）', () => {
    expect(isValidCommit('deploy')).toBe(false);
    expect(isValidCommit('master')).toBe(false);
  });

  it('缺失 / 空串 / 非法字符一律无效', () => {
    expect(isValidCommit(undefined)).toBe(false);
    expect(isValidCommit(null)).toBe(false);
    expect(isValidCommit('')).toBe(false);
    expect(isValidCommit('   ')).toBe(false);
    expect(isValidCommit('not-a-sha')).toBe(false);
    expect(isValidCommit('abc12')).toBe(false); // 少于 7 位
  });

  it('合法 git sha（短 7 位 ~ 完整 40 位）通过', () => {
    expect(isValidCommit(COMMIT)).toBe(true);
    expect(isValidCommit('0123456789abcdef0123456789abcdef01234567')).toBe(true);
    expect(isValidCommit('ABC1234')).toBe(true); // 大小写不敏感
  });
});

describe('来源顺序 — 指针与内容分流', () => {
  const CDN_LIST = ['fastly', 'gcore', 'jsdelivr'];

  /** 降级链完整性：不重不漏，三个 CDN 域名与 local 兜底都在列 */
  const expectCompleteChain = (order: string[]) => {
    expect(new Set(order).size).toBe(order.length);
    for (const s of CDN_LIST) expect(order).toContain(s);
    expect(order).toContain('raw');
    expect(order).toContain('local');
  };

  it('指针：CDN 家族打头，raw 退居其后（2026-09-16 实测 raw 在国内会 60s 挂起）', () => {
    const order = resolvePointerOrder({});
    expectCompleteChain(order);
    expect(CDN_LIST).toContain(order[0]);
    // raw 必须排在**所有** CDN 之后：它在国内会连接挂起（实测 http=000、60s 无响应），
    // 占首位 = 每次首访白等一个完整超时才降级，这正是「打开就转圈」的原始来源。
    const rawIdx = order.indexOf('raw');
    expect(rawIdx).toBeGreaterThan(0);
    expect(order.slice(0, rawIdx).every((s) => CDN_LIST.includes(s))).toBe(true);
    // local 永远在最后（兜底）
    expect(order[order.length - 1]).toBe('local');
  });

  it('指针：CDN 顺序稳定（fastly 打头 —— 实测 age=0 且走东京节点最快）', () => {
    expect(resolvePointerOrder({})[0]).toBe('fastly');
  });

  it('指针：preferLocal / file 协议下 local 打头', () => {
    expect(resolvePointerOrder({ preferLocal: true })[0]).toBe('local');
    expect(resolvePointerOrder({ preferLocal: true })).toContain('raw');
    expect(resolvePointerOrder({ preferLocal: true })).toContain('jsdelivr');
  });

  it('内容：有有效 commit → CDN 内容寻址打头', () => {
    const order = resolveContentOrder({}, COMMIT);
    expectCompleteChain(order);
    expect(CDN_LIST).toContain(order[0]);
  });

  it('内容：commit 无效 → raw 打头（@local 必然 404，@branch 陈旧）', () => {
    expect(resolveContentOrder({}, 'local')[0]).toBe('raw');
    expect(resolveContentOrder({}, undefined)[0]).toBe('raw');
  });

  it('内容：路径不可变（带小时戳后缀）→ 即使 commit 无效也走 CDN', () => {
    const p = 'today/snapshot-2026-09-16-0347.json';
    expect(isImmutablePath(p)).toBe(true);
    expect(CDN_LIST).toContain(resolveContentOrder({}, 'local', p)[0]);
    expect(CDN_LIST).toContain(resolveContentOrder({}, undefined, p)[0]);
  });

  it('isImmutablePath：可变路径一律 false（防「固定名 + 长缓存」踩陈旧）', () => {
    expect(isImmutablePath('today/snapshot-2026-09-16.json')).toBe(false);
    expect(isImmutablePath('today/report-2026-09-16.json')).toBe(false);
    expect(isImmutablePath('history/2026/09/items.ndjson')).toBe(false);
    expect(isImmutablePath('history/history-index.json')).toBe(false);
    expect(isImmutablePath(undefined)).toBe(false);
    expect(isImmutablePath('')).toBe(false);
    // report 与 snapshot 共用同一后缀规则
    expect(isImmutablePath('today/report-2026-09-16-0347.json')).toBe(true);
  });

  it('preferLocal 时两条链都以 local 打头', () => {
    expect(resolvePointerOrder({ preferLocal: true })[0]).toBe('local');
    expect(resolveContentOrder({ preferLocal: true }, COMMIT)[0]).toBe('local');
  });

  it('resolveOrder 保留兼容，等价于 resolveContentOrder', () => {
    expect(resolveOrder({ commit: COMMIT })).toEqual(resolveContentOrder({}, COMMIT));
  });

  it('超时契约：指针 3.5s / 内容 12s（原 8s 单档已废弃）', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(3500);
    expect(CONTENT_TIMEOUT_MS).toBe(12000);
  });
});

describe('loadLatest — 分流加载', () => {
  it('① 正常路径：指针 raw + 快照/报告 jsdelivr@<commit>', async () => {
    const now = Date.parse('2026-09-14T00:00:00Z');
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${RAW}today/latest.json`) return json(makePointer());
      if (url === `${JSD_COMMIT}today/snapshot-2026-09-14.json`) return json(makeSnapshot());
      if (url === `${JSD_COMMIT}today/report-2026-09-14.json`) return json(makeReport());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: false, now });
    expect(res.source).toBe('jsdelivr');
    expect(res.data.snap.date).toBe('2026-09-14');
    expect(res.data.rep?.date).toBe('2026-09-14');
    expect(res.stale).toBe(false);
  });

  it("② commit='local' 占位 → 内容退回 raw（修复此前 @local 404 死路）", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${RAW}today/latest.json`) return json(makePointer('2026-09-14', '2026-09-14T00:00:00Z', 'local'));
      if (url === `${RAW}today/snapshot-2026-09-14.json`) return json(makeSnapshot());
      // 模拟真实网络：@local 一定 404。若代码仍去请求它，本用例会退化为 source='raw' 之外的结果
      if (url.startsWith('https://cdn.jsdelivr.net/')) return notFound();
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: false, now: Date.now() });
    expect(res.source).toBe('raw');
    expect(res.data.snap.date).toBe('2026-09-14');
  });

  it('②b 指针给出不可变路径 + commit 无效 → 内容仍走 jsDelivr@branch（新 URL 必然回源）', async () => {
    const pointer = {
      ...makePointer('2026-09-14', '2026-09-14T00:00:00Z', 'local'),
      snapshotPath: 'today/snapshot-2026-09-14-0347.json',
      reportPath: 'today/report-2026-09-14-0347.json',
    };
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${RAW}today/latest.json`) return json(pointer);
      if (url === `${JSD_BRANCH}today/snapshot-2026-09-14-0347.json`) return json(makeSnapshot());
      if (url === `${JSD_BRANCH}today/report-2026-09-14-0347.json`) return json(makeReport());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: false, now: Date.now() });
    expect(res.source).toBe('jsdelivr');
    expect(res.data.snap.date).toBe('2026-09-14');
  });

  it('③ jsDelivr 内容层失败 → 降级 raw 取到快照', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${RAW}today/latest.json`) return json(makePointer());
      if (url.startsWith(JSD_COMMIT)) return notFound(); // 该 commit 在 jsDelivr 上 MISS/不可用
      if (url === `${RAW}today/snapshot-2026-09-14.json`) return json(makeSnapshot());
      if (url === `${RAW}today/report-2026-09-14.json`) return json(makeReport());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: false, now: Date.now() });
    expect(res.source).toBe('raw');
    expect(res.data.snap.date).toBe('2026-09-14');
  });

  it('④ 指针 raw 失败 → 降级 jsDelivr@branch 拿指针，内容仍走 commit', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${RAW}today/latest.json`) return new Response('boom', { status: 500 });
      if (url === `${JSD_BRANCH}today/latest.json`) return json(makePointer());
      if (url === `${JSD_COMMIT}today/snapshot-2026-09-14.json`) return json(makeSnapshot());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: false, now: Date.now() });
    expect(res.source).toBe('jsdelivr');
    expect(res.data.snap.date).toBe('2026-09-14');
  });

  it('⑤ 指针里 report 缺位不算失败（rep=null）', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${RAW}today/latest.json`) return json(makePointer());
      if (url === `${JSD_COMMIT}today/snapshot-2026-09-14.json`) return json(makeSnapshot());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: false, now: Date.now() });
    expect(res.data.rep).toBeNull();
    expect(res.source).toBe('jsdelivr');
  });

  it('⑥ dev bridge：latest.json 直接就是快照（内联），source=local', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${LOCAL}today/latest.json`) return json(makeSnapshot());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: true, now: Date.now() });
    expect(res.source).toBe('local');
    expect(res.data.snap.date).toBe('2026-09-14');
  });

  it('⑥b dev bridge：快照自带 reportPath → 拉到同轮次报告', async () => {
    // 报告名带 4 位 UTC 后缀，唯一正确的来源是快照里的声明
    const snap = makeSnapshot('2026-09-14', '2026-09-14T00:00:00Z', 'today/report-2026-09-14-0347.json');
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${LOCAL}today/latest.json`) return json(snap);
      if (url === `${LOCAL}today/report-2026-09-14-0347.json`) return json(makeReport());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: true, now: Date.now() });
    expect(res.source).toBe('local');
    expect(res.data.rep?.date).toBe('2026-09-14');
  });

  it('⑥c dev bridge：快照无 reportPath → rep=null，且**不得**回落去猜固定名', async () => {
    const requested: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      requested.push(url);
      if (url === `${LOCAL}today/latest.json`) return json(makeSnapshot());
      // 旧固定名路径即便"存在"也必须不被访问（否则会静默读到陈旧报告）
      if (url === `${LOCAL}today/report-2026-09-14.json`) return json(makeReport());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: true, now: Date.now() });
    expect(res.data.rep).toBeNull();
    expect(requested.some((u) => u.includes('report-'))).toBe(false);
  });

  it('⑦ 远程全挂 → local 兜底成功', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.startsWith('https://')) throw new Error('network down');
      if (url === `${LOCAL}today/latest.json`) return json(makeSnapshot());
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, preferLocal: false, now: Date.now() });
    expect(res.source).toBe('local');
    expect(res.data.rep).toBeNull();
  });

  it('⑧ 全部来源失败时抛出错误', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('offline');
    };
    await expect(loadLatest({ _fetch: fetchImpl, preferLocal: false })).rejects.toThrow(/offline/);
  });
});

describe('isStale — 120 分钟阈值', () => {
  it('超阈值 / 缺失 / 非法 → true；每小时采集下的典型年龄 → false', () => {
    const now = Date.parse('2026-09-14T10:00:00Z');
    expect(isStale('2026-09-14T07:00:00Z', now)).toBe(true);
    expect(isStale(undefined, now)).toBe(true);
    expect(isStale('not-a-date', now)).toBe(true);

    // 每小时采集下的典型年龄（30 / 60 / 90 分钟）必须都判 fresh，
    // 否则「数据可能非最新」黄条会在正常运行时持续误报。
    expect(isStale('2026-09-14T09:30:00Z', now)).toBe(false);
    expect(isStale('2026-09-14T09:00:00Z', now)).toBe(false);
    expect(isStale('2026-09-14T08:30:00Z', now)).toBe(false);
    // 边界：恰好 120 分钟不算过期（判定用 `>`）
    expect(isStale('2026-09-14T08:00:00Z', now)).toBe(false);
    // 超出一个采集周期才判 stale
    expect(isStale('2026-09-14T07:59:00Z', now)).toBe(true);
  });
});

describe('指针新鲜度校验 — 「CDN 打头」能成立的前提（2026-09-16 新增）', () => {
  const FASTLY = 'https://fastly.jsdelivr.net/gh/Shonee/rss-radar@deploy/';
  const GCORE = 'https://gcore.jsdelivr.net/gh/Shonee/rss-radar@deploy/';
  const NOW = Date.parse('2026-09-16T12:00:00Z');
  /** 36 小时前 —— 远超 120 分钟阈值 */
  const STALE_AT = '2026-09-15T00:00:00Z';
  /** 1 小时前 —— 采集周期内的正常年龄 */
  const FRESH_AT = '2026-09-16T11:00:00Z';

  it('★ CDN 边缘返回陈旧指针 → 继续降级到下一个来源（不能见 HTTP 200 就用）', async () => {
    const pointerHits: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      if (url === `${FASTLY}today/latest.json`) {
        pointerHits.push('fastly');
        return json(makePointer('2026-09-15', STALE_AT)); // 陈旧！CDN 分支引用的长缓存
      }
      if (url === `${GCORE}today/latest.json`) {
        pointerHits.push('gcore');
        return json(makePointer('2026-09-16', FRESH_AT)); // 新鲜
      }
      if (url.endsWith('/today/snapshot-2026-09-16.json')) return json(makeSnapshot('2026-09-16', FRESH_AT));
      if (url.endsWith('/today/report-2026-09-16.json')) return json(makeReport('2026-09-16'));
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, now: NOW, preferLocal: false });
    expect(pointerHits).toEqual(['fastly', 'gcore']);
    expect(res.data.snap.date).toBe('2026-09-16');
    expect(res.stale).toBe(false);
  });

  it('首个来源即新鲜 → 立即采用，不请求后续来源（快速路径不被拖慢）', async () => {
    const pointerHits: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      if (url.endsWith('/today/latest.json')) {
        pointerHits.push(url);
        return json(makePointer('2026-09-16', FRESH_AT));
      }
      if (url.endsWith('/today/snapshot-2026-09-16.json')) return json(makeSnapshot('2026-09-16', FRESH_AT));
      if (url.endsWith('/today/report-2026-09-16.json')) return json(makeReport('2026-09-16'));
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, now: NOW, preferLocal: false });
    expect(pointerHits.length).toBe(1);
    expect(pointerHits[0]).toContain('fastly'); // 顺序首位就是 fastly
    expect(res.data.snap.date).toBe('2026-09-16');
  });

  it('★ 全部来源都陈旧 → 采用兜底指针，但 stale=true（不把旧数据伪装成新的）', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.endsWith('/today/latest.json')) return json(makePointer('2026-09-15', STALE_AT));
      if (url.endsWith('/today/snapshot-2026-09-15.json')) return json(makeSnapshot('2026-09-15', STALE_AT));
      if (url.endsWith('/today/report-2026-09-15.json')) return json(makeReport('2026-09-15'));
      return notFound();
    };

    const res = await loadLatest({ _fetch: fetchImpl, now: NOW, preferLocal: false });
    // 有数据总好过空白页，但必须诚实标记过期
    expect(res.data.snap.date).toBe('2026-09-15');
    expect(res.stale).toBe(true);
  });
});

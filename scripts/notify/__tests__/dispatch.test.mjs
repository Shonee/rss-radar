// scripts/notify/__tests__/dispatch.test.mjs — 编排 dispatch() 单测
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12.6（可靠性）与 §12.7（幂等）
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatch } from '../index.mjs';

const MESSAGE = {
  event: 'dailyReport',
  title: '📡 RSS Radar 日报 · 2026-09-12',
  markdown: '## 日报\n- a',
  text: '日报\na',
  html: '<h2>日报</h2>',
  idempotencyKey: 'daily:2026-09-12',
  meta: { date: '2026-09-12' },
};

const NOW = new Date('2026-09-12T12:00:00+08:00'); // 非静默时段

const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json' },
});

const okFetch = async () => jsonResponse({ errcode: 0, code: 0 });
const failFetch = async () => new Response('', { status: 500 });

function wecomChannel(id = 'wecom-ops') {
  return { id, channelType: 'wecom', enabled: true, events: ['dailyReport'], webhookRef: 'WECOM_WEBHOOK', refs: { webhook: 'WECOM_WEBHOOK' } };
}
function feishuChannel(id = 'feishu-ops') {
  return { id, channelType: 'feishu', enabled: true, events: ['dailyReport'], webhookRef: 'FEISHU_WEBHOOK', refs: { webhook: 'FEISHU_WEBHOOK' } };
}

async function withTmp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'notify-dispatch-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('dispatch：跳过（skipped）语义', () => {
  test('refs 缺失 → skipped，不算失败，不 throw', async () => {
    await withTmp(async (dir) => {
      const config = { defaults: { retry: { max: 0, backoffMs: [] } }, channels: [feishuChannel()] };
      const outcome = await dispatch({
        config, message: MESSAGE, env: {}, fetchImpl: okFetch, sleepImpl: () => {}, now: NOW,
        statePath: join(dir, 'state.json'), statsDir: dir,
      });
      assert.equal(outcome.ok, true); // 无任何渠道被实际尝试
      assert.equal(outcome.results[0].skipped, true);
      assert.equal(outcome.results[0].skipReason, 'missing-env:FEISHU_WEBHOOK');
    });
  });

  test('disabled / not-subscribed 分别记录原因', async () => {
    await withTmp(async (dir) => {
      const disabled = { ...wecomChannel('wc-disabled'), enabled: false };
      const notSub = { id: 'wc-rt', channelType: 'wecom', enabled: true, events: ['realtime'], webhookRef: 'WECOM_WEBHOOK', refs: { webhook: 'WECOM_WEBHOOK' } };
      const outcome = await dispatch({
        config: { channels: [disabled, notSub] }, message: MESSAGE, env: { WECOM_WEBHOOK: 'https://x' },
        fetchImpl: okFetch, sleepImpl: () => {}, now: NOW, statePath: join(dir, 'state.json'), statsDir: dir,
      });
      const reasons = outcome.results.map((r) => r.skipReason);
      assert.ok(reasons.includes('disabled'));
      assert.ok(reasons.includes('not-subscribed'));
    });
  });
});

describe('dispatch：失败隔离', () => {
  test('单渠道失败不影响其他渠道（整体不 throw）', async () => {
    await withTmp(async (dir) => {
      const config = {
        defaults: { retry: { max: 0, backoffMs: [] } },
        channels: [feishuChannel(), wecomChannel()],
      };
      // feishu 失败、wecom 成功 → 按 URL 分派
      const fetchImpl = async (url) => (url.includes('feishu') ? failFetch() : okFetch());
      const outcome = await dispatch({
        config, message: MESSAGE,
        env: { FEISHU_WEBHOOK: 'https://open.feishu.cn/hook', WECOM_WEBHOOK: 'https://qyapi.weixin.qq.com/hook' },
        fetchImpl, sleepImpl: () => {}, now: NOW, statePath: join(dir, 'state.json'), statsDir: dir,
      });
      assert.equal(outcome.ok, true);
      const feishu = outcome.results.find((r) => r.channelId === 'feishu-ops');
      const wecom = outcome.results.find((r) => r.channelId === 'wecom-ops');
      assert.equal(feishu.ok, false);
      assert.match(feishu.error, /HTTP 500/);
      assert.equal(wecom.ok, true);
    });
  });

  test('全部渠道失败 → throw（且结果可读）', async () => {
    await withTmp(async (dir) => {
      const config = {
        defaults: { retry: { max: 1, backoffMs: [0] } },
        channels: [feishuChannel(), wecomChannel()],
      };
      await assert.rejects(
        () => dispatch({
          config, message: MESSAGE,
          env: { FEISHU_WEBHOOK: 'https://f', WECOM_WEBHOOK: 'https://w' },
          fetchImpl: failFetch, sleepImpl: () => {}, now: NOW, statePath: join(dir, 'state.json'), statsDir: dir,
        }),
        (err) => {
          assert.match(err.message, /全部发送失败/);
          assert.equal(err.outcome.results.every((r) => !r.ok), true);
          return true;
        },
      );
    });
  });

  test('未知 channelType 被记录为失败但不影响成功渠道', async () => {
    await withTmp(async (dir) => {
      const pigeon = { id: 'pigeon', channelType: 'carrier-pigeon', enabled: true, events: ['dailyReport'], refs: {} };
      const config = { defaults: { retry: { max: 0, backoffMs: [] } }, channels: [pigeon, wecomChannel()] };
      const outcome = await dispatch({
        config, message: MESSAGE, env: { WECOM_WEBHOOK: 'https://w' },
        fetchImpl: okFetch, sleepImpl: () => {}, now: NOW, statePath: join(dir, 'state.json'), statsDir: dir,
      });
      const p = outcome.results.find((r) => r.channelId === 'pigeon');
      assert.equal(p.ok, false);
      assert.match(p.error, /unknown notify channelType/);
      assert.equal(outcome.ok, true);
    });
  });
});

describe('dispatch：结果记录落盘', () => {
  test('成功发送写出 stats/notify-<ts>.json（含 summary）', async () => {
    await withTmp(async (dir) => {
      const config = { defaults: { retry: { max: 0, backoffMs: [] } }, channels: [wecomChannel()] };
      const outcome = await dispatch({
        config, message: MESSAGE, env: { WECOM_WEBHOOK: 'https://w' },
        fetchImpl: okFetch, sleepImpl: () => {}, now: NOW, statePath: join(dir, 'state.json'), statsDir: dir,
      });
      assert.ok(outcome.stateFile, '应返回 stateFile 路径');
      const files = (await readdir(dir)).filter((f) => f.startsWith('notify-'));
      assert.equal(files.length, 1);
      const rec = JSON.parse(await readFile(join(dir, files[0]), 'utf8'));
      assert.equal(rec.event, 'dailyReport');
      assert.equal(rec.idempotencyKey, 'daily:2026-09-12');
      assert.equal(rec.summary.sent, 1);
      assert.equal(rec.results[0].channelId, 'wecom-ops');
      assert.equal(typeof rec.results[0].durationMs, 'number');
    });
  });

  test('失败也写记录（failed 计数）', async () => {
    await withTmp(async (dir) => {
      const config = { defaults: { retry: { max: 0, backoffMs: [] } }, channels: [wecomChannel()] };
      await assert.rejects(() => dispatch({
        config, message: MESSAGE, env: { WECOM_WEBHOOK: 'https://w' },
        fetchImpl: failFetch, sleepImpl: () => {}, now: NOW, statePath: join(dir, 'state.json'), statsDir: dir,
      }));
      const files = (await readdir(dir)).filter((f) => f.startsWith('notify-'));
      assert.equal(files.length, 1);
      const rec = JSON.parse(await readFile(join(dir, files[0]), 'utf8'));
      assert.equal(rec.summary.failed, 1);
    });
  });

  test('dry-run 不写状态、不写 stats', async () => {
    await withTmp(async (dir) => {
      const config = { channels: [wecomChannel()] };
      const outcome = await dispatch({
        config, message: MESSAGE, env: { WECOM_WEBHOOK: 'https://w' },
        fetchImpl: okFetch, sleepImpl: () => {}, now: NOW, dryRun: true,
        statePath: join(dir, 'state.json'), statsDir: dir,
      });
      assert.equal(outcome.results[0].skipReason, 'dry-run');
      assert.equal(outcome.stateFile, undefined);
      assert.equal((await readdir(dir)).length, 0);
    });
  });
});

describe('dispatch：幂等（事件级去重）', () => {
  test('首次成功 → 状态落盘；同日再发被 duplicate-event 跳过', async () => {
    await withTmp(async (dir) => {
      const config = { defaults: { retry: { max: 0, backoffMs: [] } }, channels: [wecomChannel()] };
      const statePath = join(dir, 'state.json');
      const opts = {
        config, message: MESSAGE, env: { WECOM_WEBHOOK: 'https://w' },
        fetchImpl: okFetch, sleepImpl: () => {}, now: NOW, statePath, statsDir: dir,
      };
      const first = await dispatch(opts);
      assert.equal(first.ok, true);

      const second = await dispatch(opts);
      assert.equal(second.results[0].skipped, true);
      assert.equal(second.results[0].skipReason, 'duplicate-event');
    });
  });

  test('实时事件：realtime.enabled=false → realtime-disabled', async () => {
    await withTmp(async (dir) => {
      const rt = { ...wecomChannel(), events: ['realtime'] };
      const config = { realtime: { enabled: false }, channels: [rt] };
      const msg = { ...MESSAGE, event: 'realtime', idempotencyKey: 'realtime:it_x', meta: { itemId: 'it_x' } };
      const outcome = await dispatch({
        config, message: msg, env: { WECOM_WEBHOOK: 'https://w' },
        fetchImpl: okFetch, sleepImpl: () => {}, now: NOW, statePath: join(dir, 'state.json'), statsDir: dir,
      });
      assert.equal(outcome.results[0].skipped, true);
      assert.equal(outcome.results[0].skipReason, 'realtime-disabled');
    });
  });
});

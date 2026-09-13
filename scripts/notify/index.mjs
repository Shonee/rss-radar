// scripts/notify/index.mjs — 通知模块编排 API
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12（通知模块）
//
// 导出：
//   buildDailyDigest({ report, siteConfig, date })  → message（日报）
//   buildRealtime({ items, trigger, now })          → message（实时）
//   dispatch({ config, message, env, fetchImpl, transportFactory, ... }) → outcome
//
// dispatch 返回结构：
//   {
//     event, idempotencyKey, ok, allFailed, stateFile,
//     message,
//     results: [{ channelId, channelType, event, idempotencyKey,
//                 ok, durationMs, status?, error?, skipped?, skipReason? }, ...]
//   }
// 语义（ARCH §12.6）：
//   - 单渠道异常被吞掉并记录，返回值体现失败；
//   - 只有「所有被尝试的渠道都失败」时才 throw；
//   - 被 disabled / 未订阅 / 缺环境变量 / 被节流 的渠道记 skipped，不算失败。

import { get as getAdapter } from './channels/index.mjs';
import {
  renderDailyDigestMarkdown,
  renderRealtimeMarkdown,
  markdownToText,
  markdownToHtml,
} from './template.mjs';
import { shouldSend } from './throttle.mjs';
import { localDate, localHHmm, toDate } from './lib/clock.mjs';
import { backoff } from '../collect/lib/retry.mjs';
import {
  idempotencyKey,
  emptyState,
  normalizeState,
  readState,
  writeState,
  applySend,
  writeNotifyRecord,
  DEFAULT_STATE_PATH,
  DEFAULT_STATS_DIR,
} from './lib/idempotency.mjs';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 构造日报消息。
 * @param {Object} params
 * @param {Object} [params.report={}]
 * @param {Object} [params.siteConfig={}]
 * @param {string} [params.date]
 * @param {Object} [params.env=process.env]
 * @returns {Object} message
 */
export function buildDailyDigest({ report = {}, siteConfig = {}, date, env = process.env } = {}) {
  const d = date ?? report.date ?? localDate();
  const markdown = renderDailyDigestMarkdown({ report, siteConfig, date: d, env });
  const title = `📡 RSS Radar 日报 · ${d}`;
  return {
    event: 'dailyReport',
    title,
    markdown,
    text: markdownToText(markdown),
    html: markdownToHtml(markdown, { title }),
    idempotencyKey: idempotencyKey('dailyReport', { date: d }),
    meta: { date: d },
  };
}

/**
 * 构造实时热点消息。
 * @param {Object} params
 * @param {Array<Object>} [params.items=[]]
 * @param {Object} [params.trigger={}]
 * @param {Date|number|string} [params.now=new Date()]
 * @returns {Object} message
 */
export function buildRealtime({ items = [], trigger = {}, now = new Date() } = {}) {
  const time = trigger.time ?? localHHmm(now);
  const markdown = renderRealtimeMarkdown({ items, trigger, time });
  const title = `⚡ RSS Radar 实时热点 · ${time}`;
  const representativeId = trigger.itemId ?? items[0]?.id ?? `batch-${toDate(now).getTime()}`;
  return {
    event: 'realtime',
    title,
    markdown,
    text: markdownToText(markdown),
    html: markdownToHtml(markdown, { title }),
    idempotencyKey: idempotencyKey('realtime', { itemId: representativeId }),
    meta: { time, itemId: representativeId, itemIds: items.map((i) => i.id).filter(Boolean) },
  };
}

/**
 * 带重试地调用单个渠道适配器（skipped 不重试）。
 * @returns {Promise<Object>} 适配器结果
 */
async function sendWithRetry({ adapter, channel, message, env, fetchImpl, transportFactory, maxRetries, backoffMs, sleepImpl, logger }) {
  let last = { ok: false, error: 'not attempted' };
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const r = await adapter.send({ channel, message, env, fetchImpl, transportFactory });
      if (r && r.skipped) return r; // 缺配置：不重试
      if (r && r.ok) return r;
      last = r ?? { ok: false, error: 'adapter returned empty result' };
    } catch (err) {
      last = { ok: false, error: err?.message ?? String(err) };
    }
    if (attempt < maxRetries) {
      const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 0;
      logger?.warn?.(`[notify] 重试 ${attempt + 1}/${maxRetries} channel=${channel.id}: ${last.error ?? 'failed'}`);
      if (delay > 0) await sleepImpl(delay);
    }
  }
  return last;
}

/**
 * 分发消息到订阅该事件的所有渠道。
 * @param {Object} options
 * @param {Object} options.config                  notify 配置（config/notify.json）
 * @param {Object} options.message                 buildDailyDigest / buildRealtime 的产物
 * @param {Object} [options.env=process.env]       密钥来源（只读 process.env[ref]）
 * @param {Function} [options.fetchImpl=fetch]
 * @param {Function} [options.transportFactory]    SMTP 注入
 * @param {Object} [options.state]                 预载状态（给则不再读文件）
 * @param {string} [options.statePath=DEFAULT_STATE_PATH]
 * @param {string} [options.statsDir=DEFAULT_STATS_DIR]
 * @param {Date|number|string} [options.now=new Date()]
 * @param {boolean} [options.dryRun=false]
 * @param {Function} [options.sleepImpl]           重试等待注入（测试传 no-op）
 * @param {Object} [options.logger=console]
 * @returns {Promise<Object>} outcome
 */
export async function dispatch(options = {}) {
  const {
    config = {},
    message,
    env = process.env,
    fetchImpl = globalThis.fetch,
    transportFactory,
    state,
    statePath = DEFAULT_STATE_PATH,
    statsDir = DEFAULT_STATS_DIR,
    now = new Date(),
    dryRun = false,
    sleepImpl = defaultSleep,
    logger = console,
  } = options;

  if (!message || !message.event) throw new Error('dispatch: message.event 必填');
  const event = message.event;
  const nowDate = toDate(now);
  const startedAt = Date.now();

  const retryCfg = config.defaults?.retry ?? {};
  const maxRetries = Number.isFinite(retryCfg.max) ? retryCfg.max : 2;
  const backoffMs = Array.isArray(retryCfg.backoffMs) && retryCfg.backoffMs.length > 0
    ? retryCfg.backoffMs
    : [backoff(0), backoff(1)]; // 复用 collect/lib/retry.mjs 的退避默认（1s, 3s）

  const channels = Array.isArray(config.channels) ? config.channels : [];

  // —— 载入状态 ——
  let currentState;
  if (state !== undefined) currentState = normalizeState(state);
  else if (statePath && !dryRun) currentState = await readState(statePath);
  else currentState = emptyState();

  // —— 节流闸门（消息级，一次判定）——
  let gate;
  if (dryRun) {
    gate = { allow: true };
  } else if (event === 'realtime' && config.realtime?.enabled === false) {
    gate = { allow: false, reason: 'realtime-disabled' };
  } else {
    const gateConfig = {
      quietHours: config.quietHours,
      realtime: config.realtime,
      minRealtimeIntervalMs: config.minRealtimeIntervalMs,
    };
    if (event === 'dailyReport' && message.meta?.date) gateConfig.date = message.meta.date;
    gate = shouldSend({ state: currentState, event, itemId: message.meta?.itemId, now: nowDate, config: gateConfig });
  }

  const results = [];
  const baseFor = (channel) => ({
    channelId: channel.id,
    channelType: channel.channelType,
    event,
    idempotencyKey: message.idempotencyKey,
  });

  for (const channel of channels) {
    const subscribed = Array.isArray(channel.events) && channel.events.includes(event);
    if (!channel.enabled) {
      results.push({ ...baseFor(channel), ok: false, skipped: true, skipReason: 'disabled', durationMs: 0 });
      continue;
    }
    if (!subscribed) {
      results.push({ ...baseFor(channel), ok: false, skipped: true, skipReason: 'not-subscribed', durationMs: 0 });
      continue;
    }
    if (!gate.allow) {
      results.push({ ...baseFor(channel), ok: false, skipped: true, skipReason: gate.reason, durationMs: 0 });
      continue;
    }
    if (dryRun) {
      results.push({ ...baseFor(channel), ok: false, skipped: true, skipReason: 'dry-run', durationMs: 0 });
      continue;
    }

    let adapter;
    try {
      adapter = getAdapter(channel.channelType);
    } catch (err) {
      results.push({ ...baseFor(channel), ok: false, error: err?.message ?? String(err), durationMs: 0 });
      continue;
    }

    // 缺环境变量预检（密钥只读 process.env[ref]）→ skipped，不算失败
    const missing = (typeof adapter.requiredRefs === 'function' ? adapter.requiredRefs(channel) : [])
      .filter((refName) => refName && !env[refName]);
    if (missing.length > 0) {
      results.push({
        ...baseFor(channel),
        ok: false,
        skipped: true,
        skipReason: `missing-env:${missing[0]}`,
        durationMs: 0,
      });
      continue;
    }

    const t0 = Date.now();
    const attempt = await sendWithRetry({
      adapter,
      channel,
      message,
      env,
      fetchImpl,
      transportFactory,
      maxRetries,
      backoffMs,
      sleepImpl,
      logger,
    });
    const durationMs = Date.now() - t0;
    results.push({
      ...baseFor(channel),
      ok: !!attempt.ok,
      status: attempt.status,
      error: attempt.error,
      skipped: !!attempt.skipped,
      skipReason: attempt.skipReason,
      durationMs,
    });
  }

  const attempted = results.filter((r) => !r.skipped);
  const anyOk = results.some((r) => r.ok && !r.skipped);
  const allFailed = attempted.length > 0 && !anyOk;

  // —— 落盘：状态 + 结果记录 ——
  let stateFile;
  if (!dryRun) {
    if (anyOk) {
      currentState = applySend(currentState, {
        key: message.idempotencyKey,
        event,
        itemId: message.meta?.itemId,
        date: message.meta?.date,
        now: nowDate,
      });
      if (statePath) {
        try {
          await writeState(statePath, currentState);
        } catch (err) {
          logger?.warn?.(`[notify] 状态写入失败：${err?.message ?? String(err)}`);
        }
      }
    }
    const record = {
      schemaVersion: '1.0',
      generatedAt: nowDate.toISOString(),
      event,
      idempotencyKey: message.idempotencyKey,
      date: message.meta?.date ?? null,
      durationMs: Date.now() - startedAt,
      results: results.map((r) => ({
        channelId: r.channelId,
        channelType: r.channelType,
        ok: r.ok,
        skipped: !!r.skipped,
        skipReason: r.skipReason ?? null,
        status: r.status ?? null,
        error: r.error ?? null,
        durationMs: r.durationMs,
      })),
      summary: {
        total: results.length,
        sent: results.filter((r) => r.ok && !r.skipped).length,
        failed: attempted.filter((r) => !r.ok).length,
        skipped: results.filter((r) => r.skipped).length,
      },
    };
    try {
      stateFile = await writeNotifyRecord(statsDir, record, nowDate);
    } catch (err) {
      logger?.warn?.(`[notify] 结果记录写入失败：${err?.message ?? String(err)}`);
    }
  }

  const outcome = {
    event,
    idempotencyKey: message.idempotencyKey,
    ok: anyOk || attempted.length === 0,
    allFailed,
    stateFile,
    results,
    message,
  };

  if (allFailed) {
    // ARCH §12.6：只有全部渠道都失败 → workflow 标红（此处 throw 让上层非零退出）
    const err = new Error(`[notify] ${attempted.length} 个渠道全部发送失败（${message.idempotencyKey}）`);
    err.results = results;
    err.outcome = outcome;
    throw err;
  }
  return outcome;
}

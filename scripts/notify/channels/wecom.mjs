// scripts/notify/channels/wecom.mjs — 企业微信渠道适配器（群机器人 webhook + 应用消息）
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12.2（企业微信）与 §12.4
//
// 两种形态：
//   - webhook：群机器人，key 在 URL 中，{"msgtype":"markdown","markdown":{"content":"..."}}
//   - app    ：应用消息，corpid+corpsecret → access_token，
//              POST /cgi-bin/message/send?access_token=..
//              body {"touser","msgtype":"markdown","markdown":{"content":"..."}}

/** 渠道类型标识（registry 键） */
export const type = 'wecom';

const WECOM_BASE = 'https://qyapi.weixin.qq.com';

function webhookRef(channel = {}) {
  return channel.webhookRef ?? channel.refs?.webhook;
}
function corpSecretRef(channel = {}) {
  return channel.refs?.corpSecret ?? channel.corpSecretRef;
}

/**
 * 判定形态（webhook / app）。
 * @param {Object} [channel={}]
 * @returns {'webhook'|'app'}
 */
export function mode(channel = {}) {
  if (channel.mode === 'webhook' || channel.mode === 'app') return channel.mode;
  if (webhookRef(channel)) return 'webhook';
  if (channel.corpId && corpSecretRef(channel)) return 'app';
  return 'webhook';
}

/**
 * 本渠道依赖的环境变量名（用于 dispatch 预检）。
 * @param {Object} [channel={}]
 * @returns {string[]}
 */
export function requiredRefs(channel = {}) {
  if (mode(channel) === 'app') return [corpSecretRef(channel)].filter(Boolean);
  return [webhookRef(channel)].filter(Boolean);
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 发送（自动分派 webhook / app）。
 * @param {Object} params
 * @param {Object} params.channel
 * @param {Object} params.message
 * @param {Object} [params.env=process.env]
 * @param {Function} [params.fetchImpl=fetch]
 * @returns {Promise<{ok:boolean,status?:number,error?:string,skipped?:boolean,skipReason?:string}>}
 */
export async function send({ channel = {}, message = {}, env = process.env, fetchImpl = fetch } = {}) {
  if (mode(channel) === 'app') return sendApp({ channel, message, env, fetchImpl });
  return sendWebhook({ channel, message, env, fetchImpl });
}

/** 群机器人 webhook 形态（key 在 URL 中） */
async function sendWebhook({ channel, message, env, fetchImpl }) {
  const ref = webhookRef(channel);
  const url = ref ? env[ref] : undefined;
  if (!url) return { ok: false, skipped: true, skipReason: `missing-env:${ref}` };

  const body = { msgtype: 'markdown', markdown: { content: message.markdown ?? '' } };
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  const status = res?.status ?? 0;
  if (!res || status >= 400) return { ok: false, status, error: `HTTP ${status}` };
  const data = await safeJson(res);
  if (data && typeof data.errcode === 'number' && data.errcode !== 0) {
    return { ok: false, status, error: `wecom errcode=${data.errcode} ${data.errmsg ?? ''}`.trim() };
  }
  return { ok: true, status };
}

/** 应用消息形态 */
async function sendApp({ channel, message, env, fetchImpl }) {
  const secRef = corpSecretRef(channel);
  const corpSecret = secRef ? env[secRef] : undefined;
  if (secRef && !corpSecret) return { ok: false, skipped: true, skipReason: `missing-env:${secRef}` };
  const corpId = channel.corpId;
  if (!corpId) return { ok: false, error: 'wecom app 形态缺少 corpId' };

  const tokenUrl = `${WECOM_BASE}/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret ?? '')}`;
  let tokenRes;
  try {
    tokenRes = await fetchImpl(tokenUrl, { method: 'GET' });
  } catch (err) {
    return { ok: false, error: `token request failed: ${err?.message ?? String(err)}` };
  }
  const tokenData = await safeJson(tokenRes);
  const token = tokenData?.access_token;
  if (!token) {
    return { ok: false, status: tokenRes?.status, error: `wecom: 未取得 access_token (errcode=${tokenData?.errcode ?? '-'})` };
  }

  const url = `${WECOM_BASE}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
  const body = {
    touser: channel.toUser ?? channel.toParty ?? '@all',
    msgtype: 'markdown',
    markdown: { content: message.markdown ?? '' },
    agentid: channel.agentId,
  };
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  const status = res?.status ?? 0;
  if (!res || status >= 400) return { ok: false, status, error: `HTTP ${status}` };
  const data = await safeJson(res);
  if (data && typeof data.errcode === 'number' && data.errcode !== 0) {
    return { ok: false, status, error: `wecom errcode=${data.errcode} ${data.errmsg ?? ''}`.trim() };
  }
  return { ok: true, status };
}

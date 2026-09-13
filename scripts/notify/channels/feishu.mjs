// scripts/notify/channels/feishu.mjs — 飞书渠道适配器（群机器人 webhook + 应用消息）
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12.2（飞书）与 §12.4
//
// 两种形态：
//   - webhook：自定义群机器人，{"msg_type":"text","content":{"text":"..."}}
//   - app    ：开放平台应用消息，tenant_access_token + POST /open-apis/im/v1/messages
//
// ⚠️ 飞书加签算法（ARCH §12.2 硬警示：与钉钉形似但不同，禁止抽公共函数）：
//     key = timestamp(秒) + "\n" + secret，message = ""（空串）
//     sign = base64(HmacSHA256(key, message))
//     签名放 JSON body 的 timestamp / sign 字段。

import { createHmac } from 'node:crypto';

/** 渠道类型标识（registry 键） */
export const type = 'feishu';

const FEISHU_BASE = 'https://open.feishu.cn';

function webhookRef(channel = {}) {
  return channel.webhookRef ?? channel.refs?.webhook;
}
function signSecretRef(channel = {}) {
  return channel.signSecretRef ?? channel.refs?.signSecret;
}
function appIdRef(channel = {}) {
  return channel.refs?.appId ?? channel.appIdRef;
}
function appSecretRef(channel = {}) {
  return channel.refs?.appSecret ?? channel.appSecretRef;
}

/**
 * 判定形态（webhook / app）。
 * @param {Object} [channel={}]
 * @returns {'webhook'|'app'}
 */
export function mode(channel = {}) {
  if (channel.mode === 'webhook' || channel.mode === 'app') return channel.mode;
  if (webhookRef(channel)) return 'webhook';
  if (channel.appId || appIdRef(channel) || appSecretRef(channel)) return 'app';
  return 'webhook';
}

/**
 * 本渠道依赖的环境变量名（用于 dispatch 预检）。
 * webhook 形态：webhook（+可选 signSecret）；app 形态：appId、appSecret。
 * @param {Object} [channel={}]
 * @returns {string[]}
 */
export function requiredRefs(channel = {}) {
  if (mode(channel) === 'app') {
    return [appIdRef(channel), appSecretRef(channel)].filter(Boolean);
  }
  return [webhookRef(channel)].filter(Boolean);
}

/**
 * 飞书加签（独立实现，勿与钉钉复用）。
 * @param {number} timestampSec 秒级时间戳
 * @param {string} secret
 * @returns {string} base64 签名
 */
export function feishuSign(timestampSec, secret) {
  const key = `${timestampSec}\n${secret}`;
  const hmac = createHmac('sha256', key);
  hmac.update(''); // message = 空串
  return hmac.digest('base64');
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

/** 群机器人 webhook 形态 */
async function sendWebhook({ channel, message, env, fetchImpl }) {
  const ref = webhookRef(channel);
  const url = ref ? env[ref] : undefined;
  if (!url) return { ok: false, skipped: true, skipReason: `missing-env:${ref}` };

  const body = { msg_type: 'text', content: { text: message.text ?? message.markdown ?? '' } };

  const secretRef = signSecretRef(channel);
  const secret = secretRef ? env[secretRef] : undefined;
  if (secretRef && !secret) return { ok: false, skipped: true, skipReason: `missing-env:${secretRef}` };
  if (secret) {
    const timestampSec = Math.floor(Date.now() / 1000);
    body.timestamp = String(timestampSec);
    body.sign = feishuSign(timestampSec, secret);
  }

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
  if (data && typeof data.code === 'number' && data.code !== 0) {
    return { ok: false, status, error: `feishu code=${data.code} ${data.msg ?? ''}`.trim() };
  }
  return { ok: true, status };
}

/** 应用消息形态 */
async function sendApp({ channel, message, env, fetchImpl }) {
  const idRef = appIdRef(channel);
  const secRef = appSecretRef(channel);
  const appId = idRef ? env[idRef] : undefined;
  const appSecret = secRef ? env[secRef] : undefined;
  if (!appId) return { ok: false, skipped: true, skipReason: `missing-env:${idRef}` };
  if (!appSecret) return { ok: false, skipped: true, skipReason: `missing-env:${secRef}` };

  const receiveIdType = channel.receiveIdType ?? 'open_id';
  const receiveId = channel.receiveId ?? channel.toUser;

  let tokenRes;
  try {
    tokenRes = await fetchImpl(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
  } catch (err) {
    return { ok: false, error: `token request failed: ${err?.message ?? String(err)}` };
  }
  const tokenData = await safeJson(tokenRes);
  const token = tokenData?.tenant_access_token;
  if (!token) return { ok: false, status: tokenRes?.status, error: 'feishu: 未取得 tenant_access_token' };

  const url = `${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`;
  const body = {
    receive_id: receiveId,
    msg_type: 'text',
    content: JSON.stringify({ text: message.text ?? message.markdown ?? '' }),
  };
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  const status = res?.status ?? 0;
  if (!res || status >= 400) return { ok: false, status, error: `HTTP ${status}` };
  const data = await safeJson(res);
  if (data && typeof data.code === 'number' && data.code !== 0) {
    return { ok: false, status, error: `feishu code=${data.code} ${data.msg ?? ''}`.trim() };
  }
  return { ok: true, status };
}

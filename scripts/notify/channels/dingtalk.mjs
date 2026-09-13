// scripts/notify/channels/dingtalk.mjs — 钉钉渠道适配器（群机器人 webhook + HMAC-SHA256 加签）
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12.2（钉钉）与 §12.4
//
// 消息体：{"msgtype":"markdown","markdown":{"title":"...","text":"..."}}
//
// ⚠️ 钉钉加签算法（ARCH §12.2 硬警示：与飞书形似但不同，禁止抽公共函数）：
//     stringToSign = timestamp(毫秒) + "\n" + secret
//     sign = urlEncode(base64(HmacSHA256(key=secret, data=stringToSign)))
//     签名放 URL 查询参数 &timestamp=<ms>&sign=<sign>。
//     即：把 stringToSign 当「数据」、secret 当「密钥」（与飞书相反）。

import { createHmac } from 'node:crypto';

/** 渠道类型标识（registry 键） */
export const type = 'dingtalk';

function webhookRef(channel = {}) {
  return channel.webhookRef ?? channel.refs?.webhook;
}
function signSecretRef(channel = {}) {
  return channel.signSecretRef ?? channel.refs?.signSecret;
}

/**
 * 本渠道依赖的环境变量名（用于 dispatch 预检）。
 * @param {Object} [channel={}]
 * @returns {string[]}
 */
export function requiredRefs(channel = {}) {
  return [webhookRef(channel), signSecretRef(channel)].filter(Boolean);
}

/**
 * 钉钉加签（独立实现，勿与飞书复用）。
 * @param {number} timestampMs 毫秒级时间戳
 * @param {string} secret
 * @returns {string} URL 编码后的 base64 签名
 */
export function dingtalkSign(timestampMs, secret) {
  const stringToSign = `${timestampMs}\n${secret}`;
  const hmac = createHmac('sha256', secret); // key = secret
  hmac.update(stringToSign); // data = stringToSign
  return encodeURIComponent(hmac.digest('base64'));
}

/**
 * 发送。
 * @param {Object} params
 * @param {Object} params.channel
 * @param {Object} params.message
 * @param {Object} [params.env=process.env]
 * @param {Function} [params.fetchImpl=fetch]
 * @returns {Promise<{ok:boolean,status?:number,error?:string,skipped?:boolean,skipReason?:string}>}
 */
export async function send({ channel = {}, message = {}, env = process.env, fetchImpl = fetch } = {}) {
  const ref = webhookRef(channel);
  const baseUrl = ref ? env[ref] : undefined;
  if (!baseUrl) return { ok: false, skipped: true, skipReason: `missing-env:${ref}` };

  const secretRef = signSecretRef(channel);
  const secret = secretRef ? env[secretRef] : undefined;
  if (secretRef && !secret) return { ok: false, skipped: true, skipReason: `missing-env:${secretRef}` };

  // 加签：签名在 URL 查询参数上
  let url = baseUrl;
  if (secret) {
    const timestampMs = Date.now();
    const sep = url.includes('?') ? '&' : '?';
    url = `${url}${sep}timestamp=${timestampMs}&sign=${dingtalkSign(timestampMs, secret)}`;
  }

  const body = {
    msgtype: 'markdown',
    markdown: { title: message.title ?? 'RSS Radar', text: message.markdown ?? '' },
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

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (data && typeof data.errcode === 'number' && data.errcode !== 0) {
    return { ok: false, status, error: `dingtalk errcode=${data.errcode} ${data.errmsg ?? ''}`.trim() };
  }
  return { ok: true, status };
}

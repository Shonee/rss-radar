// scripts/notify/channels/email.mjs — 邮箱渠道适配器（nodemailer SMTP）
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12.2（邮箱）与 §12.5（密钥引用）
//
// 约定：
//   - 统一接口 send({ channel, message, env, fetchImpl, transportFactory })
//   - 密钥只通过 process.env[ref] 读取，配置内绝无明文（ARCH §12.5 硬约束）
//   - transportFactory 可注入（默认 nodemailer.createTransport），单测不真连 SMTP

import nodemailer from 'nodemailer';

/** 渠道类型标识（registry 键） */
export const type = 'email';

/**
 * 本渠道依赖的环境变量名（GitHub Secrets 变量名），用于 dispatch 预检。
 * @param {Object} [channel={}]
 * @returns {string[]}
 */
export function requiredRefs(channel = {}) {
  return [channel.refs?.password ?? channel.passwordRef].filter(Boolean);
}

/**
 * 发送邮件。subject=消息标题，html=模板 HTML，text=模板纯文本（multipart 兜底）。
 * @param {Object} params
 * @param {Object} params.channel
 * @param {Object} params.message
 * @param {Object} [params.env=process.env]
 * @param {Function} [params.transportFactory]  (options) => transporter
 * @returns {Promise<{ok:boolean,status?:number,error?:string,skipped?:boolean,skipReason?:string}>}
 */
export async function send({ channel = {}, message = {}, env = process.env, transportFactory } = {}) {
  const passwordRef = channel.refs?.password ?? channel.passwordRef;
  const password = passwordRef ? env[passwordRef] : undefined;
  if (passwordRef && !password) {
    return { ok: false, skipped: true, skipReason: `missing-env:${passwordRef}` };
  }

  const factory = transportFactory ?? nodemailer.createTransport.bind(nodemailer);
  const transportOptions = {
    host: channel.smtpHost,
    port: channel.smtpPort,
    secure: channel.secure ?? true,
    auth: { user: channel.from, pass: password },
  };

  let transporter;
  try {
    transporter = factory(transportOptions);
  } catch (err) {
    return { ok: false, error: `transport init failed: ${err?.message ?? String(err)}` };
  }
  if (!transporter || typeof transporter.sendMail !== 'function') {
    return { ok: false, error: 'transportFactory 未返回带 sendMail() 的 transporter' };
  }

  try {
    const info = await transporter.sendMail({
      from: channel.from,
      to: Array.isArray(channel.to) ? channel.to.join(',') : channel.to,
      subject: message.title,
      text: message.text,
      html: message.html,
    });
    return { ok: true, status: 250, messageId: info?.messageId };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// scripts/notify/__tests__/channels.test.mjs — 4 渠道适配器单测（全走注入，不真发）
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12.2
//
// 断言重点：请求体形态 + 鉴权位置
//   - 钉钉 sign 在 URL（查询参数）
//   - 飞书 sign 在 body（JSON 字段）
//   - 企微 webhook key 在 URL
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as email from '../channels/email.mjs';
import * as feishu from '../channels/feishu.mjs';
import * as dingtalk from '../channels/dingtalk.mjs';
import * as wecom from '../channels/wecom.mjs';
import { dingtalkSign, type as DT_TYPE } from '../channels/dingtalk.mjs';
import { feishuSign, type as FS_TYPE } from '../channels/feishu.mjs';
import { dispatch } from '../index.mjs';

const MESSAGE = {
  event: 'dailyReport',
  title: '📡 RSS Radar 日报 · 2026-09-12',
  markdown: '## 📡 RSS Radar 日报\n**加粗**\n- 条目',
  text: 'RSS Radar 日报\n加粗\n条目',
  html: '<h2>RSS Radar 日报</h2>',
  idempotencyKey: 'daily:2026-09-12',
  meta: { date: '2026-09-12' },
};

const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json' },
});

describe('email 适配器（nodemailer SMTP，注入 transportFactory）', () => {
  test('读取 refs.password 并构造 sendMail 参数', async () => {
    const calls = [];
    const transportFactory = (opts) => ({
      sendMail: async (mail) => { calls.push({ opts, mail }); return { messageId: 'm1' }; },
    });
    const channel = { id: 'email-main', channelType: 'email', smtpHost: 'smtp.test', smtpPort: 465, secure: true, from: 'radar@test', to: ['a@test', 'b@test'], refs: { password: 'SMTP_PASSWORD' } };
    const r = await email.send({ channel, message: MESSAGE, env: { SMTP_PASSWORD: 'pw' }, transportFactory });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.host, 'smtp.test');
    assert.equal(calls[0].opts.auth.pass, 'pw');
    assert.equal(calls[0].mail.to, 'a@test,b@test');
    assert.equal(calls[0].mail.subject, MESSAGE.title);
    assert.equal(calls[0].mail.html, MESSAGE.html);
  });

  test('缺 SMTP_PASSWORD → skipped', async () => {
    const channel = { id: 'email-main', channelType: 'email', refs: { password: 'SMTP_PASSWORD' } };
    const r = await email.send({ channel, message: MESSAGE, env: {}, transportFactory: () => ({ sendMail: async () => ({}) }) });
    assert.equal(r.skipped, true);
    assert.equal(r.skipReason, 'missing-env:SMTP_PASSWORD');
  });
});

describe('feishu 适配器（webhook + 应用消息）', () => {
  test('webhook：text 形态；sign 在 body（非 URL）', async () => {
    const captured = [];
    const fetchImpl = async (url, opts) => { captured.push({ url, body: JSON.parse(opts.body) }); return jsonResponse({ code: 0 }); };
    const channel = { id: 'feishu-ops', channelType: 'feishu', webhookRef: 'FEISHU_WEBHOOK', signSecretRef: 'FEISHU_SIGN_SECRET', refs: { webhook: 'FEISHU_WEBHOOK', signSecret: 'FEISHU_SIGN_SECRET' } };
    const url = 'https://open.feishu.cn/open-apis/bot/v2/hook/AAA';
    const r = await feishu.send({ channel, message: MESSAGE, env: { FEISHU_WEBHOOK: url, FEISHU_SIGN_SECRET: 'SECtest123' }, fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(captured[0].url, url);
    assert.ok(!captured[0].url.includes('sign'), '飞书 webhook 的 sign 不应在 URL 上');
    assert.equal(captured[0].body.msg_type, 'text');
    assert.equal(captured[0].body.content.text, MESSAGE.text);
    assert.equal(typeof captured[0].body.sign, 'string');
    assert.equal(captured[0].body.sign, feishuSign(Number(captured[0].body.timestamp), 'SECtest123'));
    assert.ok(captured[0].body.sign.includes('='), '飞书 sign 为原始 base64（含 =）');
  });

  test('webhook：无 secret 时不带 sign 字段', async () => {
    const captured = [];
    const fetchImpl = async (url, opts) => { captured.push(JSON.parse(opts.body)); return jsonResponse({ code: 0 }); };
    const channel = { id: 'f2', channelType: 'feishu', webhookRef: 'FEISHU_WEBHOOK', refs: { webhook: 'FEISHU_WEBHOOK' } };
    const r = await feishu.send({ channel, message: MESSAGE, env: { FEISHU_WEBHOOK: 'https://x' }, fetchImpl });
    assert.equal(r.ok, true);
    assert.ok(!('sign' in captured[0]));
    assert.ok(!('timestamp' in captured[0]));
  });

  test('缺 webhook → skipped', async () => {
    const channel = { id: 'f3', channelType: 'feishu', webhookRef: 'FEISHU_WEBHOOK', refs: { webhook: 'FEISHU_WEBHOOK' } };
    const r = await feishu.send({ channel, message: MESSAGE, env: {}, fetchImpl: async () => jsonResponse({}) });
    assert.equal(r.skipped, true);
    assert.equal(r.skipReason, 'missing-env:FEISHU_WEBHOOK');
  });

  test('app：取 tenant_access_token → POST /im/v1/messages，content 为 JSON 字符串', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, headers: opts.headers ?? {}, body: opts.body ? JSON.parse(opts.body) : null });
      if (url.includes('tenant_access_token')) return jsonResponse({ code: 0, tenant_access_token: 't-abc' });
      return jsonResponse({ code: 0 });
    };
    const channel = { id: 'feishu-app', channelType: 'feishu', mode: 'app', receiveIdType: 'open_id', receiveId: 'ou_x', refs: { appId: 'FEISHU_APP_ID', appSecret: 'FEISHU_APP_SECRET' } };
    const r = await feishu.send({ channel, message: MESSAGE, env: { FEISHU_APP_ID: 'id', FEISHU_APP_SECRET: 'sec' }, fetchImpl });
    assert.equal(r.ok, true);
    const msg = calls.find((c) => c.url.includes('/im/v1/messages'));
    assert.ok(msg.url.includes('receive_id_type=open_id'));
    assert.equal(msg.headers.Authorization, 'Bearer t-abc');
    assert.equal(msg.body.receive_id, 'ou_x');
    assert.equal(msg.body.msg_type, 'text');
    assert.equal(typeof msg.body.content, 'string');
    assert.equal(JSON.parse(msg.body.content).text, MESSAGE.text);
  });

  test('requiredRefs：webhook 形态只需 webhook', () => {
    assert.deepEqual(feishu.requiredRefs({ webhookRef: 'FEISHU_WEBHOOK' }), ['FEISHU_WEBHOOK']);
    assert.equal(FS_TYPE, 'feishu');
  });
});

describe('dingtalk 适配器（webhook + HMAC 加签；签名在 URL）', () => {
  test('sign 在 URL 查询参数；body 为 markdown；body 内无 sign', async () => {
    const captured = [];
    const fetchImpl = async (url, opts) => { captured.push({ url, body: JSON.parse(opts.body) }); return jsonResponse({ errcode: 0 }); };
    const channel = { id: 'dingtalk-ops', channelType: 'dingtalk', webhookRef: 'DINGTALK_WEBHOOK', signSecretRef: 'DINGTALK_SIGN_SECRET', refs: { webhook: 'DINGTALK_WEBHOOK', signSecret: 'DINGTALK_SIGN_SECRET' } };
    const baseUrl = 'https://oapi.dingtalk.com/robot/send?access_token=XXX';
    const r = await dingtalk.send({ channel, message: MESSAGE, env: { DINGTALK_WEBHOOK: baseUrl, DINGTALK_SIGN_SECRET: 'SECtest123' }, fetchImpl });
    assert.equal(r.ok, true);
    assert.ok(captured[0].url.includes('access_token=XXX'));
    assert.ok(captured[0].url.includes('&timestamp='));
    assert.ok(captured[0].url.includes('&sign='));
    assert.equal(captured[0].body.msgtype, 'markdown');
    assert.equal(captured[0].body.markdown.title, MESSAGE.title);
    assert.equal(captured[0].body.markdown.text, MESSAGE.markdown);
    assert.ok(!('sign' in captured[0].body), '钉钉 sign 不应在 body 内');
    assert.ok(!('timestamp' in captured[0].body), '钉钉 timestamp 不应在 body 内');

    // 校验 URL 上的 sign（searchParams 自动解码）
    const u = new URL(captured[0].url);
    const ts = Number(u.searchParams.get('timestamp'));
    const signDecoded = u.searchParams.get('sign');
    assert.equal(encodeURIComponent(signDecoded), dingtalkSign(ts, 'SECtest123'));
    assert.equal(DT_TYPE, 'dingtalk');
  });

  test('HTTP 500 → ok:false status:500', async () => {
    const channel = { id: 'd2', channelType: 'dingtalk', webhookRef: 'DINGTALK_WEBHOOK', signSecretRef: 'DINGTALK_SIGN_SECRET', refs: { webhook: 'DINGTALK_WEBHOOK', signSecret: 'DINGTALK_SIGN_SECRET' } };
    const r = await dingtalk.send({ channel, message: MESSAGE, env: { DINGTALK_WEBHOOK: 'https://x', DINGTALK_SIGN_SECRET: 's' }, fetchImpl: async () => new Response('', { status: 500 }) });
    assert.equal(r.ok, false);
    assert.equal(r.status, 500);
  });

  test('缺 signSecret → skipped', async () => {
    const channel = { id: 'd3', channelType: 'dingtalk', webhookRef: 'DINGTALK_WEBHOOK', signSecretRef: 'DINGTALK_SIGN_SECRET', refs: { webhook: 'DINGTALK_WEBHOOK', signSecret: 'DINGTALK_SIGN_SECRET' } };
    const r = await dingtalk.send({ channel, message: MESSAGE, env: { DINGTALK_WEBHOOK: 'https://x' }, fetchImpl: async () => jsonResponse({ errcode: 0 }) });
    assert.equal(r.skipped, true);
    assert.equal(r.skipReason, 'missing-env:DINGTALK_SIGN_SECRET');
  });
});

describe('wecom 适配器（webhook + 应用消息）', () => {
  test('webhook：markdown 形态；key 在 URL', async () => {
    const captured = [];
    const fetchImpl = async (url, opts) => { captured.push({ url, body: JSON.parse(opts.body) }); return jsonResponse({ errcode: 0 }); };
    const channel = { id: 'wecom-ops', channelType: 'wecom', webhookRef: 'WECOM_WEBHOOK', refs: { webhook: 'WECOM_WEBHOOK' } };
    const url = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=K123';
    const r = await wecom.send({ channel, message: MESSAGE, env: { WECOM_WEBHOOK: url }, fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(captured[0].url, url);
    assert.ok(captured[0].url.includes('key=K123'));
    assert.equal(captured[0].body.msgtype, 'markdown');
    assert.equal(captured[0].body.markdown.content, MESSAGE.markdown);
  });

  test('app：gettoken → message/send，access_token 在 URL', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
      if (url.includes('/gettoken')) return jsonResponse({ errcode: 0, access_token: 't-1' });
      return jsonResponse({ errcode: 0 });
    };
    const channel = { id: 'wecom-app', channelType: 'wecom', mode: 'app', corpId: 'corp1', toUser: '@all', agentId: '1000002', refs: { corpSecret: 'WECOM_APP_SECRET' } };
    const r = await wecom.send({ channel, message: MESSAGE, env: { WECOM_APP_SECRET: 'sec' }, fetchImpl });
    assert.equal(r.ok, true);
    assert.ok(calls[0].url.includes('corpid=corp1'));
    const send = calls.find((c) => c.url.includes('/message/send'));
    assert.ok(send.url.includes('access_token=t-1'));
    assert.equal(send.body.touser, '@all');
    assert.equal(send.body.msgtype, 'markdown');
    assert.equal(send.body.markdown.content, MESSAGE.markdown);
  });

  test('缺 webhook → skipped', async () => {
    const channel = { id: 'w3', channelType: 'wecom', webhookRef: 'WECOM_WEBHOOK', refs: { webhook: 'WECOM_WEBHOOK' } };
    const r = await wecom.send({ channel, message: MESSAGE, env: {}, fetchImpl: async () => jsonResponse({}) });
    assert.equal(r.skipped, true);
    assert.equal(r.skipReason, 'missing-env:WECOM_WEBHOOK');
  });
});

describe('HTTP 500 重试与最终失败（经 dispatch，注入 sleep = no-op）', () => {
  test('max=2 → 共尝试 3 次后全部失败 → throw', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'notify-chan-'));
    try {
      let calls = 0;
      const fetchImpl = async () => { calls += 1; return new Response('', { status: 500 }); };
      const config = {
        defaults: { retry: { max: 2, backoffMs: [0, 0] } },
        channels: [{
          id: 'dt', channelType: 'dingtalk', enabled: true, events: ['dailyReport'],
          webhookRef: 'DINGTALK_WEBHOOK', signSecretRef: 'DINGTALK_SIGN_SECRET',
          refs: { webhook: 'DINGTALK_WEBHOOK', signSecret: 'DINGTALK_SIGN_SECRET' },
        }],
      };
      await assert.rejects(
        () => dispatch({
          config, message: MESSAGE,
          env: { DINGTALK_WEBHOOK: 'https://x', DINGTALK_SIGN_SECRET: 's' },
          fetchImpl, sleepImpl: () => {}, now: new Date('2026-09-12T12:00:00+08:00'),
          statePath: join(dir, 'state.json'), statsDir: dir,
        }),
        /全部发送失败/,
      );
      assert.equal(calls, 3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

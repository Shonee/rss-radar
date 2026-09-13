// scripts/notify/__tests__/sign.test.mjs — 钉钉 vs 飞书 加签算法单测
// 对应 IMPLEMENTATION_PLAN T-P3-07 / ARCHITECTURE §12.2（硬警示：二者形似但不同，禁止互串）
//
// 验证策略：
//   1) 固定 secret/timestamp → 断言适配器输出 === 硬编码金标准（node:crypto 预先手算）
//   2) 用 node:crypto 在测试内独立重算 → 断言一致（回归保护）
//   3) 断言两者的 sign 值不同、且「用错算法」的交叉值也与金标准不符（证明未互串）
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';

import { dingtalkSign } from '../channels/dingtalk.mjs';
import { feishuSign } from '../channels/feishu.mjs';

const SECRET = 'SECtest123';
const TS_MS = 1757654400123;
const TS_SEC = 1757654400;

// —— 硬编码金标准（预先用 node:crypto 手算）——
const GOLD_DINGTALK_RAW = 'D2UhSwkaLwrJDbqp6dI/9rSEGjqkN7X62q5DktsbG58=';
const GOLD_DINGTALK_URL = 'D2UhSwkaLwrJDbqp6dI%2F9rSEGjqkN7X62q5DktsbG58%3D';
const GOLD_FEISHU = '4PooYc8ZVXSRFAPnUdldsxkbLVJHJvJp5yWRHgX1Okc=';
const GOLD_CROSS_FEISHU_ALG_ON_DINGTALK_INPUTS = '82cmf8lPp909nmGANm1%2FjLabCanYRc8B5sx%2BQkAP%2F0s%3D';
const GOLD_CROSS_DINGTALK_ALG_ON_FEISHU_INPUTS = 'xClbOUqb3dhZ0p4dpA8GG1TfbfX+SY2b1+zjOTj5EDI=';

describe('钉钉加签（stringToSign 当数据、secret 当密钥；签名在 URL）', () => {
  test('固定输入 → 硬编码金标准（URL 编码 base64）', () => {
    assert.equal(dingtalkSign(TS_MS, SECRET), GOLD_DINGTALK_URL);
    assert.equal(decodeURIComponent(dingtalkSign(TS_MS, SECRET)), GOLD_DINGTALK_RAW);
  });

  test('用 node:crypto 独立重算一致', () => {
    const expectedRaw = createHmac('sha256', SECRET).update(`${TS_MS}\n${SECRET}`).digest('base64');
    assert.equal(dingtalkSign(TS_MS, SECRET), encodeURIComponent(expectedRaw));
  });

  test('URL 编码：不含裸 + / =', () => {
    const sign = dingtalkSign(TS_MS, SECRET);
    assert.ok(!sign.includes('+'), '不应含裸 +');
    assert.ok(!sign.includes('/'), '不应含裸 /');
    assert.ok(!sign.includes('='), '不应含裸 =');
  });
});

describe('飞书加签（timestamp+"\\n"+secret 当密钥、空串当数据；签名在 body）', () => {
  test('固定输入 → 硬编码金标准（原始 base64，不 URL 编码）', () => {
    assert.equal(feishuSign(TS_SEC, SECRET), GOLD_FEISHU);
  });

  test('用 node:crypto 独立重算一致', () => {
    const expected = createHmac('sha256', `${TS_SEC}\n${SECRET}`).update('').digest('base64');
    assert.equal(feishuSign(TS_SEC, SECRET), expected);
  });

  test('原始 base64：含 = 填充', () => {
    assert.ok(feishuSign(TS_SEC, SECRET).includes('='), '应含 base64 填充 =');
  });
});

describe('互不串（交叉验证）', () => {
  test('同一输入下两者 sign 不同', () => {
    assert.notEqual(dingtalkSign(TS_SEC, SECRET), feishuSign(TS_SEC, SECRET));
  });

  test('「飞书算法套钉钉输入」的交叉值 ≠ 钉钉金标准', () => {
    // 飞书算法：key = ts+"\n"+secret，data = ""
    const cross = encodeURIComponent(
      createHmac('sha256', `${TS_MS}\n${SECRET}`).update('').digest('base64'),
    );
    assert.equal(cross, GOLD_CROSS_FEISHU_ALG_ON_DINGTALK_INPUTS);
    assert.notEqual(cross, dingtalkSign(TS_MS, SECRET));
    assert.notEqual(cross, GOLD_DINGTALK_URL);
  });

  test('「钉钉算法套飞书输入」的交叉值 ≠ 飞书金标准', () => {
    // 钉钉算法：key = secret，data = ts+"\n"+secret
    const cross = createHmac('sha256', SECRET).update(`${TS_SEC}\n${SECRET}`).digest('base64');
    assert.equal(cross, GOLD_CROSS_DINGTALK_ALG_ON_FEISHU_INPUTS);
    assert.notEqual(cross, feishuSign(TS_SEC, SECRET));
    assert.notEqual(cross, GOLD_FEISHU);
  });
});

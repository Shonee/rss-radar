import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { resolveCollectExitCode } from '../exit-code.mjs';

test('resolveCollectExitCode: 全部成功 -> 0', () => {
  assert.equal(resolveCollectExitCode({ ok: 3, err: 0 }), 0);
});

test('resolveCollectExitCode: 全部失败 -> 1', () => {
  assert.equal(resolveCollectExitCode({ ok: 0, err: 3 }), 1);
});

test('resolveCollectExitCode: 部分失败默认 -> 2', () => {
  assert.equal(resolveCollectExitCode({ ok: 3, err: 1 }), 2);
});

test('resolveCollectExitCode: allowPartialSuccess 时部分失败 -> 0', () => {
  assert.equal(resolveCollectExitCode({ ok: 3, err: 1, allowPartialSuccess: true }), 0);
});

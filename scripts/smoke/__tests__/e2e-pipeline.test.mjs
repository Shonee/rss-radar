// scripts/smoke/__tests__/e2e-pipeline.test.mjs
// T-P2-10 端到端管线测试（node:test）
// 调用 scripts/smoke/e2e-pipeline.mjs 作为子进程执行，验证退出码 + artifact
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

describe('e2e-pipeline 入口', () => {
  it('退出码 0', () => {
    const r = spawnSync('node', ['scripts/smoke/e2e-pipeline.mjs'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    assert.equal(r.status, 0, `e2e 退出码非 0: stderr=${r.stderr}`);
    assert.match(r.stdout, /\[e2e\] PASS/);
  });

  it('产生 snapshot + report + history-index', () => {
    const r = spawnSync('node', ['scripts/smoke/e2e-pipeline.mjs'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /artifacts:[\s\S]*event: true/);
    assert.match(r.stdout, /artifacts:[\s\S]*snapshot: true/);
    assert.match(r.stdout, /artifacts:[\s\S]*report: true/);
    assert.match(r.stdout, /artifacts:[\s\S]*historyIndex: true/);
    assert.match(r.stdout, /artifacts:[\s\S]*monthlyNdjson: true/);
  });

  it('跨天 rollover 模拟通过', () => {
    const r = spawnSync('node', ['scripts/smoke/e2e-pipeline.mjs'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /rollover: monthAppended=/);
  });

  it('URL 健康检查走通 mock fetch', () => {
    const r = spawnSync('node', ['scripts/smoke/e2e-pipeline.mjs'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /url-health: \d+ URLs/);
  });
});

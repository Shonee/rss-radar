// scripts/collect/__tests__/dev-bridge.test.mjs
// dev bridge 契约：collect 落盘后，snapshot 与 report **都要**被复制到 <publicDir>/data/today/，
// 否则本地 today/ 会出现「snapshot 新一轮、report 旧一轮」的口径漂移（report.totalItems ≠ snapshot.items）。
// 复用 collector 的 copyToPublicData（scripts/collect/write.mjs）——即 main.mjs dev bridge 调用的同一函数。
// 用临时目录，不触网。
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { copyToPublicData } from '../write.mjs';

describe('dev bridge — snapshot 与 report 同步复制', () => {
  let root;
  let publicDir;
  let todayDir;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rssradar-devbridge-'));
    publicDir = join(root, 'public');
    todayDir = join(root, 'tmp', 'deploy', 'today');
    mkdirSync(todayDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('copyToPublicData：report 文件也被复制到 <publicDir>/data/today/', () => {
    const date = '2026-09-14';
    const snapPath = join(todayDir, `snapshot-${date}.json`);
    const repPath = join(todayDir, `report-${date}.json`);
    writeFileSync(snapPath, JSON.stringify({ date, items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }), 'utf8');
    writeFileSync(repPath, JSON.stringify({ date, totalItems: 3 }), 'utf8');

    copyToPublicData(snapPath, publicDir);
    copyToPublicData(repPath, publicDir);

    const dstSnap = join(publicDir, 'data', 'today', `snapshot-${date}.json`);
    const dstRep = join(publicDir, 'data', 'today', `report-${date}.json`);
    assert.equal(existsSync(dstSnap), true, 'snapshot 已复制到 public/data/today/');
    assert.equal(existsSync(dstRep), true, 'report 已复制到 public/data/today/');
    assert.deepEqual(JSON.parse(readFileSync(dstRep, 'utf8')), { date, totalItems: 3 }, 'report 内容一致');
  });

  it('复制后 public 下 snapshot.items.length 与 report.totalItems 口径一致', () => {
    const date = '2026-09-14';
    const items = [{ id: 'a' }, { id: 'b' }];
    const snapPath = join(todayDir, `snapshot-${date}.json`);
    const repPath = join(todayDir, `report-${date}.json`);
    writeFileSync(snapPath, JSON.stringify({ date, items }), 'utf8');
    writeFileSync(repPath, JSON.stringify({ date, totalItems: items.length }), 'utf8');

    copyToPublicData(snapPath, publicDir);
    copyToPublicData(repPath, publicDir);

    const outSnap = JSON.parse(readFileSync(join(publicDir, 'data', 'today', `snapshot-${date}.json`), 'utf8'));
    const outRep = JSON.parse(readFileSync(join(publicDir, 'data', 'today', `report-${date}.json`), 'utf8'));
    assert.equal(outRep.totalItems, outSnap.items.length, 'report.totalItems == snapshot.items.length');
  });
});

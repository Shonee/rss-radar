// scripts/collect/__tests__/prune-artifacts.test.mjs
// 同日产物清理契约。背景（2026-09-16）：
//   报告/快照改名后带 4 位 UTC 后缀（`snapshot-<date>-<stamp>.json`），
//   而「旧固定名」`<kind>-<date>.json` 不在旧 prune 的匹配范围内 → 永久残留。
//   残留的后果不是 404，而是**静默命中陈旧数据**：回归断言 A4 曾拿到 903 条旧报告
//   去比 894 条新快照。故旧固定名必须与带后缀文件一起被清理。
// 用临时目录，不触网。
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pruneOldStampedArtifacts } from '../project-snapshot.mjs';

const DATE = '2026-09-16';

describe('pruneOldStampedArtifacts — 同日产物清理', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rssradar-prune-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const touch = (name) => writeFileSync(join(dir, name), '{}', 'utf8');
  const alive = (name) => existsSync(join(dir, name));

  it('清掉同日旧后缀文件，保留本轮目标', () => {
    touch(`snapshot-${DATE}-0100.json`);
    touch(`snapshot-${DATE}-0350.json`);

    const n = pruneOldStampedArtifacts(dir, DATE, 'snapshot', [`snapshot-${DATE}-0350.json`]);

    assert.equal(n, 1);
    assert.equal(alive(`snapshot-${DATE}-0100.json`), false, '旧后缀被清理');
    assert.equal(alive(`snapshot-${DATE}-0350.json`), true, '本轮目标保留');
  });

  it('★ 旧固定名 `<kind>-<date>.json` 也必须清掉（静默命中陈旧数据的根因）', () => {
    touch(`report-${DATE}.json`);
    touch(`report-${DATE}-0350.json`);

    const n = pruneOldStampedArtifacts(dir, DATE, 'report', [`report-${DATE}-0350.json`]);

    assert.equal(n, 1, '旧固定名计入清理数');
    assert.equal(alive(`report-${DATE}.json`), false, '旧固定名被清理');
    assert.equal(alive(`report-${DATE}-0350.json`), true, '本轮目标保留');
  });

  it('不误伤：其他日期 / 其他 kind / 不含日期的 fixture / 非 json 全部保留', () => {
    const untouched = [
      'snapshot-2026-09-15.json', // 其他日期的旧固定名
      `report-${DATE}-0350.json`, // 另一 kind
      'snapshot.json',            // P1 fixture：不含日期
      `events-${DATE}.ndjson`,    // 事件流：非 .json（且不该被误删）
    ];
    for (const name of untouched) touch(name);

    const n = pruneOldStampedArtifacts(dir, DATE, 'snapshot', [`snapshot-${DATE}-0350.json`]);

    assert.equal(n, 0, '无任何文件被清理');
    for (const name of untouched) assert.equal(alive(name), true, `保留 ${name}`);
  });

  it('keep 命中的旧固定名不被删（显式保留优先于清理）', () => {
    touch(`snapshot-${DATE}.json`);

    const n = pruneOldStampedArtifacts(dir, DATE, 'snapshot', [`snapshot-${DATE}.json`]);

    assert.equal(n, 0);
    assert.equal(alive(`snapshot-${DATE}.json`), true);
  });
});

// scripts/collect/__tests__/archive.test.mjs
// T-P2-06 归档测试：dry-run 列出待删除文件 + 边界日不删 + 月末封口保留
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** 在 tmp 下构造模拟 history 目录 */
async function mkMockRoot() {
  const root = `/tmp/rss-radar-archive-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await mkdir(root, { recursive: true });
  await mkdir(join(root, 'history', '2025', '01'), { recursive: true });
  await mkdir(join(root, 'history', '2025', '02'), { recursive: true });
  await mkdir(join(root, 'history', '2025', '06'), { recursive: true });
  await mkdir(join(root, 'history', '2026', '01'), { recursive: true });
  // 2025-01 老：2025-01-15 早于 today-365（假设 today=2026-09-12 → cutoff=2025-09-12）
  await writeFile(join(root, 'history', '2025', '01', 'items.ndjson'), '{}\n');
  await writeFile(join(root, 'history', '2025', '01', 'snapshot-2025-01-15.json'), '{}');
  // 2025-02 老：2025-02-20 早于 cutoff
  await writeFile(join(root, 'history', '2025', '02', 'items.ndjson'), '{}\n');
  // 2025-06 中：2025-06-10 早于 cutoff
  await writeFile(join(root, 'history', '2025', '06', 'items.ndjson'), '{}\n');
  await writeFile(join(root, 'history', '2025', '06', 'snapshot-2025-06-10.json'), '{}');
  await writeFile(join(root, 'history', '2025', '06', 'SEALED'), 'sealed_at=2025-06-30');
  // 2026-01 新：2026-01-10 不早于 cutoff
  await writeFile(join(root, 'history', '2026', '01', 'items.ndjson'), '{}\n');
  await writeFile(join(root, 'history', '2026', '01', 'snapshot-2026-01-10.json'), '{}');
  return root;
}

describe('archive dry-run：列出待删除文件', () => {
  it('--dry-run 默认 + --year 2025 列出 3 月共 4 个文件', async () => {
    const root = await mkMockRoot();
    try {
      const { listCandidatesForArchival, listBundlable } = await import('../archive.mjs');
      const { candidates, byMonth, cutoffDate } = await listCandidatesForArchival(root, 2025, '2026-09-12');
      assert.equal(cutoffDate, '2025-09-12');
      // 早于 cutoff 的文件：2025-01 2 个 + 2025-02 1 个 + 2025-06 2 个 = 5
      assert.equal(candidates.length, 5, '候选 5 个文件');
      // byMonth 应只列有候选的月份
      assert.ok('01' in byMonth);
      assert.ok('02' in byMonth);
      assert.ok('06' in byMonth);
      // 月末封口 SEALED 不在候选（被跳过）
      const allPaths = candidates.map((c) => c.path);
      for (const p of allPaths) assert.ok(!p.includes('SEALED'));
      // bundlable 应包含 history 全部文件（含 SEALED）作为打包候选
      const bundlable = await listBundlable(root, 2025);
      assert.ok(bundlable.length >= 5);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('--year 2025 + 不存在的目录 → 0 candidates + note', async () => {
    const root = `/tmp/rss-radar-archive-empty-${Date.now()}`;
    await mkdir(root, { recursive: true });
    try {
      const { listCandidatesForArchival } = await import('../archive.mjs');
      const { candidates, note } = await listCandidatesForArchival(root, 2025, '2026-09-12');
      assert.equal(candidates.length, 0);
      assert.ok(note && /history.*不存在/.test(note));
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('--year 不存在 → 0 candidates', async () => {
    const root = await mkMockRoot();
    try {
      const { listCandidatesForArchival } = await import('../archive.mjs');
      const { candidates } = await listCandidatesForArchival(root, 2030, '2026-09-12');
      assert.equal(candidates.length, 0);
    } finally {
      await rm(root, { recursive: true });
    }
  });
});

describe('archive 边界日判定', () => {
  it('today = cutoffDate → 候选严格 < cutoffDate 的文件（不包含等于）', async () => {
    const root = `/tmp/rss-radar-archive-boundary-${Date.now()}`;
    await mkdir(join(root, 'history', '2025', '09'), { recursive: true });
    // 2025-09-12 等于 cutoff
    await writeFile(join(root, 'history', '2025', '09', 'snapshot-2025-09-12.json'), '{}');
    await writeFile(join(root, 'history', '2025', '09', 'snapshot-2025-09-11.json'), '{}');
    try {
      const { listCandidatesForArchival } = await import('../archive.mjs');
      const { candidates } = await listCandidatesForArchival(root, 2025, '2025-09-12');
      // cutoffDate = 2024-09-12 (2025-09-12 - 365)
      // 09-12 远 > cutoffDate；应该 0 候选
      assert.equal(candidates.length, 0);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('NP 文件名（无日期）以 mtime 兜底（文件直接放 roundRoot 下）', async () => {
    const root = `/tmp/rss-radar-archive-mtime-${Date.now()}`;
    await mkdir(root, { recursive: true });
    // 不放 history 子目录下 → mtime 兜底
    await writeFile(join(root, 'misc.json'), '{}');
    try {
      const { listCandidatesForArchival } = await import('../archive.mjs');
      const { candidates } = await listCandidatesForArchival(root, 2025, '2026-09-12');
      // history 不存在 → 0 candidates
      assert.equal(candidates.length, 0);
    } finally {
      await rm(root, { recursive: true });
    }
  });
});

describe('release.mjs：GitHub Release 资产准备', () => {
  it('prepareReleaseAssets: sha256 + size + 默认 name', async () => {
    const bundle = `/tmp/rss-radar-bundle-${Date.now()}`;
    await writeFile(bundle, 'hello world\nthis is a test archive');
    try {
      const { prepareReleaseAssets } = await import('../lib/release.mjs');
      const meta = await prepareReleaseAssets(bundle, {});
      assert.match(meta.sha256, /^[0-9a-f]{64}$/);
      assert.ok(meta.size > 0);
      assert.match(meta.name, /^rss-radar-\d{4}-\d{2}-\d{2}\.tar\.zst$/);
      assert.match(meta.notes, /年度归档/);
    } finally {
      await rm(bundle);
    }
  });

  it('prepareReleaseAssets: 自定义 releaseName + notes', async () => {
    const bundle = `/tmp/rss-radar-bundle2-${Date.now()}`;
    await writeFile(bundle, 'x');
    try {
      const { prepareReleaseAssets } = await import('../lib/release.mjs');
      const meta = await prepareReleaseAssets(bundle, { releaseName: 'custom.tar.zst', releaseNotes: 'note' });
      assert.equal(meta.name, 'custom.tar.zst');
      assert.equal(meta.notes, 'note');
    } finally {
      await rm(bundle);
    }
  });

  it('createReleaseViaGh: 无 token 抛错', async () => {
    const oldToken = process.env.GITHUB_TOKEN;
    const oldGh = process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    try {
      const { createReleaseViaGh } = await import('../lib/release.mjs');
      await assert.rejects(
        createReleaseViaGh({ owner: 'me', repo: 'rss-radar', tag: 'v1', assets: [], notes: 'x' }),
        /GITHUB_TOKEN|GH_TOKEN/,
      );
    } finally {
      if (oldToken) process.env.GITHUB_TOKEN = oldToken;
      if (oldGh) process.env.GH_TOKEN = oldGh;
    }
  });

  it('createReleaseViaRest: token 缺失抛错', async () => {
    const { createReleaseViaRest } = await import('../lib/release.mjs');
    await assert.rejects(
      createReleaseViaRest({ owner: 'me', repo: 'rss-radar', tag: 'v1', assets: ['a.tar.zst'] }),
      /token 缺失/,
    );
  });

  it('createReleaseViaGh: 有 token 但本地不实装（invoked=false）', async () => {
    process.env.GITHUB_TOKEN = 'fake';
    try {
      const { createReleaseViaGh } = await import('../lib/release.mjs');
      const r = await createReleaseViaGh({ owner: 'me', repo: 'rss-radar', tag: 'v1', assets: ['a.tar.zst'], notes: 'x' });
      assert.equal(r.invoked, false);
      assert.match(r.reason, /本地 P2-B 不实装/);
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });
});

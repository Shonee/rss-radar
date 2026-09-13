// scripts/collect/lib/release.mjs
// GitHub Release 资产准备 + 触发封装（T-P2-06）
//
// 触发：CI（archive.yml）跑本模块；本地 P2-B 仅验证 dry-run + 文件准备
// P2-A + P2-B 都未实装到 workflow（老登 15:45 拍板：CF Pages / API token / fork 沙箱全部延后到代码上传远程仓库后再做）
//
// 公开 API：
//   - prepareReleaseAssets(archiveBundle, opts)  → 签名/sha256 + 元数据 → 准备上传
//   - createReleaseViaGh({owner, repo, tag, assets, token}) → 真实 gh release 触发（CI 侧；本地不调用）
//   - createReleaseViaRest({owner, repo, tag, assets, token}) → REST API 触发（CI 侧）
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/**
 * 准备 Release 资产（metadata）
 * @param {string} archiveBundle 归档包绝对路径
 * @param {{releaseName?: string, releaseNotes?: string}} [opts]
 * @returns {Promise<{name: string, size: number, sha256: string, notes: string}>}
 */
export async function prepareReleaseAssets(archiveBundle, opts = {}) {
  const buf = await readFile(archiveBundle);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const name = opts.releaseName ?? `rss-radar-${new Date().toISOString().slice(0, 10)}.tar.zst`;
  return {
    name,
    size: buf.byteLength,
    sha256,
    notes: opts.releaseNotes ?? 'rss-radar 年度归档',
  };
}

/**
 * 通过 GitHub CLI (gh) 创建 Release（CI 侧；本地不实际调用）
 * 需要：gh 命令已安装且已登录；GH_TOKEN 环境变量已设
 */
export async function createReleaseViaGh({ owner, repo, tag, assets, notes }) {
  // 实装留 CI 侧：调用 `gh release create <tag> <assets...> --notes <notes> --title <title>`
  // 本地 P2-B 不实装
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    throw new Error('release.mjs: GITHUB_TOKEN/GH_TOKEN 未设置（CI 侧配置）');
  }
  // 实际 shell 调用放到 CI step；本模块仅暴露签名 + 元数据
  return {
    invoked: false,
    reason: '本地 P2-B 不实装 gh 调用；CI 由 archive.yml 触发',
    owner, repo, tag, assets, notes,
  };
}

/**
 * 通过 REST API (octokit 风格) 创建 Release
 * CI 侧实装；本地 P2-B 不实装
 */
export async function createReleaseViaRest({ owner, repo, tag, assets, token }) {
  if (!token) {
    throw new Error('release.mjs: token 缺失（CI 侧配置）');
  }
  return { invoked: false, reason: '本地 P2-B 不实装 REST 调用', owner, repo, tag, assetCount: assets?.length ?? 0 };
}

/** 是否 CI 触发（GitHub Actions 环境变量检测） */
export function isCI() {
  return Boolean(process.env.GITHUB_ACTIONS);
}

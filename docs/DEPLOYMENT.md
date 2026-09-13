# RSS Radar 部署指南（本地 / GitHub Pages / Cloudflare Pages）

> 本文档最后与代码同步于 commit `8b9eab8`。
>
> 依据 `docs/ARCHITECTURE.md` §7（部署方案）与 §6.1.1（触发段写法）。
> 相关文档：[`USAGE.md`](./USAGE.md)、[`SOURCES.md`](./SOURCES.md)、[`NOTIFY.md`](./NOTIFY.md)。

---

## 0. 🔴 现状如实标注（先看这里）

| 项 | 状态 |
|---|---|
| 本地 `dev` / `build` / `preview` | ✅ **可用**（我已实跑验证） |
| `.github/workflows/deploy-gh-pages.yml` | ❌ **尚未创建**（T-P4-02） |
| `.github/workflows/deploy-cf-pages.yml` | ❌ **尚未创建**（T-P4-03） |
| Cloudflare Pages Direct Upload 项目 | ❌ **尚未创建** |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | ❌ **尚未准备**（主理人已决定延后到代码上传远程仓库后再做） |
| 部署端到端 | ❌ **未验证** |

> **因此本文档目前是「按架构设计的操作手册」**：本地部分是实测的；GitHub Pages / Cloudflare Pages 部分是**尚未落地的设计**，**不要把未验证的步骤当作已验证**。落地后请按真实 workflow 复核。

---

## 1. 本地

### 1.1 命令

```bash
npm run dev        # 开发服务器（Vite），默认 http://localhost:5173/#/
npm run build      # tsc -b && vite build → dist/
npm run preview    # 预览已构建产物 dist/，默认 http://localhost:4173/
```

- `npm run build` 会先做 `tsc -b`（类型检查）再 `vite build`。**类型错误会直接让构建失败**。
- 访问路径用 `HashRouter`，所以带 `#/`：`http://localhost:5173/#/`。

### 1.2 `vite.config.ts` 的关键设定

| 设定 | 值 | 作用 |
|---|---|---|
| `base` | `'./'` | 相对路径引用资源 → **同一份产物在子路径 / 根路径都能加载**（§7.2） |
| `server.host` / `server.port` / `server.strictPort` | `'0.0.0.0'` / `5173` / `true` | dev server 监听；端口被占用时**直接报错**而不换端口 |
| `preview.host` / `preview.port` / `preview.strictPort` | `'0.0.0.0'` / `4173` / `true` | 预览服务同上 |
| `build.outDir` / `target` / `sourcemap` | `'dist'` / `'es2022'` / `true` | 输出目录与目标 |
| `build.rollupOptions.output.manualChunks` | `vendor-mui` / `vendor-router` / `vendor-react` / `vendor` | 把大依赖拆到独立 vendor chunk（长期缓存） |

> 当前构建产物（`npm run build` 实测）：主 chunk `index-*.js` ≈ **43 kB**（gzip ≈ 16 kB）；页面2/3/4/关于各自 lazy chunk；`vendor-mui` 251 kB、`vendor-react` 142 kB、`vendor-router` 23 kB。

---

## 2. GitHub Pages

### 2.1 为什么子路径不会 404（§7.2）

GH Pages 把站点放在**子路径** `https://<owner>.github.io/rss-radar/`。两个关键设计保证刷新 / 深链不 404：

1. **`base: './'`**：`index.html` 用相对路径引用 JS/CSS，放在任意子路径都能加载。
2. **`HashRouter`**：路由形如 `/#/channels`，**不需要服务端 SPA fallback**，任何子路径刷新都落到同一个 `index.html`。
3. **数据 URL 与 base 无关**：数据走外部绝对 URL（raw / CDN），不受站点路径影响。

| 冲突点 | 方案 |
|---|---|
| 静态资源路径 | `base: './'` |
| 前端深链刷新 404 | `HashRouter` |
| 数据读取 | 绝对外部 URL |

### 2.2 仓库设置（一次性）

- 仓库 → **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。

### 2.3 workflow（**尚未创建**，下面是设计骨架）

文件 `.github/workflows/deploy-gh-pages.yml`（设计）：

- **触发**：`workflow_dispatch`（手动）；`push:` 段**默认整段注释**（§6.1.1，先手动，稳定后再开自动）。
- **步骤**：checkout → `actions/setup-node@v4`（Node 20 + `cache: npm`）→ `npm ci` → `npm run build` → `actions/configure-pages` + `actions/upload-pages-artifact`（`dist`）+ `actions/deploy-pages`。
- **权限**：`contents: read`、`pages: write`、`id-token: write`。
- **secrets**：无需（用内置 `GITHUB_TOKEN`）。

### 2.4 启用自动部署

取消 `push:` 段注释并删除 job 的 `if` 守卫即可（见下方 §4 的注释写法）。

---

## 3. Cloudflare Pages（Direct Upload）

> 采用**方案 A**：**由 GitHub Actions 构建，再用 `wrangler` 把 `dist/` 直传 CF Pages**（CF 不构建）。理由见 ARCHITECTURE §7.6.6。

### 3.1 为什么直传（§7.6.1 / §7.6.2）

- Direct Upload = 上传**已构建好的产物**，**CF 全程不构建** → **不消耗 CF `500 builds/月`**。
- 增量上传：`wrangler pages deploy` 按文件内容哈希比对，**只上传变更文件** → 后续部署秒级。
- 配额边界（Free）：单项目文件数 ≤ 20,000、单文件 ≤ 25 MiB、账户项目 ≤ 100、带宽无限。本项目远不触及。

### 3.2 🔴 安全红线：必须用 `wrangler-action`，并固定到 commit SHA（§7.6.3）

- 🚫 **禁用 `cloudflare/pages-action`**：已弃用**且有未修复 RCE `CVE-2026-11325`（CVSS 8.8）**，可经某些 workflow 配置泄露 `CLOUDFLARE_API_TOKEN` / `GITHUB_TOKEN`；**无补丁**；**仓库将于 2026-09-18 被删除**。
- ✅ **使用官方推荐的 `cloudflare/wrangler-action`**。
- **生产必须把 Action 固定到 commit SHA**（不要浮动 tag `@v3`，防 tag 被改写 / 投毒）：
  `uses: cloudflare/wrangler-action@<full-commit-sha>`。
- **token 最小权限**：仅 **Account → Cloudflare Pages → Edit**。
- **job 权限**：`permissions: { contents: read, deployments: write }`。

### 3.3 CF 侧一次性准备（**尚未做**）

| 步骤 | 操作 |
|---|---|
| 1 | CF 控制台 → Workers & Pages → **Create application → Pages → Upload assets** |
| 2 | 输入项目名（如 `rss-radar`）→ 建一个 **Direct Upload** 项目（**不连 Git**） |
| 3 | 生成 API Token（Account › Cloudflare Pages › **Edit**）→ 存为 Secrets `CLOUDFLARE_API_TOKEN`；账户 ID 存 `CLOUDFLARE_ACCOUNT_ID` |
| 4 | （可选）绑自定义域；默认已获 `<proj>.pages.dev` |

> ⚠️ **不可逆**：Direct Upload 项目**事后无法切换为 Git 集成**（官方明确：*"You cannot switch to Git integration later"*）。若要改回 Git 集成，需新建项目。

### 3.4 workflow（**尚未创建**，设计骨架）

`.github/workflows/deploy-cf-pages.yml`（取自 ARCHITECTURE §7.6.5）：

```yaml
name: deploy-cf-pages
on:
  # ⛔ 自动触发默认禁用（与 GH Pages 一致：先手动，稳定后再开）。
  # push:
  #   branches: [master]
  #   paths:
  #     - 'src/**'
  #     - 'config/**'
  #     - 'package.json'
  #     - 'package-lock.json'
  #     - 'index.html'
  #     - 'vite.config.ts'
  workflow_dispatch:            # ✅ 始终保留，保证手动可触发且文件合法
jobs:
  build-and-deploy:
    if: github.event_name == 'workflow_dispatch'     # 🛡 非手动不跑（开自动后删除本行）
    runs-on: ubuntu-latest
    permissions: { contents: read, deployments: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run build
      - name: Publish to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3        # 生产建议固定到 @<full-commit-sha>
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist --project-name=rss-radar
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

> 上面的 `uses: cloudflare/wrangler-action@v3` 仅为**易读示例**；**生产请改成固定 commit SHA**（见 §3.2）。

---

## 4. 触发段「先注释掉」的写法（§6.1.1）

两个部署 workflow 都采用同一策略：**默认只手动、不自动**。合法写法：

```yaml
on:
  # push:                # 整段注释掉
  #   branches: [master]
  #   paths: ['src/**', 'config/**', 'package.json', 'package-lock.json', 'index.html', 'vite.config.ts']
  workflow_dispatch:     # 保留，保证文件合法且可手动触发
```

- 只注释 `push:`、**保留 `workflow_dispatch`**，文件才是合法 workflow。
- 配合 job 上的 `if: github.event_name == 'workflow_dispatch'` 守卫，**开自动时删掉该行**。
- 好处：需要时（首次上线 / 改版）仍能一键手动发布，但不会因每次代码提交或数据提交误触发。

---

## 5. 双端同一产物（§7.4）

- 两个平台用**同一份 `dist/`**，且在 **同一个 runner、同一 Node、同一 `package-lock.json`** 下由**同一次 `npm run build`** 产出 → **产物逐字节一致**（§7.4）。
- 差异仅在托管平台与访问路径（GH Pages 子路径 / CF Pages 根路径），**产物零差异**。
- 数据更新**不经过任何构建 workflow**，而是前端**运行时 fetch**（raw 主 + jsDelivr 回退），把「数据更新」与「站点部署」彻底解耦。

---

## 6. 缓存策略（§7.3）

| 资源 | 缓存 |
|---|---|
| `index.html` | `no-cache`（保证拿到最新入口） |
| 带 hash 的静态资源 | `max-age=31536000, immutable` |
| 数据文件 | 由 raw/CDN 控制短 TTL（raw ≈ 5 分钟）；前端 fetch 用 `cache: 'no-store'` 绕浏览器缓存 |

> 自定义域名：GH Pages 写 `CNAME` 文件；CF Pages 在 Dashboard 绑定。

---

## 7. 尚待完成（落地清单）

1. 创建 `.github/workflows/deploy-gh-pages.yml`（T-P4-02）。
2. 创建 `.github/workflows/deploy-cf-pages.yml`（T-P4-03），`wrangler-action` **固定 commit SHA**。
3. CF 控制台建 **Direct Upload** 项目。
4. 配 Secrets：`CLOUDFLARE_API_TOKEN`（仅 Pages:Edit）、`CLOUDFLARE_ACCOUNT_ID`。
5. 手动触发一次，确认 URL 可访问、页面渲染正确（P5 验证）。

> 以上均**尚未执行**，故本文档的 GH Pages / CF Pages 部分**尚未端到端验证**。

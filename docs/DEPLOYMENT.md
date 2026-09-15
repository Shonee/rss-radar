# RSS Radar 部署指南（本地 / GitHub Pages / Cloudflare Pages）

> 本文档最后与代码同步于本地 commit `4cbb5dc`（含「CF Pages Git 集成」章节 + 首次构建失败修复，见 §3.1.7）。
>
> 依据 `docs/ARCHITECTURE.md` §7（部署方案）与 §6.1.1（触发段写法）。
> 相关文档：[`USAGE.md`](./USAGE.md)、[`SOURCES.md`](./SOURCES.md)、[`NOTIFY.md`](./NOTIFY.md)。

---

## 0. 🔴 现状如实标注（先看这里）

| 项 | 状态 |
|---|---|
| 本地 `dev` / `build` / `preview` | ✅ **可用**（已实跑验证） |
| 代码推送远程仓库 `Shonee/rss-radar` | 🟡 **已推送但本地领先**：`master` 已推送（私有仓库，SSH 可用）；本地存在未推送提交（数量随每次提交变化，用 `git rev-list --left-right --count origin/master...master` 自查），**推之前请先核对** |
| `deploy` 数据分支（orphan，仅数据） | ✅ **已存在**（`collect.yml` 首次运行建立） |
| 6 个 workflow（collect / notify / archive / deploy-gh-pages / deploy-cf-pages / keepalive） | 🟡 **文件已创建；`collect` 已按 30 分钟周期真实运行，其余尚未逐一验证** |
| Cloudflare Pages 项目 | 🟡 **已创建（路径 A：Git 集成）** —— 依据 2026-09-15 构建日志推断（分支 A 之外的两条路径均未走） |
| 首次 CF 构建 | ❌ **失败**：`Cannot find module @rollup/rollup-linux-x64-gnu`。根因已定位、lock 已修复，**待重新部署验证（§3.1.7）** |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | ❌ **尚未准备**（仅 Direct Upload 路径需要） |
| 部署端到端 | ❌ **未成功**（首次构建已完成克隆 / `npm ci` / `tsc -b`，止步于 `vite build`） |

> **本地侧与构建链路已实测**：lock 与 `package.json` 一致性、`npm run build`、**跨平台（Linux）安装**三项均已实跑验证（详见 §3.1.2 与 §3.1.7）。
>
> **Cloudflare Pages 的页面渲染结果尚未在 CF 上实测**——§3 标注了哪些是官方文档结论、哪些是本地等价推导。**不要把未验证的步骤当作已验证。**

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

> 当前构建产物（`npm run build` 实测）：主 chunk `index-*.js` ≈ **55 kB**（gzip ≈ 18 kB）；页面2/3/4/关于各自 lazy chunk；`vendor-mui` 251 kB、`vendor-react` 142 kB、`vendor-router` 23 kB。整站 `dist/` ≈ 3.4 MB（含本地 dev-bridge 数据时）。

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

### 2.3 workflow（**已创建，未真实触发验证**，骨架如下）

文件 `.github/workflows/deploy-gh-pages.yml`（设计骨架；P4 已创建）：

- **触发**：`workflow_dispatch`（手动）；`push:` 段**默认整段注释**（§6.1.1，先手动，稳定后再开自动）。
- **步骤**：checkout → `actions/setup-node@v4`（Node 20 + `cache: npm`）→ `npm ci` → `npm run build` → `actions/configure-pages` + `actions/upload-pages-artifact`（`dist`）+ `actions/deploy-pages`。
- **权限**：`contents: read`、`pages: write`、`id-token: write`。
- **secrets**：无需（用内置 `GITHUB_TOKEN`）。

### 2.4 启用自动部署

取消 `push:` 段注释并删除 job 的 `if` 守卫即可（见下方 §4 的注释写法）。

---

## 3. Cloudflare Pages

> ⚠️ **本节两条路径（Git 集成 / Direct Upload）在项目创建后不可互转**，选择本身是一次性决策。**先读 §3.0 再动手。**

### 3.0 🔴 先定路径：两条创建方式不可互转

Cloudflare Pages 项目分两类，**项目类型在创建时确定，之后无法更改**（官方原文：*"If you choose Direct Upload, you cannot switch to Git integration later. You will have to create a new project with Git integration to use automatic deployments."*）：

| 维度 | 路径 A：Git 集成 | 路径 B：Direct Upload |
|---|---|---|
| 创建入口 | Create application → Pages → **Connect to Git** | Create application → Pages → **Upload assets** |
| 谁构建 | **CF 构建容器**（`npm ci` + `npm run build`） | **你自己**（本项目由 GitHub Actions 构建） |
| 构建配额 | 🔴 受 **500 builds/月**（Free，1 并发）约束 | ✅ **不消耗**（CF 不构建） |
| 触发方式 | push 到生产分支自动构建；非生产分支默认建预览 | 手动 / CI 调 `wrangler pages deploy` |
| 需要 API Token | ❌ 不需要 | ✅ 需要 `CLOUDFLARE_API_TOKEN` + `ACCOUNT_ID` |
| 能否改用另一种 | 🟡 **不能改回 Drag&drop，但可以继续用 `wrangler` 直传** | ❌ **完全不能再接 Git**，只能新建项目 |
| 是否受数据分支 push 影响 | 🔴 **会**（见 §3.1.3 必做配置） | ✅ 不会（数据 push 不触发任何构建） |

> **架构背景**：`ARCHITECTURE.md` §7.6 是 **v1.2 重写版**，其中**明确「由 GitHub Actions 直传取代 v1.1 的 CF 控制台 Git 集成」**，核心理由就是 Git 集成要额外对付 500 builds/月 与预览构建（§7.6.2）。本文档 §3.1 补充的 Git 集成路径，是**该决策的替代方案说明**——若走这条路，§3.1.3 的分支控制不是可选项。

> 🔴 **不对称性（关键结论）**：**Git 集成是"超集"** —— Git 集成项目**仍可用 `wrangler` 直传**（官方：*"For existing Git-integrated projects, you can manually create deployments using `wrangler deploy`. However, you cannot use drag and drop on the dashboard."*），反之不成立。**若要保留双轨能力，必须先建 Git 集成项目。**

---

### 3.1 路径 A：Git 集成（控制台导入仓库）

> 适用场景：不想配置 `CLOUDFLARE_API_TOKEN`、希望「push 即部署」，且接受 §3.1.3 的分支控制配置与 §3.1.5 的数据可达性方案（独立公开数据仓库）。

#### 3.1.1 前置条件

| 项 | 要求 | 本项目现状 |
|---|---|---|
| 仓库可见性 | 公开 / **私有均支持**（官方：*"Both private and public repositories are supported."*） | 私有 ✅ |
| 至少一个已推送分支 | 否则 Production branch 下拉框为空 | `master` / `deploy` 均已推送 ✅ |
| lock 与 `package.json` 一致 | CF 构建第一步执行 `npm ci`，漂移会直接失败 | ✅ 已实测（见 §3.1.2） |
| 🔴 **lock 含 Linux 平台可选依赖** | **仅"一致"不够**：`rollup` / `esbuild` 的原生二进制走 `optionalDependencies` 分发，lock 里缺 `linux-x64` 变体会在 `vite build` 阶段崩溃 | ✅ 2026-09-15 已修复（§3.1.7） |

> ⚠️ 第 4 行是**本项目真实踩过的坑**：前 3 项全绿、`npm ci` 成功，构建仍然失败。详见 §3.1.7。

#### 3.1.2 控制台六步操作

1. `dash.cloudflare.com` → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. GitHub 授权页选 **Only select repositories**，只勾 `Shonee/rss-radar` → **Install & Authorize**
3. 选中仓库 → **Begin setup**
4. 按下表填写构建配置（**本项目准确值，不需要改框架预设**）：

   | 字段 | 值 | 说明 |
   |---|---|---|
   | **Project name** | `rss-radar` | 决定 `<name>.pages.dev`；被占用则加后缀 |
   | **Production branch** | **`master`** | ⚠️ 本项目默认分支是 `master`，**不是 `main`** |
   | **Framework preset** | Vite（或 None） | 不影响结果，四个字段以下表为准 |
   | **Build command** | `npm run build` | 即 `tsc -b && vite build` |
   | **Build output directory** | `dist` | 与 `vite.config.ts` 的 `build.outDir` 一致 |
   | **Root directory** | **留空** | 仓库根即项目根；仅 monorepo 才填 |

5. **Environment variables** 增加三条（**Production 环境，构建期生效**）：
   - `NODE_VERSION` = `20`（`package.json` 的 `engines.node` 要求 `>=20`，显式钉住而非赌 CF 默认镜像版本）
   - `VITE_DATA_OWNER` = `Shonee`
   - `VITE_DATA_REPO` = `rss-radar-data`
   > 后两条指向**独立公开数据仓库**（见 §3.1.5）。**必须先配好**，否则站点只会读到空 / fixture 数据，且构建不报红。
6. **Save and Deploy**，等日志出现 `✓ built in ...` 与部署成功提示

**不需要 `_redirects`**：本项目用 `HashRouter`，URL 只会有 `/` 与 `/#/xxx`，不会向服务器请求深链路径，故无需 SPA fallback 规则（对比：若改用 `BrowserRouter` 才需要 `_redirects` 里的 `/* /index.html 200`）。

**前置校验（本地等价实测，2026-09-15）**：

> 🔴 **这四条要一起跑。** 前两条在 2026-09-15 首次部署时**全绿**，构建照样失败了——它们各自只看一段链路（§3.1.7）。

```bash
# ① lock 与 package.json 一致性（模拟 CF 构建第一步）
git show origin/master:package.json       > /tmp/lockcheck/package.json
git show origin/master:package-lock.json  > /tmp/lockcheck/package-lock.json
cd /tmp/lockcheck && npm ci --dry-run --registry=https://registry.npmjs.org
# → 302 packages，无 ERESOLVE / 无 lock 漂移 ✅

# ② 构建命令本身（模拟 CF 构建第二、三步）
npm run build   # → ✓ built in 1.41s，无 TS 报错 ✅（本地为 darwin-arm64，平台匹配）

# ③ 🔴 lock 是否含目标平台（Linux）的可选依赖 —— 必跑
node -e "const p=require('./package-lock.json').packages;const need=['@rollup/rollup-linux-x64-gnu','@esbuild/linux-x64'];const miss=need.filter(n=>!p['node_modules/'+n]);if(miss.length){console.error('❌ lock 缺少平台包:',miss.join(', '));process.exit(1)}console.log('✅ lock 含 Linux 平台包')"

# ④ 真实模拟 CF 的 Linux 环境安装（npm 原生支持 --os / --cpu 跨平台开关）—— 最强证据
mkdir -p /tmp/crosscheck && cp package.json package-lock.json /tmp/crosscheck/ && cd /tmp/crosscheck
npm ci --os=linux --cpu=x64 --ignore-scripts
ls node_modules/@rollup/rollup-linux-x64-gnu node_modules/@esbuild/linux-x64   # 两个都应存在 ✅
```

> 依赖源：修复后 `package-lock.json` 中 **302 个包全部指向官方 `registry.npmjs.org`**（修复前有 1 个 `registry.npmmirror.com`），均为公网可达源，CF 构建容器可正常安装。

#### 3.1.3 🔴 必做配置：分支构建控制（不配会爆配额）

**这是 Git 集成路径上唯一一个"不做就出事"的步骤。**

CF 项目**默认对所有非生产分支自动构建预览部署**（官方：*"All non-Production branches: By default, Pages will automatically deploy any and every commit to a preview branch."*）。而本项目的 `collect.yml` **每 30 分钟**向 `deploy` 分支推一次数据：

| Workflow | 推送分支 | 频率 | 默认配置下的后果 |
|---|---|---|---|
| `collect.yml` | `deploy`（非生产） | 每 30 分钟 ≈ **1440 次/月** | 🔴 触发预览构建，**远超 500 builds/月**；且 `deploy` 是 orphan 分支**没有源码与 `package.json`**，每次构建必然失败 |
| `archive.yml` | `deploy`（非生产） | 每年 1 次 | 同上（量小） |
| `keepalive.yml` | `master`（生产） | 每周 1 次 | 触发生产构建（源码未变，属无用构建） |

**`[skip ci]` 不能作为依赖**，有两个理由：

1. 官方要求是 **prefix（前缀）**：*"By adding the `[CI Skip]`, `[CI-Skip]`, `[Skip CI]`, `[Skip-CI]`, or `[CF-Pages-Skip]` flag **as a prefix** in your commit message, and Pages will omit that deployment."* 而本项目三处 workflow 的 `[skip ci]` **都在 message 末尾**：
   - `collect.yml` → `chore(data): $TODAY [skip ci]`
   - `archive.yml` → `chore(archive): prune history [skip ci]`
   - `keepalive.yml` → `chore(keepalive): prevent scheduled-workflow disable [skip ci]`

   另有社区实测称 CF 扫描**整条 message（subject + body）**而非仅前缀，与官方措辞存在出入。**结论：该行为不确定，不可当作唯一防线。**
2. 即使生效也属**隐式魔法字符串**——一旦有人调整 commit message 格式就会静默失效，而失效的代价是配额爆掉。

**正确做法（官方显式机制）**：项目 → **Settings → Builds & deployments**：

| 配置项 | 设为 | 效果 |
|---|---|---|
| **Configure Production deployments** → `Enable automatic production branch deployments` | 保持**勾选** | `master` push 自动构建（Git 集成的价值所在） |
| **Configure preview deployment** → **Preview branch** | **`None`** | 彻底关闭所有非生产分支的自动构建 → `deploy` 数据 push 不再触发任何构建 ✅ |

> 若日后确实需要预览分支，改用 **`Custom branches`** 并设置 `Exclude Preview branches: deploy`（规则执行顺序为 ① Excludes → ② Includes → ③ Skip）。
>
> 备选（更保守）：**取消勾选** `Enable automatic production branch deployments`，完全停用自动构建，仅用 `wrangler` 直传 —— 这等于把 Git 集成项目当 Direct Upload 用（受支持，见 §3.0 不对称性）。

> **建议（尚未实施）**：把三处 workflow 的 `[skip ci]` 从末尾移到 message **开头**，与官方 prefix 要求对齐，作为 §3.1.3 之外的**第二层保险**（不能替代分支控制）。

#### 3.1.4 数据更新与站点部署解耦（架构不变）

数据更新**不经过任何构建流程**：`collect.yml` 推 `deploy` 分支 → 前端**运行时 fetch**。因此：

- 站点构建（push `master`）与数据更新（push `deploy`）是**两条独立链路**；
- §3.1.3 把 preview 关掉之后，`deploy` 分支的 push 对 CF 完全不可见，**不产生任何构建**；
- 这也意味着**数据更新后站点无需重新部署**——但前提是前端能读到 `deploy` 分支的数据（见下节）。

#### 3.1.5 数据可达性方案（已定：独立公开数据仓库）

前端 `src/services/dataClient.ts` 的三层降级顺序为 **① raw.githubusercontent.com → ② jsDelivr（版本化 commit）→ ③ `./data/` 本地兜底**（`src/config/site.ts` 提供基址；`<owner>` / `<repo>` 由环境变量 `VITE_DATA_OWNER` / `VITE_DATA_REPO` 覆盖，默认指向本仓库）。

**问题复现与实测证据**（私有仓库形态下，前两层在浏览器端均不可用）：

| 层 | 结果 | 依据 |
|---|---|---|
| ① `raw.githubusercontent.com` | ❌ **404** | 实测 `curl raw.githubusercontent.com/Shonee/rss-radar/deploy/today/latest.json` → 404；私有仓库 raw 需鉴权，前端无法携带 token |
| ② `cdn.jsdelivr.net` | ❌ 不可用 | jsDelivr 仅服务公开仓库 |
| ③ `./data/` 兜底 | ⚠️ **仅 1 个文件** | CF 只 clone `master`，而被 git 跟踪的数据文件**只有** `public/data/today/snapshot.json`（P1 手工 fixture，3 条，`date=2026-09-13`）。`.gitignore` 已忽略 `public/data/today/*`（保留该 fixture）、`public/data/history/`、`public/data/latest.json` |

> ⚠️ **注意本地与云端的差异**：本地 `npm run build` 产出的 `dist/data/` 里**含有真实数据**（dev-bridge 写入 `public/data/` 后被 Vite 拷入），但那些文件**未入库**，因此 **CF 构建的 `dist/` 不会包含它们**。
>
> 🔴 **由此产生一个高危诱导**：把本地 `dist/` 目录**拖拽**上传达 CF 可以立刻"看到数据"——**但拖拽属于 Direct Upload，会永久锁死本项目的 Git 集成能力**（§3.0）。**禁止为图省事走这条路。**

**已选方案 + 其余候选（备查）**：

最终采用 **方案 ①：独立公开数据仓库**。理由：零前端改动（owner/repo 已由 `VITE_DATA_OWNER` / `VITE_DATA_REPO` 支持）、数据仍走运行时 fetch（保持实时）、私有代码仓库不公开。原「仓库转 public」「构建时带出数据」「Worker 代理」三个候选均降级为**未采用的备选**（见下表）。

| # | 方案 | 状态 | 优点 | 代价 |
|---|---|---|---|---|
| ① | **独立公开数据仓库**（采用） | ✅ **已定** | 零前端改动；数据实时；代码仓库维持私有 | 需新建公开仓库 + 搬运 workflow + CF 两个构建期环境变量 |
| ② | 仓库转 public | 未采用（备选） | 零代码改动，raw 与 jsDelivr 立即可用 | 源清单与采集数据完全公开 |
| ③ | 构建时带出数据（Git 集成 Build command 拉 `deploy` 分支） | 未采用（备选） | 数据内联进产物，不依赖运行时网络 | Build command 变复杂；数据随构建时间点冻结（失去运行时实时性） |
| ④ | Cloudflare Worker 代理 GitHub Contents API（带 token 服务端读取） | 未采用（备选） | 数据保持实时，仓库维持私有 | 多一个组件要维护，需处理缓存与鉴权 |

**架构说明（代码仓库 ↔ 公开数据仓库）**：

- **私有仓库 `Shonee/rss-radar`**：代码 + 配置（`src/`、`scripts/`、`config/`、`docs/`），含 `deploy` 数据分支作为私有备份与 `archive` / `notify` 工作分支。
- **公开数据仓库 `Shonee/rss-radar-data`**：仅承载数据，分支仍叫 `deploy`，结构为 `today/`（当天数据 + `today/latest.json` 指针）、`history/`、`stats/`。
- **搬运**：新增 `.github/workflows/mirror-data.yml`，由 `collect` / `notify` / `archive` 完成事件经 `workflow_run` 触发，把私有仓库的 `deploy` 分支 `--force` 推送到公开数据仓库。**不能用 `on: push`**——`deploy` 分支提交信息带 `[skip ci]`，GitHub 会跳过 push 触发的 workflow。
- **前端取数**：仍走三层降级，仅 owner/repo 经 `VITE_DATA_OWNER` / `VITE_DATA_REPO` 指向公开数据仓库（生产环境 `Shonee` / `rss-radar-data`）。`collect.yml` 已修指针落点为 `today/latest.json`，与前端 `config/site-config.json` 的 `deploy.pointerPath` 一致。

**落地清单（用户需在 GitHub / Cloudflare 后台做的事，按顺序）**：

1. **新建公开仓库** `Shonee/rss-radar-data`（空仓库即可，不必初始化 README）。
2. **创建细粒度 PAT**：**只在** `rss-radar-data` 上拥有 `Contents: Read and write` 权限；值由你生成，存为 secret（勿在文档/代码中明文存放）。
3. 在私有仓库 `Shonee/rss-radar` 的 **Settings → Secrets and variables → Actions** 添加 secret **`DATA_REPO_TOKEN`**（值为上一步的 PAT）；可选添加 repository variable **`DATA_REPO`**（默认 `Shonee/rss-radar-data`，不设也可）。
4. CF Pages 项目 → **Settings → Environment variables**（**Production 环境，构建期生效**）新增 **`VITE_DATA_OWNER=Shonee`** 与 **`VITE_DATA_REPO=rss-radar-data`**。
5. 触发一次重新部署；或在 Actions 里手动 `workflow_dispatch` 跑一次 `mirror-data` 验证镜像成功。
6. **验收**：打开站点，首屏应为**当天真实条目**（量级上千，不是 3 条）。

> ⚠️ **配置前先配好 secret，否则数据永远是空的。** `DATA_REPO_TOKEN` 未配置时，`mirror-data.yml` 会打印 `::warning::` 并**跳过**镜像（不会失败），所以配置前的部署不会报红、却也读不到任何数据——这正是「页面空 / 只有 fixture」的根因之一。务必先把上面 1–4 步走完。
>
> 原「首屏 3 条 fixture + 数据可能非最新横幅 = 预期结果」的判据**已作废**：配好数据通道后，那属于**故障信号**（见 §3.1.6）。

#### 3.1.6 部署验收标准：正常现象 vs 真故障

打开 `https://<project>.pages.dev`，按下表判定：

| 观察到的现象 | 判定 |
|---|---|
| 页面正常渲染，四个页面均可导航切换 | ✅ 部署成功 |
| 首屏 **3 条**内容，日期显示 `2026-09-13` | ❌ **故障信号**：数据通道未配好，前端只读到 `public/data/today/snapshot.json` 的 P1 fixture（§3.1.5）。配好 `DATA_REPO_TOKEN` + `VITE_DATA_OWNER` / `VITE_DATA_REPO` 后，首屏应为当天真实条目（量级上千） |
| 顶部出现「数据可能非最新」横幅 | ✅ 三层降级的设计行为，诚实反馈（数据滞后 >60 分钟时出现，非故障） |
| 页面 2 渠道看板**大量/全部** `failed` | ❌ **故障信号**：多为 fixture（`date=2026-09-13`）里的旧健康状态；真实数据下应反映当天采集结果。若数据通道已配却仍如此，检查 `mirror-data` 是否成功推送公开仓库 |
| 白屏 / 控制台报 `assets/index-*.js` 404 | ❌ **真故障**：构建产物引用路径问题 |
| 页面结构错乱 / MUI 样式全丢 | ❌ **真故障**：CSS 未加载 |
| CF 构建日志中 `npm ci` 或 `tsc` 报错 | ❌ **真故障**：环境或类型问题（排查见 §3.1.7） |
| CF 构建日志中 `vite build` 报 `Cannot find module @rollup/rollup-linux-x64-gnu` | ❌ **真故障**：lock 缺 Linux 平台变体 —— **2026-09-15 实际发生过，修复见 §3.1.7** |

#### 3.1.7 🔴 构建失败排查：跨平台可选依赖（2026-09-15 真实案例）

**现象**：CF 构建在克隆、`npm ci`、`tsc -b` **全部成功之后**，`vite build` 阶段崩溃：

```
> rss-radar@0.1.0 build
> tsc -b && vite build

Error: Cannot find module @rollup/rollup-linux-x64-gnu. npm has a bug related to optional
dependencies (https://github.com/npm/cli/issues/4828). Please try `npm i` again after
removing both package-lock.json and node_modules directory.
    at requireWithFriendlyError (/opt/buildhome/repo/node_modules/rollup/dist/native.js:121:9)
  code: 'MODULE_NOT_FOUND'

Failed: build command exited with code: 1
```

**根因**：`rollup`（Vite 的打包内核）4.x 把平台原生二进制拆成 25 个 `@rollup/rollup-<os>-<cpu>` 包，通过 `optionalDependencies` 分发；`esbuild` 同理（23 个 `@esbuild/*`）。**这些平台包必须写进 `package-lock.json`**，`npm ci` 才知道该装哪一个。

本项目修复前的 lock 里**只有 `darwin-arm64` 一个变体**（在 macOS arm64 上生成），于是 CF 的 Linux 容器：

| 构建阶段 | 结果 | 说明 |
|---|---|---|
| `Cloning repository` | ✅ 成功 | CF 克隆远端 `master` |
| `npm clean-install` | ✅ **成功**（`added 252 packages`） | 🔴 lock 与 `package.json` 是**"一致地缺"**，校验不出来 |
| `tsc -b` | ✅ 通过 | 纯类型检查，不加载原生二进制 |
| `vite build` | ❌ **崩溃** | `require('@rollup/rollup-linux-x64-gnu')` → `MODULE_NOT_FOUND` |

> 🔴 **核心认知：`npm ci` 成功 ≠ lock 完整。** install 阶段只按 lock 落盘；**真正 `require` 原生模块发生在 build 阶段**。所以 §3.1.2 的 ①② 两条校验（一致性 + 本地构建）**全绿也推不出「CF 能构建成功」**——这是个"链路分段"陷阱。

**为什么本地一直发现不了**：本地是 macOS arm64，lock 里的 `@rollup/rollup-darwin-arm64` / `@esbuild/darwin-arm64` 刚好匹配当前平台，`npm run build` 永远绿。**平台不匹配只在"另一个平台"上暴露。**

**修复（2026-09-15 已实施）**：重新解析，生成**平台完整**的 lock。

```bash
# 先备份，再重生成（不要在唯一的 lock 上直接试验）
cp package-lock.json /tmp/package-lock.backup.json
rm -rf node_modules package-lock.json && npm install
```

**本次修复的实际改动（已逐项核对）**：

| 指标 | 结果 |
|---|---|
| 新增条目 | **48 个**，全部是平台专属可选依赖（rollup 25 个变体 + esbuild 23 个变体，另 1 个 `@napi-rs/lzma-linux-x64-gnu`） |
| 删除条目 | **0 个** |
| 版本漂移 | **仅 3 个 patch 级**：`rollup` 4.63.2→4.63.3、`@rollup/rollup-darwin-arm64`、`electron-to-chromium` 1.5.427→1.5.428 |
| 依赖源 | 302/302 全部 `registry.npmjs.org`（修复前含 1 个 `registry.npmmirror.com`） |
| 构建复测 | ✅ `rollup 4.63.3` + `vite 5.4.21` → `✓ built in 1.41s`，无回归 |

**验证结果（即 §3.1.2 的 ③④ 两条）**：

- ③ lock 平台包：rollup **25** 个 / esbuild **23** 个 ✅
- ④ `npm ci --os=linux --cpu=x64` 真实安装：`@rollup/rollup-linux-x64-gnu@4.63.3` 与 `@esbuild/linux-x64@0.21.5` 均正常落地 ✅

**两个"看起来很对、但会复发或扩大问题"的做法（禁止）**：

| 做法 | 为什么不行 |
|---|---|
| 在 CF Build command 里加 `npm i @rollup/rollup-linux-x64-gnu` | 把平台假设焊进构建脚本；CF 换 runner 架构（如 arm64）立刻失效，且掩盖 lock 缺陷本身 |
| 改用 `npm ci --omit=optional` / `--no-optional` | 直接砍掉全部可选依赖，把同类问题扩大化（esbuild 也会一起废） |

**已实测排除的怀疑（避免下次误判）**：曾怀疑"在 macOS 上跑 `npm install` 会把其他平台变体重新剪掉"。**隔离目录实测：不成立** —— 对**平台完整**的 lock 在 macOS 执行 `npm install`，25 个 rollup 变体与全部 linux 条目**一个不少**。即 **lock 一旦完整即稳定，不需要每次提交都重新生成。**

**附带发现（非阻塞）**：本次日志显示 `Detected the following tools from environment: npm@10.9.2, nodejs@22.16.0`，说明步骤 5 建议的 `NODE_VERSION=20` **未生效或未配置**。22.16.0 满足 `engines.node >=20`，**不阻塞构建**，但与文档预期不一致，建议核对 **Settings → Environment variables**。

**修复后的下一步**：提交 lock 改动并推到 `master`（⚠️ 本地与远端已分叉，直接 `git push` 会被拒，需先合并/变基），CF 会自动重新构建；判定标准回到 §3.1.6。

---

### 3.2 路径 B：Direct Upload（`wrangler` 直传）

> 采用**方案 A**（ARCHITECTURE §7.6.6）：**由 GitHub Actions 构建，再用 `wrangler` 把 `dist/` 直传 CF Pages**（CF 不构建）。这是 `ARCHITECTURE.md` §7.6 **v1.2 的推荐方案**。

#### 3.2.1 为什么直传（§7.6.1 / §7.6.2）

- Direct Upload = 上传**已构建好的产物**，**CF 全程不构建** → **不消耗 CF `500 builds/月`**。
- 增量上传：`wrangler pages deploy` 按文件内容哈希比对，**只上传变更文件** → 后续部署秒级。
- 配额边界（Free）：单项目文件数 ≤ 20,000、单文件 ≤ 25 MiB、账户项目 ≤ 100、带宽无限。本项目远不触及。
- **不受数据分支 push 干扰**：数据在 `deploy` 分支更新，与 CF 项目无任何关联（这是 §3.1.3 那套分支控制问题从根上消失的原因）。

#### 3.2.2 🔴 安全红线：必须用 `wrangler-action`，并固定到 commit SHA（§7.6.3）

- 🚫 **禁用 `cloudflare/pages-action`**：已弃用**且有未修复 RCE `CVE-2026-11325`（CVSS 8.8）**，可经某些 workflow 配置泄露 `CLOUDFLARE_API_TOKEN` / `GITHUB_TOKEN`；**无补丁**；**仓库将于 2026-09-18 被删除**。
- ✅ **使用官方推荐的 `cloudflare/wrangler-action`**。
- **生产必须把 Action 固定到 commit SHA**（不要浮动 tag `@v3`，防 tag 被改写 / 投毒）：
  `uses: cloudflare/wrangler-action@9acf94ace14e7dc412b076f2c5c20b8ce93c79cd`
- **token 最小权限**：仅 **Account → Cloudflare Pages → Edit**。
- **job 权限**：`permissions: { contents: read, deployments: write }`。

#### 3.2.3 CF 侧一次性准备（**尚未做**）

| 步骤 | 操作 |
|---|---|
| 1 | CF 控制台 → Workers & Pages → **Create application → Pages → Upload assets** |
| 2 | 输入项目名（如 `rss-radar`）→ 建一个 **Direct Upload** 项目（**不连 Git**） |
| 3 | 生成 API Token（Account › Cloudflare Pages › **Edit**）→ 存为 Secrets `CLOUDFLARE_API_TOKEN`；账户 ID 存 `CLOUDFLARE_ACCOUNT_ID` |
| 4 | （可选）绑自定义域；默认已获 `<proj>.pages.dev` |

> ⚠️ **不可逆**：Direct Upload 项目**事后无法切换为 Git 集成**（官方明确：*"You cannot switch to Git integration later"*）。若要改回 Git 集成，需新建项目（见 §3.0）。

#### 3.2.4 workflow（**已创建，未真实触发验证**，设计骨架）

`.github/workflows/deploy-cf-pages.yml`（取自 ARCHITECTURE §7.6.5；P4 已创建）：

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
        # 生产已固定到核实过的 full commit SHA（见 §3.2.2，勿改回浮动 tag）
        uses: cloudflare/wrangler-action@9acf94ace14e7dc412b076f2c5c20b8ce93c79cd
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist --project-name=rss-radar
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

> 📌 文档与实现的差异修正：仓库中的真实 workflow **已固定到上述 full commit SHA**（非浮动 `@v3`）。`ARCHITECTURE.md` §7.6.3 的示例为便于阅读仍写 `@v3`，**以本文件为准**。

---

### 3.3 两条路径对比与选择建议

| 如果你… | 选 |
|---|---|
| 不想配 API Token，希望 push `master` 即自动部署 | **路径 A（Git 集成）**，但**必须**先做 §3.1.3 的分支控制 |
| 希望零构建配额消耗、数据分支零干扰 | **路径 B（Direct Upload）**，即 ARCHITECTURE §7.6 的 v1.2 方案 |
| 现在不确定、想两者都保留 | **先建 Git 集成项目**（超集，之后仍可用 `wrangler` 直传） |

> 🔴 **再次强调**：一旦**先**建成 Direct Upload 项目，Git 集成能力就永久不可获得。**倾向于"保留可能性"时应先建 Git 集成项目。**

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

## 5. 双端产物一致性（§7.4）

**该结论的成立范围取决于走哪条路径**（此处修正为如实口径）：

| 路径 | 产物关系 | 说明 |
|---|---|---|
| **路径 B（Direct Upload）** | ✅ **逐字节一致** | 两平台用**同一份 `dist/`**，由**同一 runner、同一 Node、同一 `package-lock.json`、同一次 `npm run build`** 产出 |
| **路径 A（Git 集成）** | ⚠️ **不再一致** | GH Pages 由 Actions 构建、CF 由**CF 构建容器**构建 → **两次独立构建**。虽同源同 lock（理论上产物等价），但**不满足"同一次构建"这一逐字节一致的前提** |

- 差异也体现在托管平台与访问路径（GH Pages 子路径 / CF Pages 根路径）。
- 数据更新**不经过任何构建 workflow**，而是前端**运行时 fetch**（raw 主 + jsDelivr 回退），把「数据更新」与「站点部署」彻底解耦。

---

## 6. 缓存策略（§7.3）

| 资源 | 缓存 |
|---|---|
| `index.html` | `no-cache`（保证拿到最新入口） |
| 带 hash 的静态资源 | `max-age=31536000, immutable` |
| 数据文件 | 由 raw/CDN 控制短 TTL（raw ≈ 5 分钟）；前端 fetch 用 `cache: 'no-store'` 绕浏览器缓存 |

> 📌 上表为**目标策略**；`public/_headers` **尚未创建**，当前实际依赖 CF Pages / GH Pages 的默认缓存行为。如需精确控制，需新增 `public/_headers`（CF）与对应 GH Pages 配置。
>
> 自定义域名：GH Pages 写 `CNAME` 文件；CF Pages 在 Dashboard 绑定。

---

## 7. Workflow 清单、所需 Secrets 与落地清单

### 7.1 七个 workflow

| Workflow | 用途 | 关键 Secrets | 推送分支 |
|---|---|---|---|
| `collect.yml` | 每 30 分钟采集写 `deploy` 分支 | `GITHUB_TOKEN`（内置） | `deploy` |
| `notify.yml` | 每日日报 + 实时热点触发 | `SMTP_PASSWORD`（邮箱）、`FEISHU_WEBHOOK` / `DINGTALK_WEBHOOK` / `WECOM_WEBHOOK`（对应渠道，可选） | 无（不推代码） |
| `archive.yml` | 每年 1/1 年度归档 | `GITHUB_TOKEN`（内置） | `deploy` |
| `mirror-data.yml` | `collect`/`notify`/`archive` 完成后把 `deploy` 分支 `--force` 推到公开数据仓库 `rss-radar-data`（数据可达性方案，§3.1.5） | `DATA_REPO_TOKEN`（细粒度 PAT，仅 `rss-radar-data` 写权限） | 公开仓库 `rss-radar-data` 的 `deploy` |
| `deploy-gh-pages.yml` | 手动部署 GH Pages | 无需（内置 `GITHUB_TOKEN`） | 无 |
| `deploy-cf-pages.yml` | 手动 Direct Upload 到 CF Pages | `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | 无 |
| `keepalive.yml` | 每周 trivial commit 防休眠 | `GITHUB_TOKEN`（内置） | `master` |

> 触发段默认「只手动、不自动」（`push:` 注释 + 保留 `workflow_dispatch` + job `if` 守卫）；`collect` 与 `keepalive` 为 `schedule` 定时触发。
>
> 🔴 **走路径 A（Git 集成）时**，请对照 §3.1.3 确认这些分支推送不会触发 CF 构建：`deploy`（高频）与 `master`（低频）。

### 7.2 所需 GitHub Secrets 清单

| Secret | 用途 | 是否必需 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | CF Pages Direct Upload（仅 Account › Cloudflare Pages › Edit 最小权限） | **仅路径 B 必需**；路径 A 不需要 |
| `CLOUDFLARE_ACCOUNT_ID` | CF 账户 ID | **仅路径 B 必需** |
| `SMTP_PASSWORD` | 邮箱通知（nodemailer）；配合 `config/notify.json` 的 smtp 配置 | 启用邮箱通知时必需（默认 `enabled:false`） |
| `FEISHU_WEBHOOK` / `DINGTALK_WEBHOOK` / `WECOM_WEBHOOK` | 对应 IM 渠道 webhook | 启用对应渠道时必需（默认全 `enabled:false`） |
| `DATA_REPO_TOKEN` | `mirror-data.yml` 推送数据到公开数据仓库 `rss-radar-data`（细粒度 PAT，仅该仓库 `Contents: Read and write`） | **配置数据通道必需**；不设则镜像跳过、站点读不到数据，且构建/部署不报红 |

> Secrets 在仓库 **Settings → Secrets and variables → Actions** 配置。通知相关 secret 仅在对应渠道 `enabled:true` 时才被读取；当前 4 个通知渠道在 `config/notify.json` 中**全部 `enabled:false`**。

### 7.3 落地清单

**已完成**

1. ~~代码 push 到远程仓库~~ ✅ 已完成（`master`；🟡 但**本地与远端已分叉**，待对齐）
2. ~~`deploy` 数据分支建立~~ ✅ 已完成（`collect.yml` 首次运行）
3. ~~构建链路前置校验（lock 一致性 / `npm run build`）~~ ✅ 已实测通过（§3.1.2 ①②）
4. 🔴 ~~lock 跨平台完整性修复~~ ✅ 2026-09-15 已完成（首次构建正因此失败，见 §3.1.7）

**进行中**

5. ~~选路径~~ ✅ 已选**路径 A（Git 集成）**：项目已创建、首次构建已触发，止步于 `vite build` 跨平台依赖问题。
6. **重新部署验证**：提交并推送 lock 修复 → CF 自动重建 → 按 §3.1.6 判定。
   - ⚠️ 推送前须先对齐分叉（本地独有 7 个提交 / 远端独有 3 个）。
7. **在控制台核对 §3.1.3 分支构建控制**（`Preview branch = None`）—— 构建日志无法证明该项已配，需人工确认；不配会爆 500 builds/月 配额。

**待完成**

8. 仅当改走路径 B 时才需要：配置 Secrets `CLOUDFLARE_API_TOKEN`（仅 Pages:Edit）与 `CLOUDFLARE_ACCOUNT_ID`。
9. ~~决定数据可达性方案~~ ✅ 已定**独立公开数据仓库**（§3.1.5）：新建公开 `rss-radar-data` + `mirror-data.yml` + CF 环境变量 `VITE_DATA_OWNER` / `VITE_DATA_REPO`；落地清单见 §3.1.5。

> 上述状态截至 **2026-09-15 首次构建失败**时；**站点渲染结果尚未在 CF 上实测**（首次构建未走到部署阶段）。

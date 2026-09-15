# RSS Radar 验证流程（VERIFICATION）

> 本文档回答一个问题：**怎么验证这个项目是好的？**
>
> 面向 QA 与工程师。所有命令均已在 `package.json` 的 `scripts` 中核对存在（除非特别标注为「手动配方 / 待建」）。
>
> **项目铁律（三态诚实）**：任何验证结论只有三态——`通过` / `失败` / `未验证`。DOM 未真跑时**绝不**给假 PASS，必须带 `domVerified` 标志。详见 §4。

---

## 1. 本地五道门禁（pre-commit / CI 必跑）

下列五条是「改完代码后必须全绿」的底线，全部来自 `package.json` 的 `scripts`（已核对）：

| 门禁 | 命令 | 实际执行 | 说明 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | `tsc -b --noEmit` | 全量 TS strict 类型检查；类型错误直接 0 退出 |
| 前端单测 | `npm run test:vitest` | `vitest run` | `src/**` 下的前端单测（hooks / services） |
| 脚本单测 | `npm run test:node` | `node --test ...` | `scripts/collect` `scripts/smoke` `scripts/notify` 的 `node:test` |
| 配置校验 | `npm run validate` | `node scripts/validate-schema.mjs` | ajv 校验 `config/*.json`；当前 **5/5** |
| 构建 | `npm run build` | `tsc -b && vite build` | 先类型检查再出 `dist/` |

- `npm test` = `npm run test:node && npm run test:vitest`（两套接口不同，见 §3）。
- **任何一条非 0 退出 = 门禁失败，禁止带病提交 / 合并。**

---

## 2. 采集链路本地验证（纪律）

采集管线是项目核心，本地验证方式如下：

```bash
# 跑一次全量采集（仅 enabled 源）
npm run collect:once
# 产物：tmp/deploy/today/{events-<date>.ndjson, snapshot-<date>.json, report-<date>.json, latest.json}
#       dev bridge 会同步复制到 public/data/today/，供本地页面读取

# 全链路 smoke：collect → validate → 产物契约断言
npm run smoke          # = bash scripts/smoke/run.sh

# e2e 管线（mock fixture，不触网）
npm run test:e2e       # = node scripts/smoke/e2e-pipeline.mjs
```

> ### ⚠️ 回写纪律（血泪教训，必须）
> `npm run collect:once` 会**回写被 git 跟踪的 `config/sources.json`**（`lastStatus` / `lastFetchAt` / `lastError`
> + JSON 重排）；同一轮采集的 dev-bridge 还会刷新 `public/data/today/*.json`。
> 即：**`--out` 改不了这件事**，只有 `--skip-health` 能阻止 config 回写。
>
> - **`npm run smoke` 已自动善后**：脚本跑前备份、退出时（含失败）原样还原被跟踪文件，跑完工作区保持干净。
>   想保留本次采集结果：`SMOKE_KEEP_STATE=1 npm run smoke`。
> - 手动跑采集验证时，请**加 `--skip-health`**：
>   ```bash
>   node scripts/collect/index.mjs --once --skip-health
>   ```
>   若已经跑了带 health 的采集，用**备份还原**（比 `git checkout --` 安全，不会抹掉你本地未提交的源改动）：
>   ```bash
>   cp config/sources.json /tmp/sources.bak   # ← 开跑前就该做的事
>   cp /tmp/sources.bak config/sources.json   # ← 跑完还原
>   ```
> 否则运行时回写会混进提交，污染 master。**验证产物（tmp/、public/data/today/）不进 master。**

---

## 3. 浏览器级验证（headless Chrome + CDP 手动配方）

前端页面（页面1~4 + 关于）需要真实浏览器验证。本仓库**当前未提交**自动化 CDP 套件，因此下面是**手动配方**——命令真实可跑，但自动化套件尚待建立（见 §6 / §7「未验证」）。

### 3.1 启动 headless Chrome（必须隔离 user-data-dir）

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --no-first-run \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/rss-radar-cdp
```

> **纪律**：`--user-data-dir` **必须**指向 `/tmp` 下的隔离目录（如 `/tmp/rss-radar-cdp`），否则会撞 `GoogleUpdater` 的权限拒绝而启动失败。

### 3.2 用 CDP 驱动页面

Chrome 起来后，DevTools 端点为 `http://127.0.0.1:9222`。可用 `chrome-remote-interface`（或任意 CDP 客户端）驱动：

- `Page.navigate` 到 `http://localhost:5173/#/`（需先 `npm run dev` 起 vite）
- `Runtime.evaluate` 取 DOM，断言关键节点（如热榜列表、渠道卡片、报告数字）
- 路由用 `HashRouter`，深链形如 `http://localhost:5173/#/channels`

### 3.3 `domVerified` 标志（三态诚实）

- **任何真正在 DOM 上跑过的验证**，结论必须带 `domVerified: true`。
- 仅静态分析 / 类型推断、**没有真跑 DOM** 的，结论只能标 `未验证`，绝不标 `通过`。

---

## 4. 三态诚实原则（项目铁律）

验证结论只有三态：

| 状态 | 含义 | 允许动作 |
|---|---|---|
| `通过` | 真跑且断言全绿（含 DOM 须 `domVerified`） | 可合入 |
| `失败` | 真跑且有断言非 0 / 抛错 | 阻塞，必须修 |
| `未验证` | 未真跑 / 套件未建 / 环境不具备 | 如实标注，不冒充通过 |

> **绝不给假 PASS。** 没有真跑 DOM 就写「页面渲染正常」属于违反铁律。

---

## 5. 变异测试（mutation testing）

目的：确认「失败能被检测出来」，而不是套件永远绿。验证一套检查**有效**，要证明它能对错误说不。

### 5.1 当前可跑的变异（真实存在）

```bash
# 变异 A：破坏配置 → validate 必须非 0
#   临时改坏 config/sources.json（如删掉某 channel 的必填字段）
npm run validate          # 期望：非 0 退出，报 schema 错误
git checkout -- config/sources.json   # 还原

# 变异 B：破坏类型 → typecheck 必须非 0
#   故意在 src/ 写一处类型错误
npm run typecheck         # 期望：非 0 退出
git checkout -- <改动文件> # 还原
```

以上两条证明门禁对「坏输入」说不了——套件有效。

### 5.2 P5 CDP 套件落地后的目标变异（当前未验证）

> 一旦 §6 的回归套件接入浏览器级检查，应能通过如下变异：
> 故意把 `--chrome-path` 指向不存在的路径，套件**必须非 0 退出**。
> 当前仓库无此套件，本条为**目标 / 未验证**，不要假称已实现。

---

## 6. CI 集成（GitHub Actions）

门禁与回归在 `.github/workflows/` 中挂载（6 个 workflow 见 `README.md` §6 个 workflow）：

- **五道门禁**作为 PR / push 的 required check：`typecheck` / `test:node` / `test:vitest` / `validate` / `build`。
- **回归套件**：`tests/regression/`（T-P5-02 回归套件）——**当前尚未创建（P5 待做）**。落地后由 CI 调用，例如 `node --test tests/regression/`。
- **采集 / 部署 workflow**（`collect` / `notify` / `archive` / `deploy-gh-pages` / `deploy-cf-pages` / `keepalive`）各自在 job 内串联 `npm ci` → 对应脚本。

> 注意：workflow 文件已随 P4 创建，但**尚未真实触发验证**（见 `README.md` 已知限制与 `docs/DEPLOYMENT.md` 现状标注）。

---

## 7. 验证状态总表（三态）

| 验证项 | 状态 | 依据 |
|---|---|---|
| `typecheck` / `test:node` / `test:vitest` / `validate` / `build` | `通过` | 本地已跑（validate 5/5） |
| `collect:once` / `smoke` / `test:e2e` | `通过` | 本地可跑（注意回写纪律 §2） |
| 浏览器级 DOM 验证 | `未验证` | 手动配方就绪（§3），自动化 CDP 套件待建 |
| `tests/regression/` 回归套件 | `未验证` | 目录尚未创建（P5 待做） |
| workflow 真实触发（Actions） | `未验证` | P4 已创建，未真跑 Actions |
| 部署端到端（GH Pages / CF Pages） | `未验证` | 见 `docs/DEPLOYMENT.md` §0 |

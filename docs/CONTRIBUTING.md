# RSS Radar 贡献指南（CONTRIBUTING）

> 面向想给 RSS Radar 提 PR 的工程师。先读 [`README.md`](./README.md) 与 [`USAGE.md`](./USAGE.md)，再读本文件。
> 验证相关纪律见 [`VERIFICATION.md`](./VERIFICATION.md)（三态诚实、回写纪律、变异测试）。

---

## 1. 分支与提交规范

- **分支命名**：`feat/T-<stage>-<NN>` 或 `fix/T-<stage>-<NN>`（`<stage>` ∈ `p1`..`p5`，`<NN>` 两位数任务号）。
- **commit 格式**：

  ```
  <type>(<stage>): T-<stage>-<NN> <一句话>
  ```

  - `type` ∈ `feat` / `fix` / `docs` / `test` / `chore` / `refactor`
  - `stage` ∈ `p1`..`p5`（对应 P1 采集 / P2 管线 / P3 前端+通知 / P4 部署 / P5 回归）
  - 例：`fix(p3): T-P3-06 修页面4 空态` —— 任务号在对仓库历史中可查

- **真实示例**（取自本仓库 `git log`）：

  | commit | 信息 |
  |---|---|
  | `e092865` | `fix(p3): 清掉排序档位死代码（defaultSort 配置/类型/导出/文档）` |
  | `d661349` | `feat(p3): 页面1 排序整合口径去掉模式切换 + 时间筛选删近3小时（主理人口径）` |
  | `6e20c61` | `docs(qa): 页面1 排序整合 + 时间筛选删3h 真机回归报告` |
  | `b420117` | `fix(p1): schema enum 对齐真实配置（category 13 类 + generic_api）` |
  | `173b832` | `chore(p3): 预置 nodemailer@6 依赖 + test:node 覆盖 scripts/notify` |

---

## 2. git 纪律（血泪教训，必须）

> 本项目的头号坑：**误把运行时生成物 / 回写配置 `git add` 进提交**。

- **只用显式路径 `git add <path>`，禁止 `git add -A` / `git add .`**。原因：
  - `git add -A` 会带进 `config/sources.json` 的**运行时回写**（`lastStatus` / `lastFetchAt`）；
  - 会带进 `tmp/`、`public/data/today/`、`dist/` 等生成物；
  - 会带进 `.workbuddy/` 与 QA 截图。
- **`.workbuddy/` 与 QA 截图（`docs/qa/screenshots/`）不入库**：已在 `.gitignore` / 状态忽略中排除，不要强行 `git add -f`。
- **误跑采集后的补救**：若你跑过 `npm run collect:once` / `npm run smoke`，提交前先：
  ```bash
  git checkout -- config/sources.json
  ```
- 提交前 **`git status`** 确认暂存区只有预期文件，再 `git commit`。

---

## 3. 代码规范

- **TypeScript strict** 模式（全量开启，勿用 `any` 绕过）。
- **ESM**：仓库 `"type": "module"`，新文件用 `.mjs`（脚本）或 `.ts(x)`（前端）。
- **测试双轨，接口不同，不要混写**：

  | 层级 | 测试框架 | 命令 | 文件位置 |
  |---|---|---|---|
  | `scripts/**`（采集 / smoke / 通知） | `node:test` | `npm run test:node` | `scripts/**/__tests__/*.test.mjs` |
  | `src/**`（前端 hooks / services） | `vitest` | `npm run test:vitest` | `src/**/__tests__/*.test.ts(x)` |

  > `node:test` 与 `vitest` 的 `describe/it/expect` 接口不同，跨层混写会导致其中一套收集不到用例。
- 新脚本用 `node --test` 风格；前端单测用 `vitest` 风格。

---

## 4. 新增 RSS 源的正确流程

权威样本与字段定义见 [`docs/SOURCES.md`](./SOURCES.md)（配置样本 `config/sources.json`）。

1. 在 `config/sources.json` 的 `channels[]` 加一条渠道（id / name / homepage / category / weight …）。
2. 在 `sources[]` 加源，`channelId` 必须指向 `channels[]` 中已存在的 id。
3. 跑 `npm run validate` 确保 schema 通过。
4. `git checkout -- config/sources.json` 清掉回写（见 §2），只提交你对配置的**有意改动**。
5. 提交，commit 遵循 §1 格式。

> 新增分类（category）需四处同步：`config/categories.json` → `config/keyword-rules.json` → `sources.schema.json#/definitions/categoryKey` → `src/types/models.ts`（详见 README「CategoryKey 启用集 vs 预留集」）。

---

## 5. PR 流程与自查清单

1. 开分支（§1），本地改动。
2. 跑完本地五道门禁（见 [`VERIFICATION.md`](./VERIFICATION.md) §1）全绿。
3. 若跑过 `collect:once` / `smoke`，确认已 `git checkout -- config/sources.json`。
4. 用**显式路径** `git add`，勿用 `-A` / `.`。
5. 提 PR，标题同 commit 规范，描述关联 `T-<stage>-<NN>`。

### 提交前自查清单

- [ ] 本地五道门禁全绿：`typecheck` / `test:node` / `test:vitest` / `validate` / `build`
- [ ] 若跑过 `collect:once` / `smoke`，已 `git checkout -- config/sources.json`
- [ ] 未触碰 `.workbuddy/` 与 QA 截图（`docs/qa/screenshots/`）
- [ ] 改动用显式路径 `git add`，暂存区无生成物 / 回写
- [ ] 浏览器级改动若未真跑 DOM，结论标 `未验证` 而非 `通过`（三态诚实，见 VERIFICATION §4）
- [ ] PR 标题遵循 `<type>(<stage>): T-<stage>-<NN> <一句话>`
- [ ] 合并前 CI 五道门禁 + 回归套件（`tests/regression/`，P5 落地后）通过

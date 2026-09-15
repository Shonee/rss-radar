# tools/legacy-python

> **定位**：这是从原 `rss_private` 项目**原样归档**的参考实现，**不参与 CI、不参与构建、不保证可运行**。保留它的目的是记录原始「飞书表当源清单 + feedparser 按时间窗解析」的思路，作为 rss-radar 当前实现的设计溯源。
>
> 源项目路径：`/Users/dushouxin/WorkSpace/github/rss_private`（Python + 飞书多维表格源清单同步 + feedparser 解析）。其 RSS 源清单已合并进 `config/sources.json`。

## 归档内容

| 文件 | 说明 |
|---|---|
| `rss_sync.py` | 飞书多维表格源清单 → 本地 CSV 增量同步 |
| `rss_parse.py` | requests + feedparser 抓取，按「昨天零点」时间窗过滤，输出 Markdown 列表 |
| `feishu_bitable_utils.py` | 飞书 Bitable 客户端（tenant_access_token + 分页 + 字段解包） |
| `file_utils.py` | 文本/JSON 落盘工具 |
| `csv_pandas_utils.py` | CSV / pandas 读写工具 |
| `requirements.txt` | 原项目 Python 依赖 |
| `rss.md` | 抓取结果示例（Markdown 列表） |
| `rss_parse.yml` / `rss_sync.yml` | 原项目 GitHub Actions 定时任务 |

## 原脚本 → rss-radar 等价能力映射

| 原脚本 | 作用 | rss-radar 对应 |
|---|---|---|
| `rss_sync.py` | 飞书多维表格源清单 → 本地 CSV 增量同步 | `scripts/sync-sources.mjs`（本次新增）|
| `rss_parse.py` | requests + feedparser 抓取，按「昨天零点」时间窗过滤，输出 Markdown 列表 | `scripts/collect/`（`connectors/feed-rss.mjs` / `feed-atom.mjs` + `index.mjs` 编排，能力更强：重试 / ETag / 健康检查 / 去重）|
| `feishu_bitable_utils.py` | 飞书 Bitable 客户端（tenant_access_token + 分页 + 字段解包）| `scripts/collect/connectors/feishu-bitable.mjs` |
| `file_utils.py` / `csv_pandas_utils.py` | 文本 / JSON / CSV 落盘工具 | 无直接对应；rss-radar 用 JSON 管线（`scripts/collect/write.mjs`）替代 |
| `.github/workflows/rss_*.yml` | 原项目定时任务 | rss-radar 的 `.github/workflows/collect.yml` 等 |

## 能力覆盖判断 + 唯一缺口

**判断：rss-radar 已覆盖 `rss_private` 的解析能力，且更强。**

- 原 `rss_parse.py` 仅做「requests 抓取 + feedparser 解析 + 昨天零点时间窗过滤 + 输出 Markdown」，无重试、无条件请求（ETag / If-Modified）、无 URL 健康检查、无去重、无分类。
- rss-radar 的 `scripts/collect/` 连接器实现了：请求重试、条件请求（ETag / Last-Modified）、URL 健康检查（`url-health.mjs`）、多级去重（`dedup.mjs`，含 SimHash64 / Dice）、分类（`classify.mjs`）、规范化（`normalize.mjs`）与快照/事件双写（`write.mjs`）。整体严格覆盖并超越原 Python 脚本。

**唯一缺口（已补齐）：**

原 `rss_private` 的**独有能力**是「飞书多维表格当**源清单注册表** + 增量同步」——即把 RSS 源清单维护在飞书 Bitable 中，再同步到本地。这一能力已由 `scripts/sync-sources.mjs` 补齐（对应原 `rss_sync.py` + `feishu_bitable_utils.py` 的核心逻辑）。除此外，原项目无 rss-radar 未具备的能力。

## 🔒 安全提示（脱敏）

原 `feishu_bitable_utils.py` **曾硬编码明文凭证**（飞书 app_id / app_secret，形如 `cli_a****100d` / `IgDK****U1FF`）：

归档版本已将其改为从环境变量读取：

```python
app_id=os.environ.get("FEISHU_APP_ID"),
app_secret=os.environ.get("FEISHU_APP_SECRET")
```

并已补 `import os`；文档 URL 中残留的 app_id 片段也一并替换为 `<APP_ID>` 占位。**任何情况下不要把凭证写回代码。** 校验：在本仓库范围（排除 `node_modules` / `.git`）对这两个字符串 `grep` 均无输出。

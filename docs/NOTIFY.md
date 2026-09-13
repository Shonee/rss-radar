# RSS Radar 通知配置指南（NOTIFY）

> 本文档最后与代码同步于 commit `8b9eab8`。
>
> 内容以 `scripts/notify/` 的**真实实现**为准（`main.mjs` / `index.mjs` / `channels/*.mjs` / `throttle.mjs` / `lib/idempotency.mjs`）。
> 相关文档：[`USAGE.md`](./USAGE.md)、[`SOURCES.md`](./SOURCES.md)、[`DEPLOYMENT.md`](./DEPLOYMENT.md)。

---

## 1. 架构边界（先讲清楚）

- **通知在 GitHub Actions 侧发送**：由采集 / 定时 workflow 调用 `scripts/notify/` 完成。
- **前端只读展示，没有任何触发发送的入口**：页面1 底部与「关于」页各有一个只读的「通知状态」面板（`src/components/NotifyStatusPanel.tsx`），它只**读取**通知产物；页面里**没有**「发送」按钮 / 链接（ARCHITECTURE §12 硬约束）。
- **密钥只存 GitHub Secrets**：`config/notify.json` 里的 `refs.*` **只放变量名**，运行时由 `process.env[ref]` 读取，**配置文件内绝无明文密钥**。
- **失败不阻断主流程**：任一渠道失败都不影响采集 / 落盘（ARCHITECTURE §12.6）；只有「本次所有被尝试的渠道都失败」才让进程非零退出。

> ⚠️ **当前尚未接线**：`.github/workflows/notify.yml` **尚未创建**（属 P4，T-P4-01）。因此**定时推送当前还没跑起来**，真实发送**尚未验证**（本地只做了 dry-run 与 mock 单测）。下面流程为「按实现设计的操作手册」。

---

## 2. 当前配置状态（`config/notify.json`，如实抄录）

| 渠道 id | channelType | enabled | events | 引用（Secrets 变量名） |
|---|---|---|---|---|
| `email-main` | `email` | **false** | dailyReport, realtime | `refs.password = SMTP_PASSWORD` |
| `feishu-webhook` | `feishu` | **false** | realtime | `webhookRef = FEISHU_WEBHOOK` |
| `dingtalk-webhook` | `dingtalk` | **false** | dailyReport | `webhookRef = DINGTALK_WEBHOOK`、`signSecretRef = DINGTALK_SIGN_SECRET` |
| `wecom-webhook` | `wecom` | **false** | realtime | `webhookRef = WECOM_WEBHOOK` |

- **4 个渠道当前全部 `enabled:false`**（占位，默认关闭）。
- 全局：`realtime.enabled = false`；`realtime.hotScoreThreshold = 0.8`；`realtime.sourceCountThreshold = 3`；`realtime.maxPerDay = 10`；`quietHours = "23:00-07:00"`；`defaults.retry = { max: 2, backoffMs: [1000, 3000] }`；`defaults.timezone = "Asia/Shanghai"`。
- `notify.json` 的渠道对象支持两种引用写法：顶层 `webhookRef` / `signSecretRef`（当前用这种），或 `refs: { webhook, signSecret, password, appId, appSecret, corpSecret }`（等价）。

---

## 3. 4 渠道启用流程（通用 5 步）

对任意渠道：

1. **获取凭据 / Webhook**（见 §4 各渠道）。
2. **存入仓库 Secrets**：Settings → Secrets and variables → Actions → New repository secret，变量名与 `refs.*` 完全一致。
3. **在 `config/notify.json` 里配置该 channel**：把 `enabled` 改 `true`，并在 `events[]` 里勾选订阅的事件。
4. **本地 dry-run 预览**（不真发、不写状态、不写 stats）：

   ```bash
   node scripts/notify/main.mjs --dry-run --event dailyReport
   node scripts/notify/main.mjs --event realtime --dry-run
   ```

   输出含：消息体预览（subject + markdown）+ **逐渠道判定**（`OK / SKIP / FAIL`）+ 汇总（`sent / skipped / failed`）。
5. **真发**：去掉 `--dry-run`（本地真发需先在当前 shell `export` 对应环境变量）。

### CLI 用法（`scripts/notify/main.mjs`）

```
node scripts/notify/main.mjs [options]

--dry-run                构建消息但「不真发」，打印预览 + 逐渠道判定
--event <name>           dailyReport（默认）| realtime
--date <YYYY-MM-DD>      日报日期
--report <path>          指定 report.json（默认探测 public/data/today/，兜底示例文件）
--items <path>           实时条目来源 JSON（数组或 {items:[]}）
--config <path>          默认 config/notify.json
--site-config <path>     默认 config/site-config.json
--state <path>           默认 stats/notify-state.json
--stats-dir <path>       默认 stats/
```

- `--dry-run` 与真发的区别：dry-run 下所有「已启用且已订阅」的渠道都会记为 **`SKIP`（reason=`dry-run`）**，且**不写状态 / 不写 stats**。
- `--report` 自动探测顺序：`--report` 指定值 → `public/data/today/report-<date>.json` → `public/data/today/report.json` → `public/data/today/latest-report.json` → `docs/data-model/examples/report.example.json`（兜底示例）。

---

## 4. 各渠道如何拿凭据 / 配置

### 4.1 邮箱（`channelType: "email"`，SMTP + `nodemailer`）

- **获取凭据**：用任意 SMTP 服务（企业邮箱 / QQ 邮箱 / Gmail 的「应用专用密码 / 授权码」）。
- **存 Secrets**：`SMTP_PASSWORD`（授权码）。`from` 即发件邮箱。
- **配 channel**：

  ```jsonc
  {
    "id": "email-main",
    "channelType": "email",
    "enabled": true,
    "events": ["dailyReport", "realtime"],
    "refs": { "password": "SMTP_PASSWORD" },
    "smtpHost": "smtp.example.com",
    "smtpPort": 465,
    "secure": true,
    "from": "radar@example.com",
    "to": ["user@example.com"]
  }
  ```

- 实现细节：`email.mjs` 用 `nodemailer.createTransport({ host, port, secure, auth: { user: from, pass: password } })`，发 `{ from, to, subject: 标题, text, html }`（`text` 为纯文本兜底，`html` 为模板 HTML）。
- `auth.user` 取 `channel.from`；`to` 可为数组。

### 4.2 飞书（`channelType: "feishu"`，群机器人 webhook / 应用消息）

**形态由配置决定**：有 `webhookRef` → webhook 形态；有 `appId`+`appSecret`（或 `refs.appId` / `refs.appSecret`）→ app 形态；也可显式写 `"mode": "webhook" | "app"`。

- **群机器人 webhook**：
  - 获取：飞书群 → 设置 → 群机器人 → 添加「自定义机器人」→ 得到 Webhook 地址（可选开启「签名校验」得到 secret）。
  - 存 Secrets：`FEISHU_WEBHOOK`（+ 可选 `FEISHU_SIGN_SECRET`）。
  - 配 channel 见 §2 表；消息体为 `{"msg_type":"text","content":{"text": ...}}`。
- **应用消息**：
  - 获取：飞书开放平台建应用 → 拿 `app_id` / `app_secret`；配好机器人能力与接收人。
  - 存 Secrets：`FEISHU_APP_ID` / `FEISHU_APP_SECRET`。
  - 配 channel：

    ```jsonc
    {
      "id": "feishu-app",
      "channelType": "feishu",
      "mode": "app",
      "enabled": true,
      "events": ["dailyReport"],
      "refs": { "appId": "FEISHU_APP_ID", "appSecret": "FEISHU_APP_SECRET" },
      "receiveIdType": "open_id",
      "receiveId": "<接收人 open_id>"
    }
    ```

  - 实现：先取 `tenant_access_token`，再 `POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=...`。

### 4.3 钉钉（`channelType: "dingtalk"`，群机器人 webhook + 加签）

- **获取**：钉钉群 → 群设置 → 智能群助手 → 添加机器人 → 自定义 → 安全设置选「加签」，得到 Webhook 与 **加签 secret**。
- **存 Secrets**：`DINGTALK_WEBHOOK`、`DINGTALK_SIGN_SECRET`。
- **配 channel**：

  ```jsonc
  {
    "id": "dingtalk-webhook",
    "channelType": "dingtalk",
    "enabled": true,
    "events": ["dailyReport"],
    "webhookRef": "DINGTALK_WEBHOOK",
    "signSecretRef": "DINGTALK_SIGN_SECRET"
  }
  ```

- 消息体：`{"msgtype":"markdown","markdown":{"title":...,"text":...}}`；**签名拼在 URL 查询参数**（见 §5）。

### 4.4 企业微信（`channelType: "wecom"`，群机器人 webhook / 应用消息）

**形态**：有 `webhookRef` → webhook；有 `corpId`+`corpSecretRef`（或 `refs.corpSecret`）→ app；或写 `"mode"`。

- **群机器人 webhook**：
  - 获取：企业微信群 → 群机器人 → 添加 → 复制 Webhook（key 在 URL 里）。
  - 存 Secrets：`WECOM_WEBHOOK`。
  - 配 channel 见 §2 表；消息体 `{"msgtype":"markdown","markdown":{"content": ...}}`。
- **应用消息**：
  - 获取：企业微信管理后台建应用 → `corpId` + `corpSecret` + `agentId`。
  - 存 Secrets：`WECOM_CORP_SECRET`。
  - 配 channel：

    ```jsonc
    {
      "id": "wecom-app",
      "channelType": "wecom",
      "mode": "app",
      "enabled": true,
      "events": ["dailyReport"],
      "corpId": "<企业 ID>",
      "refs": { "corpSecret": "WECOM_CORP_SECRET" },
      "agentId": 1000002,
      "toUser": "@all"
    }
    ```

  - 实现：`GET /cgi-bin/gettoken` → `POST /cgi-bin/message/send`。

---

## 5. 🔴 加签算法：钉钉 vs 飞书（**分开讲，勿复用**）

这是最容易配错的地方。**两者形似但不同，实现里是两个独立函数**（`dingtalk.mjs` 的 `dingtalkSign` 与 `feishu.mjs` 的 `feishuSign`），**不要试图抽公共函数**。

| | 钉钉 | 飞书 |
|---|---|---|
| 时间戳单位 | **毫秒** | **秒** |
| 密钥（HMAC key） | **secret 本身** | `timestamp + "\n" + secret` |
| 数据（HMAC data） | `timestamp + "\n" + secret` | **空串 `""`** |
| 签名编码 | `urlEncode(base64(hmac))` | `base64(hmac)`（不 urlEncode） |
| 签名位置 | **URL 查询参数** `&timestamp=<ms>&sign=<sign>` | **JSON body** 的 `timestamp` / `sign` 字段 |

**钉钉**：

```
stringToSign = timestamp(毫秒) + "\n" + secret
sign = urlEncode(base64(HMAC-SHA256(key=secret, data=stringToSign)))
POST <webhook>&timestamp=<ms>&sign=<sign>
```

**飞书**：

```
key  = timestamp(秒) + "\n" + secret
sign = base64(HMAC-SHA256(key, ""))       # data 为空串
POST <webhook>
body: { ...原有内容..., "timestamp": "<秒>", "sign": "<base64>" }
```

### 校验示例（用 `secret = SECtest123`，可本地复现）

```bash
node --input-type=module -e "
import { dingtalkSign } from './scripts/notify/channels/dingtalk.mjs';
import { feishuSign } from './scripts/notify/channels/feishu.mjs';
console.log('dingtalk ts=1757654400123 ->', dingtalkSign(1757654400123, 'SECtest123'));
console.log('feishu   ts=1757654400    ->', feishuSign(1757654400, 'SECtest123'));
"
```

实测输出（已核对）：

```
dingtalk ts=1757654400123 -> D2UhSwkaLwrJDbqp6dI%2F9rSEGjqkN7X62q5DktsbG58%3D
feishu   ts=1757654400    -> 4PooYc8ZVXSRFAPnUdldsxkbLVJHJvJp5yWRHgX1Okc=
```

**注意两者输出形态也不同**：钉钉结果里 `%2F` / `%3D` 是 URL 编码痕迹（要拼进 URL）；飞书结果是裸 base64（含 `=`），要放进 JSON body。

> ⚠️ 钉钉**只有配置了 `signSecretRef` 才会加签**；飞书 webhook **只有配置了 `signSecret` 才会加签**。若机器人安全设置选了「加签」，配置里就必须给 secret，否则会被服务端拒绝。

---

## 6. 两种推送形态

| 形态 | 事件 | 触发方式 | 默认内容 |
|---|---|---|---|
| **每日报告** | `dailyReport` | 独立 `notify.yml`（默认 08:00 Asia/Shanghai，**推前一天**） | 概要数字 + 热点 TopN + 分类分布 + 站点链接 |
| **实时热点** | `realtime` | 采集末尾按**阈值**判定（复用采集 workflow） | 触发条目 + 为什么触发 + 链接 |

- **日报幂等键**：`daily:<date>`（同一天不重复推）。
- **实时幂等键**：`realtime:<itemId>`（同一条目一天内只推一次）。
- **实时触发阈值**（默认，可配）：`hotScore ≥ 0.8` **或** 跨源 `sourceCount ≥ 3`。

本地预览：

```bash
node scripts/notify/main.mjs --dry-run --event dailyReport
node scripts/notify/main.mjs --dry-run --event realtime
```

（`--date` / `--report` / `--items` 可指定数据来源。）

---

## 7. 节流 / 防刷屏配置

在 `config/notify.json` 顶层：

| 配置 | 默认 | 含义 |
|---|---|---|
| `quietHours` | `"23:00-07:00"` | **静默时段（跨午夜）**：此时段内**实时**提醒静默，合并到次日日报 |
| `realtime.maxPerDay` | `10` | 实时提醒**每日上限**，超限丢弃并记日志 |
| `realtime.enabled` | `false` | 实时推送总开关（`false` 时实时事件直接 skip，reason=`realtime-disabled`） |
| `minRealtimeIntervalMs` | `600000`（10 分钟） | 同类实时**最小间隔**（间隔内合并/丢弃，reason=`rate-limited`） |
| `defaults.retry` | `{ max: 2, backoffMs: [1000,3000] }` | 发送失败退避重试（skipped 不重试） |

**幂等与去重**（`throttle.mjs` / `lib/idempotency.mjs`）：

- 条目级：`realtime:<itemId>`（一天内只推一次）；
- 事件级：`daily:<date>`（同一天不重复推日报）；
- 状态文件 `stats/notify-state.json`：`{ version, sent: { <key>: <ISO> }, realtime: { date, count, lastSentAt(ms) } }`；读写容错，损坏即退回空状态。

---

## 8. 排障

### 8.1 看产物

| 文件 | 内容 |
|---|---|
| `stats/notify-<ISO时间戳>.json` | 每次运行的**结果记录**：`{ schemaVersion, generatedAt, event, idempotencyKey, date, durationMs, results:[...], summary:{total,sent,failed,skipped} }`；每条 result 含 `channelId / channelType / ok / skipped / skipReason / status / error / durationMs` |
| `stats/notify-state.json` | 幂等状态（见 §7） |

> ⚠️ `stats/` 目录**当前尚不存在**，会在通知真正运行时创建（`deploy` 分支的运行时产物）。前端「通知状态」面板读的也是这两份文件（`stats/notify-state.json` 与可选的 `stats/notify-latest.json`）。

### 8.2 `skipped` 的 reason 取值清单（从代码读出）

| skipReason | 触发条件 |
|---|---|
| `disabled` | 渠道 `enabled:false` |
| `not-subscribed` | 渠道 `events[]` 不含本次事件 |
| `dry-run` | 本次带 `--dry-run` |
| `realtime-disabled` | `realtime.enabled:false` 且事件为 realtime |
| `quiet-hours` | 落在 `quietHours` 静默时段（跨午夜） |
| `duplicate-item` | 同 `realtime:<itemId>` 已发过 |
| `duplicate-event` | 同 `daily:<date>` 已发过 |
| `rate-limited` | 距上次实时发送 < `minRealtimeIntervalMs` |
| `daily-limit-exceeded` | 当日实时发送数 ≥ `realtime.maxPerDay` |
| `unknown-event` | 事件类型非法 |
| `missing-env:<REF>` | 预检发现某个必需的环境变量 `REF` 未设置 |

> 记忆点：**`skipped` ≠ 失败**。缺环境变量、被节流、未订阅，都记 `skipped`，不计入 `failed`。

### 8.3 常见问题

| 症状 | 排查 |
|---|---|
| dry-run 里渠道全是 `SKIP disabled` | 该渠道 `enabled` 还是 `false`（当前默认就是 4 个全 false） |
| 真发时 `SKIP missing-env:XXX` | 对应 Secrets / 环境变量没配，或名字与 `refs` 不一致 |
| `SKIP duplicate-event` | 该日期日报今天已成功发过（幂等生效，正常） |
| `SKIP rate-limited` | 距上次实时发送不足 10 分钟 |
| 钉钉返回 `errcode != 0` | 常见是加签错误（时间戳单位 / secret 用错，见 §5） |
| 飞书 `code != 0` | webhook 地址错 / 签名错（`timestamp` 必须是**秒**） |
| 想确认消息内容 | 先 `--dry-run` 看预览，再排查发送 |

---

## 9. 尚未验证 / 尚未实现（如实标注）

- ⚠️ **`.github/workflows/notify.yml` 尚未创建**（T-P4-01），**定时推送当前未接线**。
- ⚠️ **真实发送尚未验证**：本地仅做了 **dry-run** 与 **mock 单测**（`scripts/notify/__tests__/`），未对真实 SMTP / 飞书 / 钉钉 / 企业微信端点实发。
- ⚠️ 4 个渠道在 `config/notify.json` 中**当前全部 `enabled:false`**，`realtime.enabled:false`。
- ⚠️ 前端「通知状态」面板在无产物时**优雅降级为空态**（显示「暂无发送记录」），不会报错。

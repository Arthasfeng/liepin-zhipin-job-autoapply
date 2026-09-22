# FIXLOG 2026-09-22 — 登录态失效致投递停摆 + 可观测性补齐

## 事故现象（数据实证）

**9/18 之后所有账号投递归零**：

| 账号 | 最后事件 | 9/20 起状态 |
|------|---------|------------|
| Boss直聘A | 09-18 18:04 | ❌ 完全无事件 |
| Boss直聘B | 09-18 14:15 | ❌ 完全无事件 |
| 猎聘A | 09-22 14:47 | ⚠️ 在跑，投递恒 0 |
| 猎聘B | 09-22 14:49 | ⚠️ 在跑，投递约 0 |

- 托盘调度**正常触发**（9/20、9/21、9/22 每天 3 次 `startAll`）→ 程序没坏，是账号侧。
- 用户实测确认：**多个账号已登出**。
- 平台差异解释了两种表现：Boss 登出后无职位卡片 → 连 scanned 都没有；猎聘未登录仍能浏览列表 → 能扫不能投。

## 根因（两处，叠加）

1. **登录态失效无人知道**：程序对"无卡片"只打一行日志就继续跑，对"有卡片但全跳过"完全无感。
2. **跳过原因根本没上报**（可观测性缺陷）：
   - `liepin.js applyOne()` 里最重要的两个 skip（`已处理过` / `继续聊`）**返回时不含 `info`**；
   - 而 `index.js` 的上报点是 `if (r && r.info)` 才记录 → **这两类跳过连事件都不产生**，原因彻底丢失。
   - 另外 `jobboard-collector.js` 的 `recordApplyResult` 会把 skip 映射成 `scanned`，`reason` 字段直接丢弃。

## 修复内容

### 1. 跳过/失败原因上报（index.js 两处上报点）
改为**每张卡片无条件上报**处理结果，新增 `status` + `reason` 字段：

```js
if (r) {
  safeRecord({
    account: ..., platform: 'boss'|'liepin', keyword: ...,
    event_type: r.status === 'success' ? 'applied' : 'scanned',
    job_title/company/city/salary: (r.info && r.info.x) || '',
    status: r.status || '',      // success / skip / fail / paused
    reason: r.reason || '',      // 已处理过 / 继续聊 / 聊天未打开 / 每日沟通上限 ...
  });
}
```

`jobboard-collector.js::record()` 默认字段新增 `reason: ''`。

### 2. 登录态诊断（Runner._diagnoseLogin）
页面 URL 命中 login/passport/signin、或正文出现登录入口、或标题含"登录" → 判定失效。
落点：`run()` 中"最终卡片数为 0"时调用，命中则标记 `_loginFailed` 并告警。

### 3. 异常告警（企业微信群机器人）
新增 `notifier.js`，旁路设计（发送失败绝不影响投递）：
- `init(webhook, cooldownMs)`：webhook 为空则静默关闭
- `alert(type, text, force)`：同类告警默认 30 分钟冷却去重
- 识别企业微信 `errcode != 0` 为失败

三个触发点：
| 告警 | 触发条件 |
|------|---------|
| `login-fail-<acctId>` | 无卡片 + 诊断为登录页（强制发送，不受冷却限制）|
| `zero-apply-<acctId>` | 本轮投递 0 且扫到过职位（兜底猎聘场景）|
| `freeze-<acctId>` | 账号被冻结（每日沟通上限等）|

### 4. 配置（config/defaults.js 新增 notify 段）
```js
notify: {
  wecomWebhook: '',                  // 留空=关闭; 也可用环境变量 WECOM_WEBHOOK
  alertCooldownMs: 30 * 60 * 1000,
  alertOnLoginFail: true,
  alertOnFreeze: true,
  alertOnZeroApply: true,
}
```

## 验证结果
- `node --check` 四个文件全部通过
- notifier 实测：空 webhook → 静默关闭；假 key → 企业微信返回 `errcode 93000`，模块正确判 false 且**不抛错**

## 待办
1. **填真实 webhook**：`config/defaults.js` → `notify.wecomWebhook`（企业微信群机器人 URL）
2. **部署到 Mac Mini**：index.js / notifier.js / jobboard-collector.js / config/defaults.js
3. 重跑一轮，在 NAS 看板确认 `reason` 字段有值

## 遗留（独立问题，本次未动）
- **猎聘A 从 9/8 启用首日起就 0 投递**（累计扫描 31,936 次 / 投递 0）—— 与本次 9/18 的登录事故是**两回事**，疑似 `_processedIds` 去重集合污染（href 提取失败时用 `card_<索引>` 当 ID，不同职位相同索引会误判重复）。新加的 `reason` 上报上线后可直接证实。
- 账号名乱码导致看板里同一账号分裂成 8 个变体（编码问题）。
- 猎聘扫描唯一率仅 30-48%（近 3 天合并 26.1%），9 个搜索词高度重叠。

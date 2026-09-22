# FIXLOG — Boss 职位池投穿 + 推荐流备用池 + 黑名单筛选

日期：2026-09-22

## 背景

Boss 直聘搜索词池投穿后（连续大量"已沟通过"），旧逻辑只会滚动重试，最终 0 投递。
用户决策：连续 50 张"已沟通过"= 投穿阈值；保留白名单 + 黑名单筛选。

## 实测验证（前置研究，全链路摸清）

| 项 | 结论 |
|----|------|
| 推荐 tab | `.synthesis`（与搜索词 tab `.expect-item` 并列 y=75）|
| 产出新批次 | 靠反复点搜索词 tab（每轮 6~15 张），点已激活推荐 tab 无效 |
| 推荐流加载 | window 滚动 15→38 张上限 |
| 池子 | 90+ 唯一职位，可投率 100%（全是"立即沟通"）|
| 匹配度 | 约 80% 管理/客服类 |
| 投递真相 | 点"立即沟通"瞬间消息即发出，弹窗（留在此页/继续沟通）是导航选择非确认 |
| JS 点击 | `el.click()` 对 React tab 无效，必须 CDP `Input.dispatchMouseEvent` |
| 已沟通过判定 | 按钮 class 加 `is-disabled`（文本仍"立即沟通"）→ `reason:'已沟通过'` |

## 代码改动

### 1. `config/defaults.js`
- `limits.exhaustThreshold: 50`（投穿阈值）
- `jobFilter.blacklist: [...]`（全局黑名单 23 词）

### 2. `platforms/boss.js` — `getCardStatuses()`
- 加黑名单筛选（`skip_blacklist`），黑名单优先于白名单（`jobTitle`）

### 3. `index.js` — `_runBossPages()`
- 加 `consecutiveChatted` 计数器（跨批次累计）
- `r.reason === '已沟通过'` → 计数 ++；`r.status === 'success'` → 清零
- 投穿检测：`consecutiveChatted >= exhaustThreshold` → 切推荐流 + 企业微信告警
- 处理 `skip_blacklist` 状态（跳过 + 计入 skip）

### 4. `index.js` — `_switchBossMode()` recommend 分支
- 改用 CDP 真实点击 `.synthesis`（`engine.rect` + `mouseMove` + `mouseClick`）
- 兜底：找不到 `.synthesis` → URL 导航

## 防死循环设计（关键）

- `switchedToRecommend` 标志：推荐流也投穿 → `break` 结束本轮（等下周期）
- 投穿触发时**不调用 `_resetClocks()`**：让 3 分钟"结果健康超时"能兜底切下一 mode
  （原写法 `_resetClocks()` 会永久重置健康时钟，导致推荐流枯竭时无限循环）

## 验证结果

- 语法：index.js / boss.js / defaults.js 本地 + 远端全过
- 部署：md5 双端一致（index.js / boss.js / defaults.js）
- 黑名单端到端：15 张卡片中 3 张正确拦截（质检QC / 专员 / 工程师），12 张放行；
  "服装设计总监"正确未误伤（黑名单是"设计师"完整词非"设计"）
- 投穿检测 reason 匹配：`applyOne` 返回 `reason:'已沟通过'` 与计数器判断精确一致
- engine 方法签名：`rect()` 返回中心坐标 {x,y}，`mouseClick(x,y)` CDP 真实点击

## 待观察

投穿检测（阈值 50）完整触发需下次托盘运行时观察（企业微信告警 + 日志"切推荐流"）。
测试账号 9230 当前全部 `is-disabled`（触发了某种限制），暂不适合跑完整投递验证。

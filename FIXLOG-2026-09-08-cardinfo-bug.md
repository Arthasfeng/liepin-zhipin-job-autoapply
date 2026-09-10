# 2026-09-08 自动投递成功率骤降 — 诊断与修复记录

## 现象
- 2026-09-07 用户在 Mac Mini 开始跑升级后的 auto-apply（新增看板埋点采集）
- 投递成功率从升级前 90%+ 骤降到接近 0（日志统计全为 `✅成功:0`）
- 大量报错 `[cardInfo is not defined]`（302次/日）+ `❌`
- 服务端(data.organicomm.com)仍收到 508 条/日数据，但那是"扫描动作级"采集，非真实投递成功

## 根因（升级埋点引入的硬 Bug）
9/6 给 liepin.js 加"卡片结构化信息采集"时，在 `applyOne()` 里**引用了从未声明的 `cardInfo` 变量**：

```js
// git diff 显示新增了 3 处引用，但漏了 `var cardInfo = await this.getCardInfo(...)` 声明行
if (chat.err)      return { status:'fail', reason:'聊天未打开', info: cardInfo };   // ReferenceError
if (chat.status==='skip') return { status:'skip', reason:'继续聊', info: cardInfo }; // ReferenceError
send.info = cardInfo;    // 成功路径也必执行 → ReferenceError
```

→ **猎聘每次投递必抛 ReferenceError → 被 catch 判 fail → 成功率归零**。
Boss 的 getCardInfo 调用无 try-catch 兜底，同样有隐患。

## 诊断方法（可复用）
1. **git diff 对比升级改动**（三个未提交文件 index.js / boss.js / liepin.js = 埋点功能）— 最快定位
2. 静态分析函数体：`node -e` 提取 applyOne 方法体，检查 `cardInfo` 引用次数 vs `var` 声明
3. 构造 mock engine 单测 applyOne，复现/验证 ReferenceError

## 修复（3 文件）
| 文件 | 改动 |
|------|------|
| `platforms/liepin.js` | 补 `var cardInfo = null; try { cardInfo = await this.getCardInfo(...) } catch(e){ cardInfo=null }` |
| `platforms/boss.js` | getCardInfo 调用加同样 try-catch 兜底 |
| `index.js` | 4 处 `jobBoard.record()` 改 `safeRecord()` 包装（采集绝不阻断投递主循环） |

## 部署方式（关键！）
- 本机(yunji MacBook) → Mac Mini: **`ssh danzaipaidui@100.125.134.87`（Tailscale）免密直达主用户**
- 直接写 `/Users/danzaipaidui/Downloads/job-auto-apply/` 下文件，**无需 sudo**
- 验证 MD5 一致: `md5 -q 本地文件` vs 远端 `md5 -q`（node 不在 PATH, 用绝对路径 `/usr/local/bin/node --check`）
- 重启: `launchctl unload/load ~/Library/LaunchAgents/com.autoapply.daily.plist` + `launchctl start com.autoapply.daily`
- 确认生效: 日志不再出现 `cardInfo is not defined`，出现 `✅`

## 教训
1. 加"旁路采集"时，采集代码**绝不能引用主流程未声明的变量**；引用前先声明并 try-catch
2. 升级后必须跑一轮真实流程验证，不能只看"能启动"
3. 远程改文件用对用户（danzaipaidui），不要 admin+sudoo 绕弯
4. 本机代码 = 运行版（MD5 已校验），改本机再推送即可

## 状态
- ✅ 修复版已部署 Mac Mini 并重启（7:00 PM）
- ✅ 日志确认错误消失、✅ 成功出现
- ⏳ 成功率恢复到 90%+ 待长期运行确认

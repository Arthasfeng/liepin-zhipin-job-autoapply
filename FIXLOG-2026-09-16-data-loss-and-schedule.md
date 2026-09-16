# 2026-09-16 数据上报丢失修复 + 调度机制简化（仅托盘）

## 问题 1：退出时数据丢失
**现象**：9/16 的 656 条数据（14:00-14:28）卡在本地 buffer，服务端数据停在 12:49。9/12 也发生过同类丢失（269 条）。

**根因**：`jobboard-collector.js::flushSync()`（绑定在 `process.on('exit')`）用**异步 http.request 发送后立即清空 buffer**。Node 进程退出时未完成的请求被中断 → 数据既没发出、buffer 也被清空/或未及时写盘。

**修复（3 处）**：
| 文件 | 改动 |
|------|------|
| `jobboard-collector.js` `flush()` | 加 `req.setTimeout(15000)` 超时保护，避免服务端无响应时永久挂起 |
| `jobboard-collector.js` `flushSync()` | 改用 **`execSync` + curl 同步发送**（阻塞直到完成或超时）；失败则保留 buffer 待下次启动重发 |
| `index.js` `main()` 末尾 | 退出前 **`await jobBoard.flush()`**，等上报响应再 `process.exit(0)` |

## 问题 2：双调度冲突（已按用户决定处理）
Mac Mini 上同时存在两套调度：
- **托盘 App**（`源圈求职自动刷.app`）：08:00 / 11:00 / 13:30（用户自定义）
- **launchd**（`com.autoapply.daily`）：09:00 / 14:00 / 20:00

两者时间重叠 → 同时启动 node 进程 → 一个被"已有运行实例"跳过，数据/日志混乱，排查困难（托盘进程日志走 pipe 不落盘）。

**处置（用户决定：仅留托盘）**：
```bash
launchctl bootout gui/$(id -u)/com.autoapply.daily
launchctl disable gui/$(id -u)/com.autoapply.daily
mv ~/Library/LaunchAgents/com.autoapply.daily.plist{,.disabled}
```
→ 现在**只有托盘调度**。

## 遗留观察项（未处理）
1. **猎聘A 账号投递持续 0**（9/13-9/16 四天，观察 2-3k/天，投递 0）——疑为职位池已投遍，待确认
2. **scanned 去重率低**（30-48%，同一职位反复扫描）
3. **账号名乱码**（每天 9-30 条，~0.5%）

## 相关
- `FIXLOG-2026-09-12-selfkill-cleanup-bug.md`（SIGKILL 自杀）
- `FIXLOG-2026-09-10-launchd-zombie.md`（僵死阻塞调度）

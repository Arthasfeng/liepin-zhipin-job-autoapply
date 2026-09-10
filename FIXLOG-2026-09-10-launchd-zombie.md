# 2026-09-10 数据断流事故 — launchd 僵尸进程阻塞调度

## 现象
- 服务端 data.organicomm.com 数据自 **9/9 18:29 中断**，9/10 上午 0 条（中断约 17 小时）
- Mac Mini 上 `run.log` 停在 9/9 14:00（"全部完成 / 60秒后自动关闭 Chrome..."）
- 锁文件 `/tmp/auto-apply-locks/*.lock` 全部残留（PID 26604，写于 9/9 17:00，该进程已死）

## 根因（关键）
`index.js` 的 `main()` **结尾没有 `process.exit(0)`**（第 689 行自然结束）。

链条：
1. 9/9 14:00 launchd 触发的实例检测到"已有运行实例"（上午实例仍持锁）→ 全部账号跳过 → 打印"全部完成"
2. 但进程**未退出**：残留句柄（Chrome CDP 连接 / 定时器）让 Node 事件循环不空 → **僵死**
3. launchd 认为 job 仍在运行（`state=running, pid=13913`）→ 9/9 20:00、9/10 9:00 的调度**在系统层面被跳过**
4. 数据彻底断流（进程僵死 = 不采集、不上报）

佐证：
- PID 13913/13914 从 9/9 14:00 存活至 9/10 11:40，累计 CPU 仅 **0.11 秒**（僵死典型特征）
- `launchctl print` → `state = running, pid = 13913`（阻塞源）
- `launchd-stderr.log` 大量 `Killed: 9`（历史进程管理问题）

## 修复（3 处加固 + 现场清理）

### A. 现场恢复
```bash
kill -9 13913 13914                      # 杀僵死进程，解除 launchd running 状态
rm -f /tmp/auto-apply-locks/*.lock       # 清残留锁
pkill -9 -f "user-data-dir=/tmp/auto-apply"  # 清残余 Chrome
launchctl kickstart -k gui/$(id -u)/com.autoapply.daily  # 触发新运行
```

### B. 代码加固（index.js，已部署 Mac Mini，MD5 9f86614b97eefcd80b9afc5f8099a907）
| # | 位置 | 改动 |
|---|------|------|
| 1 | `main()` 开头 | 加 8 小时 watchdog 硬超时（`setTimeout(...).unref()`），任何卡死自动退出 |
| 2 | `await Promise.all(runners)` 后 | `_allEngines.length === 0`（全部账号被锁跳过）时**立即 `process.exit(0)`** |
| 3 | `main()` 结尾 | 显式 `process.exit(0)` —— **事故根因修复** |

### C. 验证
- 新进程 11:43 启动，run.log 正常输出投递 ✅
- buffer 正常积累（351 条）→ 11:54 自动 flush 成功 `received: 470`
- 服务端 events.json 更新到 11:53，9/10 共 444 条（scanned 368 / applied 76）

## 教训
1. **`main()` 必须有显式 `process.exit(0)`** —— Node 进程只要有一个未关闭的句柄（CDP/定时器/socket）就不会退出；配合 launchd 的 `state=running` 会**永久阻塞后续所有调度**
2. **定时任务要加硬超时兜底**（watchdog），不要假设程序会正常结束
3. launchd job 排查要看 `launchctl print ... state/pid`，不能只看日志文件
4. 日志文件时间戳（run.log 停在 14:00）≠ 进程已退出；必须查进程表

## 相关
- 上一事故：`FIXLOG-2026-09-08-cardinfo-bug.md`（cardInfo 未声明致投递失败）
- 采集上报：每 10 分钟 flush 一次（`jobboard-collector.js: FLUSH_INTERVAL_MS`）

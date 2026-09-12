# 2026-09-12 自杀式清理 Bug — 每轮结束进程被 SIGKILL、上报数据丢失

## 现象
- 服务端数据 9/12 只到 **09:30**（09:00 轮结束后），14:00 轮跑完（14:18）但数据未上报
- Mac Mini buffer 文件残留 **269 条**待上报数据
- `launchd-stderr.log` 反复出现 `Killed: 9`；`launchctl print` → `last exit code = 137`（128+9 = SIGKILL）

## 根因（自杀式清理）
`index.js` 结尾的 Chrome 清理逻辑：
```js
var pids = execSync('lsof -ti :' + port);          // port = 9222~9225
if (pids) pids.split('\n').forEach(pid => process.kill(pid, 'SIGKILL'));
```
问题：**node 通过 CDP WebSocket 连着 Chrome 的 9222 端口**，`lsof -ti :9222` 会**同时返回 node 自己的 PID** → 清理时把自己也 SIGKILL 了。

后果链：
1. node 被 SIGKILL → `process.on('exit', flushSync)` **不会执行**
2. 该轮采集的全部数据（269 条）卡在 buffer 里，**永远不上报**
3. launchd 看到 exit 137
4. 同样逻辑在"启动前清理旧 Chrome"（655 行）也有 → 双重点火

## 修复
kill 前**排除自己与父进程**（两处：655 行启动前清理、692 行结尾清理）：
```js
oldPid.split('\n').forEach(function(pid) {
  var p = parseInt(pid, 10);
  if (p && p !== process.pid && p !== process.ppid) {
    try { process.kill(p, 'SIGKILL'); } catch(e) {}
  }
});
```

## 数据补救
- buffer 中 269 条已手动 POST 到 `/api/upload`（HTTP 200 received:269），buffer 已清空
- 服务端 9/12 数据补齐

## 教训
1. **`lsof -ti :port` 会返回"连接者"和"监听者"两类进程** —— 清理端口前必须先过滤掉自身 PID
2. `process.on('exit')` 兜底在 **SIGKILL 下完全失效**（SIGKILL 不可捕获）—— 关键数据不能在"退出时才上报"，要有周期性 flush（本项目 10 分钟一次的 setInterval 是正确设计，只是被 SIGKILL 打断）
3. 排查"进程被杀"必须看 `launchd-stderr.log` 的 `Killed: 9` 与退出码 137，而不是只看业务日志

## 相关
- `FIXLOG-2026-09-10-launchd-zombie.md`（僵死阻塞调度）
- `FIXLOG-2026-09-08-cardinfo-bug.md`（投递失败）

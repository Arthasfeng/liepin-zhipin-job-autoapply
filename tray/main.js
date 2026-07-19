/**
 * 自动投递平台 — 系统托盘控制程序 v2.0
 * 应用窗口交互（非文本编辑器）
 */
const { app, Menu, Tray, nativeImage, Notification, dialog, BrowserWindow, ipcMain, powerMonitor } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { loadAccounts, saveAccounts, ACCOUNT_FILE, SCHEDULE } = require('../config/accounts');

const STATUS_FILE = '/tmp/auto-apply-status.json';
let tray = null;
let childProcess = null;
let isRunning = false;
let scheduleTimers = [];
let statusInterval = null;

/* ====== IPC handlers ====== */
ipcMain.on('keywords-saved', function(ev, data) {
  var all = loadAccounts();
  var acct = all.find(function(a) { return a.id === data.id; });
  if (acct) {
    acct.keywords = {
      search: data.search || [],
      jobTitle: data.jobTitle || [],
    };
    saveAccounts(all);
    new Notification({ title: '关键词已更新', body: acct.name }).show();
    updateTrayMenu();
  }
});

/* ====== 状态 ====== */
function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch(e) { return {}; }
}

function getStatusText(acctId) {
  var s = readStatus()[acctId];
  if (!s) return '⏹ 未启动';
  if (s.frozen) return '❄️ 已冻结';
  if (s.status === 'running') return '▶ ' + (s.kw || '') + ' ✅' + ((s.stats && s.stats.success) || 0);
  if (s.status === 'switching') return '🔄 ' + (s.kw || '');
  return '⏹ ' + (s.status || '');
}

/* ====== 定时调度（setTimeout 计算下次 + 唤醒补检）====== */
var scheduleTimer = null;

function loadSchedule() {
  try {
    var saved = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'schedule-data.json'), 'utf8'));
    return saved;
  } catch(e) {
    return { days: [0,1,2,3,4,5,6], ranges: [{start:'09:00',end:'12:00'},{start:'14:00',end:'18:00'}] };
  }
}

function isInSchedule() {
  var sched = loadSchedule();
  if (!sched.days || !sched.ranges) return false;
  var now = new Date();
  var dayMap = [6,0,1,2,3,4,5];
  var today = dayMap[now.getDay()];
  if (sched.days.indexOf(today) < 0) return false;
  var curMin = now.getHours() * 60 + now.getMinutes();
  for (var i = 0; i < sched.ranges.length; i++) {
    var sp = sched.ranges[i].start.split(':');
    var ep = sched.ranges[i].end.split(':');
    var startMin = parseInt(sp[0]) * 60 + parseInt(sp[1]);
    var endMin = parseInt(ep[0]) * 60 + parseInt(ep[1]);
    if (curMin >= startMin && curMin < endMin) return true;
  }
  return false;
}

function tryStartSchedule() {
  if (!isRunning && isInSchedule()) {
    console.log('[Tray] 定时触发');
    startAll(true);
  }
}

function scheduleNextRun() {
  clearSchedule();
  var sched = loadSchedule();
  if (!sched.days || !sched.ranges || sched.days.length === 0 || sched.ranges.length === 0) return;
  var now = new Date();
  var dayMap = [6,0,1,2,3,4,5];
  var curDay = dayMap[now.getDay()];
  var curMin = now.getHours() * 60 + now.getMinutes();
  for (var d = 0; d < 7; d++) {
    var checkDay = (curDay + d) % 7;
    if (sched.days.indexOf(checkDay) < 0) continue;
    for (var i = 0; i < sched.ranges.length; i++) {
      var sp = sched.ranges[i].start.split(':');
      var startMin = parseInt(sp[0]) * 60 + parseInt(sp[1]);
      if (d === 0 && startMin <= curMin) continue;
      var target = new Date(now);
      target.setDate(target.getDate() + d);
      target.setHours(parseInt(sp[0]), parseInt(sp[1]), 0, 0);
      var delay = target.getTime() - now.getTime();
      if (delay > 0) {
        scheduleTimer = setTimeout(function() {
          console.log('[Tray] 定时触发');
          if (!isRunning) startAll(true);
          scheduleNextRun();
        }, delay);
        console.log('[Tray] 下次定时: ' + target.toLocaleString());
        return;
      }
    }
  }
}

function clearSchedule() {
  if (scheduleTimer) { clearTimeout(scheduleTimer); scheduleTimer = null; }
}

/* ====== 窗口 ====== */
function openKeywordsWindow(accountId) {
  var all = loadAccounts();
  var acct = all.find(function(a) { return a.id === accountId; });
  if (!acct) return;

  var data = encodeURIComponent(JSON.stringify({
    id: acct.id, name: acct.name, platform: acct.platform,
    search: acct.keywords.search || [],
    jobTitle: acct.keywords.jobTitle || [],
  }));

  var win = new BrowserWindow({
    width: 480, height: 420, resizable: false,
    title: '编辑关键词 - ' + acct.name,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile(path.join(__dirname, 'dialogs', 'keywords.html'), { search: '?' + data });
  win.setMenuBarVisibility(false);
}

/* ====== Tray ====== */
function createTrayIcon() {
  // 使用生成的太阳图标
  var icon;
  try {
    icon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));
    if (icon.isEmpty()) throw new Error('empty');
    icon = icon.resize({ width: 18, height: 18 });
  } catch(e) {
    icon = nativeImage.createEmpty();
  }
  return icon;
}

function updateTrayMenu() {
  var accounts = loadAccounts().filter(function(a) { return a.enabled; });
  var status = readStatus();
  var runningCount = Object.keys(status).filter(function(id) { return status[id].status === 'running'; }).length;
  var statusLabel = isRunning ? '▶ 运行中 (' + runningCount + '个)' : '⏹ 已停止';

  var template = [
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    {
      label: isRunning ? '⏹ 停止所有' : '▶ 立即运行',
      click: isRunning ? stopAll : function() { startAll(false); },
    },
    {
      label: '☐ 定时模式',
      type: 'checkbox',
      checked: false,
      click: function(item) {
        if (item.checked) { }
        else { if (isRunning) stopAll(); }
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    { label: '📊 账号状态', enabled: false },
  ];

  // 每个账号状态行
  for (var i = 0; i < accounts.length; i++) {
    var a = accounts[i];
    template.push({ label: '  ' + a.name + ' [' + a.platform + '] ' + getStatusText(a.id), enabled: false });
  }

  template.push({ type: 'separator' });
  template.push({
    label: '账号管理 (' + accounts.length + '个)',
    submenu: buildAccountMenu(accounts),
  });
  template.push({ type: 'separator' });
  template.push({
    label: '编辑定时设置',
    click: openScheduleWindow,
  });
  template.push({
    label: '查看统计',
    click: showStats,
  });
  template.push({ type: 'separator' });
  template.push({ label: '退出', click: function() { stopAll(); clearSchedule(); app.quit(); } });

  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip('自动投递 ' + statusLabel);
}

function buildAccountMenu(accounts) {
  var items = [];
  for (var i = 0; i < accounts.length; i++) {
    var acct = accounts[i];
    items.push({
      label: acct.name + ' [' + acct.platform + ']',
      submenu: [
        { label: '编辑关键词', click: function(id) { return function() { openKeywordsWindow(id); }; }(acct.id) },
        {
          label: function() { return '启用: ' + (acct.enabled ? '✅' : '❌'); }(),
          click: function(id) { return function() {
            var all = loadAccounts();
            var a = all.find(function(x) { return x.id === id; });
            if (a) { a.enabled = !a.enabled; saveAccounts(all); }
            updateTrayMenu();
          }; }(acct.id),
        },
        { type: 'separator' },
        { label: '单独运行', click: function(id) { return function() { runSingle(id); }; }(acct.id) },
        { type: 'separator' },
        { label: '🗑 删除账号', click: function(id) { return function() { deleteAccount(id); }; }(acct.id) },
      ],
    });
  }
  items.push({ type: 'separator' });
  items.push({ label: '➕ 添加新账号', click: addAccount });
  return items;
}

/* ====== 账号管理 ====== */
function addAccount() {
  var win = new BrowserWindow({
    width: 360, height: 280, resizable: false,
    title: '添加新账号',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.setMenuBarVisibility(false);

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>';
  html += 'body{font-family:-apple-system,sans-serif;padding:24px;background:#f5f5f7}';
  html += 'h2{margin:0 0 20px 0;font-size:18px;color:#1d1d1f}';
  html += 'label{display:block;font-size:13px;color:#6e6e73;margin-bottom:4px}';
  html += 'select,input{width:100%;padding:8px;border:1px solid #d2d2d7;border-radius:8px;font-size:14px;margin-bottom:16px;box-sizing:border-box}';
  html += '.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}';
  html += 'button{padding:8px 20px;border-radius:8px;border:none;font-size:14px;cursor:pointer}';
  html += '.primary{background:#0071e3;color:white}.primary:hover{background:#0060c0}';
  html += '.cancel{background:#e8e8ed;color:#1d1d1f}.cancel:hover{background:#d2d2d7}';
  html += '</style></head><body>';
  html += '<h2>添加新账号</h2>';
  html += '<label>平台</label><select id="platform"><option value="liepin">猎聘</option><option value="boss">Boss直聘</option></select>';
  html += '<label>备注名称</label><input id="name" placeholder="猎聘B账号">';
  html += '<div class="actions">';
  html += '<button class="cancel" onclick="window.close()">取消</button>';
  html += '<button class="primary" onclick="add()">添加</button>';
  html += '</div>';
  html += '<script>function add(){';
  html += 'var p=document.getElementById("platform").value;';
  html += 'var n=document.getElementById("name").value;';
  html += 'require("electron").ipcRenderer.send("add-account",{platform:p,name:n});';
  html += 'window.close();}';
  html += '<' + '/script></body></html>';

  win.loadURL('data:text/html,' + encodeURIComponent(html));
}

ipcMain.on('add-account', function(ev, data) {
  var all = loadAccounts();
  var count = all.filter(function(a) { return a.platform === data.platform; }).length + 1;
  var id = data.platform + '-' + String.fromCharCode(96 + count);
  var name = data.name || (data.platform === 'liepin' ? '猎聘' : 'Boss直聘') + String.fromCharCode(64 + count) + '账号';
  all.push({
    id: id, name: name, platform: data.platform,
    profileDir: '/tmp/auto-apply/' + id,
    keywords: { search: [], jobTitle: [] },
    greeting: '您好，看到贵公司在招聘相关岗位，我有相关经验，方便沟通下吗？',
    enabled: true,
  });
  saveAccounts(all);
  updateTrayMenu();
  new Notification({ title: '账号已添加', body: name }).show();
  openKeywordsWindow(id);
});

function deleteAccount(accountId) {
  var all = loadAccounts();
  var acct = all.find(function(a) { return a.id === accountId; });
  if (!acct) return;
  var result = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['取消', '确认删除'],
    defaultId: 0,
    title: '删除账号',
    message: '确认删除 ' + acct.name + ' 吗？',
  });
  if (result === 1) {
    var filtered = all.filter(function(a) { return a.id !== accountId; });
    saveAccounts(filtered);
    updateTrayMenu();
  }
}

/* ====== 运行控制 ====== */
function startAll(scheduleMode) {
  var stack = new Error().stack.split('\n').slice(2,5).join(' → ');
  console.log('[Tray] >>> startAll from:', stack);
  // 写入文件供排查
  try { fs.appendFileSync('/tmp/auto-apply-start.log', new Date().toISOString() + ' startAll scheduleMode=' + scheduleMode + ' stack=' + stack + '\n'); } catch(e) {}
  if (isRunning) { console.log('[Tray] isRunning=true, ignored'); return; }
  childProcess = spawn('node', ['index.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  childProcess.stdout.on('data', function(d) { try { console.log(d.toString()); } catch(e) {} });
  childProcess.stderr.on('data', function(d) { try { console.error(d.toString()); } catch(e) {} });
  childProcess.on('exit', function(code) {
    isRunning = false;
    updateTrayMenu();
    if (code !== 0) new Notification({ title: '自动投递', body: '异常退出 (代码: ' + code + ')' }).show();
  });
  isRunning = true;
  if (statusInterval) clearInterval(statusInterval);
  statusInterval = setInterval(updateTrayMenu, 3000);
  updateTrayMenu();
  new Notification({ title: '自动投递', body: scheduleMode ? '定时模式已启动' : '已开始运行' }).show();
}

function runSingle(accountId) {
  if (isRunning) return;
  childProcess = spawn('node', ['index.js', '--account', accountId], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  childProcess.stdout.on('data', function(d) { console.log(d.toString()); });
  childProcess.stderr.on('data', function(d) { console.error(d.toString()); });
  childProcess.on('exit', function() { isRunning = false; updateTrayMenu(); });
  isRunning = true;
  if (statusInterval) clearInterval(statusInterval);
  statusInterval = setInterval(updateTrayMenu, 3000);
  updateTrayMenu();
}

function stopAll() {
  if (childProcess) { 
    childProcess.kill('SIGTERM'); 
    setTimeout(function() { 
      if (childProcess) childProcess.kill('SIGKILL'); 
      // 兜底：确保 Chrome 窗口关闭
      try { require('child_process').execSync('pkill -f "Google Chrome.*remote-debugging" 2>/dev/null || true'); } catch(e) {}
    }, 5000); 
  }
  isRunning = false;
  if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
  updateTrayMenu();
}

/* ====== 定时设置窗口 ====== */
function hrsOpts(sel) { var r=''; for(var i=0;i<24;i++){var s=i<10?'0'+i:''+i;r+='<option value="'+s+'"'+(s===sel?' selected':'')+'>'+s+'</option>';} return r; }
function minOpts(sel) { var r=''; for(var i=0;i<60;i+=5){var s=i<10?'0'+i:''+i;r+='<option value="'+s+'"'+(s===sel?' selected':'')+'>'+s+'</option>';} return r; }

function openScheduleWindow() {
  var win = new BrowserWindow({
    width: 480, height: 380, resizable: false,
    title: '定时设置', webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.setMenuBarVisibility(false);

  var days = ['周一','周二','周三','周四','周五','周六','周日'];
  var sched = loadSchedule();
  var ranges = sched.ranges || [{start:'09:00',end:'12:00'},{start:'14:00',end:'18:00'}];
  var savedDays = sched.days || [0,1,2,3,4,5,6];

  var h = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>';
  h += '*{box-sizing:border-box;margin:0;padding:0}';
  h += 'body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:16px;background:#f5f5f7;color:#1d1d1f;font-size:13px}';
  h += 'h2{font-size:16px;font-weight:600;margin-bottom:12px}';
  h += '.section{margin-bottom:12px}';
  h += '.label{color:#6e6e73;font-size:12px;margin-bottom:4px}';
  h += '.days{display:flex;gap:4px;flex-wrap:wrap}';
  h += '.day{padding:4px 10px;border-radius:12px;border:1px solid #d2d2d7;background:white;cursor:pointer;font-size:12px;user-select:none}';
  h += '.day.on{background:#0071e3;color:white;border-color:#0071e3}';
  h += '.range{display:flex;align-items:center;gap:4px;margin-bottom:4px;background:white;padding:4px 8px;border-radius:6px;border:1px solid #e8e8ed}';
  h += '.range select{padding:2px 4px;border:1px solid #d2d2d7;border-radius:4px;font-size:12px;background:white;min-width:40px}';
  h += '.range .sep{color:#6e6e73;font-size:12px}';
  h += '.range .del{color:#ff3b30;cursor:pointer;font-size:14px;margin-left:auto;padding:0 4px}';
  h += '.add{color:#0071e3;cursor:pointer;font-size:12px;margin-top:2px;display:inline-block}';
  h += '.add:hover{text-decoration:underline}';
  h += '.btns{display:flex;gap:6px;justify-content:flex-end;margin-top:12px;padding-top:10px;border-top:1px solid #d2d2d7}';
  h += 'button{padding:6px 16px;border-radius:6px;border:none;font-size:12px;cursor:pointer}';
  h += '.ok{background:#0071e3;color:white}.cancel{background:#e8e8ed;color:#1d1d1f}';
  h += '</style></head><body>';
  h += '<h2>⏰ 定时设置</h2>';

  h += '<div class="section"><div class="label">运行日期</div><div class="days" id="days">';
  for (var i = 0; i < days.length; i++) {
    var active = savedDays.indexOf(i) >= 0 ? ' on' : '';
    h += '<span class="day' + active + '">' + days[i] + '</span>';
  }
  h += '</div></div>';

  h += '<div class="section"><div class="label">运行时间区间</div><div id="ranges">';
  for (var i = 0; i < ranges.length; i++) {
    h += '<div class="range">';
    h += '<span>从</span><select class="sh">'+hrsOpts(ranges[i].start.split(':')[0])+'</select><span class="sep">:</span><select class="sm">'+minOpts(ranges[i].start.split(':')[1])+'</select>';
    h += '<span>至</span><select class="eh">'+hrsOpts(ranges[i].end.split(':')[0])+'</select><span class="sep">:</span><select class="em">'+minOpts(ranges[i].end.split(':')[1])+'</select>';
    h += '<span class="del" onclick="this.parentElement.remove()">✕</span></div>';
  }
  h += '</div><span class="add" onclick="addRange()">+ 添加</span></div>';

  h += '<div class="btns"><button class="cancel" onclick="window.close()">取消</button><button class="ok" onclick="save()">保存</button></div>';
  var hrs09 = hrsOpts('09'), hrs18 = hrsOpts('18'), min00 = minOpts('00');
  h += '<script>document.getElementById("days").onclick=function(e){if(e.target.classList.contains("day"))e.target.classList.toggle("on")};';
  h += 'var h09='+JSON.stringify(hrs09)+',h18='+JSON.stringify(hrs18)+',m00='+JSON.stringify(min00)+';';
  h += 'function addRange(){var d=document.getElementById("ranges");var r=document.createElement("div");r.className="range";';
  h += 'r.innerHTML="<span>从</span><select class=sh>"+h09+"</select><span class=sep>:</span><select class=sm>"+m00+"</select>';
  h += '<span>至</span><select class=eh>"+h18+"</select><span class=sep>:</span><select class=em>"+m00+"</select>';
  h += '<span class=del onclick=this.parentElement.remove()>✕</span>";d.appendChild(r);}';
  h += 'function save(){';
  h += 'var ds=[];document.querySelectorAll(".day.on").forEach(function(e){ds.push([].indexOf.call(e.parentElement.children,e));});';
  h += 'var rs=[];document.querySelectorAll(".range").forEach(function(r){rs.push({start:r.querySelector(".sh").value+":"+r.querySelector(".sm").value,end:r.querySelector(".eh").value+":"+r.querySelector(".em").value});});';
  h += 'require("electron").ipcRenderer.send("schedule-saved",JSON.stringify({days:ds,ranges:rs}));window.close();}';
  h += '</script></body></html>';

  win.loadURL('data:text/html,' + encodeURIComponent(h));
}

ipcMain.on('schedule-saved', function(ev, dataStr) {
  try {
    var data = JSON.parse(dataStr);
    var dayNames = ['周一','周二','周三','周四','周五','周六','周日'];
    var dayStr = (data.days || []).map(function(d) { return dayNames[d]; }).join(' ');
    var rangeStr = (data.ranges || []).map(function(r) { return r.start + '~' + r.end; }).join(', ');
    // 保存到文件并重载定时
    var s = JSON.stringify({ days: data.days || [], ranges: data.ranges || [] });
    fs.writeFileSync(path.join(__dirname, '..', 'config', 'schedule-data.json'), s);
    clearSchedule();
    setupSchedule();
    new Notification({
      title: '定时设置已更新',
      body: (dayStr || '每天') + ' ' + (rangeStr || '无'),
    }).show();
  } catch(e) {}
});

function showStats() {
  var dailyFile = '/tmp/auto-apply-daily-stats.json';
  var daily = {};
  try { daily = JSON.parse(fs.readFileSync(dailyFile, 'utf8')); } catch(e) {}

  var dates = Object.keys(daily).sort().slice(-7);
  if (dates.length === 0) {
    dialog.showMessageBox({ type: 'info', title: '自动投递统计', message: '暂无数据，请先运行一次。', buttons: ['确定'] });
    return;
  }

  var totalScan = 0, totalOk = 0, totalFail = 0, totalSkip = 0;
  var text = '── 每日汇总 ──\n';
  
  for (var di = 0; di < dates.length; di++) {
    var date = dates[di];
    var dayData = daily[date];
    var ds = 0, dsu = 0, df = 0, dsk = 0;
    Object.keys(dayData).forEach(function(id) {
      ds += dayData[id].scanned || 0;
      dsu += dayData[id].success || 0;
      df += dayData[id].fail || 0;
      dsk += dayData[id].skip || 0;
    });
    var rate = ds > 0 ? (dsu / ds * 100).toFixed(1) + '%' : '-';
    var parts = date.split('-');
    var sd = parts[0].slice(2) + '/' + parseInt(parts[1]) + '/' + parseInt(parts[2]);
    text += '\n' + sd + '\n  ' + String(ds).padStart(4) + '扫  ' + String(dsu).padStart(3) + '成  ' + String(df).padStart(3) + '失  ' + String(dsk).padStart(4) + '跳  ' + rate + '\n';
    totalScan += ds; totalOk += dsu; totalFail += df; totalSkip += dsk;
  }
  
  var totalRate = totalScan > 0 ? (totalOk / totalScan * 100).toFixed(1) + '%' : '-';
  text += ' 合计\n  ' + String(totalScan).padStart(4) + '扫  ' + String(totalOk).padStart(3) + '成  ' + String(totalFail).padStart(3) + '失  ' + String(totalSkip).padStart(4) + '跳  ' + totalRate;

  // 用 BrowserWindow 替代 dialog，支持左对齐
  var win = new BrowserWindow({
    width: 420, height: 320, resizable: false,
    title: '自动投递统计', webPreferences: { nodeIntegration: true, contextIsolation: false },
    autoHideMenuBar: true,
  });
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>';
  html += 'body{font-family:"SF Mono",Menlo,Consolas,monospace;font-size:13px;padding:16px;background:#f5f5f7;white-space:pre;margin:0}';
  html += '</style></head><body>' + text.replace(/</g,'&lt;').replace(/\n/g,'<br>') + '</body></html>';
  win.loadURL('data:text/html,' + encodeURIComponent(html));
}

/* ====== 启动 ====== */
app.whenReady().then(function() {
  // 杀死其他托盘进程（确保本实例是唯一的）
  try {
    var myPid = process.pid;
    require('child_process').execSync(
      "ps aux | grep 'Electron.*tray/main.js' | grep -v grep | awk '{print $2}' | grep -v " + myPid + " | xargs kill 2>/dev/null || true"
    );
  } catch(e) {}

  // 清理残留的子进程
  try { process.kill(childProcess && childProcess.pid); } catch(e) {}
  try { require('child_process').execSync('pkill -f "node index.js" 2>/dev/null || true'); } catch(e) {}
  // 关闭之前遗留的 Chrome 窗口
  try { require('child_process').execSync('pkill -f "Google Chrome.*remote-debugging" 2>/dev/null || true'); } catch(e) {}

  // 隐藏程序坞图标（仅托盘）
  if (app.dock) app.dock.hide();

  var icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setPressedImage(icon);
  updateTrayMenu();
  // 启动时检查是否需要运行
  tryStartSchedule();
  // 排好下次定时
  scheduleNextRun();
  // 系统唤醒时重新检查
  powerMonitor.on('resume', function() {
    console.log('[Tray] 系统唤醒，检查定时');
    tryStartSchedule();
  });
  updateTrayMenu(); // 同步定时模式 checkbox 状态
  });
  app.on('window-all-closed', function() {});

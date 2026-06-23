/**
 * 自动投递 — 终端控制台
 * 零依赖，替代 Electron 托盘程序
 * 
 * 使用: node menu.js
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { loadAccounts, saveAccounts, ACCOUNT_FILE, SCHEDULE } = require('./config/accounts');
const STATUS_FILE = '/tmp/auto-apply-status.json';

let childProcess = null;
let isRunning = false;
let statusInterval = null;

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch(e) { return {}; }
}

function clearScreen() {
  process.stdout.write('\x1Bc');
}

function showMenu() {
  clearScreen();
  var status = readStatus();
  var accounts = loadAccounts().filter(function(a) { return a.enabled; });
  
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║        自动投递控制台 v2.0                    ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║ 状态: ' + (isRunning ? '▶ 运行中' : '⏹ 已停止').padEnd(35) + '║');
  
  // 每个账号状态
  for (var i = 0; i < accounts.length; i++) {
    var a = accounts[i];
    var s = status[a.id] || {};
    var st = s.frozen ? '❄️冻结' : (s.status === 'running' ? '▶运行' : '⏹停止');
    var stats = s.stats || {};
    var line = '  ' + a.name + ' [' + a.platform + '] ' + st +
      ' ✅' + (stats.success || 0) + ' ❌' + (stats.fail_chat || 0);
    console.log('║ ' + line.padEnd(39) + '║');
  }
  
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║ 操作:                                        ║');
  console.log('║  [1] ▶ 立即运行                               ║');
  console.log('║  [2] ⏹ 停止                                  ║');
  console.log('║  [3] 📊 查看统计                              ║');
  console.log('║  [4] ✏ 编辑关键词                             ║');
  console.log('║  [5] ⏰ 编辑定时设置                           ║');
  console.log('║  [q] 退出                                     ║');
  console.log('╚══════════════════════════════════════════════╝');
  process.stdout.write('选择: ');
}

function startAll() {
  if (isRunning) return;
  childProcess = spawn('node', ['index.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  childProcess.stdout.on('data', function(d) { console.log(d.toString()); });
  childProcess.stderr.on('data', function(d) { console.error(d.toString()); });
  childProcess.on('exit', function(code) {
    isRunning = false;
    console.log('\n进程已退出 (代码: ' + code + ')。按 Enter 返回菜单...');
  });
  isRunning = true;
  console.log('\n已启动！最小化此窗口即可后台运行。');
}

function stopAll() {
  if (childProcess) {
    childProcess.kill('SIGINT');
    setTimeout(function() { if (childProcess) childProcess.kill('SIGKILL'); }, 5000);
    isRunning = false;
  }
}

function showStats() {
  clearScreen();
  var status = readStatus();
  console.log('═══════════════════════════════');
  console.log('        自动投递统计');
  console.log('═══════════════════════════════');
  for (var id in status) {
    var s = status[id];
    var st = s.stats || {};
    console.log(' ' + s.name + ' [' + (s.platform || '') + ']');
    console.log('   ✅ 成功: ' + (st.success || 0));
    console.log('   ❌ 失败: ' + ((st.fail_chat || 0) + (st.fail_dialog || 0)));
    console.log('   ⏭ 跳过: ' + ((st.skip_chatted || 0) + (st.skip_processed || 0)));
    if (s.kw) console.log('   当前: ' + s.kw);
    if (s.frozen) console.log('   ❄️ 已冻结');
    console.log('');
  }
  if (Object.keys(status).length === 0) {
    console.log(' 暂无数据，请先运行一次。\n');
  }
  console.log('按 Enter 返回菜单...');
}

function editKeywords() {
  var accounts = loadAccounts().filter(function(a) { return a.enabled; });
  if (accounts.length === 0) { console.log('无可用账号'); return; }
  
  console.log('\n选择要编辑的账号:');
  for (var i = 0; i < accounts.length; i++) {
    console.log('  [' + (i+1) + '] ' + accounts[i].name);
  }
  process.stdout.write('选择 (1-' + accounts.length + '): ');
}

function doEditKeywords(idx) {
  var accounts = loadAccounts().filter(function(a) { return a.enabled; });
  var acct = accounts[idx];
  if (!acct) return;

  var tmpFile = '/tmp/auto-apply-keywords-' + acct.id + '.json';
  var data = {
    search: acct.keywords.search || [],
    jobTitle: acct.keywords.jobTitle || [],
  };
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  
  console.log('\n已打开 ' + acct.name + ' 的关键词文件。');
  console.log('格式: { "search": ["关键词1","关键词2"], "jobTitle": ["岗位1","岗位2"] }');
  console.log('保存文件后，30秒内自动加载。\n');
  
  execSync('open -t ' + tmpFile);
  
  // 监控文件变化
  var lastContent = fs.readFileSync(tmpFile, 'utf8');
  function checkFile() {
    try {
      var content = fs.readFileSync(tmpFile, 'utf8');
      if (content !== lastContent) {
        var newData = JSON.parse(content);
        acct.keywords = { search: newData.search || [], jobTitle: newData.jobTitle || [] };
        saveAccounts(loadAccounts().map(function(a) {
          if (a.id === acct.id) return acct;
          return a;
        }));
        console.log('✅ 关键词已更新: search=' + JSON.stringify(acct.keywords.search) + 
          ', jobTitle=' + JSON.stringify(acct.keywords.jobTitle));
      }
    } catch(e) {}
  }
  var watcher = fs.watch(tmpFile, function() { checkFile(); lastContent = fs.readFileSync(tmpFile, 'utf8'); });
  setTimeout(function() { watcher.close(); }, 30000);
}

function editSchedule() {
  var tmpFile = '/tmp/auto-apply-schedule.json';
  fs.writeFileSync(tmpFile, JSON.stringify(SCHEDULE, null, 2));
  console.log('\n已打开定时设置文件。');
  console.log('格式: { "runTimes": ["09:00","14:00","20:00"], "maxDuration": 120 }');
  execSync('open -t ' + tmpFile);
}

// ====== 主循环 ======
var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
showMenu();

rl.on('line', function(line) {
  var c = line.trim();
  if (c === '1') { startAll(); setTimeout(showMenu, 1500); }
  else if (c === '2') { stopAll(); showMenu(); }
  else if (c === '3') { showStats(); }
  else if (c === '4') { editKeywords(); }
  else if (c === '5') { editSchedule(); showMenu(); }
  else if (c === 'q' || c === 'Q') { stopAll(); rl.close(); process.exit(0); }
  else if (c.match(/^\d+$/)) {
    var n = parseInt(c);
    var accounts = loadAccounts().filter(function(a) { return a.enabled; });
    if (n >= 1 && n <= accounts.length) {
      doEditKeywords(n - 1);
      setTimeout(showMenu, 1000);
    } else {
      showMenu();
    }
  } else {
    showMenu();
  }
});

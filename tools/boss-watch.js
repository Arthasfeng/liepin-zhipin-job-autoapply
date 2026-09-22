/**
 * Boss 后台观察器: 持续监控页面状态变化 (用于观察用户手动点击"立即沟通"的真实流程)
 * 用法: node tools/boss-watch.js [port] [seconds]
 * 输出: 每次检测到变化输出一行; 无变化每 10 次输出心跳
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);
const SECONDS = parseInt(process.argv[3] || '180', 10);

// 抓取完整状态快照 (用于 diff)
const STATE = `(function(){
  var out = {};
  // ① 右侧面板主按钮
  var chatBtn = document.querySelector('a.op-btn-chat, .op-btn-chat');
  out.chatBtnText = chatBtn ? (chatBtn.innerText||'').trim() : null;
  out.chatBtnCls = chatBtn ? (chatBtn.className||'').toString() : null;

  // ② 所有弹窗/对话框 (可见的)
  var dialogs = [];
  var dEls = document.querySelectorAll('[class*="dialog"], [class*="modal"], [class*="greet"], [class*="popup"], [class*="chat-dialog"]');
  for (var i = 0; i < dEls.length; i++) {
    var d = dEls[i];
    var r = d.getBoundingClientRect();
    if (r.width < 80 || r.height < 50) continue;
    dialogs.push({
      cls: (d.className||'').toString().slice(0,80),
      txt: (d.innerText||'').replace(/\\s+/g,' ').trim().slice(0,120),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)
    });
  }
  out.dialogs = dialogs.slice(0, 6);
  out.dialogCount = dialogs.length;

  // ③ 输入框 (打招呼消息框)
  var tas = document.querySelectorAll('textarea, input[type="text"]');
  var inputs = [];
  for (var j = 0; j < tas.length; j++) {
    var t = tas[j];
    var r2 = t.getBoundingClientRect();
    if (r2.width < 30) continue;
    inputs.push({ tag: t.tagName, cls: (t.className||'').toString().slice(0,50), ph: t.placeholder || '', x: Math.round(r2.x), y: Math.round(r2.y), w: Math.round(r2.width), h: Math.round(r2.height) });
  }
  out.inputs = inputs.slice(0, 6);

  // ④ 页面里所有按钮文本 (找"发送"/"确定")
  var btns = [];
  var bEls = document.querySelectorAll('button, a');
  for (var k = 0; k < bEls.length; k++) {
    var b = bEls[k];
    var bt = (b.innerText||'').replace(/\\s+/g,' ').trim();
    if (!bt || bt.length > 12) continue;
    if (!/(发送|确定|确认|取消|关闭|知道了|好|打招呼|立即)/.test(bt)) continue;
    var r3 = b.getBoundingClientRect();
    if (r3.width < 10) continue;
    btns.push({ t: bt, cls: (b.className||'').toString().slice(0,55), x: Math.round(r3.x), y: Math.round(r3.y) });
  }
  out.actionBtns = btns.slice(0, 12);

  // ⑤ 当前详情面板的职位名
  var detail = document.querySelector('.job-detail-container, [class*="job-detail-box"]');
  var dn = document.querySelector('.job-detail-container .job-name, .job-detail-box .job-name, [class*="detail"] .job-name');
  out.detailJob = dn ? (dn.innerText||'').trim().slice(0,30) : null;

  // ⑥ URL + 滚动
  out.url = (location.href||'').slice(0,110);
  out.scrollY = Math.round(window.scrollY);
  out.cardCount = document.querySelectorAll('div.job-card-wrap').length;

  return out;
})()`;

function sig(o) {
  if (!o) return 'null';
  return [
    o.chatBtnText, o.dialogCount,
    (o.dialogs||[]).map(d => d.cls.slice(0,30)).join(','),
    (o.inputs||[]).length,
    (o.actionBtns||[]).map(b => b.t).join('|'),
    o.detailJob
  ].join(' || ');
}

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();
  console.log(`[观察器启动] 端口 ${port}, 持续 ${SECONDS} 秒, 每 800ms 采样`);
  console.log(`[时间] ${new Date().toLocaleTimeString('zh-CN')}`);

  const t0 = Date.now();
  let lastSig = null;
  let i = 0;
  let changes = 0;

  // 初始基线
  const init = await eng.evaluate(STATE).catch(() => null);
  if (init) {
    lastSig = sig(init);
    console.log('\n=== 基线状态 ===');
    console.log(`  聊天按钮: "${init.chatBtnText}"  cls=[${(init.chatBtnCls||'').slice(0,50)}]`);
    console.log(`  详情职位: ${init.detailJob}`);
    console.log(`  弹窗数: ${init.dialogCount} | 输入框数: ${(init.inputs||[]).length}`);
    console.log(`  动作按钮: ${JSON.stringify((init.actionBtns||[]).map(b=>b.t))}`);
    console.log(`  卡片数: ${init.cardCount} | URL: ${init.url}`);
  }
  console.log('\n=== 开始监控 (等你点击"立即沟通") ===');

  while ((Date.now() - t0) / 1000 < SECONDS) {
    i++;
    await sleep(800);
    const cur = await eng.evaluate(STATE).catch(() => null);
    if (!cur) continue;
    const s = sig(cur);
    if (s !== lastSig) {
      changes++;
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`\n[变化 #${changes}] +${dt}s`);
      console.log(`  聊天按钮: "${cur.chatBtnText}"`);
      console.log(`  详情职位: ${cur.detailJob}`);
      console.log(`  弹窗 (${cur.dialogCount}):`);
      (cur.dialogs||[]).forEach(d => console.log(`    [${d.cls}] "${d.txt.slice(0,80)}" @(${d.x},${d.y}) ${d.w}x${d.h}`));
      console.log(`  输入框 (${(cur.inputs||[]).length}):`);
      (cur.inputs||[]).forEach(x => console.log(`    <${x.tag}> cls=[${x.cls}] ph="${x.ph}" @(${x.x},${x.y}) ${x.w}x${x.h}`));
      console.log(`  动作按钮: ${JSON.stringify((cur.actionBtns||[]).map(b => b.t + '@' + b.x + ',' + b.y))}`);
      console.log(`  URL: ${cur.url}`);
      lastSig = s;
    } else if (i % 20 === 0) {
      process.stdout.write(`·(${((Date.now()-t0)/1000).toFixed(0)}s)`);
    }
  }

  console.log(`\n\n[观察结束] 共检测到 ${changes} 次变化`);
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

/**
 * A 验证: 自动投递一次 (CDP 真实鼠标点击), 边点边观察真实流程
 * 关键: 用 Input.dispatchMouseEvent (真实事件), 排除 JS el.click() 姿势问题
 * 用法: node tools/boss-auto-apply-test.js [port]
 * 注意: 会真实给当前详情职位的 HR 发打招呼消息
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);

const SNAP = `(function(){
  var out = {};
  var chat = document.querySelector('a.op-btn-chat, .op-btn-chat');
  out.chatBtn = chat ? { text:(chat.innerText||'').trim(), cls:(chat.className||'').toString(), visible: (function(){var r=chat.getBoundingClientRect();return r.width>0&&r.height>0;})() } : null;
  if (chat) { var r = chat.getBoundingClientRect(); out.chatBtn.x = Math.round(r.x+r.width/2); out.chatBtn.y = Math.round(r.y+r.height/2); }

  // 弹窗
  var dialogs = [];
  var dEls = document.querySelectorAll('[class*="dialog"], [class*="modal"], [class*="greet"], [class*="popup"], [class*="confirm"], [class*="chat-dialog"]');
  for (var i=0;i<dEls.length;i++){
    var d=dEls[i]; var r2=d.getBoundingClientRect();
    if (r2.width<80||r2.height<50) continue;
    dialogs.push({ cls:(d.className||'').toString().slice(0,90), txt:(d.innerText||'').replace(/\\s+/g,' ').trim().slice(0,160), x:Math.round(r2.x),y:Math.round(r2.y),w:Math.round(r2.width),h:Math.round(r2.height) });
  }
  out.dialogs = dialogs.slice(0,8);

  // 所有按钮 (找 "留在本页面/继续沟通/发送/确定")
  var btns = [];
  var bEls = document.querySelectorAll('button, a, span, div');
  for (var j=0;j<bEls.length;j++){
    var b=bEls[j]; var bt=(b.innerText||'').replace(/\\s+/g,' ').trim();
    if(!bt||bt.length>16) continue;
    if(b.children.length>1) continue;
    if(!/(留在本页|继续沟通|发送|确定|确认|取消|知道了|关闭|好的)/.test(bt)) continue;
    var r3=b.getBoundingClientRect();
    if(r3.width<8) continue;
    btns.push({ t:bt, tag:b.tagName, cls:(b.className||'').toString().slice(0,65), x:Math.round(r3.x+r3.width/2), y:Math.round(r3.y+r3.height/2) });
  }
  out.actionBtns = btns.slice(0,15);

  out.url = (location.href||'').slice(0,120);
  out.detailJob = (function(){ var d=document.querySelector('.job-detail-container .job-name, [class*="job-detail"] .job-name'); return d?(d.innerText||'').trim().slice(0,30):null; })();
  return out;
})()`;

async function realClick(eng, x, y) {
  await eng.cmd('Input.dispatchMouseEvent', { type:'mouseMoved', x:Math.round(x), y:Math.round(y), button:'none' });
  await sleep(100);
  await eng.cmd('Input.dispatchMouseEvent', { type:'mousePressed', x:Math.round(x), y:Math.round(y), button:'left', clickCount:1 });
  await sleep(60);
  await eng.cmd('Input.dispatchMouseEvent', { type:'mouseReleased', x:Math.round(x), y:Math.round(y), button:'left', clickCount:1 });
}

async function findBtn(eng, textRe) {
  return eng.evaluate(`(function(){
    var els = document.querySelectorAll('button, a, span, div');
    for (var i=0;i<els.length;i++){
      var b=els[i]; var t=(b.innerText||'').replace(/\\s+/g,' ').trim();
      if(!${JSON.stringify(textRe)}.test(t)) continue;
      var r=b.getBoundingClientRect();
      if(r.width<8) continue;
      return { x:r.x+r.width/2, y:r.y+r.height/2, text:t, cls:(b.className||'').toString().slice(0,60) };
    }
    return null;
  })()`);
}

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();
  const ev = async (js) => {
    try { return await Promise.race([eng.evaluate(js), new Promise((_, rj) => setTimeout(() => rj(new Error('timeout')), 20000))]); }
    catch (e) { return null; }
  };

  console.log('=== ① 基线 ===');
  let s = await ev(SNAP);
  if (!s) { console.log('快照失败'); process.exit(1); }
  console.log(`  聊天按钮: ${JSON.stringify(s.chatBtn)}`);
  console.log(`  详情职位: ${s.detailJob}`);
  console.log(`  弹窗数: ${(s.dialogs||[]).length} | URL: ${s.url}`);

  // ② CDP 真实点击"立即沟通"
  console.log('\n=== ② CDP 真实点击 "立即沟通" ===');
  if (!s.chatBtn || !s.chatBtn.visible) { console.log('  未找到可见的聊天按钮'); process.exit(1); }
  console.log(`  点击位置: (${s.chatBtn.x}, ${s.chatBtn.y}) 按钮文本="${s.chatBtn.text}"`);
  await realClick(eng, s.chatBtn.x, s.chatBtn.y);

  // ③ 连续采样 10 次 (500ms), 捕捉弹窗
  console.log('\n=== ③ 点击后连续采样 (500ms x 10) ===');
  for (let i = 1; i <= 10; i++) {
    await sleep(500);
    const c = await ev(SNAP);
    if (!c) continue;
    const newDialogs = (c.dialogs||[]).filter(d => !(s.dialogs||[]).some(o => o.cls === d.cls));
    const btnChanged = c.chatBtn && s.chatBtn && c.chatBtn.text !== s.chatBtn.text;
    const urlChanged = c.url !== s.url;
    const flag = (newDialogs.length ? `弹窗+${newDialogs.length}` : '') + (btnChanged ? '按钮变 ' : '') + (urlChanged ? 'URL变 ' : '');
    console.log(`  t=${(i*0.5).toFixed(1)}s 弹窗=${(c.dialogs||[]).length} 按钮="${c.chatBtn?c.chatBtn.text:null}" ${flag}${c.url !== s.url ? '→ '+c.url : ''}`);
    if (newDialogs.length) {
      newDialogs.forEach(d => {
        console.log(`    ⭐ 新弹窗 [${d.cls}]`);
        console.log(`       文本: "${d.txt.slice(0,140)}"`);
        console.log(`       位置 (${d.x},${d.y}) ${d.w}x${d.h}`);
      });
    }
    const newBtns = (c.actionBtns||[]).filter(b => /留在本页|继续沟通/.test(b.t));
    if (newBtns.length) console.log(`    动作按钮: ${JSON.stringify(newBtns)}`);
    // 如果出现"留在本页/继续沟通"按钮, 就找到了关键弹窗
    if ((c.dialogs||[]).length > 0) break;
  }

  // ④ 找"留在本页面"按钮并记录 (不自动点, 先报告给用户)
  console.log('\n=== ④ 当前弹窗与按钮 ===');
  const final = await ev(SNAP);
  if (final) {
    console.log(`  弹窗 (${(final.dialogs||[]).length}):`);
    (final.dialogs||[]).forEach(d => console.log(`    [${d.cls}] "${d.txt.slice(0,120)}"`));
    console.log(`  所有动作按钮:`);
    (final.actionBtns||[]).forEach(b => console.log(`    "${b.t}" <${b.tag}> [${b.cls}] @(${b.x},${b.y})`));
  }

  console.log('\n[脚本结束] 已观察完点击后的真实流程 (未自动点"留在本页面", 避免误发)');
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

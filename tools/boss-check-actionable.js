/**
 * 逐张点击卡片 → 读右侧详情面板 → 判断可投/已沟通
 * 依据: skill 记录 "Boss直聘卡片不点击直接找沟通按钮 → 必须先 clickCard() 触发详情面板"
 * 用法: node tools/boss-check-actionable.js [port] [maxCards]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);
const MAX = parseInt(process.argv[3] || '10', 10);

// 读右侧面板的按钮情况
const READ_PANEL = `(function(){
  var panel = document.querySelector('.job-detail-container, .job-detail-box, [class*="job-detail"]');
  if (!panel) return { found: false };
  var btns = [];
  var els = panel.querySelectorAll('a, button, span, div');
  for (var i = 0; i < els.length; i++) {
    var t = (els[i].innerText || '').replace(/\\s+/g, ' ').trim();
    if (!t || t.length > 14) continue;
    if (els[i].children.length > 1) continue;
    if (/(聊一聊|继续聊|立即沟通|投递|打招呼|已沟通|发送简历)/.test(t)) {
      btns.push({ t: t, cls: (els[i].className||'').toString().slice(0,70) });
    }
  }
  // 也直接找 a.op-btn-chat 这类已知选择器
  var known = panel.querySelectorAll('a.op-btn-chat, .op-btn-chat, [class*="op-btn"]');
  var knownList = [];
  for (var j = 0; j < known.length; j++) {
    knownList.push((known[j].className||'').toString().slice(0,60) + ' :: ' + (known[j].innerText||'').replace(/\\s+/g,' ').trim().slice(0,16));
  }
  return { found: true, btns: btns.slice(0,8), known: knownList.slice(0,6), panelCls: (panel.className||'').toString().slice(0,60) };
})()`;

const CARD_POS = (i) => `(function(){
  var cards = document.querySelectorAll('div.job-card-wrap');
  if (${i} >= cards.length) return null;
  var c = cards[${i}];
  c.scrollIntoView({block:'center'});
  var rc = c.getBoundingClientRect();
  var nm = c.querySelector('a.job-name, .job-name, .job-title');
  var co = c.querySelector('.boss-info, .company-name');
  return { x: rc.x + rc.width*0.4, y: rc.y + 30,
    job: nm ? (nm.innerText||'').replace(/\\s+/g,' ').trim().slice(0,28) : '?',
    company: co ? (co.innerText||'').replace(/\\s+/g,' ').trim().slice(0,18) : '?' };
})()`;

async function clickAt(eng, x, y) {
  await eng.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'none' });
  await sleep(100);
  await eng.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  await sleep(50);
  await eng.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
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

  const total = await ev('document.querySelectorAll("div.job-card-wrap").length');
  console.log(`当前页面卡片数: ${total}, 将检查前 ${Math.min(MAX, total)} 张\n`);

  const results = [];
  for (let i = 0; i < Math.min(MAX, total); i++) {
    const pos = await ev(CARD_POS(i));
    if (!pos) { console.log(`#${i} 取不到位置`); continue; }
    await sleep(500);
    await clickAt(eng, pos.x, pos.y);
    await sleep(2500);
    const panel = await ev(READ_PANEL);
    const allBtn = panel && panel.btns ? panel.btns.map(b => b.t) : [];
    const actionable = allBtn.some(t => /聊一聊|立即沟通|投递|打招呼|发送简历/.test(t));
    const chatted = allBtn.some(t => /继续聊|已沟通/.test(t));
    const verdict = actionable ? '可投' : (chatted ? '已沟通' : '未知');
    results.push({ i, job: pos.job, company: pos.company, btns: allBtn, verdict, known: panel ? panel.known : null });
    console.log(`#${i} [${verdict}] ${pos.job} @ ${pos.company}`);
    console.log(`     面板按钮: ${JSON.stringify(allBtn) || '[]'}`);
    if (panel && panel.known && panel.known.length) console.log(`     已知选择器: ${JSON.stringify(panel.known)}`);
  }

  console.log(`\n===== 汇总 =====`);
  const cnt = {};
  results.forEach(r => { cnt[r.verdict] = (cnt[r.verdict] || 0) + 1; });
  console.log(`  ${JSON.stringify(cnt)}`);
  console.log(`  可投率: ${results.length ? Math.round((cnt['可投']||0) / results.length * 100) : 0}%`);
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

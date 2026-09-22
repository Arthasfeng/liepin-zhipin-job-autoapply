/**
 * 验证 Boss "已沟通过"卡片的按钮真实状态 (写投穿检测的前提)
 * 逐个点开卡片, 抓 a.op-btn-chat 的完整状态 (文本 + class + disabled)
 * 用法: node tools/boss-check-chatted.js [port] [maxCards]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);
const MAX = parseInt(process.argv[3] || '15', 10);

const CARD_POS = (i) => `(function(){
  var cards = document.querySelectorAll('div.job-card-wrap');
  if(${i} >= cards.length) return null;
  var c = cards[${i}];
  c.scrollIntoView({block:'center'});
  var r = c.getBoundingClientRect();
  var nm = c.querySelector('a.job-name, .job-name, .job-title');
  return { x: r.x + r.width*0.4, y: r.y + 30, job: nm ? (nm.innerText||'').replace(/\\s+/g,' ').trim().slice(0,26) : '?' };
})()`;

const READ_BTN = `(function(){
  var btn = document.querySelector('a.op-btn-chat');
  if (!btn) return { found: false };
  var r = btn.getBoundingClientRect();
  return {
    found: true,
    text: (btn.innerText||'').replace(/\\s+/g,' ').trim(),
    cls: (btn.className||'').toString(),
    disabled: btn.classList.contains('is-disabled'),
    visible: r.width > 0 && r.height > 0
  };
})()`;

async function clickAt(eng, x, y) {
  await eng.cmd('Input.dispatchMouseEvent', { type:'mouseMoved', x:Math.round(x), y:Math.round(y), button:'none' });
  await sleep(90);
  await eng.cmd('Input.dispatchMouseEvent', { type:'mousePressed', x:Math.round(x), y:Math.round(y), button:'left', clickCount:1 });
  await sleep(50);
  await eng.cmd('Input.dispatchMouseEvent', { type:'mouseReleased', x:Math.round(x), y:Math.round(y), button:'left', clickCount:1 });
}

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();
  const ev = async (js) => {
    try { return await Promise.race([eng.evaluate(js), new Promise((_, rj) => setTimeout(() => rj(new Error('t')), 20000))]); }
    catch (e) { return null; }
  };

  const total = await ev('document.querySelectorAll("div.job-card-wrap").length');
  console.log(`页面卡片数: ${total}, 检查前 ${Math.min(MAX, total)} 张\n`);

  const states = {};
  for (let i = 0; i < Math.min(MAX, total); i++) {
    const pos = await ev(CARD_POS(i));
    if (!pos) continue;
    await sleep(400);
    await clickAt(eng, pos.x, pos.y);
    await sleep(2200);
    const btn = await ev(READ_BTN);
    const key = btn && btn.found ? `${btn.text}|${btn.disabled ? 'disabled' : 'enabled'}` : 'no-btn';
    states[key] = (states[key] || 0) + 1;
    console.log(`#${i} [${key}] "${pos.job}"`);
    if (btn && btn.found) console.log(`     cls=[${btn.cls}]`);
  }

  console.log(`\n===== 按钮状态分布 =====`);
  Object.keys(states).forEach(k => console.log(`  ${k}: ${states[k]} 张`));
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

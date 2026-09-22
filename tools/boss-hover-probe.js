/**
 * 交互式确认: 把窗口带到前台 + hover 指定卡片 + 探测按钮
 * 用法: node tools/boss-hover-probe.js [port] [cardIndex]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);
const IDX = parseInt(process.argv[3] || '0', 10);

// 探测: 卡片内 + 卡片右侧区域 + 视口内所有按钮
const PROBE = (i) => `(function(){
  var cards = document.querySelectorAll('div.job-card-wrap');
  var out = { totalCards: cards.length, idx: ${i} };
  if (${i} >= cards.length) { out.err = 'index out of range'; return out; }
  var c = cards[${i}];
  var rc = c.getBoundingClientRect();
  out.cardRect = { x: Math.round(rc.x), y: Math.round(rc.y), w: Math.round(rc.width), h: Math.round(rc.height) };
  var nm = c.querySelector('a.job-name,.job-name,.job-title');
  out.jobName = nm ? (nm.innerText||'').replace(/\\s+/g,' ').trim().slice(0,30) : '?';

  // ① 卡片内所有元素的文本（含按钮）
  var inside = [];
  var els = c.querySelectorAll('*');
  for (var k = 0; k < els.length; k++) {
    var t = (els[k].innerText || '').replace(/\\s+/g,' ').trim();
    if (!t || t.length > 16) continue;
    if (els[k].children.length > 0) continue;    // 叶子
    var r2 = els[k].getBoundingClientRect();
    if (r2.width < 5 || r2.height < 5) continue;
    inside.push({ t: t, cls: (els[k].className||'').toString().slice(0,60),
                  x: Math.round(r2.x), y: Math.round(r2.y), w: Math.round(r2.width), h: Math.round(r2.height) });
  }
  out.leafTextsInCard = inside.slice(0, 20);

  // ② 卡片内的 a/button 元素
  var act = [];
  var acts = c.querySelectorAll('a, button');
  for (var m = 0; m < acts.length; m++) {
    var a = acts[m];
    var r3 = a.getBoundingClientRect();
    act.push({ tag: a.tagName, txt: (a.innerText||'').replace(/\\s+/g,' ').trim().slice(0,18),
               cls: (a.className||'').toString().slice(0,70), href: (a.getAttribute('href')||'').slice(0,40),
               x: Math.round(r3.x), y: Math.round(r3.y), w: Math.round(r3.width), h: Math.round(r3.height),
               visible: (r3.width > 0 && r3.height > 0) });
  }
  out.linksAndButtons = act.slice(0, 12);

  // ③ 鼠标当前位置下的元素 (hover 后很有用)
  try {
    var mid = { x: Math.round(rc.x + rc.width*0.5), y: Math.round(rc.y + rc.height*0.5) };
    var elAt = document.elementFromPoint(mid.x, mid.y);
    out.elementAtCardCenter = elAt ? { tag: elAt.tagName, cls: (elAt.className||'').toString().slice(0,70),
                                       txt: (elAt.innerText||'').replace(/\\s+/g,' ').trim().slice(0,24) } : null;
  } catch(e) { out.elementAtCardCenter = 'err'; }

  // ④ 卡片右边缘附近的元素 (按钮常在右侧)
  try {
    var rx = Math.round(rc.right - 40);
    var ry = Math.round(rc.y + rc.height*0.5);
    var elR = document.elementFromPoint(rx, ry);
    out.elementAtCardRight = elR ? { tag: elR.tagName, cls: (elR.className||'').toString().slice(0,70),
                                     txt: (elR.innerText||'').replace(/\\s+/g,' ').trim().slice(0,24) } : null;
  } catch(e) { out.elementAtCardRight = 'err'; }

  return out;
})()`;

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();

  // 窗口带到前台
  try { await eng.cmd('Page.bringToFront', {}); } catch (e) {}
  await sleep(800);

  // 先滚到顶部, 让第 0 张卡片可见
  await eng.evaluate('window.scrollTo(0,0)').catch(() => null);
  await sleep(1200);

  const before = await eng.evaluate(PROBE(IDX)).catch(e => ({ err: e.message }));
  console.log('=== HOVER 之前 ===');
  console.log(`  卡片 #${IDX}: ${before.jobName}  rect=${JSON.stringify(before.cardRect)}`);
  console.log(`  卡片内叶子文本 (${(before.leafTextsInCard||[]).length} 个):`);
  (before.leafTextsInCard || []).forEach(t => console.log(`    "${t.t}" [${t.cls}] @(${t.x},${t.y}) ${t.w}x${t.h}`));
  console.log(`  卡片内 a/button (${(before.linksAndButtons||[]).length} 个):`);
  (before.linksAndButtons || []).forEach(b => console.log(`    <${b.tag}> "${b.txt}" cls=[${b.cls}] href=${b.href} @(${b.x},${b.y}) ${b.w}x${b.h} visible=${b.visible}`));
  console.log(`  卡片中心元素: ${JSON.stringify(before.elementAtCardCenter)}`);
  console.log(`  卡片右侧元素: ${JSON.stringify(before.elementAtCardRight)}`);

  // hover 到卡片中心
  const rc = before.cardRect;
  if (rc) {
    const hx = rc.x + rc.w * 0.5, hy = rc.y + rc.h * 0.5;
    console.log(`\n>>> 现在把鼠标移到卡片中心 (${Math.round(hx)}, ${Math.round(hy)}) ...`);
    await eng.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(hx * 0.4), y: Math.round(hy * 0.4), button: 'none' });
    await sleep(80);
    await eng.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(hx * 0.8), y: Math.round(hy * 0.8), button: 'none' });
    await sleep(80);
    await eng.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(hx), y: Math.round(hy), button: 'none' });
    await sleep(1500);

    const after = await eng.evaluate(PROBE(IDX)).catch(e => ({ err: e.message }));
    console.log('\n=== HOVER 之后 ===');
    console.log(`  卡片内叶子文本 (${(after.leafTextsInCard||[]).length} 个):`);
    (after.leafTextsInCard || []).forEach(t => console.log(`    "${t.t}" [${t.cls}] @(${t.x},${t.y}) ${t.w}x${t.h}`));
    console.log(`  卡片内 a/button (${(after.linksAndButtons||[]).length} 个):`);
    (after.linksAndButtons || []).forEach(b => console.log(`    <${b.tag}> "${b.txt}" cls=[${b.cls}] href=${b.href} @(${b.x},${b.y}) ${b.w}x${b.h} visible=${b.visible}`));
    console.log(`  卡片中心元素: ${JSON.stringify(after.elementAtCardCenter)}`);
    console.log(`  卡片右侧元素: ${JSON.stringify(after.elementAtCardRight)}`);
  }

  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

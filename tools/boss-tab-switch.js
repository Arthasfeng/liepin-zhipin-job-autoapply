/**
 * 验证 "客服总监(杭州)" <-> "推荐" 两个选项卡交替切换是否产出新卡片
 * 假设: 用户观察到的是"在搜索词tab下点击推荐"的切换动作
 * 用法: node tools/boss-tab-switch.js [port] [rounds]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);
const ROUNDS = parseInt(process.argv[3] || '3', 10);

const SNAP = `(function(){
  var cards = document.querySelectorAll('div.job-card-wrap');
  var l = [];
  for (var i=0;i<cards.length;i++){
    var n=cards[i].querySelector('a.job-name,.job-name,.job-title');
    l.push(((n?(n.innerText||''):(cards[i].innerText||'')).replace(/\\s+/g,' ').trim().slice(0,26)));
  }
  return { n: cards.length, list: l, docH: document.body.scrollHeight,
    url: (location.href||'').slice(0,100),
    activeTab: (function(){
      var s = document.querySelector('.synthesis');
      var e = document.querySelector('.expect-item');
      return '推荐=' + (s ? /active/.test(s.className||'') : '?') + ' 搜索词=' + (e ? (e.className||'').toString().includes('active') : '?');
    })()
  };
})()`;

async function realClickAt(eng, sel) {
  const pos = await eng.evaluate(`(function(){
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    el.scrollIntoView({block:'center'});
    var rc = el.getBoundingClientRect();
    return { x: rc.x + rc.width/2, y: rc.y + rc.height/2, text: (el.innerText||'').trim() };
  })()`).catch(() => null);
  if (!pos) return null;
  await sleep(600);
  const pos2 = await eng.evaluate(`(function(){
    var el = document.querySelector(${JSON.stringify(sel)});
    var rc = el.getBoundingClientRect();
    return { x: rc.x + rc.width/2, y: rc.y + rc.height/2 };
  })()`).catch(() => pos);
  await eng.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(pos2.x), y: Math.round(pos2.y), button: 'none' });
  await sleep(120);
  await eng.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(pos2.x), y: Math.round(pos2.y), button: 'left', clickCount: 1 });
  await sleep(60);
  await eng.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(pos2.x), y: Math.round(pos2.y), button: 'left', clickCount: 1 });
  return pos.text;
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

  const s0 = await ev(SNAP);
  console.log('=== 初始 ===');
  console.log(`  卡片 ${s0.n} | docH ${s0.docH} | URL ${s0.url}`);
  console.log(`  tab 状态: ${s0.activeTab}`);
  const seen = new Set(s0.list);

  for (let r = 1; r <= ROUNDS; r++) {
    // ① 切到搜索词 tab
    const t1 = await realClickAt(eng, '.expect-item');
    await sleep(6000);
    const sa = await ev(SNAP);
    const addA = sa ? sa.list.filter(t => !seen.has(t)) : [];
    addA.forEach(t => seen.add(t));
    console.log(`\n--- 第 ${r} 轮 ---`);
    console.log(`  ① 点击 [${t1}] (搜索词tab) → ${sa ? sa.n : '?'} 张 | 新增 ${addA.length} | ${sa ? sa.activeTab : ''} | docH ${sa ? sa.docH : '?'}`);

    // ② 切回推荐 tab
    const t2 = await realClickAt(eng, '.synthesis');
    await sleep(6000);
    const sb = await ev(SNAP);
    const addB = sb ? sb.list.filter(t => !seen.has(t)) : [];
    addB.forEach(t => seen.add(t));
    console.log(`  ② 点击 [${t2}] (推荐tab)   → ${sb ? sb.n : '?'} 张 | 新增 ${addB.length} | ${sb ? sb.activeTab : ''} | docH ${sb ? sb.docH : '?'}`);
    if (addB.length) console.log(`     新: ${addB.slice(0,4).join(' | ')}`);
    if (sb) console.log(`     URL: ${sb.url}`);
  }

  console.log(`\n===== 结论 =====`);
  console.log(`累计唯一职位: ${seen.size} (初始 ${s0.n}, 净增 ${seen.size - s0.n})`);
  if (seen.size > s0.n + 3) console.log('✅ 选项卡切换确实产出新职位');
  else console.log('⚠️ 切换未产出新职位');
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

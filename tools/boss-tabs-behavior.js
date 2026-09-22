/**
 * 验证 "推荐" 选项卡的点击行为
 * 目的: 核实用户观察 —— 点击后卡片是否刷新 / 是否持续衍生新卡片
 * 用法: node tools/boss-tabs-behavior.js [port]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9223', 10);

// 抓取当前卡片快照（标题列表）
const SNAP = `(function(){
  var cards = document.querySelectorAll('div.job-card-wrap');
  var titles = [];
  for (var i = 0; i < cards.length; i++) {
    var t = cards[i].querySelector('a.job-name, .job-name, .job-title');
    var name = t ? (t.innerText||'').replace(/\\s+/g,' ').trim() : (cards[i].innerText||'').split('\\n')[0];
    var comp = cards[i].querySelector('.company-name, .boss-name');
    titles.push(name.slice(0,28) + ' @ ' + (comp ? (comp.innerText||'').trim().slice(0,16) : '?'));
  }
  return {
    url: (location.href||'').slice(0,160),
    activeTab: (function(){
      var a = document.querySelector('.synthesis, [class*=tab].active, [class*=active][class*=tab]');
      return a ? (a.innerText||'').replace(/\\s+/g,' ').trim().slice(0,40) + ' [' + (a.className||'').toString().slice(0,50) + ']' : '(未识别)';
    })(),
    cardCount: cards.length,
    titles: titles,
    scrollY: window.scrollY,
    docHeight: document.body.scrollHeight
  };
})()`;

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();

  const ev = async (js, tag) => {
    try { return await Promise.race([eng.evaluate(js), new Promise((_, rj) => setTimeout(() => rj(new Error('timeout')), 20000))]); }
    catch (e) { console.log(`  [${tag}] 失败: ${e.message}`); return null; }
  };

  console.log('=== ① 初始状态 ===');
  let s0 = await ev(SNAP, 'init');
  if (!s0) process.exit(1);
  console.log(`  URL: ${s0.url}`);
  console.log(`  当前激活 tab: ${s0.activeTab}`);
  console.log(`  卡片数: ${s0.cardCount}`);
  console.log(`  前 3 张: ${s0.titles.slice(0, 3).join(' | ')}`);

  // ② 点击 "推荐" 选项卡 (.synthesis)
  console.log('\n=== ② 点击 "推荐" 选项卡 (.synthesis) ===');
  const clicked = await ev(`(function(){
    var el = document.querySelector('.synthesis');
    if (!el) return { ok:false, why:'未找到 .synthesis' };
    var r = el.getBoundingClientRect();
    el.click();
    return { ok:true, text:(el.innerText||'').trim(), rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)} };
  })()`, 'click');
  console.log('  ' + JSON.stringify(clicked));
  await sleep(6000);

  console.log('\n=== ③ 点击后状态 ===');
  let s1 = await ev(SNAP, 'after');
  if (s1) {
    console.log(`  URL: ${s1.url}`);
    console.log(`  当前激活 tab: ${s1.activeTab}`);
    console.log(`  卡片数: ${s1.cardCount}`);
    console.log(`  前 3 张: ${s1.titles.slice(0, 3).join(' | ')}`);
    const set0 = new Set(s0.titles), set1 = new Set(s1.titles);
    const newOnes = s1.titles.filter(t => !set0.has(t));
    console.log(`  → 新出现卡片: ${newOnes.length} 张`);
    if (newOnes.length) console.log(`     ${newOnes.slice(0, 5).join(' | ')}`);
  }

  // ④ 滚动到底，看是否加载更多（未登录态下推荐流行为）
  console.log('\n=== ④ 滚动到底部触底加载 ===');
  await ev(`(function(){
    var best = null;
    var divs = document.querySelectorAll('div');
    for (var i=0;i<divs.length;i++){
      var d=divs[i];
      if (d.scrollHeight > d.clientHeight + 200 && d.clientHeight > 250) { if(!best || d.clientHeight>best.clientHeight) best=d; }
    }
    if (best) { best.scrollTop = best.scrollHeight; return { scrolled:true, cls:(best.className||'').slice(0,60), to:best.scrollTop }; }
    window.scrollTo(0, document.body.scrollHeight);
    return { scrolled:false, fallback:'window' };
  })()`, 'scroll');
  await sleep(6000);
  let s2 = await ev(SNAP, 'scroll2');
  if (s2) {
    console.log(`  滚动后卡片数: ${s2.cardCount}  (初始 ${s0.cardCount})`);
    const set1 = new Set(s1 ? s1.titles : []);
    const newer = s2.titles.filter(t => !set1.has(t) && !new Set(s0.titles).has(t));
    console.log(`  → 滚动后新增: ${newer.length} 张`);
    if (newer.length) console.log(`     ${newer.slice(0, 5).join(' | ')}`);
  }

  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

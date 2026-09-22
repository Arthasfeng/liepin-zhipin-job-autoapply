/**
 * 修正版 v2: 滚 window (整页滚动) 触发无限加载
 * 用法: node tools/boss-window-scroll.js [port] [rounds]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);
const ROUNDS = parseInt(process.argv[3] || '8', 10);

const SNAP = `(function(){
  var cards = document.querySelectorAll('div.job-card-wrap');
  var l = [];
  for (var i=0;i<cards.length;i++){
    var n=cards[i].querySelector('a.job-name,.job-name,.job-title');
    l.push(((n?(n.innerText||''):(cards[i].innerText||'')).replace(/\\s+/g,' ').trim().slice(0,24)));
  }
  return {
    n: cards.length, list: l,
    winY: Math.round(window.scrollY),
    winH: window.innerHeight,
    docH: document.body.scrollHeight,
    atBottom: (window.scrollY + window.innerHeight) >= document.body.scrollHeight - 120
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

  const s0 = await ev(SNAP, 's0');
  if (!s0) process.exit(1);
  console.log(`初始: ${s0.n} 张 | 文档高 ${s0.docH} | 视口高 ${s0.winH} | scrollY ${s0.winY}`);
  console.log(`  样例: ${s0.list.slice(0,2).join(' | ')}\n`);

  const seen = new Set(s0.list);
  const roundStats = [];

  for (let r = 1; r <= ROUNDS; r++) {
    // 真实滚动: 分几步滚到底, 模拟用户滚动轨迹
    await ev(`(function(){
      var target = document.body.scrollHeight;
      window.scrollTo(0, target);
      window.dispatchEvent(new Event('scroll', {bubbles:true}));
      return { y: window.scrollY, sh: document.body.scrollHeight };
    })()`, 'scroll' + r);
    await sleep(5500);

    const s = await ev(SNAP, 's' + r);
    if (!s) continue;
    const nw = s.list.filter(t => !seen.has(t));
    nw.forEach(t => seen.add(t));
    roundStats.push({ r, n: s.n, added: nw.length, docH: s.docH });
    console.log(`第 ${r} 轮: 卡片 ${s.n} | 新增 ${nw.length} | 文档高 ${s.docH} | 累计唯一 ${seen.size}`);
    if (nw.length) console.log(`   新: ${nw.slice(0, 4).join(' | ')}`);
    else console.log(`   ⚠️ 无新增`);

    // 如果文档高度不再增长且已到底, 说明加载停止
    if (r >= 3 && roundStats.slice(-3).every(x => x.added === 0)) {
      console.log(`\n  → 连续 3 轮无新增, 停止 (文档高稳定在 ${s.docH})`);
      break;
    }
  }

  console.log(`\n===== 结论 =====`);
  console.log(`初始 ${s0.n} 张 → 累计唯一 ${seen.size} 张 (净增 ${seen.size - s0.n})`);
  console.log(`文档高度: ${s0.docH} → ${roundStats.length ? roundStats[roundStats.length-1].docH : '?'}`);
  if (seen.size > s0.n + 5) console.log(`✅ 滚动确实持续加载新职位 — 可作为储备池`);
  else console.log(`⚠️ 滚动未加载更多 — 需要检查登录态/是否真的到底`);
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

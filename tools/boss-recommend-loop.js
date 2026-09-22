/**
 * 验证 "推荐" 选项卡反复点击是否持续产出新卡片
 * 核实用户观察: "如果没有新的出来，再点击一下'推荐'选项卡卡片，
 *               下面还会继续刷新出新的职位卡片"
 * 用法: node tools/boss-recommend-loop.js [port] [rounds]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9223', 10);
const ROUNDS = parseInt(process.argv[3] || '4', 10);

const SNAP = `(function(){
  var cards = document.querySelectorAll('div.job-card-wrap');
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var n = cards[i].querySelector('a.job-name, .job-name, .job-title');
    var c = cards[i].querySelector('.company-name, .boss-name');
    out.push(((n ? (n.innerText||'') : (cards[i].innerText||'')).replace(/\\s+/g,' ').trim().slice(0,26))
             + ' @ ' + (c ? (c.innerText||'').trim().slice(0,14) : '?'));
  }
  return { url:(location.href||'').slice(0,110), active:(function(){var a=document.querySelector('.synthesis');return a?(a.className||'').toString():'';})(), n:cards.length, list:out };
})()`;

const CLICK = `(function(){
  var el = document.querySelector('.synthesis');
  if (!el) return { ok:false };
  el.click();
  return { ok:true };
})()`;

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

  const seen = new Set();
  let s = await ev(SNAP);
  if (!s) { console.log('初始快照失败'); process.exit(1); }
  s.list.forEach(t => seen.add(t));
  console.log(`初始: ${s.n} 张, 唯一累计 ${seen.size}`);
  console.log(`  样例: ${s.list.slice(0,2).join(' | ')}\n`);

  let staleCount = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    await ev(CLICK);
    await sleep(6500);
    const cur = await ev(SNAP);
    if (!cur) { console.log(`第 ${round} 轮: 快照失败`); continue; }
    const newOnes = cur.list.filter(t => !seen.has(t));
    newOnes.forEach(t => seen.add(t));
    console.log(`第 ${round} 轮点击后: ${cur.n} 张 | 本轮新增 ${newOnes.length} | 累计唯一 ${seen.size}`);
    if (newOnes.length) console.log(`  新: ${newOnes.slice(0, 3).join(' | ')}`);
    if (newOnes.length === 0) { staleCount++; console.log('  ⚠️ 本轮无新增'); } else { staleCount = 0; }
    // URL 变化记录
    if (round === 1) console.log(`  (URL: ${cur.url})`);
  }

  console.log(`\n===== 结论 =====`);
  console.log(`累计唯一职位: ${seen.size}  (连续无新增轮数: ${staleCount})`);
  if (staleCount === 0 && seen.size > 20) {
    console.log('✅ 反复点击"推荐"确实持续产出新职位 —— 可作为"投穿后"的备用池');
  } else if (staleCount >= 2) {
    console.log('⚠️ 连续多轮无新增 —— 推荐流已枯竭或未登录态限制');
  }
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

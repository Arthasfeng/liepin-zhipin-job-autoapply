/**
 * 用 CDP 真实鼠标事件点击 "推荐" tab，验证是否刷新出新卡片
 * 关键: JS el.click() 是合成事件, React 可能忽略;
 *       Input.dispatchMouseEvent 是真实浏览器输入事件, 必被处理
 * 用法: node tools/boss-real-click.js [port] [rounds]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);
const ROUNDS = parseInt(process.argv[3] || '4', 10);

const SNAP = `(function(){
  var cards = document.querySelectorAll('div.job-card-wrap');
  var l = [];
  for (var i=0;i<cards.length;i++){
    var n=cards[i].querySelector('a.job-name,.job-name,.job-title');
    l.push(((n?(n.innerText||''):(cards[i].innerText||'')).replace(/\\s+/g,' ').trim().slice(0,24)));
  }
  return { n: cards.length, list: l, winY: Math.round(window.scrollY), docH: document.body.scrollHeight,
    activeTab: (function(){ var a=document.querySelector('.synthesis'); return a?(a.className||'').toString():''; })() };
})()`;

async function realClick(eng, x, y) {
  await eng.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'none' });
  await sleep(120);
  await eng.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  await sleep(60);
  await eng.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
}

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
  console.log(`初始: ${s0.n} 张 | docH ${s0.docH} | scrollY ${s0.winY} | tab=${s0.activeTab}`);

  const seen = new Set(s0.list);

  for (let r = 1; r <= ROUNDS; r++) {
    // 拿 .synthesis 的实时坐标（注意: 可能在视口外, 需要先滚到顶部）
    const pos = await ev(`(function(){
      var el = document.querySelector('.synthesis');
      if (!el) return null;
      var rc = el.getBoundingClientRect();
      return { x: rc.x + rc.width/2, y: rc.y + rc.height/2, vis: rc.y >= 0 && rc.y < window.innerHeight };
    })()`, 'pos' + r);
    if (!pos) { console.log('找不到 .synthesis'); break; }

    // 若不在视口内, 先滚到顶部让 tab 可见(真实鼠标点击需要元素可见)
    if (!pos.vis) {
      await ev('window.scrollTo(0,0)', 'totop');
      await sleep(1200);
    }
    const pos2 = await ev(`(function(){
      var el=document.querySelector('.synthesis'); var rc=el.getBoundingClientRect();
      return {x:rc.x+rc.width/2, y:rc.y+rc.height/2};})()`, 'pos2');

    console.log(`\n第 ${r} 轮: 真实鼠标点击 (.synthesis @ ${Math.round(pos2.x)},${Math.round(pos2.y)})`);
    await realClick(eng, pos2.x, pos2.y);
    await sleep(6500);

    const s = await ev(SNAP, 's' + r);
    if (!s) continue;
    const nw = s.list.filter(t => !seen.has(t));
    nw.forEach(t => seen.add(t));
    console.log(`  → 卡片 ${s.n} | 新增 ${nw.length} | docH ${s.docH} | 累计唯一 ${seen.size}`);
    if (nw.length) console.log(`     新: ${nw.slice(0,4).join(' | ')}`);
    else console.log('     ⚠️ 无新增');
  }

  console.log(`\n===== 结论 =====`);
  console.log(`累计唯一: ${seen.size} (初始 ${s0.n}, 净增 ${seen.size - s0.n})`);
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

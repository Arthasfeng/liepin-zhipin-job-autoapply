/**
 * 修正版: 从 job-card-wrap 反查可滚动祖先, 正确滚动职位列表
 * 用法: node tools/boss-scroll-fix.js [port]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);

const SNAP = `(function(){
  var cards = document.querySelectorAll('div.job-card-wrap');
  var l = [];
  for (var i=0;i<cards.length;i++){
    var n=cards[i].querySelector('a.job-name,.job-name,.job-title');
    l.push(((n?(n.innerText||''):(cards[i].innerText||'')).replace(/\\s+/g,' ').trim().slice(0,24)));
  }
  // 从卡片反查可滚动祖先
  var sc = null, el = cards.length ? cards[0] : null;
  var chain = [];
  while (el && el !== document.body) {
    var rc = el.getBoundingClientRect();
    chain.push((el.className||'').toString().slice(0,50) + '|sh=' + el.scrollHeight + '|ch=' + el.clientHeight);
    if (!sc && el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 300) sc = el;
    el = el.parentElement;
  }
  return {
    n: cards.length, list: l,
    scrollContainer: sc ? { cls:(sc.className||'').toString().slice(0,60), sh:sc.scrollHeight, ch:sc.clientHeight, top:sc.scrollTop } : null,
    ancestorChain: chain.slice(0, 8)
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
  console.log('=== 初始 ===');
  console.log(`  卡片: ${s0.n}`);
  console.log(`  滚动容器: ${JSON.stringify(s0.scrollContainer)}`);
  console.log(`  祖先链 (卡片→body):`);
  s0.ancestorChain.forEach((c, i) => console.log(`    ${i}: ${c}`));

  const seen = new Set(s0.list);
  console.log(`\n=== 用正确容器滚动 5 轮 (每轮滚到底 + 等 6s) ===`);
  for (let r = 1; r <= 5; r++) {
    const scrolled = await ev(`(function(){
      var cards=document.querySelectorAll('div.job-card-wrap');
      if(!cards.length) return {ok:false};
      var el=cards[0], sc=null;
      while(el && el!==document.body){
        if(el.scrollHeight>el.clientHeight+100 && el.clientHeight>300){ sc=el; break; }
        el=el.parentElement;
      }
      if(!sc) return {ok:false, why:'no scroll container'};
      var before=sc.scrollTop;
      sc.scrollTop = sc.scrollHeight;
      // 同时触发真实滚动事件（React 常监听 scroll 事件）
      sc.dispatchEvent(new Event('scroll', {bubbles:true}));
      return {ok:true, cls:(sc.className||'').toString().slice(0,50), before:Math.round(before), after:Math.round(sc.scrollTop), sh:sc.scrollHeight, ch:sc.clientHeight};
    })()`, 'scroll' + r);
    console.log(`  第 ${r} 轮: ${JSON.stringify(scrolled)}`);
    await sleep(6000);
    const s = await ev(SNAP, 's' + r);
    if (!s) continue;
    const nw = s.list.filter(t => !seen.has(t));
    nw.forEach(t => seen.add(t));
    console.log(`     → 卡片 ${s.n} 张 | 新增 ${nw.length} | 累计唯一 ${seen.size}`);
    if (nw.length) console.log(`       新: ${nw.slice(0,4).join(' | ')}`);
    if (nw.length === 0 && r >= 2) { console.log('     (连续无新增)'); }
  }

  console.log(`\n===== 结论 =====`);
  console.log(`累计唯一职位: ${seen.size} (初始 ${s0.n})`);
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

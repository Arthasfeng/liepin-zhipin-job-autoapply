/**
 * 全面探测 Boss "推荐"页的可交互元素 + 加载机制
 * 目的: 找出用户所说的"点击/操作后继续刷新出新职位卡片"的正确触发点
 * 用法: node tools/boss-recommend-probe.js [port]
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
  return { url:(location.href||'').slice(0,110), n:cards.length, list:l,
    scrollInfo:(function(){
      var divs=document.querySelectorAll('div'),best=null;
      for(var j=0;j<divs.length;j++){var d=divs[j];
        if(d.scrollHeight>d.clientHeight+200&&d.clientHeight>250){if(!best||d.clientHeight>best.clientHeight)best=d;}}
      if(best) return {cls:(best.className||'').slice(0,60),top:best.scrollTop,sh:best.scrollHeight,ch:best.clientHeight};
      return {win:true,top:window.scrollY,sh:document.body.scrollHeight};})()
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

  // ① 页面所有按钮/可点击元素
  console.log('=== ① 所有 button / 可点击元素 (前 30) ===');
  const btns = await ev(`(function(){
    var out=[]; var els=document.querySelectorAll('button, a, [class*="btn"], [class*="refresh"], [class*="change"], [class*="replace"]');
    for(var i=0;i<els.length;i++){
      var el=els[i];
      var t=(el.innerText||'').replace(/\\s+/g,' ').trim();
      if(!t||t.length>20) continue;
      var r=el.getBoundingClientRect();
      if(r.width<8||r.height<8) continue;
      out.push({t:t, cls:(el.className||'').toString().slice(0,58), y:Math.round(r.y), x:Math.round(r.x)});
    }
    return out.slice(0,30);
  })()`, 'btns');
  if (btns) btns.forEach(b => console.log(`  "${b.t}"  [${b.cls}]  (${b.x},${b.y})`));

  // ② 关键词搜索: 换一批 / 换一换 / 加载更多 / 查看更多 / 刷新
  console.log('\n=== ② 关键文案命中 ===');
  const kw = await ev(`(function(){
    var body=(document.body&&document.body.innerText)||'';
    var res={};
    ['换一批','换一换','加载更多','查看更多','下拉刷新','刷新','没有更多','已无更多','到底了','为新职位'].forEach(function(k){
      res[k] = body.indexOf(k)>=0;
    });
    return res;
  })()`, 'kw');
  if (kw) console.log('  ' + JSON.stringify(kw));

  // ③ 初始快照
  console.log('\n=== ③ 初始快照 ===');
  const s0 = await ev(SNAP, 's0');
  if (!s0) process.exit(1);
  console.log(`  卡片 ${s0.n} 张 | 滚动容器: ${JSON.stringify(s0.scrollInfo)}`);

  // ④ 滚动到底 + 等待 (真实滚动事件)
  console.log('\n=== ④ 滚动到底部 + 等待 8s ===');
  await ev(`(function(){
    var divs=document.querySelectorAll('div'),best=null;
    for(var j=0;j<divs.length;j++){var d=divs[j];
      if(d.scrollHeight>d.clientHeight+200&&d.clientHeight>250){if(!best||d.clientHeight>best.clientHeight)best=d;}}
    if(best){ best.scrollTop=best.scrollHeight; return {t:'div',to:best.scrollTop}; }
    window.scrollTo(0,document.body.scrollHeight); return {t:'win'};
  })()`, 'scroll1');
  await sleep(8000);
  const s1 = await ev(SNAP, 's1');
  if (s1) {
    const set0 = new Set(s0.list);
    const nw = s1.list.filter(t => !set0.has(t));
    console.log(`  滚动后: ${s1.n} 张 | 新增 ${nw.length} | ${JSON.stringify(s1.scrollInfo)}`);
    if (nw.length) console.log(`    新: ${nw.slice(0,4).join(' | ')}`);
  }

  // ⑤ 再滚一次 (有些列表要连续滚动触发)
  console.log('\n=== ⑤ 再次滚动 + 等待 8s ===');
  await ev(`(function(){
    var divs=document.querySelectorAll('div'),best=null;
    for(var j=0;j<divs.length;j++){var d=divs[j];
      if(d.scrollHeight>d.clientHeight+200&&d.clientHeight>250){if(!best||d.clientHeight>best.clientHeight)best=d;}}
    if(best){ best.scrollTop=best.scrollHeight; return 1; }
    window.scrollTo(0,document.body.scrollHeight); return 1;
  })()`, 'scroll2');
  await sleep(8000);
  const s2 = await ev(SNAP, 's2');
  if (s2) {
    const prev = new Set([...s0.list, ...(s1 ? s1.list : [])]);
    const nw = s2.list.filter(t => !prev.has(t));
    console.log(`  再滚后: ${s2.n} 张 | 新增 ${nw.length}`);
    if (nw.length) console.log(`    新: ${nw.slice(0,4).join(' | ')}`);
  }

  // ⑥ 点击"推荐" tab (真实鼠标事件序列, 而非 el.click())
  console.log('\n=== ⑥ 用完整鼠标事件序列点击 "推荐" ===');
  await ev(`(function(){
    var el=document.querySelector('.synthesis'); if(!el) return 0;
    var r=el.getBoundingClientRect(); var x=r.x+r.width/2, y=r.y+r.height/2;
    ['mousedown','mouseup','click'].forEach(function(t){
      el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,view:window}));
    });
    return 1;
  })()`, 'click2');
  await sleep(7000);
  const s3 = await ev(SNAP, 's3');
  if (s3) {
    const prev = new Set([...s0.list, ...(s1?s1.list:[]), ...(s2?s2.list:[])]);
    const nw = s3.list.filter(t => !prev.has(t));
    console.log(`  完整事件点击后: ${s3.n} 张 | 新增 ${nw.length}`);
    if (nw.length) console.log(`    新: ${nw.slice(0,4).join(' | ')}`);
  }

  console.log('\n===== 汇总 =====');
  const all = new Set([...s0.list, ...(s1?s1.list:[]), ...(s2?s2.list:[]), ...(s3?s3.list:[])]);
  console.log(`  累计唯一职位: ${all.size} (初始 ${s0.n})`);
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

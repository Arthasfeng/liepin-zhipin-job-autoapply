/**
 * Boss直聘 列表页头部选项卡探测
 * 核实: 搜索框同高度附近是否存在 "推荐" 与 "职位名" 两个选项卡控件
 * 用法: node tools/boss-tabs-probe.js [port]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));

const port = parseInt(process.argv[2] || '9223', 10);

const PROBE = `(function(){
  var out = { url: (location.href||'').slice(0,180), title: document.title||'' };

  // 1) 页面上所有含"推荐"文本的元素（看哪些是选项卡级别的）
  function findByText(txt) {
    var all = document.querySelectorAll('a,div,span,li,button');
    var hits = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var t = (el.innerText || '').replace(/\\s+/g,' ').trim();
      if (t !== txt) continue;                     // 完全等于才算（避免抓到父容器）
      var rc = el.getBoundingClientRect();
      if (rc.width < 5 || rc.height < 5) continue; // 过滤不可见
      hits.push({
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 120),
        x: Math.round(rc.x), y: Math.round(rc.y),
        w: Math.round(rc.width), h: Math.round(rc.height),
        parentCls: el.parentElement ? (el.parentElement.className||'').toString().slice(0,110) : '',
        parentTag: el.parentElement ? el.parentElement.tagName : '',
        siblings: el.parentElement ? el.parentElement.children.length : 0,
        dataAttrs: (function(){ var o={}; for (var a of el.attributes) if (a.name.indexOf('data-')===0) o[a.name]=a.value.slice(0,40); return o; })()
      });
    }
    return hits;
  }
  out.推荐 = findByText('推荐');

  // 2) 找疑似"职位名选项卡": 头部区域里含"总监/经理/客服/主管/总经理"的短文本元素
  var heads = document.querySelectorAll('a,div,span,li,button');
  var jobTabLike = [];
  for (var j = 0; j < heads.length; j++) {
    var e2 = heads[j];
    var t2 = (e2.innerText || '').replace(/\\s+/g,' ').trim();
    if (t2.length === 0 || t2.length > 22) continue;
    if (!/(总监|经理|主管|总裁|客服|运营|采购|人事|财务|店长|VP)/.test(t2)) continue;
    var r2 = e2.getBoundingClientRect();
    if (r2.width < 5 || r2.height < 5) continue;
    if (r2.y > 220) continue;                    // 只看页面顶部区域
    jobTabLike.push({
      tag: e2.tagName,
      text: t2,
      cls: (e2.className||'').toString().slice(0,110),
      x: Math.round(r2.x), y: Math.round(r2.y), w: Math.round(r2.width), h: Math.round(r2.height),
      parentCls: e2.parentElement ? (e2.parentElement.className||'').toString().slice(0,110) : ''
    });
  }
  out.疑似职位名选项卡 = jobTabLike.slice(0, 12);

  // 3) 顶部区域(y<130)的完整文案 + 该高度上的可点元素
  var top = [];
  var allEls = document.querySelectorAll('a,div,span,button');
  for (var k = 0; k < allEls.length; k++) {
    var e3 = allEls[k];
    var r3 = e3.getBoundingClientRect();
    if (r3.y < 0 || r3.y > 120 || r3.width < 20 || r3.height < 8 || r3.height > 60) continue;
    var t3 = (e3.innerText || '').replace(/\\s+/g,' ').trim();
    if (!t3 || t3.length > 30) continue;
    if (e3.children.length > 2) continue;         // 叶子节点才要
    top.push({ x: Math.round(r3.x), y: Math.round(r3.y), text: t3, cls: (e3.className||'').toString().slice(0,70) });
  }
  top.sort(function(a,b){ return a.y - b.y || a.x - b.x; });
  out.顶部窄高度元素 = top.slice(0, 25);

  // 4) 卡片总数 + 卡片容器类名
  var cards = document.querySelectorAll('div.job-card-wrap');
  out.卡片数 = cards.length;
  if (cards.length) {
    out.卡片容器类 = (cards[0].className||'').toString().slice(0,120);
    out.首卡片文本 = (cards[0].innerText||'').replace(/\\s+/g,' ').slice(0,100);
    out.末卡片文本 = (cards[cards.length-1].innerText||'').replace(/\\s+/g,' ').slice(0,100);
  }

  // 5) 是否有"已完成/没有更多"之类的结束提示
  var body = (document.body && document.body.innerText) || '';
  out.结束提示 = ['没有更多','已无更多','暂无更多','加载完毕','到底了','换了新一批'].filter(function(w){ return body.indexOf(w) >= 0; });

  // 6) 滚动容器定位（无限滚动通常在内层 div）
  var scrollers = [];
  var divs = document.querySelectorAll('div');
  for (var m = 0; m < divs.length; m++) {
    var d = divs[m];
    if (d.scrollHeight > d.clientHeight + 200 && d.clientHeight > 200) {
      var rr = d.getBoundingClientRect();
      scrollers.push({ cls:(d.className||'').toString().slice(0,90), sh:d.scrollHeight, ch:d.clientHeight, y:Math.round(rr.y) });
    }
  }
  out.滚动容器 = scrollers.slice(0,6);

  return out;
})()`;

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();
  const r = await Promise.race([
    eng.evaluate(PROBE),
    new Promise((_, rj) => setTimeout(() => rj(new Error('evaluate timeout 25s')), 25000)),
  ]);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch(function (e) {
  console.error('ERR:', e.message);
  process.exit(1);
});

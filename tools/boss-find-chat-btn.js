/**
 * 全页面搜索 "立即沟通/继续聊" 文本的精确位置
 * 用法: node tools/boss-find-chat-btn.js [port]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));

const port = parseInt(process.argv[2] || '9230', 10);

const JS = `(function(){
  var out = { hits: [], viewport: { w: window.innerWidth, h: window.innerHeight }, scrollY: Math.round(window.scrollY) };
  var els = document.querySelectorAll('*');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    if (!t) continue;
    if (!/(立即沟通|继续聊|聊一聊|沟通过)/.test(t)) continue;
    if (t.length > 30) continue;
    if (el.children.length > 0) continue;
    var r = el.getBoundingClientRect();
    out.hits.push({
      tag: el.tagName,
      txt: t.slice(0, 20),
      cls: (el.className || '').toString().slice(0, 90),
      parentCls: el.parentElement ? (el.parentElement.className||'').toString().slice(0, 70) : '',
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      visible: r.width > 0 && r.height > 0 && r.y > -50 && r.y < window.innerHeight + 50
    });
  }
  return out;
})()`;

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();
  await eng.evaluate('window.scrollTo(0,0)').catch(() => null);
  await new Promise(r => setTimeout(r, 1200));

  const r = await eng.evaluate(JS).catch(e => ({ err: e.message }));
  console.log(`视口: ${JSON.stringify(r.viewport)} | scrollY=${r.scrollY}`);
  console.log(`命中 "立即沟通/继续聊/聊一聊" 的元素: ${(r.hits||[]).length} 个\n`);
  (r.hits || []).forEach((h, i) => {
    console.log(`${i+1}. <${h.tag}> "${h.txt}"`);
    console.log(`   cls=[${h.cls}]`);
    console.log(`   parent=[${h.parentCls}]`);
    console.log(`   位置 (${h.x},${h.y}) 尺寸 ${h.w}x${h.h} 可见=${h.visible}`);
  });
  if (!r.hits || r.hits.length === 0) {
    console.log('  ⚠️ 全页面没有任何"立即沟通/继续聊"文本元素');
    console.log('  → 说明按钮不在 DOM 中(可能需要点击卡片后才渲染)');
  }
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

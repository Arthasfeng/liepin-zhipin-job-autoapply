/**
 * 补抓: 弹窗内所有按钮的精确类名 + 文本 (写代码需要准确选择器)
 * 用法: node tools/boss-grab-dialog-btns.js [port]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));

const port = parseInt(process.argv[2] || '9230', 10);

const JS = `(function(){
  var out = { dialogs: [], allBtnsInDialog: [] };
  // 弹窗容器
  var dlg = document.querySelector('.greet-boss-dialog, .greet-boss-container, [class*="greet-boss"]');
  if (dlg) {
    var r = dlg.getBoundingClientRect();
    out.dialogFound = { cls: (dlg.className||'').toString(), x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height) };
    // 弹窗内所有 a/button/span (带文本的)
    var els = dlg.querySelectorAll('a, button, span, div');
    for (var i=0;i<els.length;i++){
      var e = els[i];
      var t = (e.innerText||'').replace(/\\s+/g,' ').trim();
      if (!t || t.length > 20) continue;
      if (e.children.length > 1) continue;
      var r2 = e.getBoundingClientRect();
      if (r2.width < 5 || r2.height < 5) continue;
      out.allBtnsInDialog.push({
        tag: e.tagName, text: t,
        cls: (e.className||'').toString(),
        x: Math.round(r2.x+r2.width/2), y: Math.round(r2.y+r2.height/2),
        w: Math.round(r2.width), h: Math.round(r2.height)
      });
    }
  } else {
    out.dialogFound = null;
    out.note = '弹窗已关闭 (可能已超时或已操作)';
  }
  return out;
})()`;

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();
  const r = await eng.evaluate(JS).catch(e => ({ err: e.message }));
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

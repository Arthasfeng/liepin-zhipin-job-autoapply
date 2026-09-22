/**
 * 快速检查某端口的登录态 + 页面概况
 * 用法: node tools/check-login-state.js [port]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));

const port = parseInt(process.argv[2] || '9230', 10);

const JS = `(function(){
  var b = (document.body && document.body.innerText) || '';
  var out = document.querySelector('a[href*="logout"], [class*="logout"]');
  var cookies = document.cookie || '';
  return {
    url: (location.href||'').slice(0,140),
    title: document.title || '',
    hasLogoutEl: !!out,
    cookieNames: cookies.split(';').map(function(c){return c.split('=')[0].trim();}).filter(Boolean).slice(0, 25),
    head: b.slice(0, 320).replace(/\\s+/g, ' '),
    hasLoginRegister: /登录\\/注册/.test(b),
    推荐tab存在: !!document.querySelector('.synthesis'),
    推荐tab激活: (function(){ var a = document.querySelector('.synthesis'); return a ? /active/.test(a.className||'') : null; })(),
    jobCount: document.querySelectorAll('div.job-card-wrap').length,
    可见tab列表: (function(){
      var out = [];
      var els = document.querySelectorAll('.synthesis, [class*="tab"]');
      for (var i = 0; i < els.length; i++) {
        var t = (els[i].innerText||'').replace(/\\s+/g,' ').trim();
        var r = els[i].getBoundingClientRect();
        if (t && t.length < 30 && r.width > 10 && r.y < 200) {
          out.push({ text: t, cls: (els[i].className||'').toString().slice(0,60), x: Math.round(r.x), y: Math.round(r.y) });
        }
      }
      return out.slice(0, 12);
    })()
  };
})()`;

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();
  const r = await Promise.race([
    eng.evaluate(JS),
    new Promise((_, rj) => setTimeout(() => rj(new Error('evaluate timeout 25s')), 25000)),
  ]);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

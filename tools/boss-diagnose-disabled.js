/**
 * 诊断 is-disabled 按钮的真实原因 (title/aria/父容器文本/hover提示)
 * 用法: node tools/boss-diagnose-disabled.js [port]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);

const JS = `(function(){
  var out = {};
  var btn = document.querySelector('a.op-btn-chat');
  if (!btn) { out.noBtn = true; return out; }
  out.btn = {
    text: (btn.innerText||'').replace(/\\s+/g,' ').trim(),
    cls: (btn.className||'').toString(),
    disabled: btn.classList.contains('is-disabled'),
    title: btn.getAttribute('title') || '',
    ariaLabel: btn.getAttribute('aria-label') || '',
    dataAttrs: (function(){ var o={}; for (var a of btn.attributes) if(a.name.indexOf('data-')===0) o[a.name]=a.value.slice(0,50); return o; })()
  };
  // 父容器 op 区域完整文本
  var op = btn.parentElement;
  out.opArea = op ? { cls:(op.className||'').toString(), text:(op.innerText||'').replace(/\\s+/g,' ').trim().slice(0,200) } : null;
  // 详情面板顶部完整文本 (可能含"已沟通"/"今日已沟通过"等)
  var detail = btn.closest('.job-detail-container, [class*="job-detail"]');
  out.detailText = detail ? (detail.innerText||'').replace(/\\s+/g,' ').trim().slice(0,300) : null;
  // 全页面找限制/上限/沟通次数相关文案
  var body = (document.body&&document.body.innerText)||'';
  out.limitKeywords = ['沟通次数','沟通上限','今日已','已沟通过','达到上限','次数已用完','每日','免费沟通','沟通机会','打招呼次数'].filter(function(k){ return body.indexOf(k)>=0; });
  // 侧边栏"沟通过"入口
  var side = document.querySelector('.side-entry2, [class*="side-entry"]');
  out.sideEntry = side ? { cls:(side.className||'').toString().slice(0,80), text:(side.innerText||'').replace(/\\s+/g,' ').trim().slice(0,120) } : null;
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

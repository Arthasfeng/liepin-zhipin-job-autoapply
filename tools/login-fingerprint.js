/**
 * 猎聘/直聘 登录态特征提取器
 * 用法: node login-fingerprint.js <debugPort>
 * 输出: JSON 特征, 用于"已登录 vs 未登录"对比
 */
const ChromeEngine = require(require('path').join(__dirname, '..', 'engine', 'chrome'));

const port = parseInt(process.argv[2] || '9222', 10);

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();

  const r = await eng.evaluate(`(function(){
    var out = {};
    out.port = ${port};
    out.url = (location.href || '').slice(0, 220);
    out.title = document.title || '';

    var body = (document.body && document.body.innerText) || '';
    out.bodyLen = body.length;

    // 关键文案出现次数
    var kws = ['登录','注册','我的','简历','消息','退出','投递','继续聊','聊一聊','登录/注册','立即登录','扫码登录','我要找工作','我要招聘'];
    out.keywords = {};
    kws.forEach(function(k){
      var n = 0, idx = 0;
      while ((idx = body.indexOf(k, idx)) >= 0) { n++; idx += k.length; }
      out.keywords[k] = n;
    });

    // 候选元素: 选择器 -> 数量 + 前几个的文本/类名
    var sels = {
      'login_class': '[class*="login"]',
      'user_class': '[class*="user"]',
      'avatar_class': '[class*="avatar"]',
      'header_class': '[class*="header"]',
      'nav_class': '[class*="nav"]',
      'resume_class': '[class*="resume"]',
      'login_href': 'a[href*="login"], a[href*="Login"]',
      'logout': '[class*="logout"], a[href*="logout"]',
      'job_card_ln': 'a[data-nick="job-detail-job-info"]',
      'job_card_boss': 'div.job-card-wrap',
      'chat_btn': 'button'
    };
    out.selectors = {};
    Object.keys(sels).forEach(function(k){
      var els;
      try { els = document.querySelectorAll(sels[k]); } catch(e) { out.selectors[k] = 'err'; return; }
      var samples = [];
      for (var i = 0; i < Math.min(els.length, 5); i++) {
        var t = (els[i].innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 45);
        samples.push(t || ('<' + (els[i].tagName || '') + '>'));
      }
      out.selectors[k] = { count: els.length, samples: samples };
    });

    // 顶部导航区文本 (登录态差异通常在这里)
    var hdr = document.querySelector('header, [class*="header"], [class*="nav-bar"], [class*="navbar"]');
    out.headerText = hdr ? (hdr.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300) : '(无 header 元素)';

    // Cookie 里是否有登录态标记 (只看名字, 不看值)
    out.cookieNames = (document.cookie || '').split(';').map(function(c){ return c.split('=')[0].trim(); }).filter(Boolean).slice(0, 40);

    return out;
  })()`);

  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch(function (e) {
  console.error('ERR:', e.message);
  process.exit(1);
});

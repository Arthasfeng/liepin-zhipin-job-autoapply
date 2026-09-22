/**
 * 登录态检测 - 准确性验证
 * 对 4 个已知状态的页面跑检测逻辑, 验证判定是否正确
 * 用法: node tools/test-login-detect.js
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));

// 与 index.js _diagnoseLogin 内联的检测逻辑保持一致 (从 index.js 复制)
const DETECT_JS = `(function(){
  var u = location.href || '';
  var body = (document.body && document.body.innerText) || '';
  var head = body.slice(0, 4000);
  var cookies = document.cookie || '';

  if (/\\/login|\\/passport|signin|sign-in/i.test(u)) {
    return { state: 'logged_out', why: 'URL 跳转到登录页: ' + u.slice(0, 90), strong: true };
  }

  var inSig = [];
  if (/liepin_login_valid|(^|;)\\s*user_name=|user_photo=/.test(cookies)) inSig.push('cookie(liepin_login_valid/user_name)');
  if (/退出登录|退出帐号|注销登录/.test(head)) inSig.push('文案(退出登录)');
  if (/你好[，,]\\s*\\S{1,12}/.test(head)) inSig.push('文案(你好，XX)');
  var hasLogoutEl = false;
  try { hasLogoutEl = document.querySelectorAll('[class*="logout"], a[href*="logout"], [class*="log-out"]').length > 0; } catch(e) {}
  if (hasLogoutEl) inSig.push('元素(退出登录)');
  var hasMsgNav = /消息/.test(head) && /简历/.test(head) && !/添加求职期望/.test(head);

  var outSig = [];
  if (/登录\\/注册|立即登录|扫码登录|密码登录|手机号登录|验证码登录/.test(head)) outSig.push('文案(登录/注册)');

  if (inSig.length && !outSig.length) return { state: 'logged_in', why: inSig.join(' + '), strong: true };
  if (outSig.length && !inSig.length) return { state: 'logged_out', why: outSig.join(' + '), strong: true };
  if (inSig.length && outSig.length) return { state: 'uncertain', why: '冲突', strong: false };
  return { state: 'unknown', why: '无明确特征', strong: false };
})()`;

const ALL_CASES = {
  9222: { expect: 'logged_in',  desc: '猎聘A 已登录' },
  9223: { expect: 'logged_in',  desc: 'BossA 已登录' },
  9225: { expect: 'logged_in',  desc: 'BossB 已登录' },
  9226: { expect: 'logged_out', desc: '猎聘 未登录(全新profile)' },
  9227: { expect: 'logged_out', desc: 'Boss 未登录(全新profile)' },
};

// 用法: node tools/test-login-detect.js [9222,9226,...]  缺省=全部
const argPorts = (process.argv[2] || '').split(',').map(s => parseInt(s, 10)).filter(Boolean);
const CASES = (argPorts.length ? argPorts : Object.keys(ALL_CASES).map(Number))
  .filter(p => ALL_CASES[p])
  .map(p => ({ port: p, ...ALL_CASES[p] }));

(async function () {
  let pass = 0, fail = 0;
  for (const c of CASES) {
    try {
      const eng = new ChromeEngine({
        remoteDebugPort: c.port,
        chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      });
      await eng.connect();
      const r = await Promise.race([
        eng.evaluate(DETECT_JS),
        new Promise((_, rj) => setTimeout(() => rj(new Error('evaluate timeout 20s')), 20000)),
      ]);
      const ok = r && r.state === c.expect;
      console.log(`${ok ? '✅' : '❌'} port ${c.port} [${c.desc}]`);
      console.log(`     期望: ${c.expect}   实际: ${(r && r.state) || 'no-result'}`);
      console.log(`     依据: ${(r && r.why) || '-'}`);
      ok ? pass++ : fail++;
      try { eng.kill && eng.kill(); } catch (e) {}
    } catch (e) {
      console.log(`⚠️  port ${c.port} [${c.desc}] 连接失败: ${e.message}`);
      fail++;
    }
  }
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(0);
})();

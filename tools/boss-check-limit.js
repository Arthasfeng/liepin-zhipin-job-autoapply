/**
 * 诊断 9230 全 disabled 的真实原因: CDP 点 disabled 按钮看反应 + 抓账号限制提示
 * 用法: node tools/boss-check-limit.js [port]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();
  const ev = async (js) => {
    try { return await Promise.race([eng.evaluate(js), new Promise((_, rj) => setTimeout(() => rj(new Error('t')), 15000))]); }
    catch (e) { return null; }
  };

  // 1. 当前详情面板按钮状态
  const btnState = await ev('(function(){var b=document.querySelector("a.op-btn-chat");if(!b)return null;var r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,text:(b.innerText||"").trim(),disabled:b.classList.contains("is-disabled")}})()');
  console.log('当前按钮:', JSON.stringify(btnState));

  // 2. baseline 文本 (用于对比点击后的变化)
  const base = await ev('(document.body&&document.body.innerText)||""');
  const baseSet = new Set((base || '').split('\n').map(s => s.trim()).filter(s => s.length > 1));

  // 3. CDP 真实点击 disabled 按钮
  if (btnState) {
    await eng.mouseMove(btnState.x, btnState.y);
    await sleep(200);
    await eng.mouseClick(btnState.x, btnState.y);
    await sleep(2500);
  }

  // 4. 点击后新出现的文本 (toast/弹窗/提示)
  const after = await ev('(document.body&&document.body.innerText)||""');
  const afterSet = new Set((after || '').split('\n').map(s => s.trim()).filter(s => s.length > 1));
  const diff = [];
  afterSet.forEach(s => { if (!baseSet.has(s)) diff.push(s); });
  console.log('\n点击后新增文本 (前30条):');
  diff.slice(0, 30).forEach(s => console.log('  + ' + s.slice(0, 80)));

  // 5. 账号限制关键词扫描
  const kws = ['完善', '认证', '实名', '沟通次数', '上限', '已用完', '解锁', '机会', '今日', '每天', '简历', '打招呼次数', '无法', '暂不可', '受限', '封禁', '异常', '风控'];
  const hits = [];
  kws.forEach(k => { if ((after || '').indexOf(k) >= 0) hits.push(k); });
  console.log('\n限制相关关键词命中:', hits.length ? hits.join(', ') : '(无)');

  // 6. 头部账号状态区 (看是否有沟通次数/会员提示)
  const header = await ev('(function(){var h=document.querySelector(".job-detail-op, [class*=account], [class*=user-info], [class*=header]");return h?h.innerText.replace(/\\s+/g," ").trim().slice(0,200):null})()');
  console.log('\n头部状态区:', header || '(未找到)');

  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

/**
 * 决定性验证: 搜一个全新职位, 看按钮是 enabled 还是 disabled
 * - 若 enabled → is-disabled = "已沟通过" (推荐流职位都投过/不匹配了)
 * - 若 disabled → 账号级限制 (新账号/简历不完整/风控)
 * 用法: node tools/boss-check-fresh.js [port] [关键词]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);
const kw = process.argv[3] || '运营总监';

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

  // 1. 当前 URL
  const curUrl = await ev('location.href');
  console.log('当前 URL:', curUrl);

  // 2. 导航到全新搜索词
  const url = 'https://www.zhipin.com/web/geek/job?query=' + encodeURIComponent(kw) + '&city=101210100';
  console.log('导航到:', url);
  await eng.evaluate('location.href=' + JSON.stringify(url));
  await sleep(4500);

  // 3. 第一张卡片标题 + 点开
  const cardInfo = await ev('(function(){var c=document.querySelector("div.job-card-wrap");if(!c)return null;var l=c.querySelector("a.job-name");var r=c.getBoundingClientRect();return{x:r.x+r.width*0.4,y:r.y+30,title:l?l.textContent.replace(/\\s+/g," ").trim().slice(0,30):"?"}})()');
  console.log('第一张卡片:', cardInfo ? cardInfo.title : '(无卡片)');
  if (cardInfo) {
    await eng.mouseMove(cardInfo.x, cardInfo.y);
    await sleep(300);
    await eng.mouseClick(cardInfo.x, cardInfo.y);
    await sleep(2500);
  }

  // 4. 按钮状态 (关键)
  const btn = await ev('(function(){var b=document.querySelector("a.op-btn-chat");if(!b)return null;var r=b.getBoundingClientRect();return{text:(b.innerText||"").trim(),cls:(b.className||"").toString(),disabled:b.classList.contains("is-disabled"),visible:r.width>0&&r.height>0}})()');
  console.log('\n===== 关键结果 =====');
  console.log('按钮状态:', JSON.stringify(btn));
  console.log(btn ? (btn.disabled ? '→ DISABLED (账号级限制或已投过)' : '→ ENABLED (可投, is-disabled确实=已沟通过)') : '→ 无按钮');

  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

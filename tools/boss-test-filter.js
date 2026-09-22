/**
 * 验证 getCardStatuses 黑名单筛选 (真实调用 BossFlow.getCardStatuses)
 * 用法: node tools/boss-test-filter.js [port]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const BossFlow = require(path.join(__dirname, '..', 'platforms', 'boss'));

const port = parseInt(process.argv[2] || '9230', 10);

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();

  // 测试账号: 无 jobTitle 白名单 (只测黑名单)
  const acct = { name: 'test', id: 'test', keywords: {} };
  const flow = new BossFlow(eng, acct);

  const statuses = await flow.getCardStatuses();

  // 同时抓卡片标题用于对照
  const titles = await eng.evaluate('(function(){var c=document.querySelectorAll("div.job-card-wrap");var r=[];for(var i=0;i<c.length;i++){var l=c[i].querySelector("a.job-name");r.push(l?l.textContent.replace(/\\s+/g," ").trim().slice(0,24):"?");}return r})()');

  console.log(`卡片总数: ${statuses.length}\n`);
  const dist = {};
  statuses.forEach((s, i) => {
    dist[s] = (dist[s] || 0) + 1;
    console.log(`#${i} [${s}] "${titles[i]}"`);
  });
  console.log(`\n===== 状态分布 =====`);
  Object.keys(dist).forEach(k => console.log(`  ${k}: ${dist[k]}`));
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

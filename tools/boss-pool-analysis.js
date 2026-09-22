/**
 * 推荐流职位池规模 + 关键词匹配度分析
 * 回答: ① 推荐流能产出多少不重复职位 ② 与目标关键词的匹配度
 * 用法: node tools/boss-pool-analysis.js [port] [switchRounds]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = parseInt(process.argv[2] || '9230', 10);
const ROUNDS = parseInt(process.argv[3] || '6', 10);

// 目标关键词: 管理类岗位(用户账号定位)
const MGMT = /总监|总经理|经理|主管|负责人|总裁|COO|CEO|CFO|CTO|VP|副总|店长|院长|校长|主任|合伙人/;
const CS = /客服|客户服务|售后/;

const COLLECT = `(function(){
  var cards = document.querySelectorAll('div.job-card-wrap');
  var l = [];
  for (var i=0;i<cards.length;i++){
    var n=cards[i].querySelector('a.job-name,.job-name,.job-title');
    var co=cards[i].querySelector('.boss-info,.company-name');
    var sal=cards[i].querySelector('.salary,.job-salary,[class*="salary"]');
    l.push({
      job: (n?(n.innerText||''):'').replace(/\\s+/g,' ').trim().slice(0,40),
      company: (co?(co.innerText||''):'').replace(/\\s+/g,' ').trim().slice(0,24),
      salary: (sal?(sal.innerText||''):'').trim().slice(0,18)
    });
  }
  return { n: cards.length, list: l, docH: document.body.scrollHeight };
})()`;

async function scrollToBottom(eng) {
  await eng.evaluate(`(function(){ window.scrollTo(0, document.body.scrollHeight); window.dispatchEvent(new Event('scroll',{bubbles:true})); return window.scrollY; })()`).catch(()=>null);
}

async function realClickSel(eng, sel) {
  const pos = await eng.evaluate(`(function(){
    var el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null;
    el.scrollIntoView({block:'center'});
    var rc=el.getBoundingClientRect(); return {x:rc.x+rc.width/2,y:rc.y+rc.height/2};
  })()`).catch(()=>null);
  if (!pos) return false;
  await sleep(500);
  const p2 = await eng.evaluate(`(function(){var el=document.querySelector(${JSON.stringify(sel)});var rc=el.getBoundingClientRect();return {x:rc.x+rc.width/2,y:rc.y+rc.height/2};})()`).catch(()=>pos);
  await eng.cmd('Input.dispatchMouseEvent', { type:'mouseMoved', x:Math.round(p2.x), y:Math.round(p2.y), button:'none' });
  await sleep(90);
  await eng.cmd('Input.dispatchMouseEvent', { type:'mousePressed', x:Math.round(p2.x), y:Math.round(p2.y), button:'left', clickCount:1 });
  await sleep(50);
  await eng.cmd('Input.dispatchMouseEvent', { type:'mouseReleased', x:Math.round(p2.x), y:Math.round(p2.y), button:'left', clickCount:1 });
  return true;
}

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();
  const ev = async (js) => {
    try { return await Promise.race([eng.evaluate(js), new Promise((_, rj) => setTimeout(() => rj(new Error('t')), 20000))]); }
    catch (e) { return null; }
  };

  const seen = new Map(); // job+company -> info
  const addAll = (snap) => {
    if (!snap) return 0;
    let before = seen.size;
    snap.list.forEach(x => { if (x.job) seen.set(x.job + '@' + x.company, x); });
    return seen.size - before;
  };

  console.log('=== 阶段1: 推荐 tab 滚动加载 ===');
  let s = await ev(COLLECT);
  addAll(s);
  console.log(`  初始 ${s.n} 张, 池 ${seen.size}`);
  for (let r = 1; r <= 4; r++) {
    await scrollToBottom(eng);
    await sleep(5500);
    s = await ev(COLLECT);
    const add = addAll(s);
    console.log(`  滚动 ${r}: ${s.n} 张 | 新增 ${add} | 池 ${seen.size} | docH ${s.docH}`);
    if (add === 0 && r >= 2) break;
  }

  console.log('\n=== 阶段2: 切换到搜索词 tab 再切回推荐 (多轮) ===');
  for (let r = 1; r <= ROUNDS; r++) {
    await realClickSel(eng, '.expect-item');
    await sleep(5500);
    const a = await ev(COLLECT);
    const addA = addAll(a);
    await realClickSel(eng, '.synthesis');
    await sleep(5500);
    const b = await ev(COLLECT);
    const addB = addAll(b);
    console.log(`  第 ${r} 轮: 搜索词tab 新增 ${addA} (${a? a.n:'?'}张) | 推荐tab 新增 ${addB} (${b? b.n:'?'}张) | 池 ${seen.size}`);
    // 推荐 tab 下再滚动一轮
    await scrollToBottom(eng);
    await sleep(5500);
    const c = await ev(COLLECT);
    const addC = addAll(c);
    if (addC) console.log(`     + 推荐滚动新增 ${addC} | 池 ${seen.size}`);
  }

  console.log(`\n===== 池子分析 (共 ${seen.size} 个唯一职位) =====`);
  const all = Array.from(seen.values());
  const mgmt = all.filter(x => MGMT.test(x.job));
  const cs = all.filter(x => CS.test(x.job));
  const mgmtOrCs = all.filter(x => MGMT.test(x.job) || CS.test(x.job));
  const irrelevant = all.filter(x => !MGMT.test(x.job) && !CS.test(x.job));

  console.log(`  含管理类词(总监/经理/主管/负责人...): ${mgmt.length} (${Math.round(mgmt.length/all.length*100)}%)`);
  console.log(`  含"客服": ${cs.length}`);
  console.log(`  管理类 OR 客服: ${mgmtOrCs.length} (${Math.round(mgmtOrCs.length/all.length*100)}%)`);
  console.log(`  与管理/客服无关: ${irrelevant.length} (${Math.round(irrelevant.length/all.length*100)}%)`);

  console.log(`\n  --- 管理类样例 (前 12) ---`);
  mgmt.slice(0, 12).forEach(x => console.log(`    · ${x.job}  [${x.salary}] @ ${x.company}`));
  console.log(`\n  --- 无关样例 (前 8) ---`);
  irrelevant.slice(0, 8).forEach(x => console.log(`    · ${x.job}  [${x.salary}] @ ${x.company}`));

  console.log(`\n  --- 全部职位名 (供你判断) ---`);
  all.forEach((x, i) => console.log(`    ${String(i+1).padStart(3)}. ${x.job}`));

  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

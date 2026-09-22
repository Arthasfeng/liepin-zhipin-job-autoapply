/**
 * Boss 卡片结构 + 按钮状态探测
 * 目的: 找出每张卡片的"可投/已沟通"状态标识
 * 用法: node tools/boss-card-buttons.js [port]
 */
const path = require('path');
const ChromeEngine = require(path.join(__dirname, '..', 'engine', 'chrome'));

const port = parseInt(process.argv[2] || '9230', 10);

const JS = `(function(){
  var cards = document.querySelectorAll('div.job-card-wrap');
  var out = { total: cards.length, samples: [], allBtnTexts: {}, chatWords: {} };

  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];

    // 卡片内所有可点击元素的文本
    var btns = [];
    var els = c.querySelectorAll('a, button, span, div');
    for (var j = 0; j < els.length; j++) {
      var t = (els[j].innerText || '').replace(/\\s+/g, ' ').trim();
      if (!t || t.length > 12) continue;
      if (els[j].children.length > 1) continue;
      if (/(聊|投递|沟通|立即|继续|打招呼|发送)/.test(t)) {
        var cls = (els[j].className || '').toString();
        btns.push({ t: t, cls: cls.slice(0, 60) });
        out.chatWords[t] = (out.chatWords[t] || 0) + 1;
      }
    }

    // 卡片内所有 class 含 btn/chat/op 的元素
    var opEls = c.querySelectorAll('[class*="op-btn"], [class*="chat"], [class*="btn"]');
    var opList = [];
    for (var k = 0; k < opEls.length && k < 6; k++) {
      var ocls = (opEls[k].className || '').toString();
      out.allBtnTexts[ocls.slice(0, 55)] = (out.allBtnTexts[ocls.slice(0, 55)] || 0) + 1;
      opList.push(ocls.slice(0, 55) + ' :: ' + (opEls[k].innerText||'').replace(/\\s+/g,' ').trim().slice(0, 14));
    }

    if (i < 6) {
      var nm = c.querySelector('a.job-name, .job-name, .job-title');
      var sal = c.querySelector('.salary, .job-salary, [class*="salary"]');
      var co = c.querySelector('.boss-info, .company-name');
      out.samples.push({
        idx: i,
        job: nm ? (nm.innerText||'').replace(/\\s+/g,' ').trim().slice(0,30) : '?',
        salary: sal ? (sal.innerText||'').trim().slice(0,20) : '?',
        company: co ? (co.innerText||'').replace(/\\s+/g,' ').trim().slice(0,20) : '?',
        btnMatches: btns.slice(0, 5),
        opEls: opList.slice(0, 4)
      });
    }
  }
  return out;
})()`;

(async function () {
  const eng = new ChromeEngine({
    remoteDebugPort: port,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  await eng.connect();
  const r = await Promise.race([
    eng.evaluate(JS),
    new Promise((_, rj) => setTimeout(() => rj(new Error('timeout 25s')), 25000)),
  ]);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch(function (e) { console.error('ERR:', e.message); process.exit(1); });

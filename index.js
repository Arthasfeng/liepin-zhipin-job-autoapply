const ChromeEngine = require('./engine/chrome');
const LiepinFlow = require('./platforms/liepin');
const BossFlow = require('./platforms/boss');
const { CHROME_CONFIG, loadAccounts } = require('./config/accounts');
const fs = require('fs');

function log(m) { console.log('['+new Date().toLocaleTimeString()+'] '+m); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 状态报告 — 每个 Runner 定期写入
var STATUS_FILE = '/tmp/auto-apply-status.json';
function reportStatus(acct, data) {
  try {
    var all = {};
    try { all = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch(e) {}
    all[acct.id] = Object.assign({ name: acct.name, platform: acct.platform, time: Date.now() }, data);
    fs.writeFileSync(STATUS_FILE, JSON.stringify(all, null, 2));
  } catch(e) {}
}

// 断点续传 — 保存/恢复进度
var STATE_DIR = '/tmp/auto-apply-state';
try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch(e) {}

function statePath(acctId) { return STATE_DIR + '/' + acctId + '.json'; }

function saveRunState(acct, data) {
  try {
    fs.writeFileSync(statePath(acct.id), JSON.stringify(Object.assign({ updated: Date.now() }, data)));
  } catch(e) {}
}

function loadRunState(acctId) {
  try {
    var raw = fs.readFileSync(statePath(acctId), 'utf8');
    var data = JSON.parse(raw);
    // 状态超过24小时就过期，从头开始
    if (Date.now() - (data.updated || 0) > 24 * 60 * 60 * 1000) return null;
    return data;
  } catch(e) { return null; }
}

function clearRunState(acctId) {
  try { fs.unlinkSync(statePath(acctId)); } catch(e) {}
}

class Runner {
  constructor(acct, engine) {
    this.acct = acct;
    this.engine = engine;
    this.config = require('./config/defaults');
    this.flow = null;
    this.running = true;
    this._kw = '';
    // 健康时钟
    this._resultClock = 0;
    this._pageClock = 0;
    this._programClock = 0;
    this._lastProgress = Date.now();
    this._lastModeSwitch = Date.now();
    this._modeIndex = 0;
    this._frozen = false;
    this._scrollFailCount = 0;

    // 断点续传
    var saved = loadRunState(acct.id);
    if (saved) {
      if (saved.paused) {
        console.log('['+acct.name+'] 上次因"'+saved.reason+'"已暂停，跳过本次执行');
        this._frozen = true;
        this._processedIds = new Set(saved.processedIds || []);
      } else {
        this._kw = saved.kw || '';
        this._modeIndex = saved.modeIndex || 0;
        this._resumeKw = saved.kw || '';
        this._resumeModeIndex = saved.modeIndex || 0;
        this._resumeCardIndex = saved.cardIndex || 0;
        this._resumePage = saved.page || 1;
        this._processedIds = new Set(saved.processedIds || []);
        console.log('['+acct.name+'] 发现上次运行状态，从中断处恢复 (关键词:'+this._resumeKw+')');
      }
    } else {
      this._resumeKw = null;
      this._processedIds = new Set();
    }

    reportStatus(this.acct, { status: 'idle', stats: this.flow ? this.flow.stats : {} });
  }

  /** 保存当前运行状态（断点续传）*/
  _saveState(extra) {
    saveRunState(this.acct, Object.assign({
      kw: this._kw,
      modeIndex: this._modeIndex,
      cardIndex: this._cardIndex || 0,
      page: this._page || 1,
      processedIds: Array.from(this._processedIds || []),
    }, extra || {}));
  }

  /** 搜索 URL 生成 */
  _searchUrl(keyword) {
    var b = this.acct.platform !== 'liepin'
      ? 'https://www.zhipin.com/web/geek/job?query='
      : 'https://www.liepin.com/zhaopin/?key='
    return b + encodeURIComponent(keyword);
  }

  /** 缓存清理 — 导航到当前页 URL（不 location.reload，避免结果重排） */
  async _restartChrome(keepPage) {
    log('['+this.acct.name+'] 刷新缓存...');
    // 导航到当前搜索页（带 page 参数），不刷新，避免结果重排
    var url = this._searchUrl(this._kw) + '&curPage=' + keepPage;
    await this.engine.evaluate('location.href="' + url + '"');
    await sleep(4000);
    // 等卡片加载
    for (var w = 0; w < 10; w++) {
      var n = await this.flow.getCards();
      if (n > 0) break;
      await sleep(1000);
    }
    log('['+this.acct.name+'] 刷新完毕');
  }

  async run() {
    const a = this.acct;
    const kw = (a.keywords?.search || [])[0];
    if (!kw) { log('['+a.name+'] 无关键词'); return; }

    log('['+a.name+'] 导航到搜索页...');
    await this.engine.navigate(this._searchUrl(kw));
    // 设置窗口标题用于识别
    await this.engine.evaluate('document.title="['+a.name+'] 自动投递 - '+a.platform+'"').catch(function(){});

    // 等登录 + 等页面加载
    const deadline = Date.now() + 480000;
    let notified = false;
    while (Date.now() < deadline) {
      await this.engine.evaluate(
        'document.querySelectorAll(\'[class*="popup"],[class*="modal"],[class*="mask"]\')'+
        '.forEach(function(e){if(!e.offsetWidth)return;'+
        'var c=e.querySelector(\'[class*="close"],[aria-label*="关闭"],button\');'+
        'if(c&&c.offsetWidth)c.click();})'
      ).catch(()=>{});
      await this.engine.cmd('Input.dispatchKeyEvent',
        {type:'keyDown',key:'Escape',windowsVirtualKeyCode:27}).catch(()=>{});

      // 平台特定的卡片选择器
      var cardSel = this.acct.platform === 'boss'
        ? 'div.job-card-wrap'
        : 'a[data-nick=\\"job-detail-job-info\\"]';

      const info = await this.engine.evaluate(
        '({u:location.href.slice(0,150),l:/login|passport|auth/.test(location.href),'+
        'c:document.querySelectorAll("'+cardSel+'").length,'+
        't:document.title,b:((document.body&&document.body.innerHTML)||"").length})'
      ).catch(()=>({}));

      if (info && info.c > 0) {
        log('['+a.name+'] 已登录'); break;
      }
      if (info && info.b > 5000 && (info.u.indexOf('zhaopin') > 0 || info.u.indexOf('zhipin') > 0)) {
        for (var w = 0; w < 30; w++) {
          await sleep(1000);
          var ck = await this.engine.evaluate('document.querySelectorAll("'+cardSel+'").length');
          if (ck > 0) { log('['+a.name+'] 已登录'); break; }
        }
        break;
      }
      if (info && info.u.indexOf('wow') >= 0 && !notified) {
        log('['+a.name+'] 正在加载猎聘... (当前: '+info.u.slice(0,60)+')');
        notified = true;
      }
      if (info && info.l && !notified) {
        log('['+a.name+'] 请扫码登录');
        notified = true;
      }
      await sleep(1500);
    }

    var finalCards = await this.engine.evaluate(
      'document.querySelectorAll("'+cardSel+'").length'
    ).catch(()=>0);
    if (!finalCards) {
      log('['+a.name+'] 仍未加载卡片，尝试导航到搜索页...');
      var id = ++this.engine._mid;
      this.engine.ws.send(JSON.stringify({ id: id, method: 'Page.navigate', params: { url: this._searchUrl(a.keywords.search[0]) } }));
      for (var w = 0; w < 30; w++) {
        await sleep(2000);
        var ck = await this.engine.evaluate('document.querySelectorAll("'+cardSel+'").length').catch(()=>0);
        if (ck > 0) break;
      }
    }

    this.flow = new (a.platform === 'liepin' ? LiepinFlow : BossFlow)(this.engine, this.acct);

    if (this.acct.platform === 'boss') {
      // Boss直聘：_runBossPages 内完整管理所有模式循环
      this._kw = a.keywords.search[0] || '';
      if (this._resumeKw) {
        this._kw = this._resumeKw;
        this._modeIndex = this._resumeModeIndex || 0;
      }
      await this._runBossPages(a.greeting);
    } else {
      // 猎聘：遍历所有关键词（如有断点，跳过已完成的）
      var resumeFound = !this._resumeKw;
      for (const k of a.keywords.search) {
        if (!this.running) break;
        if (!resumeFound) {
          if (k === this._resumeKw) resumeFound = true;
          else { log('['+a.name+'] 跳过已处理的关键词: '+k); continue; }
        }
        log('['+a.name+'] 关键词: '+k);
        this._kw = k;
        if (k !== a.keywords.search[0]) {
          await this.engine.navigate(this._searchUrl(k));
          await this.engine.sleep(1200);
          await this.engine.evaluate('document.title="['+a.name+'] 自动投递 - '+k+'"').catch(function(){});
        }
        await this._runPages(a.greeting);
      }
    }
    clearRunState(this.acct.id); // 全部完成，清除断点
    log('['+a.name+'] 完成');
  }

  /** Boss直聘 — 无限滚动投递 + 健康值守 */
  async _runBossPages(greeting) {
    var kwStats = { success:0, fail:0, skip:0 };
    var kwStartTime = Date.now();
    var af = this.config.antiFraud;

    // 模式列表：所有关键词 + 求职期望 + 推荐（可循环）
    var modes = [];
    (this.acct.keywords.search || []).forEach(function(k){ modes.push({type:'keyword', value:k}); });
    var expectTags = await this.flow.getExpectTags();
    expectTags.forEach(function(t){ modes.push({type:'expect', value:t}); });
    modes.push({type:'recommend', value:''});

    this._resetClocks();

    while (this.running && !this._frozen) {
      // ===== 健康检查 =====
      var now = Date.now();
      var resultIdle = now - this._lastProgress;
      var pageIdle = now - this._lastModeSwitch;
      var programIdle = now - this._lastProgress;

      if (resultIdle > 3 * 60 * 1000) {
        // 结果健康超时（3分钟没成功打过招呼）→ 切到下一模式循环
        log('['+this.acct.name+'] 结果健康超时，切换搜索模式');
        this._modeIndex = (this._modeIndex + 1) % modes.length;
        await this._switchBossMode(modes[this._modeIndex]);
        this._lastProgress = Date.now();
        this._lastModeSwitch = Date.now();
        this._resultClock = 0;
        this._pageClock = 0;
        reportStatus(this.acct, { status: 'switching', mode: this._modeIndex, stats: this.flow ? this.flow.stats : {} });
        continue;
      }

      if (pageIdle > 5 * 60 * 1000) {
        // 页面健康超时（5分钟页面无操作）
        log('['+this.acct.name+'] 5分钟页面无操作');
        this._modeIndex = (this._modeIndex + 1) % modes.length;
        await this._switchBossMode(modes[this._modeIndex]);
        this._lastModeSwitch = Date.now();
        this._resultClock = 0;
        this._pageClock = 0;
        continue;
      }

      if (programIdle > 15 * 60 * 1000) {
        // 程序健康超时（15分钟完全无进度）
        log('['+this.acct.name+'] 15分钟无任何进度，冻结，等下周期');
        this._frozen = true;
        reportStatus(this.acct, { status: 'frozen', stats: this.flow ? this.flow.stats : {}, kwStats: kwStats });
        break;
      }

      // ===== 正常投递流程 =====
      // 先关闭可能存在的弹窗
      await this.flow.closePopups();

      // 检测当前可见卡片（不滚动）
      var statuses = await this.flow.getCardStatuses();
      var totalCards = statuses.length;
      var hasWork = false;

      // 处理可见的卡片
      for (var i = 0; i < totalCards && this.running; i++) {
        if (statuses[i] === 'skip_title') { process.stdout.write('\u23ed'); kwStats.skip++; continue; }
        if (statuses[i] === 'skip') continue;
        if (statuses[i] !== 'chat' && statuses[i] !== 'new') continue;

        hasWork = true;
        process.stdout.write('['+(i+1)+'/'+totalCards+'] ');
        var r = await this.flow.applyOne(i, greeting);

        if (r.status === 'success') {
          process.stdout.write('\u2705'); kwStats.success++;
          this._resetClocks();
          this._saveState({ stats: kwStats });
        } else if (r.status === 'skip') {
          process.stdout.write('\u23ed'); kwStats.skip++;
        } else if (r.status === 'paused') {
          process.stdout.write('\u274c'); kwStats.fail++;
          log(''); log('['+this.acct.name+'] ⏸ '+r.reason+'，冻结此账号');
          this._frozen = true;
          this._saveState({ stats: kwStats, paused: true, reason: r.reason });
          break;
        } else {
          process.stdout.write('\u274c'); kwStats.fail++;
          if (++this.flow._consecutiveFail >= af.pauseThreshold) {
            log(''); log('⚠ 连续失败，暂停'+af.pauseDuration/1000+'秒');
            await sleep(af.pauseDuration);
            this.flow._consecutiveFail = 0;
          }
        }
        if (r.reason) process.stdout.write('['+r.reason+']');
        await sleep(af.minCardGap);
      }

      if (!hasWork) {
        // 当前无可打招呼卡片 → 滚动加载更多
        var n = await this.flow.scrollToLoad();
        if (n === 0) {
          this._scrollFailCount++;
          if (this._scrollFailCount >= 10) {
            // 连续10次滚动无新卡 → 到底了，直接切模式
            log('['+this.acct.name+'] 滚动10次无新卡片，切换搜索模式');
            this._modeIndex = (this._modeIndex + 1) % modes.length;
            await this._switchBossMode(modes[this._modeIndex]);
            this._scrollFailCount = 0;
          } else {
            await sleep(3000);
          }
        } else {
          this._scrollFailCount = 0; // 有新卡片，重置计数
        }
      } else {
        // 有处理过的卡片但当前页已处理完 → 滚动加载更多
        await this.flow.scrollToLoad();
        this._scrollFailCount = 0;
      }
      // 定期状态报告
      reportStatus(this.acct, { status: 'running', kw: this._kw, mode: this._modeIndex,
        stats: this.flow ? this.flow.stats : {}, kwStats: kwStats, frozen: this._frozen });
    }

    var elapsed = Math.round((Date.now()-kwStartTime)/1000);
    log(''); log('\u2550\u2550\u2550'+this._kw+'\u2550\u2550\u2550');
    log('  \u2705成功:'+kwStats.success+' | \u274c失败:'+kwStats.fail+' | \u23ed跳过:'+kwStats.skip);
    log('  \u23f1耗时: '+elapsed+'秒');
    if (this._frozen) log('  \u274c已冻结，等待下个周期恢复');
    log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  }

  /** 健康时钟重置 */
  _resetClocks() {
    this._lastProgress = Date.now();
    this._lastModeSwitch = Date.now();
    this._resultClock = 0;
    this._pageClock = 0;
    this._programClock = 0;
    this._scrollFailCount = 0;
  }

  /** 切换 Boss 搜索模式 */
  async _switchBossMode(mode) {
    if (mode.type === 'keyword') {
      var url = this._searchUrl(mode.value);
      await this.engine.evaluate('location.href="'+url+'"');
      await sleep(3000);
      await this.engine.evaluate('document.title="['+this.acct.name+'] 自动投递 - '+mode.value+'"').catch(function(){});
      log('['+this.acct.name+'] 切换到关键词: '+mode.value);
    } else if (mode.type === 'expect') {
      await this.flow.switchExpectTag(mode.value);
      await this.engine.evaluate('document.title="['+this.acct.name+'] 自动投递 - 期望:'+mode.value+'"').catch(function(){});
      log('['+this.acct.name+'] 切换到求职期望: '+mode.value);
    } else if (mode.type === 'recommend') {
      await this.engine.evaluate('location.href="https://www.zhipin.com/web/geek/job?recommend=1"');
      await sleep(3000);
      await this.engine.evaluate('document.title="['+this.acct.name+'] 自动投递 - 推荐"').catch(function(){});
      log('['+this.acct.name+'] 切换到推荐');
    }
    this._lastModeSwitch = Date.now();
  }

  /** _runPages — 翻页投递逻辑（猎聘用）
   * 功能：
   *  - 逐卡投递，每卡前做"继续聊"去重检测
   *  - 每处理15张卡重启 Chrome 释放缓存
   *  - 翻页用 goToPage（SPA 不刷新）
   *  - 最后一页检测 → 跳出循环换关键词
   *  - 弹窗广告自动关闭
   */
  async _runPages(greeting) {
    var page = 1;
    var lastPageReached = false;
    var pageStartTime = Date.now();
    var kwStartTime = Date.now();
    var kwStats = { success:0, fail:0, skip:0, partial:0 };
    var self = this;
    var af = this.config.antiFraud;

    while (this.running && !lastPageReached) {
      log('['+this.acct.name+'] 第'+page+'页 | '+this._kw);
      
      await this.flow.scrollToLoad();
      var statuses = await this.flow.getCardStatuses();
      var n = statuses.length;
      if (n === 0) {
        log('['+this.acct.name+'] 无卡片，切换关键词');
        lastPageReached = true; break;
      }
      log('['+this.acct.name+'] 卡片: '+n+' 张');

      for (var i = 0; i < n && this.running; i++) {
        // 快速跳过
        if (statuses[i] === 'skip' || statuses[i] === 'skip_title') {
          process.stdout.write('\u23ed');
          kwStats.skip++;
          continue;
        }

        // 实时状态输出
        process.stdout.write('['+(i+1)+'/'+n+'] ');

        // 投递
        var r = await this.flow.applyOne(i, greeting);
        
        if (r.status === 'success') {
          process.stdout.write('\u2705');
          kwStats.success++;
          this._saveState({ stats: kwStats, page: page });
        } else if (r.status === 'partial') {
          process.stdout.write('\u26a0\ufe0f');
          kwStats.partial++;
        } else if (r.status === 'skip') {
          process.stdout.write('\u23ed');
          kwStats.skip++;
        } else {
          process.stdout.write('\u274c');
          kwStats.fail++;
          // 连续失败 → 渐进降速
          if (++this.flow._consecutiveFail >= af.pauseThreshold) {
            console.log('');
            log('⚠ 连续'+this.flow._consecutiveFail+'次失败，暂停'+af.pauseDuration/1000+'秒');
            await sleep(af.pauseDuration);
            this.flow._consecutiveFail = 0;
          } else if (this.flow._consecutiveFail >= af.consecutiveSlowdown) {
            console.log('');
            log('⚠ 连续'+this.flow._consecutiveFail+'次失败，降速至'+af.slowedDelay+'ms');
            await sleep(af.slowedDelay);
          }
        }
        if (r.reason) process.stdout.write('['+r.reason+']');

        // 卡间最小间隔
        await sleep(af.minCardGap);
      }
      console.log('');
      log('⏱ 本页耗时 '+(Math.round((Date.now()-pageStartTime)/1000))+'秒');

      // 翻页检测 — 先滚到底确保分页组件已加载
      await this.flow.scrollToLoad();
      var pg = await this.flow.getPageInfo();
      log('['+this.acct.name+'] 分页: '+pg.curPage+'/'+pg.totalPages);
      
      // 即使检测到只有1页，也尝试翻下一页（可能检测不准）
      if (pg.curPage >= pg.totalPages && pg.totalPages <= 1) {
        log('['+this.acct.name+'] 检测到1页，尝试翻到第2页');
        var tryNext = await this.flow.goToPage(2);
        if (tryNext) {
          page = 2; pageStartTime = Date.now(); continue;
        }
        // 也尝试点"下一页"按钮
        var nextBtn = await this.flow.engine.evaluate(
          '(function(){var all=document.querySelectorAll("a,button,[role=button]");'+
          'for(var i=0;i<all.length;i++){var t=(all[i].textContent||"").trim();'+
          'if(t.indexOf("下一页")>=0||t.indexOf(">")>=0){all[i].click();return true}}return false})()'
        );
        if (nextBtn) { await sleep(3000); page = 2; pageStartTime = Date.now(); continue; }
      }
      
      if (pg.curPage >= pg.totalPages && pg.totalPages > 1) {
        log('['+this.acct.name+'] 已到最后一页');
        lastPageReached = true; break;
      }
      var next = page + 1;
      log('['+this.acct.name+'] 翻到第'+next+'页');
      var ok = await this.flow.goToPage(next);
      if (ok) { page = next; pageStartTime = Date.now(); continue; }
      log('['+this.acct.name+'] 翻页失败，尝试URL导航');
      await this.engine.navigate(this._searchUrl(this._kw) + '&curPage=' + next);
      await this.engine.evaluate('document.title="['+this.acct.name+'] 自动投递 - '+this._kw+' 第'+next+'页"').catch(function(){});
      await sleep(2000);
      page = next;
      pageStartTime = Date.now();
    }

    // 关键词完成报告
    var elapsed = Math.round((Date.now()-kwStartTime)/1000);
    log('');
    log('\u2550\u2550\u2550'+this._kw+'\u2550\u2550\u2550');
    log('  \u2705成功:'+kwStats.success+' | \u274c失败:'+kwStats.fail+' | \u23ed跳过:'+kwStats.skip+' | \u26a0\ufe0f部分:'+kwStats.partial);
    log('  \u23f1耗时: '+elapsed+'秒');
    log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  }
}

async function main() {
  // 清理所有旧 Chrome 进程（避免多窗口）
  require('child_process').execSync('pkill -f "Google Chrome.*remote-debugging" 2>/dev/null || true');
  await new Promise(function(r) { setTimeout(r, 1000); });

  // 支持 --account 参数单独运行指定账号
  var accountFilter = process.argv.indexOf('--account');
  var targetId = accountFilter >= 0 && process.argv[accountFilter + 1] ? process.argv[accountFilter + 1] : null;

  const accounts = loadAccounts().filter(function(a) {
    return a.enabled && (!targetId || a.id === targetId);
  });
  if (!accounts.length) { log(targetId ? '未找到账号: '+targetId : '无可用账号'); return; }

  log('启动 '+accounts.length+' 个账号...');

  // 并行启动所有账号，每个账号独立 Chrome 实例
  var runners = accounts.map(function(a, i) {
    return (async function() {
      var keywords = a.keywords?.search || [];
      if (keywords.length === 0 || !keywords[0]) {
        log('['+a.name+'] 无搜索关键词，跳过');
        return;
      }
      var port = 9222 + i;
      var eng = new ChromeEngine({remoteDebugPort: port, chromePath: CHROME_CONFIG.path});
      try {
        await eng.start(a.profileDir || CHROME_CONFIG.userDataDir);
        await eng.connect();
        log('['+a.name+'] Chrome 就绪 (port:'+port+')');
        await new Runner(a, eng).run().catch(function(e) {
          log('['+a.name+'] 错误: '+e.message);
        });
        log('['+a.name+'] 完成');
      } catch(e) {
        log('['+a.name+'] 启动失败: '+e.message);
      }
    })();
  });

  await Promise.all(runners);

  log('全部完成');
  // 所有 Chrome 保持打开，用户查看投递历史
  await new Promise(function() {}); // 永久等待
}

main().catch(e => { log('FATAL: '+e.message); process.exit(1); });

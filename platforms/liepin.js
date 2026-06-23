/**
 * 猎聘平台自动化流程
 *
 * 翻页逻辑（关键）：
 *  - 必须用 DOM 点击"下一页"按钮，不能用 URL 导航
 *  - URL 导航→页面刷新→结果重排→永远在第一页
 *  - 翻页后必须验证页面确实切换了（检查页码文本）
 *  - 检测到"下一页"按钮不可用/不存在 → 自动切换到下一个关键词
 *
 * Selectors 来自 WorkBuddy 的实战调试成果（liepin-apply.cjs）
 */

class LiepinFlow {
  constructor(engine, account) {
    this.engine = engine;
    this.acct = account || {};
    this.config = require('../config/defaults');
    this.stats = { success:0, fail_chat:0, fail_resume:0, fail_confirm:0, skip_chatted:0, skip_processed:0 };
    this._processedIds = new Set();
    this._consecutiveFail = 0;
    this._cardIndex = 0;
  }

  /** 带 ms 级别的 engine.sleep 简写 */
  async sleep(ms) { await this.engine.sleep(ms); }

  /** 超时包装器 */
  async withTimeout(promise, ms, label) {
    var timer = new Promise(function(r){setTimeout(function(){r({_timeout:true})},ms)});
    var result = await Promise.race([promise, timer]);
    if (result && result._timeout) return {err:'timeout', msg:label+'('+ms+'ms)'};
    return result;
  }

  /** 重试包装器 — 按配置重试 + 超时 */
  async withRetry(fn, cfg) {
    for (var i = 0; i < cfg.retries; i++) {
      var r = await fn();
      // 如果返回了值（非null/undefined/false）且没有err，认为成功
      if (r && !r.err) return r;
      if (i < cfg.retries - 1) await this.sleep(cfg.delay);
    }
    return {err:'exhausted', msg:cfg.label+'重试'+cfg.retries+'次失败'};
  }

  /** 随机延时（防止风控） */
  async randomSleep(base, variance) {
    var ms = base + Math.round(Math.random() * (variance || base));
    await this.engine.sleep(ms);
  }

  /** 操作节流：确保距上次操作至少间隔 N 毫秒 */
  async throttle(minGap) {
    minGap = minGap || this._minActionGap;
    var elapsed = Date.now() - this._lastActionTime;
    if (elapsed < minGap) {
      await this.engine.sleep(minGap - elapsed + Math.round(Math.random() * 1000));
    }
    this._lastActionTime = Date.now();
  }

  /** 搜索职位 */
  async searchJobs(keyword) {
    var url = "https://www.liepin.com/zhaopin/?key=" + encodeURIComponent(keyword);
    await this.engine.evaluate('location.href="' + url + '"');
    await this.engine.sleep(3000);
    this._currentPageUrl = url;
  }

  /** 滚动加载全部卡片（猎聘懒加载） */
  async scrollToLoad() {
    await this.engine.evaluate(
      '(function(){return new Promise(function(resolve){'+
      'var totalHeight=0;var distance=300;var timer=setInterval(function(){'+
      'var sh=document.documentElement.scrollTop;var ch=document.documentElement.scrollHeight;'+
      'window.scrollBy(0,distance);totalHeight+=distance;'+
      'if(totalHeight>=ch||sh+distance>=ch){clearInterval(timer);resolve();}'+
      '},200);})})()'
    );
    await this.engine.sleep(1500);
    // 回到顶部
    await this.engine.evaluate('window.scrollTo(0,0)');
    await this.engine.sleep(500);
  }

  /** 获取当前页职位卡片数 */
  async getCards() {
    var n = await this.engine.evaluate(
      "document.querySelectorAll('a[data-nick=\\\"job-detail-job-info\\\"]').length"
    );
    return n || 0;
  }

  /** 获取分页信息 — 兼容 Ant Design 分页 */
  async getPageInfo() {
    var info = await this.engine.evaluate(
      "(function(){var t=1,c=1;"+
      // 策略A: 搜"第X/Y页"文本
      "var all=document.querySelectorAll('*');"+
      "for(var i=0;i<all.length;i++){"+
      "var txt=(all[i].textContent||'').trim();"+
      "var m=txt.match(/第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/);"+
      "if(m&&all[i].offsetWidth>0){c=parseInt(m[1]);t=parseInt(m[2]);break;}}"+
      // 策略B: Ant Design 分页 li.ant-pagination-item
      "if(t===1){"+
      "var items=document.querySelectorAll('li.ant-pagination-item');"+
      "var nums=[];items.forEach(function(li){var n=parseInt(li.textContent);if(!isNaN(n))nums.push(n)});"+
      "if(nums.length>0){"+
      "var active=document.querySelector('li.ant-pagination-item-active');"+
      "c=active?parseInt(active.textContent)||1:1;"+
      "t=Math.max.apply(null,nums);}}"+
      "return JSON.stringify({curPage:c,totalPages:t})})()"
    );
    try { return JSON.parse(info); } catch(e) { return {curPage:1,totalPages:1}; }
  }

  /** 点击指定页码（SPA 不刷新页面） */
  async goToPage(pageNum) {
    var oldInfo = await this.getPageInfo();
    // 猎聘用 Ant Design 分页: <li class="ant-pagination-item"><a>N</a></li>
    var clicked = await this.engine.evaluate(
      '(function(){var n='+pageNum+';'+
      // 先找 ant-pagination-item 内的 a 标签
      'var items=document.querySelectorAll("li.ant-pagination-item a");'+
      'for(var i=0;i<items.length;i++){if(parseInt(items[i].textContent)===n){items[i].click();return true}}'+
      // 兜底：找"下一页"
      'var all=document.querySelectorAll("a,button,[role=button]");'+
      'for(var i=0;i<all.length;i++){var t=(all[i].textContent||"").trim();'+
      'if(t.indexOf(">")>=0&&all[i].getBoundingClientRect().width>5){all[i].click();return true}}'+
      'return false})()'
    );
    if (clicked) {
      await this.sleep(3000);
      var newInfo = await this.getPageInfo();
      if (newInfo.curPage !== oldInfo.curPage) return true;
      return false;
    }
    return false;
  }

  /** 检测当前页是否最后一页 */
  async isLastPage() {
    const info = await this.getPageInfo();
    return info.curPage >= info.totalPages;
  }

  /** 批量检测所有卡片状态（聊一聊 vs 继续聊 + 岗位关键词筛选）*/
    async getCardStatuses() {
      var filters = (this.acct.keywords?.jobTitle || []);
      var fjs = JSON.stringify(filters);
      var statuses = await this.engine.evaluate(
        '(function(){var filters='+fjs+';'+
        'var L=document.querySelectorAll(\'a[data-nick="job-detail-job-info"]\');var result=[];for(var i=0;i<L.length;i++){var title=L[i].textContent.trim();'+
        'if(filters.length>0){var match=false;for(var f=0;f<filters.length;f++){if(title.indexOf(filters[f])>=0){match=true;break;}}if(!match){result.push("skip_title");continue;}}'+
        'var card=L[i];for(var d=0;d<6;d++){var r=card.getBoundingClientRect();if(r.width>300)break;card=card.parentElement;}var btns=card.querySelectorAll("button,a,[role=\'button\']");var status="unknown";for(var b=0;b<btns.length;b++){var t=(btns[b].textContent||"").trim();if(t==="聊一聊"||t==="立即沟通"){status="chat";break;}if(t==="继续聊"){status="skip";break;}}result.push(status)}return JSON.stringify(result)})()'
      );
      return JSON.parse(statuses || '[]');
    }

    /** 检测卡片是否为"继续聊"(已聊过) */
  async checkChatted(cardIndex) {
    var chatted = await this.engine.evaluate(
      "(function(i){var L=document.querySelectorAll('a[data-nick=\\\"job-detail-job-info\\\"]');" +
      "if(i>=L.length)return false;var link=L[i];var card=link;" +
      "for(var d=0;d<6;d++){var r=card.getBoundingClientRect();if(r.width>300)break;card=card.parentElement;}" +
      "var btns=card.querySelectorAll('button,a,[role=\\\"button\\\"]');" +
      "for(var b=0;b<btns.length;b++){if(btns[b].textContent.trim()==='继续聊')return true;}" +
      "return false})(" + cardIndex + ")"
    );
    return chatted === true;
  }

  /** hover卡片 — WorkBuddy 容器选择器 + JS/JS/JS 双通道 */
  async hoverCard(index) {
    var result = await this.engine.evaluate(`(function(){
      var pos = ${index};
      // 策略A: 直接用容器选择器（WorkBuddy 已验证）
      var cards = document.querySelectorAll('[class*="job-card-pc-container"]');
      if (pos < cards.length) {
        var card = cards[pos];
        card.scrollIntoView({behavior:'instant',block:'center'});
        card.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true,cancelable:true,view:window}));
        card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,cancelable:true,view:window}));
        var rr = card.getBoundingClientRect();
        return JSON.stringify({x:Math.round(rr.right-30), y:Math.round(rr.top+rr.height/2), ok:true, w:Math.round(rr.width)});
      }
      // 策略B: 用 a[data-nick] + 上溯父级（原方案）
      var L = document.querySelectorAll('a[data-nick="job-detail-job-info"]');
      if (pos >= L.length) return JSON.stringify({err:'OOB',total:L.length});
      var link = L[pos];
      link.scrollIntoView({behavior:'instant',block:'center'});
      var card = link;
      for (var d = 0; d < 6; d++) {
        var rr = card.getBoundingClientRect();
        if (rr.width > 300) break;
        card = card.parentElement;
      }
      card.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true,cancelable:true,view:window}));
      card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,cancelable:true,view:window}));
      var rr = card.getBoundingClientRect();
      return JSON.stringify({x:Math.round(rr.right-30), y:Math.round(rr.top+rr.height/2), ok:true, href:link.href});
    })()`);
    if (!result) return false;
    var r = JSON.parse(result);
    if (r.err) return { err: true, total: r.total };
    this._lastCardPos = {x:r.x, y:r.y};
    return r;
  }

  /** 点击聊一聊 — 恢复成功参数（CDP mouseMoved 5步 + 800ms等待 + 轮询） */
  async clickChat() {
    var px = this._lastCardPos.x;
    var py = this._lastCardPos.y;
    // 5步 mouseMoved（仅此，不用 mouseClick）
    for (var s = 1; s <= 5; s++) {
      await this.engine.mouseMove(Math.round(px * s / 5), Math.round(py * s / 5));
      await this.engine.sleep(20);
    }
    await this.engine.mouseMove(px, py);
    // 400ms 等 CSS 过渡动画（从800ms缩短）
    await this.engine.sleep(400);
    // 轮询查聊一聊按钮 — 6次×200ms=1.2s（从10次×250ms缩短）
    for (var w = 0; w < 6; w++) {
      var btn = await this.engine.evaluate(
        '(function(){'+
        // 策略A: .chat-btn-box 容器
        'var box=document.querySelector(".chat-btn-box");'+
        'if(box){var b=box.querySelector("button,a");if(b&&b.getBoundingClientRect().width>0){return JSON.stringify({text:b.textContent.trim()});}}'+
        // 策略B: 全部 button
        'var btns=document.querySelectorAll("button");for(var i=0;i<btns.length;i++){var t=(btns[i].textContent||"").trim();'+
        'if(t=="聊一聊"||t=="立即沟通"||t=="继续聊"){var r=btns[i].getBoundingClientRect();'+
        'if(r.width>0&&r.height>0)return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),text:t});}}'+
        'return null})()'
      );
      if (btn) {
        var bp = JSON.parse(btn);
        // 从按钮返回数据中直接取 text（不再额外 evaluate）
        var btnText = bp.text || '';
        if (btnText === '继续聊') return 'skip';  // 已沟通过，跳过
        if (!bp.x || !bp.y) {
          // .chat-btn-box 路径没有坐标 → 搜索所有 button
          await this.engine.evaluate(
            '(function(){var btns=document.querySelectorAll("button");for(var i=0;i<btns.length;i++){var t=(btns[i].textContent||"").trim();if(t=="聊一聊"||t=="立即沟通"){btns[i].click();return true;}}return false})()'
          );
        } else {
          await this.engine.mouseMove(bp.x, bp.y);
          await this.engine.sleep(200);
          await this.engine.evaluate(
            '(function(){var btns=document.querySelectorAll("button");for(var i=0;i<btns.length;i++){var t=(btns[i].textContent||"").trim();if(t=="聊一聊"||t=="立即沟通"){btns[i].click();return true;}}return false})()'
          );
        }
        await this.engine.sleep(1500);
        return true;
      }
      await this.engine.sleep(250);
    }
    return false;
  }
  /** 等待抽屉加载（WorkBuddy 验证的 selector 列表） */
  async waitDrawerReady() {
    for (var w = 0; w < 12; w++) {
      var found = await this.engine.evaluate(
        "(function(){var c=[{e:document.querySelector('#im-c-entry'),n:'#im-c-entry'},"+
        "{e:document.querySelector('.im-ui-chat-modal-container'),n:'im-ui-chat-modal'},"+
        "{e:document.querySelector('[class*=\"im-ui-chat\"]'),n:'im-ui-chat'},"+
        "{e:document.querySelector('[class*=\"chat-modal\"]'),n:'chat-modal'},"+
        "{e:document.querySelector('[class*=\"drawer-right\"]'),n:'drawer-right'},"+
        "{e:document.querySelector('[class*=\"chat-drawer\"]'),n:'chat-drawer'}];"+
        "for(var i=0;i<c.length;i++){if(c[i].e){var r=c[i].e.getBoundingClientRect();"+
        "if(r.width>100&&r.height>200)return JSON.stringify({found:true,name:c[i].name,w:r.width,h:r.height})}}"+
        "return JSON.stringify({found:false})})()"
      );
      if (found) {
        var f = JSON.parse(found);
        if (f.found) return true;
      }
      await this.engine.sleep(500);
    }
    return false;
  }

  /** 发简历 → 打招呼 → 确认弹窗 → 验证
   *  关键：确认弹窗不阻塞输入，所以先打招呼再确认
   */
  async sendResume(greeting) {
    var cfg = this.config.actions;

    // 0: 检测抽屉内是否有历史聊天记录（有则说明已投递过）
    var hasHistory = await this.engine.evaluate(
      '(function(){var el=document.querySelector("#im-c-entry,.ant-im-modal-root");' +
      'if(!el)return false;var doc=el.contentDocument||el;var html=(doc.body?doc.body.innerHTML:doc.innerHTML)||"";' +
      'if(html.indexOf("msg-item")>=0||html.indexOf("message")>=0||' +
      'html.indexOf("chat-item")>=0||html.indexOf("history")>=0||' +
      'html.indexOf("im-history")>=0||html.indexOf("talk-record")>=0||' +
      'html.indexOf("投递成功")>=0||html.indexOf("附件简历")>=0||' +
      'html.indexOf("已投递")>=0||html.indexOf("已收到")>=0||' +
      'html.indexOf("您的简历")>=0)return true;' +
      '// 检测有任何非空消息容器' +
      'var msgC=doc.querySelectorAll("[class*=\\"msg\\"],[class*=\\"message\\"],[class*=\\"chat\\"]");' +
      'for(var i=0;i<msgC.length;i++){if(msgC[i].offsetWidth>10&&msgC[i].textContent.trim().length>10)return true;}' +
      'return false})()'
    );
    if (hasHistory) { return { status: 'skip', reason: '已投递过' }; }

    // 1: 找"发简历"按钮并点击（重试3次）
    var fajianli = await this.withRetry(async function(){
      return await this.engine.evaluate(
        '(function(){var el=document.querySelector("#im-c-entry");var root=(el&&el.contentDocument)||document;'+
        'var btns=root.querySelectorAll("button,a,span,[role=\\"button\\"]");'+
        'for(var i=0;i<btns.length;i++){var t=(btns[i].textContent||"").trim();'+
        'if(t.indexOf("发简历")>=0||t==="投递简历"){btns[i].click();return "ok";}}'+
        'var el2=root.querySelector(".im-ui-action-button.action-resume,[class*=\\"action-resume\\"]");'+
        'if(el2&&el2.offsetWidth>5){el2.click();return "ok";}'+
        'return null})()'
      );
    }.bind(this), cfg.findFajianli);
    if (fajianli.err) {
      this.stats.fail_resume++;
      return { status: 'fail', reason: '无发简历按钮' };
    }

    // 2: 处理附件简历弹窗 + 确认弹窗（现在有两个弹窗顺序出现）
    await this.sleep(1000);

    // 2a: 先找附件简历弹窗 → 点"立即投递"
    var resumeDialog = await this.withRetry(async function(){
      return await this.engine.evaluate(
        '(function(){'+
        'var wraps=document.querySelectorAll("[class*=modal-wrap]");'+
        'for(var i=0;i<wraps.length;i++){'+
        'var t=(wraps[i].textContent||"").trim();'+
        'if(t.indexOf("附件简历")>=0||t.indexOf("选择简历")>=0){'+
        'var btn=wraps[i].querySelector("button,a");'+
        'if(btn&&btn.offsetWidth>5){btn.click();return "ok"}}}'+
        // 兜底: 全页面搜"立即投递"
        'var all=document.querySelectorAll("button,a");'+
        'for(var i=0;i<all.length;i++){'+
        'var t=(all[i].textContent||"").trim();'+
        'if(t.indexOf("立即投递")>=0||t.indexOf("确认投递")>=0){all[i].click();return "ok"}}'+
        'return null})()'
      );
    }.bind(this), { retries: 5, delay: 800 });
    
    // 2b: 等确认弹窗出现 → 点"确 定"
    await this.sleep(500);
    var confirm = await this.withRetry(async function(){
      return await this.engine.evaluate(
        '(function(){'+
        'var w=document.querySelector("div.ant-im-modal-wrap.ant-im-modal-confirm-centered.ant-im-modal-centered");'+
        'if(!w)return null;'+
        'var b=w.querySelector("button.ant-im-btn.ant-im-btn-primary");'+
        'if(!b)return null;'+
        'b.click();return "ok";})()'
      );
    }.bind(this), cfg.clickConfirm);
    
    if (confirm.err) {
      this.stats.fail_confirm++;
      return { status: 'partial', reason: '确认未点' };
    }

    // 验证: 确认按钮是否消失
    await this.sleep(800);
    var stillHas = await this.engine.evaluate(
      '!!document.querySelector("div.ant-im-modal-wrap.ant-im-modal-confirm-centered")'
    );
    if (stillHas) {
      await this.engine.evaluate(
        '(function(){var w=document.querySelector("div.ant-im-modal-wrap.ant-im-modal-confirm-centered.ant-im-modal-centered");'+
        'if(w){var b=w.querySelector("button.ant-im-btn.ant-im-btn-primary");if(b)b.click();}})()'
      );
      await this.sleep(500);
    }

    // 3: 填打招呼语 + 发送
    await this.sleep(300);
    var greetingText = greeting || '您好';
    var escaped = greetingText.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    await this.engine.evaluate(
      "(function(){var candidates=document.querySelectorAll('textarea,[contenteditable=\"true\"]');" +
      "for(var i=0;i<candidates.length;i++){" +
      "var el=candidates[i];var r=el.getBoundingClientRect();" +
      "var cls=(el.className||'').toLowerCase();var ph=(el.placeholder||'').toLowerCase();" +
      "if(r.width<80)continue;if(cls.indexOf('search')>=0||ph.indexOf('搜索')>=0)continue;" +
      "var nativeSetter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;" +
      "nativeSetter.call(el,'" + escaped + "');" +
      "el.dispatchEvent(new Event('input',{bubbles:true}));" +
      "el.dispatchEvent(new Event('change',{bubbles:true}));return;}" +
      "})()"
    );
    await this.sleep(300);
    // 找"发送"按钮或按Enter
    var sendOk = await this.engine.evaluate(
      '(function(){var all=document.querySelectorAll("button,a,span,[role=\\"button\\"]");' +
      'for(var i=0;i<all.length;i++){' +
      'var t=(all[i].textContent||"").trim();' +
      'if((t==="发送"||t==="发 送")&&all[i].getBoundingClientRect().width>0){all[i].click();return true;}}' +
      'return false})()'
    );
    if (!sendOk) {
      await this.engine.cmd('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',windowsVirtualKeyCode:13});
      await this.sleep(100);
      await this.engine.cmd('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',windowsVirtualKeyCode:13});
    }
    await this.sleep(300);
    return { status: 'success' };
  }

  /** 点击聊天按钮 + 等待抽屉打开（单次尝试，不回滚） */
  async doChat(cardIndex) {
    var rect = await this.hoverCard(cardIndex);
    if (!rect || rect.err) { this.stats.fail_chat++; return {err:'no_card'}; }
    var chatOk = await this.clickChat();
    if (chatOk === 'skip') { return {status:'skip', reason:'继续聊'}; }
    if (!chatOk) { this.stats.fail_chat++; return {err:'no_chat_btn'}; }
    var drawerOk = await this.waitDrawerReady();
    if (!drawerOk) return {err:'no_drawer'};
    return { status: 'ok' };
  }

  /** 通用弹窗/对话框处理器
   *  扫描主文档 + 所有 iframe，识别弹窗并自动处理
   *  处理策略：
   *    确认类（确定/确认/立即投递）→ 点击确认
   *    通知类（我知道了/知道了）→ 点击关闭
   *    广告类（关闭按钮/X/不再提示）→ 关闭
   *  返回 true=处理了弹窗，false=无弹窗
   */
  async handleDialogs() {
    return await this.engine.evaluate(
      '(function(){var roots=[];roots.push(document);'+
      'var e=document.querySelector("#im-c-entry");if(e)roots.push(e.contentDocument||e);'+
      'document.querySelectorAll("iframe").forEach(function(f){try{if(f.contentDocument)roots.push(f.contentDocument)}catch(e){}});'+
      'var handled=0;'+
      'for(var ri=0;ri<roots.length;ri++){var doc=roots[ri];if(!doc||!doc.querySelectorAll)continue;'+
      'var all=doc.querySelectorAll("div,section,aside");'+
      'for(var ai=0;ai<all.length;ai++){var el=all[ai];var r=el.getBoundingClientRect();'+
      'if(r.width<100||r.height<80||r.left<0||r.top<0||r.top>window.innerHeight)continue;'+
      'if(r.width>window.innerWidth*0.8&&r.height>window.innerHeight*0.8)continue;'+
      'var z=window.getComputedStyle(el).zIndex;if(parseInt(z)<100)continue;'+
      'var btns=el.querySelectorAll("button,a,span,[role=\\"button\\"]");'+
      'for(var bi=0;bi<btns.length;bi++){'+
      'var t=(btns[bi].textContent||"").trim();var br=btns[bi].getBoundingClientRect();'+
      'if(br.width<10||br.height<10)continue;'+
      'if(t==="确定"||t==="确认"||t==="立即投递"||t==="确认投递"||t==="投递简历"||t==="确认发送"||t==="确定发送"){btns[bi].click();handled++;}'+
      'else if(t==="我知道了"||t==="知道了"){btns[bi].click();handled++;}'+
      'else if(t==="关闭"||t==="取消"||t==="不再提示"||t==="×"){btns[bi].click();handled++;}'+
      'else if(br.width<50){btns[bi].click();handled++;}}}}'+
      'return handled})()'
    ) || 0;
  }

  /** 等待弹窗稳定（不再有新弹窗弹出） */
  async waitDialogsStable(timeout) {
    timeout = timeout || 5000;
    var stable = false;
    for (var w = 0; w < timeout/300; w++) {
      var count = await this.handleDialogs();
      if (count === 0) { stable = true; break; }
      await this.engine.sleep(300);
    }
    return stable;
  }
  async closeDrawer() {
    // 方式1: 找 drawer close 按钮
    var closed = await this.engine.evaluate(
      '(function(){var closeSelectors=[' +
      '\'[class*="close"]\',\'[class*="Close"]\',\'button[class*="close"]\',\'span[class*="close"]\',' +
      '\'.ant-modal-close\',\'.ant-drawer-close\',\'[aria-label="Close"]\',\'[aria-label="\\u5173\\u95ed"]\',' +
      '\'.dialog-close\',\'.popup-close\',\'.overlay-close\'];' +
      'for(var i=0;i<closeSelectors.length;i++){' +
      'var el=document.querySelector(closeSelectors[i]);' +
      'if(el){var r=el.getBoundingClientRect();' +
      'if(r.width>0&&r.height>0&&r.top>0&&r.left>0){el.click();return true;}}}return false})()'
    );

    if (!closed) {
      // 方式2: 找 X/关闭/取消 按钮
      closed = await this.engine.evaluate(
        '(function(){var btns=document.querySelectorAll("button,a,span");' +
        'for(var i=0;i<btns.length;i++){' +
        'var t=(btns[i].textContent||"").trim();var r=btns[i].getBoundingClientRect();' +
        'if(r.width>10&&r.height>10&&(t==="\\u00d7"||t==="\\u5173\\u95ed"||t==="\\u53d6\\u6d88")){' +
        'btns[i].click();return true;}}return false})()'
      );
    }

    if (!closed) {
      // 方式3: ESC键
      await this.engine.cmd('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',windowsVirtualKeyCode:27});
      await this.engine.sleep(300);
      await this.engine.cmd('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',windowsVirtualKeyCode:27});
    }
    await this.engine.sleep(1000);
  }

  /** ===== 翻页系统（核心） ===== */

  /** 获取当前分页信息 */
  async getPaginationInfo() {
    const res = await this.engine.cmd('Runtime.evaluate', {
      expression: `(function(){
        // 方式A: 读"第1/21页"文本
        var infoEl = document.querySelector(
          '[class*="total"], [class*="page-info"], .sojob-page'
        );
        var totalPages = 1;
        var currentPage = 1;

        if (infoEl) {
          var text = infoEl.textContent || '';
          var m = text.match(/第\\s*(\\d+)\\s*\\/\\s*(\\d+)/);
          if (m) {
            currentPage = parseInt(m[1]);
            totalPages = parseInt(m[2]);
          }
        }

        // 方式B: 数 pagination 按钮
        if (totalPages === 1) {
          var pageBtns = document.querySelectorAll(
            '[class*="pagination"] a, [class*="pager"] a, [class*="page"] a, .sojob-page a'
          );
          var nums = [];
          pageBtns.forEach(function(b){
            var n = parseInt(b.textContent);
            if (!isNaN(n)) nums.push(n);
          });
          if (nums.length > 0) {
            totalPages = Math.max.apply(null, nums);
          }
        }

        // 检测"下一页"按钮是否可用
        var nextBtns = document.querySelectorAll(
          '[class*="pagination"] a:last-child, [class*="pager"] a:last-child, ' +
          '[class*="next"], .sojob-page .next'
        );
        var hasNext = false;
        nextBtns.forEach(function(b){
          if (!b.classList.contains('disabled') && !b.classList.contains('banclick') &&
              b.getAttribute('aria-disabled') !== 'true' && b.offsetWidth > 0) {
            hasNext = true;
          }
        });

        return {
          currentPage: currentPage,
          totalPages: totalPages,
          hasNext: hasNext,
          text: infoEl ? infoEl.textContent : '',
        };
      })()`,
      returnByValue: true,
    });
    return res.result?.value || { currentPage: 1, totalPages: 1, hasNext: false };
  }

  /** 点击"下一页"按钮（DOM 点击，不刷新页面） */
  async clickNextPage() {
    const res = await this.engine.cmd('Runtime.evaluate', {
      expression: `(function(){
        var candidates = [
          '[class*="pagination"] a:last-child:not(.disabled):not(.banclick)',
          '[class*="pager"] a:last-child:not(.disabled):not(.banclick)',
          '[class*="next"]:not(.disabled):not(.banclick)',
          '.sojob-page .next:not(.disabled)',
        ];
        for (var sel of candidates) {
          var el = document.querySelector(sel);
          if (el && el.offsetWidth > 0 && el.getAttribute('aria-disabled') !== 'true') {
            var r = el.getBoundingClientRect();
            return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
          }
        }
        return null;
      })()`,
      returnByValue: true,
    });

    const pos = res.result?.value;
    if (!pos) return false;

    // 鼠标移动到翻页按钮
    await this.engine.mouseMove(pos.x - 30, pos.y);
    await this.engine.sleep(100);
    await this.engine.mouseMove(pos.x, pos.y);
    await this.engine.sleep(300);
    await this.engine.mouseClick(pos.x, pos.y);

    // 等待翻页完成（轮询检测 currentPage 是否变了）
    const oldPage = (await this.getPaginationInfo()).currentPage;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await this.engine.sleep(500);
      const info = await this.getPaginationInfo();
      if (info.currentPage !== oldPage && info.currentPage > oldPage) {
        // 翻页成功，再等卡片加载
        await this.engine.sleep(2000);
        return true;
      }
    }
    return false; // 翻页超时
  }

  /** 弹窗广告自动关闭（WorkBuddy _dismissOverlays 方案） */
  async closePopups() {
    var cleaned = await this.engine.evaluate(
      "(function(){var closed=0;" +
      "var closeSelectors=['[class*=\"close\"]','[class*=\"Close\"]','button[class*=\"close\"]','span[class*=\"close\"]'," +
      "'.ant-modal-close','.ant-drawer-close','[aria-label=\"Close\"]','[aria-label=\"\\u5173\\u95ed\"]'," +
      "'.dialog-close','.popup-close','.overlay-close'];" +
      "for(var i=0;i<closeSelectors.length;i++){" +
      "var el=document.querySelector(closeSelectors[i]);" +
      "if(el){var r=el.getBoundingClientRect();" +
      "if(r.width>0&&r.height>0&&r.top>0&&r.left>0){el.click();closed++;}}}" +
      "var textBtns=document.querySelectorAll('button,a,span');" +
      "for(var i=0;i<textBtns.length&&closed<3;i++){" +
      "var t=(textBtns[i].textContent||'').trim();var r=textBtns[i].getBoundingClientRect();" +
      "if(r.width>20&&r.height>10&&(t==='\\u77e5\\u9053\\u4e86'||t==='\\u786e\\u5b9a'||t==='\\u5173\\u95ed'||t==='\\u4e0d\\u518d\\u63d0\\u793a'||t==='\\u6211\\u77e5\\u9053\\u4e86')){" +
      "if(r.top>0&&r.top<window.innerHeight){textBtns[i].click();closed++;}}}" +
      "var icons=document.querySelectorAll('.anticon-close');" +
      "for(var i=0;i<icons.length;i++){" +
      "var p=icons[i];for(var d=0;d<5&&p;d++){" +
      "if(p.tagName==='BUTTON'||(p.onclick)){var rr=p.getBoundingClientRect();if(rr.width>5){p.click();closed++;}break;}" +
      "if(p.__reactProps){p.click();closed++;break;}p=p.parentElement;}}" +
      "return closed})()"
    );
    return cleaned > 0;
  }

  /** 单个卡片投递流程（带去重） */
  async applyOne(cardIndex, greeting) {
    try {
      // 0: 获取职位 ID 做本地去重
      var jobId = await this.engine.evaluate(
        '(function(i){var L=document.querySelectorAll(\'a[data-nick="job-detail-job-info"]\');'+
        'if(i>=L.length)return null;var h=L[i].href;return h.split("/a/")[1]?.split(".")[0]||h})('+cardIndex+')'
      );
      if (jobId && this._processedIds.has(jobId)) {
        this.stats.skip_processed++;
        return { status: 'skip', reason: '已处理过' };
      }

      // 0b: 检测卡片是否为"继续聊"（已沟通过）
      var chatted = await this.checkChatted(cardIndex);
      if (chatted) {
        this.stats.skip_chatted++;
        return { status: 'skip', reason: '继续聊' };
      }

      // 即使 jobId 没有获取到，也记录卡片索引做去重
      if (!jobId) jobId = 'card_' + cardIndex;
      this._processedIds.add(jobId);

      // 1: doChat — hover + 点击聊天 + 等抽屉
      var chat = await this.doChat(cardIndex);
      if (chat.err) {
        return { status: 'fail', reason: '聊天未打开' };
      }
      if (chat.status === 'skip') {
        this.stats.skip_chatted++;
        return { status: 'skip', reason: '继续聊' };
      }

      // 2: sendResume — 发简历→打招呼→确认→验证
      var send = await this.sendResume(greeting);
      if (send.status === 'success') {
        this.stats.success++;
        this._consecutiveFail = this._consecutiveFail > 0 ? 0 : 0;
      }

      // 3: 关抽屉
      await this.withRetry(async function(){
        return await this.closeDrawer();
      }.bind(this), this.config.actions.closeDrawer);

      return send;
    } catch (e) {
      return { status: 'fail', reason: e.message };
    }
  }

  /** 跑一页 */
  async runOnePage(cardIndex, greeting) {
    const cardCount = await this.getCards();
    if (cardCount === 0) return 0;

    let applied = 0;
    for (let i = 0; i < cardCount; i++) {
      const result = await this.applyOne(i, greeting);
      this.stats[result.status]++;
      if (result.status === 'success') applied++;
    }
    return applied;
  }

  /** 翻页检测 */
  async nextPage() {
    const info = await this.getPaginationInfo();
    if (!info.hasNext) return false;
    return await this.clickNextPage();
  }
}

module.exports = LiepinFlow;

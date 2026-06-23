/**
 * Boss直聘自动化流程
 *
 * 结构: 卡片列表 → 点击卡片 → 右侧详情面板显示"立即沟通"
 * 流程: 点击卡片选中 → 点"立即沟通" → 对话框点"留在此页"
 *
 * 诊断确认: a.op-btn-chat 在 div.job-detail-container 内，不在卡片内
 */

class BossFlow {
  constructor(engine, account) {
    this.engine = engine;
    this.acct = account || {};
    this.config = require('../config/defaults');
    this.stats = { success:0, fail_chat:0, fail_dialog:0, skip_chatted:0 };
    this._processedIds = new Set();
    this._consecutiveFail = 0;
  }

  async sleep(ms) { await this.engine.sleep(ms); }

  async getCards() {
    return (await this.engine.evaluate('document.querySelectorAll("div.job-card-wrap").length')) || 0;
  }

  /** 点击卡片选中，触发详情面板更新 */
  async clickCard(cardIndex) {
    return await this.engine.evaluate(
      '(function(i){var cards=document.querySelectorAll("div.job-card-wrap");'+
      'if(i>=cards.length)return false;'+
      'var link=cards[i].querySelector("a.job-name");'+
      'if(!link)return false;'+
      'link.click();return true})('+cardIndex+')'
    );
  }

  /** 检测"立即沟通"按钮状态 */
  async getChatBtnStatus() {
    var info = await this.engine.evaluate(
      '(function(){var btn=document.querySelector("a.op-btn-chat");'+
      'if(!btn)return "no-btn";'+
      'if(btn.classList.contains("is-disabled"))return "disabled";'+
      'return "enabled"})()'
    );
    return info;
  }

  /** 关闭任意弹窗（温馨提示、广告等） */
  async closePopups() {
    await this.engine.evaluate(
      '(function(){var all=document.querySelectorAll("div[class*=dialog],div[class*=modal],div[class*=popup]");'+
      'for(var i=0;i<all.length;i++){'+
      'var rc=all[i].getBoundingClientRect();if(rc.width<100)continue;'+
      'var btn=all[i].querySelector("button,a");'+
      'if(btn&&btn.offsetWidth>5){btn.click();return true}}'+
      'return false})()'
    );
    await this.sleep(300);
  }

  /** 点击指定卡片的"立即沟通"按钮 */
  async clickChat() {
    return await this.engine.evaluate(
      '(function(){var btn=document.querySelector("a.op-btn-chat");'+
      'if(!btn||btn.classList.contains("is-disabled"))return false;'+
      'btn.click();return true})()'
    );
  }

  /** 等对话框出现并处理（"留在此页" / "不匹配" / "温馨提示"等） */
  async handleDialog() {
    for (var w = 0; w < 10; w++) {
      var info = await this.engine.evaluate(
        '(function(){'+
        // 1: 正常沟通对话框 → 点"留在此页"
        'var dlg=document.querySelector("div.greet-boss-dialog");'+
        'if(dlg){var btn=dlg.querySelector("a.default-btn.cancel-btn");if(btn){btn.click();return "ok"}}'+
        // 2: 温馨提示/无法沟通/每日上限 → 点确认按钮
        'var all=document.querySelectorAll("div[class*=dialog],div[class*=modal],div[class*=popup]");'+
        'for(var i=0;i<all.length;i++){'+
        'var t=(all[i].textContent||"");'+
        'if(t.indexOf("温馨提示")>=0||t.indexOf("无法进行")>=0||t.indexOf("无法沟通")>=0||'+
        '(t.indexOf("每天")>=0&&t.indexOf("沟通")>=0)||(t.indexOf("今日")>=0&&t.indexOf("沟通")>=0)){'+
        'var btn=all[i].querySelector("button,a");'+
        'if(btn&&btn.getBoundingClientRect().width>5){btn.click();return "limit"}}}'+
        // 3: "不匹配"弹窗 → 点确认/关闭
        'for(var i=0;i<all.length;i++){'+
        'var t=(all[i].textContent||"");'+
        'if(t.indexOf("不匹配")>=0||t.indexOf("更换职位")>=0||t.indexOf("经验")>=0){'+
        'var btn=all[i].querySelector("button,a,[role=button]");'+
        'if(btn&&btn.getBoundingClientRect().width>20){btn.click();return "dismiss"}}'+
        '}'+
        'return false})()'
      );
      if (info === 'ok') { await this.sleep(500); return 'ok'; }
      if (info === 'limit') { await this.sleep(500); return 'limit'; }
      if (info === 'dismiss') { await this.sleep(500); return true; }
      await this.sleep(500);
    }
    return false;
  }

  /** 滚动加载更多 */
  async scrollToLoad() {
    var before = await this.getCards();
    await this.engine.evaluate('window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"})');
    await this.sleep(1500);
    var after = await this.getCards();
    if (after <= before) {
      await this.sleep(1000);
      await this.engine.evaluate('window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"})');
      await this.sleep(1500);
      after = await this.getCards();
    }
    return after;
  }

  /** 批量检测卡片状态 + 岗位关键词筛选 */
  async getCardStatuses() {
    var filters = this.acct.keywords?.jobTitle || [];
    var filtersJS = JSON.stringify(filters);
    var statuses = await this.engine.evaluate(
      '(function(){var filters='+filtersJS+';'+
      'var cards=document.querySelectorAll("div.job-card-wrap");'+
      'var result=[];'+
      'for(var i=0;i<cards.length;i++){'+
      'var link=cards[i].querySelector("a.job-name");'+
      'if(!link){result.push("unknown");continue;}'+
      'var title=link.textContent.trim();'+
      'if(filters.length>0){var match=false;for(var f=0;f<filters.length;f++){if(title.indexOf(filters[f])>=0){match=true;break;}}if(!match){result.push("skip_title");continue;}}'+
      'result.push("new");}'+
      'return result})()'
    );
    if (!statuses || !Array.isArray(statuses)) {
      var diag = await this.engine.evaluate('document.querySelectorAll("div.job-card-wrap").length');
      console.log('  [Boss] getCardStatuses 诊断: cards='+diag+', filters='+filtersJS+', returned='+typeof statuses);
      return [];
    }
    return statuses;
  }

  /** 切换到求职期望标签 */
  async switchExpectTag(tagText) {
    var clicked = await this.engine.evaluate(
      '(function(t){var tags=document.querySelectorAll("a.expect-item");'+
      'for(var i=0;i<tags.length;i++){'+
      'if(tags[i].textContent.trim()===t){tags[i].click();return true}}'+
      'return false})("'+tagText+'")'
    );
    if (clicked) await this.sleep(2000);
    return clicked;
  }

  /** 获取期望标签列表 */
  async getExpectTags() {
    var tags = await this.engine.evaluate(
      '(function(){var r=[];document.querySelectorAll("a.expect-item").forEach(function(t){r.push(t.textContent.trim())});return JSON.stringify(r)})()'
    );
    return JSON.parse(tags || '[]');
  }

  /** 单个卡片投递流程 */
  async applyOne(cardIndex, greeting) {
    try {
      // 0: 获取职位链接做去重
      var jobKey = await this.engine.evaluate(
        '(function(i){var cards=document.querySelectorAll("div.job-card-wrap");'+
        'if(i>=cards.length)return null;'+
        'var link=cards[i].querySelector("a.job-name");'+
        'return link?link.href:null})('+cardIndex+')'
      );
      if (jobKey && this._processedIds.has(jobKey)) {
        this.stats.skip_chatted++;
        return { status:'skip', reason:'已处理过' };
      }
      if (jobKey) this._processedIds.add(jobKey);

      // 1: 点击卡片选中（触发详情面板）
      var cardOk = await this.clickCard(cardIndex);
      if (!cardOk) return { status:'fail', reason:'卡片不可点击' };
      await this.sleep(800);

      // 2: 检查"立即沟通"按钮状态
      var btnStatus = await this.getChatBtnStatus();
      if (btnStatus === 'no-btn') return { status:'fail', reason:'无沟通按钮' };
      if (btnStatus === 'disabled') return { status:'skip', reason:'已沟通过' };

      // 3: 点击"立即沟通"
      var chatOk = await this.clickChat();
      if (!chatOk) { this.stats.fail_chat++; return { status:'fail', reason:'沟通按钮不可用' }; }
      await this.sleep(500);

      // 4: 处理对话框→点"留在此页"
      var dialogResult = await this.handleDialog();
      if (dialogResult === 'limit') {
        this.stats.fail_dialog++;
        return { status:'paused', reason:'每日沟通上限(已达120次)' };
      }
      if (!dialogResult) { this.stats.fail_dialog++; return { status:'fail', reason:'对话框未处理' }; }

      this.stats.success++;
      this._consecutiveFail = 0;
      return { status:'success' };
    } catch (e) {
      return { status:'fail', reason:e.message };
    }
  }
}

module.exports = BossFlow;

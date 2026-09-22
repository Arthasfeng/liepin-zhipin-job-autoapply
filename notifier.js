/**
 * 源圈自动投递 — 企业微信群机器人通知模块
 * 著作权: 杭州源源圈圈网络科技有限公司
 *
 * 职责:
 *  1. 异常告警 (登录态失效 / 连续失败 / 账号冻结)
 *  2. 可选: 每轮汇总 / 日报
 *
 * 设计原则:
 *  - 旁路: 任何通知失败绝不阻断投递主流程
 *  - 去重: 同类告警有冷却时间, 避免刷屏
 *  - 静默: 未配置 webhook 时完全静默 (不报错)
 *
 * 配置来源 (优先级从高到低):
 *  1. 环境变量 WECOM_WEBHOOK
 *  2. config/defaults.js -> notify.wecomWebhook
 */
const https = require('https');
const http = require('http');

const PREFIX = '【源圈自动投递】';

let _webhook = '';
let _enabled = false;
let _cooldownMs = 30 * 60 * 1000;   // 同类告警默认 30 分钟冷却
const _lastSent = {};                // type -> timestamp

/** 初始化。webhook 为空则整体关闭 (静默) */
function init(webhookUrl, cooldownMs) {
  _webhook = String(webhookUrl || process.env.WECOM_WEBHOOK || '').trim();
  _enabled = /^https?:\/\//i.test(_webhook);
  if (typeof cooldownMs === 'number' && cooldownMs > 0) _cooldownMs = cooldownMs;
  if (_enabled) {
    console.log('[Notifier] 企业微信通知已启用 (告警冷却 ' + Math.round(_cooldownMs / 60000) + ' 分钟)');
  } else {
    console.log('[Notifier] 未配置企业微信 webhook, 通知关闭 (设置 WECOM_WEBHOOK 或 config.notify.wecomWebhook 开启)');
  }
}

/** 底层发送。永远 resolve, 不抛出 */
function _post(text) {
  return new Promise(function (resolve) {
    if (!_enabled) return resolve(false);
    let u;
    try { u = new URL(_webhook); }
    catch (e) { console.log('[Notifier] webhook URL 非法: ' + e.message); return resolve(false); }

    const lib = u.protocol === 'https:' ? https : http;
    const body = JSON.stringify({ msgtype: 'text', text: { content: text } });
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: (u.pathname || '/') + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    }, function (res) {
      let d = '';
      res.on('data', function (c) { d += c; });
      res.on('end', function () {
        let ok = res.statusCode === 200;
        // 企业微信返回 errcode!=0 也算失败
        try {
          const j = JSON.parse(d);
          if (j && typeof j.errcode === 'number' && j.errcode !== 0) ok = false;
        } catch (e) {}
        if (!ok) console.log('[Notifier] 发送失败 status=' + res.statusCode + ' body=' + String(d).slice(0, 120));
        resolve(ok);
      });
    });
    req.on('error', function (e) { console.log('[Notifier] 网络错误: ' + e.message); resolve(false); });
    req.on('timeout', function () { req.destroy(); console.log('[Notifier] 超时'); resolve(false); });
    req.write(body);
    req.end();
  });
}

/**
 * 告警 (带同类冷却去重)
 * @param {string} type    告警类型 key, 用于冷却去重
 * @param {string} text    内容
 * @param {boolean} force  忽略冷却, 强制发送
 */
function alert(type, text, force) {
  const now = Date.now();
  if (!force && _lastSent[type] && (now - _lastSent[type]) < _cooldownMs) {
    return Promise.resolve(false);
  }
  _lastSent[type] = now;
  return _post(PREFIX + text);
}

/** 普通消息 (无冷却) */
function notify(text) {
  return _post(PREFIX + text);
}

function isEnabled() { return _enabled; }

module.exports = { init: init, alert: alert, notify: notify, isEnabled: isEnabled };

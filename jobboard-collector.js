/**
 * 源圈招聘数据看板 — 客户端采集上报模块 V1
 * 著作权: 杭州源源圈圈网络科技有限公司
 * 
 * 职责:
 *  1. 旁路采集投递过程中的职位统计信息 (不改动投递逻辑)
 *  2. 本地缓冲到 JSON 文件
 *  3. 定时上报到看板服务端 (data.organicomm.com)
 * 
 * 用法: 在 index.js 顶部 require, 启动时初始化
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');

// ====== 配置 ======
const SERVER_URL = process.env.JOB_BOARD_URL || 'https://data.organicomm.com';
const BUFFER_FILE = path.join(os.tmpdir(), 'job-board-buffer.json');
const FLUSH_INTERVAL_MS = 10 * 60 * 1000;  // 10分钟刷一次
const MAX_BUFFER = 2000;

let _buffer = [];
let _enabled = false;
let _clientName = '';

function loadBuffer() {
  try {
    if (fs.existsSync(BUFFER_FILE)) {
      _buffer = JSON.parse(fs.readFileSync(BUFFER_FILE, 'utf8'));
    }
  } catch (e) { _buffer = []; }
}

function saveBuffer() {
  try {
    fs.writeFileSync(BUFFER_FILE, JSON.stringify(_buffer));
  } catch (e) {}
}

/** 初始化采集器 */
function init(clientName) {
  _clientName = clientName || 'local';
  _enabled = true;
  loadBuffer();
  // 定期 flush
  setInterval(flush, FLUSH_INTERVAL_MS);
  // 退出时 flush
  process.on('exit', () => { flushSync(); });
  console.log('[JobBoard] 数据采集已启用 → ' + SERVER_URL);
}

/** 记录一个采集事件 */
function record(evt) {
  if (!_enabled) return;
  const e = Object.assign({
    client: _clientName,
    platform: '',
    keyword: '',
    event_type: 'scanned',
    job_title: '',
    company: '',
    city: '',
    salary: '',
    status: '',
    ts: new Date().toISOString(),
  }, evt);
  _buffer.push(e);
  if (_buffer.length >= MAX_BUFFER) flush();
  saveBuffer();
}

/** 从 DOM 卡片信息生成 scanned 事件 (由平台流程调用) */
function recordScanned(acct, keyword, card) {
  record({
    account: acct ? (acct.id || acct.name || '') : '',
    platform: acct ? acct.platform : (card.platform || ''),
    keyword: keyword || '',
    event_type: 'scanned',
    job_title: card.title || '',
    company: card.company || '',
    city: card.city || '',
    salary: card.salary || '',
    matched_keyword: card.matchedKeyword || '',
  });
}

/** 记录投递结果 */
function recordApplyResult(acct, keyword, result) {
  record({
    account: acct ? (acct.id || acct.name || '') : '',
    platform: acct ? acct.platform : (result.platform || ''),
    keyword: keyword || '',
    event_type: result.status === 'success' ? 'applied' : (result.status === 'skip' ? 'scanned' : 'failed'),
    job_title: result.title || '',
    company: result.company || '',
    status: result.status === 'success' ? 'applied' : (result.status === 'skip' ? 'skip' : 'failed'),
  });
}

/** 记录回复/意向 */
function recordReplied(acct, info) {
  record({
    account: acct ? (acct.id || acct.name || '') : '',
    platform: acct ? acct.platform : (info.platform || ''),
    keyword: info.keyword || '',
    event_type: 'replied',
    job_title: info.title || '',
    company: info.company || '',
    status: 'replied',
  });
}

/** 异步 flush 到服务端 */
function flush() {
  if (!_enabled || _buffer.length === 0) return Promise.resolve();
  const payload = JSON.stringify({ client: _clientName, events: _buffer.splice(0, _buffer.length) });
  saveBuffer();
  return new Promise((resolve) => {
    try {
      const url = new URL(SERVER_URL + '/api/upload');
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[JobBoard] 上报成功 ' + body);
          } else {
            console.log('[JobBoard] 上报失败 HTTP ' + res.statusCode);
            // 失败重新入队
            try { _buffer = JSON.parse(payload).events.concat(_buffer); saveBuffer(); } catch(e){}
          }
          resolve();
        });
      });
      req.on('error', (err) => {
        console.log('[JobBoard] 上报错误 ' + err.message);
        try { _buffer = JSON.parse(payload).events.concat(_buffer); saveBuffer(); } catch(e){}
        resolve();
      });
      req.write(payload);
      req.end();
    } catch (e) {
      try { _buffer = JSON.parse(payload).events.concat(_buffer); saveBuffer(); } catch(e2){}
      resolve();
    }
  });
}

/** 同步 flush (进程退出时用) */
function flushSync() {
  if (_buffer.length === 0) return;
  // 尽力而为的同步请求
  try {
    const payload = JSON.stringify({ client: _clientName, events: _buffer });
    const url = new URL(SERVER_URL + '/api/upload');
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    });
    req.on('error', () => {});
    req.write(payload);
    req.end();
    _buffer = [];
    saveBuffer();
  } catch (e) {}
}

module.exports = { init, record, recordScanned, recordApplyResult, recordReplied, flush };

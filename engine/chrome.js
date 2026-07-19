const { spawn } = require('child_process');

class ChromeEngine {
  constructor(opts) {
    this.port = (opts && opts.remoteDebugPort) || 9222;
    this.path = (opts && opts.chromePath) || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    this.dataDir = (opts && opts.userDataDir) || '/tmp/auto-apply-chrome';
    this.proc = null;
    this.ws = null;
    this._mid = 0;
    this._pend = {};
  }

  async start(userDataDir) {
    var me = this;
    if (userDataDir) this.dataDir = userDataDir;
    return new Promise(function(resolve) {
      me.proc = spawn(me.path, [
        '--user-data-dir=' + me.dataDir,
        '--remote-debugging-port=' + me.port,
        '--no-first-run', '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        '--disable-session-crashed-bubble',
        '--disable-features=SessionRestore',
        '--window-size=1280,800',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      var ok = false;
      var h = function(d) { if (!ok && d.toString().indexOf('DevTools') >= 0) { ok = true; resolve(); } };
      me.proc.stdout.on('data', h);
      me.proc.stderr.on('data', h);
      setTimeout(function() { if (!ok) { ok = true; resolve(); } }, 8000);
    });
  }

  async connect() {
    // 拿到第一个 page 的 WS URL，直接连
    for (var i = 0; i < 20; i++) {
      try {
        var r = await fetch('http://127.0.0.1:' + this.port + '/json');
        var ts = await r.json();
        var p = ts.find(function(t) { return t.type === 'page'; });
        if (p && p.webSocketDebuggerUrl) { return this._connectWS(p.webSocketDebuggerUrl); }
      } catch(e) {}
      await this.sleep(500);
    }
    throw new Error('cannot find page');
  }

  _connectWS(url) {
    var me = this;
    return new Promise(function(resolve, reject) {
      me.ws = new WebSocket(url);
      me._mid = 0;
      me._pend = {};
      me.ws.addEventListener('message', function(e) {
        var m = JSON.parse(e.data);
        if (m.id && me._pend[m.id]) { me._pend[m.id](m); delete me._pend[m.id]; }
      });
      me.ws.addEventListener('open', function() { resolve(me); });
      me.ws.addEventListener('error', reject);
    });
  }

  cmd(method, params) {
    var me = this;
    return new Promise(function(resolve) {
      var id = ++me._mid;
      me._pend[id] = resolve;
      me.ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  }

  async navigate(url) {
    // fire-and-forget: 不等待 Page.navigate 返回
    var id = ++this._mid;
    this.ws.send(JSON.stringify({ id: id, method: 'Page.enable' }));
    id = ++this._mid;
    this.ws.send(JSON.stringify({ id: id, method: 'Page.navigate', params: { url: url } }));
    // 不等待响应，直接等固定时间让页面加载
    await this.sleep(8000);
  }

  async evaluate(expr) {
    var r = await this.cmd('Runtime.evaluate', { expression: expr, returnByValue: true });
    var v = r.result;
    return v && v.result && v.result.value;
  }

  async mouseMove(x, y) {
    await this.cmd('Input.dispatchMouseEvent', { type:'mouseMoved', x, y, button:'none', pointerType:'mouse' });
  }

  async mouseClick(x, y) {
    await this.cmd('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
    await this.cmd('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
  }

  async rect(sel) {
    return this.evaluate('(function(){var e=document.querySelector("' + sel + '");if(!e)return null;var r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()');
  }

  sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  kill() {
    // 1. 先关闭 WebSocket
    if (this.ws) { try { this.ws.close(); } catch(e) {} this.ws = null; }
    // 2. 尝试通过 Node child_process kill
    if (this.proc) { try { this.proc.kill('SIGKILL'); } catch(e) {} this.proc = null; }
    // 3. 关键：按端口杀 Chrome（防止进程残留）
    try {
      var port = this.port;
      var execSync = require('child_process').execSync;
      // 找到占用端口的 Chrome PID 并杀掉
      var out = execSync('lsof -ti :' + port + ' 2>/dev/null', { timeout: 3000 }).toString().trim();
      if (out) {
        out.split('\n').forEach(function(pid) {
          try { process.kill(parseInt(pid), 'SIGKILL'); } catch(e) {}
        });
      }
    } catch(e) {}
  }
}

module.exports = ChromeEngine;

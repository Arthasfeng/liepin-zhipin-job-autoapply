/**
 * 自动投递平台 — 系统配置
 * 管理多账号、关键词、全局调度
 */

// ===== 账号配置 =====
// 格式：用户通过 Tray 编辑此文件来配置
const DEFAULT_ACCOUNTS = [
  // {
  //   id: 'liepin-a',
  //   name: '猎聘A账号',
  //   platform: 'liepin',
  //   profileDir: '/tmp/auto-apply/liepin-a',
  //   keywords: { search: ['CEO','COO','总裁'], jobTitle: ['总监','经理','负责人'] },
  //   greeting: '您好，我对这个职位很感兴趣，方便沟通一下吗？',
  //   enabled: true,
  // },
  // {
  //   id: 'boss-c',
  //   name: 'Boss直聘C账号',
  //   platform: 'boss',
  //   profileDir: '/tmp/auto-apply/boss-c',
  //   keywords: { search: ['技术总监','架构师'], jobTitle: ['技术','研发'] },
  //   greeting: '您好，方便沟通一下吗？',
  //   enabled: true,
  // },
];

const ACCOUNT_FILE = '/tmp/auto-apply-config.json';

// ===== 全局调度配置 =====
const SCHEDULE = {
  // 每天定时运行（24h格式，多个时段）
  runTimes: ['09:00', '14:00', '20:00'],
  // 单次运行最大时长（分钟）
  maxDuration: 120,
  // 账号间间隔（秒）
  accountInterval: 30,
};

// ===== Chrome 配置（自动检测路径）=====
var CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Windows 检测
if (process.platform === 'win32') {
  CHROME_PATH = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"';
  var altPath = process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe';
  try { if (require('fs').existsSync(altPath.replace(/^"|"$/g,''))) CHROME_PATH = '"'+altPath+'"'; } catch(e) {}
} else if (process.platform === 'linux') {
  CHROME_PATH = '/usr/bin/google-chrome';
  try { if (!require('fs').existsSync(CHROME_PATH)) CHROME_PATH = '/usr/bin/chromium-browser'; } catch(e) {}
}
// 允许环境变量覆盖
if (process.env.CHROME_PATH) CHROME_PATH = process.env.CHROME_PATH;

const CHROME_CONFIG = {
  path: CHROME_PATH,
  debugPort: 9222,
  restartPerKeyword: true,
  maxLife: 60 * 60 * 1000,
  userDataDir: '/tmp/auto-apply-chrome',
};

// ===== 加载保存账号 =====
function loadAccounts() {
  const fs = require('fs');
  try {
    if (fs.existsSync(ACCOUNT_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8'));
    }
  } catch (e) {}
  return DEFAULT_ACCOUNTS;
}

function saveAccounts(accounts) {
  const fs = require('fs');
  require('fs').mkdirSync('/tmp/auto-apply', { recursive: true });
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(accounts, null, 2));
}

module.exports = { DEFAULT_ACCOUNTS, ACCOUNT_FILE, SCHEDULE, CHROME_CONFIG, loadAccounts, saveAccounts };

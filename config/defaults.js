/**
 * Hermes 自动投递 — 集中配置
 * 所有 timeouts、retries、防风控参数集中管理
 */
const DEFAULTS = {
  // 原子操作配置
  actions: {
    scrollToLoad:  { timeout: 8000, retries: 1, delay: 1000, label: '滚动加载' },
    batchStatus:   { timeout: 3000, retries: 1, delay: 500,  label: '批量检测' },
    hoverChat:     { timeout: 10000, retries: 3, delay: 1500, label: 'hover聊一聊' },
    waitDrawer:    { timeout: 6000, retries: 2, delay: 800,  label: '等抽屉' },
    findFajianli:  { timeout: 5000, retries: 3, delay: 1000, label: '找发简历' },
    clickConfirm:  { timeout: 6000, retries: 3, delay: 1000, label: '点确定' },
    typeGreeting:  { timeout: 4000, retries: 1, delay: 500,  label: '填招呼' },
    sendGreeting:  { timeout: 4000, retries: 1, delay: 500,  label: '发送招呼' },
    closeDrawer:   { timeout: 3000, retries: 2, delay: 500,  label: '关抽屉' },
    goToPage:      { timeout: 8000, retries: 2, delay: 2000, label: '翻页' },
  },

  // 防风控
  antiFraud: {
    minCardGap: 2000,
    consecutiveSlowdown: 3,      // 连续失败3次后降速
    slowedDelay: 6000,
    pauseThreshold: 10,          // 连续失败10次后暂停
    pauseDuration: 60000,
  },

  // 全局限制
  limits: {
    restartEveryCards: 15,
    maxRunMinutes: 30,
  },

  // 弹窗选择器（来自用户 DevTools 精确路径）
  selectors: {
    confirmModal: 'div.ant-im-modal-wrap.ant-im-modal-confirm-centered.ant-im-modal-centered',
    confirmBtn: 'button.ant-im-btn.ant-im-btn-primary',
  }
};

module.exports = DEFAULTS;

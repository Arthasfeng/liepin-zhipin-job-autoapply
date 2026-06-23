# AutoApply — 智能招聘自动投递平台

> 猎聘 + Boss直聘 自动化投递，多账号并行，健康值守，系统托盘控制
>
> 工作再怎么难找，也还是要持续找找的——设想猎头、HR的规律定时自动打招呼投递，遇到匹配机会，每天看一眼有反馈回来的就行。

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)

## 📋 功能特性

### 双平台支持
| 平台 | 状态 | 特点 |
|------|:----:|------|
| **猎聘** | ✅ 稳定 | 搜索列表 hover → 聊一聊 → 发简历 → 确认弹窗 → 打招呼 |
| **Boss直聘** | ✅ 稳定 | 点击卡片 → 立即沟通 → 留在此页（自动发送招呼） |

### 核心能力
- **多账号并行** — 每个账号独立 Chrome 进程，独立配置
- **岗位关键词筛选** — 只投递标题包含指定关键词的职位（如"总经理/总监"）
- **三种搜索模式** — 关键词搜索、求职期望标签、推荐列表，自动循环
- **无限滚动** — Boss直聘 自动滚动到底部加载新卡片
- **SPA 翻页** — 猎聘 自动翻页（Ant Design 页码点击）
- **健康值守引擎** — 3分钟无结果切模式 / 5分钟无操作切模式 / 15分钟无进度冻结
- **防风控降速** — 连续失败自动降速 → 暂停，避免被风控
- **断点续传** — 停止后自动保存进度，下次从中断处继续
- **每日上限自动暂停** — 达到 Boss直聘 120 次沟通上限后自动暂停
- **确认弹窗两阶段处理** — 猎聘新版：附件简历选择 → 确认发送

### 系统托盘
- 🖥️ Electron 托盘程序（macOS 系统图标）
- ▶️ 一键启动/停止所有账号
- ⏰ 定时调度（星期多选 + 时间区间）
- 📊 实时状态显示
- ✏️ 应用窗口编辑关键词
- ➕ 添加/删除账号

## 🚀 快速开始

### 前置要求
- Node.js 18+
- Google Chrome / Chromium（自动检测路径，或设置 `CHROME_PATH` 环境变量）
- 猎聘 / Boss直聘 账号

### 安装与运行

#### macOS
```bash
# 方式一：双击运行（推荐）
# 双击项目目录下的 start.command

# 方式二：终端命令行
git clone https://github.com/yourname/auto-apply.git
cd auto-apply

# 如需托盘界面（可选）
npm install              # 安装 Electron（首次较慢）
npm run tray             # 启动系统托盘

# 直接运行（无需安装）
node index.js            # 运行所有账号
node index.js --account boss-a  # 仅运行指定账号
```

> **中国大陆用户**：安装 Electron 时若遇到网络问题，请使用镜像：
> ```bash
> ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install
> ```
> 或使用 Homebrew：`brew install --cask electron`

#### Windows
```bash
# 方式一：双击 start.bat（控制台菜单）
# 方式二：终端
node index.js
```

#### Linux
```bash
node index.js
# 或指定 Chromium 路径
CHROME_PATH=/usr/bin/chromium-browser node index.js
```

### 首次运行

执行后 Chrome 自动打开，**扫码登录**对应平台的账号。登录后会自动开始投递。

## 运行方式

| 方式 | 命令 | 需安装 | 说明 |
|------|------|--------|------|
| 🖥️ 系统托盘 | `npm run tray` | Electron | 后台运行，菜单栏图标 |
| 📋 终端控制台 | `node menu.js` | **无** | 交互菜单，功能同托盘 |
| ⚡ 一键运行 | `node index.js` | **无** | 直接执行，无管理界面 |

终端控制台界面：
```
╔══════════════════════════════════════════════╗
║        自动投递控制台 v2.0                    ║
╠══════════════════════════════════════════════╣
║ 状态: ⏹ 已停止                               ║
║   猎聘A账号 [liepin] ⏹停止 ✅0 ❌0           ║
║   Boss直聘A账号 [boss] ⏹停止 ✅0 ❌0         ║
╠══════════════════════════════════════════════╣
║  [1] ▶ 立即运行                               ║
║  [2] ⏹ 停止                                  ║
║  [3] 📊 查看统计                              ║
║  [4] ✏ 编辑关键词                             ║
║  [5] ⏰ 编辑定时设置                           ║
║  [q] 退出                                     ║
╚══════════════════════════════════════════════╝
```

## ⚙️ 配置

### 账号配置

编辑 `/tmp/auto-apply-config.json`，或通过托盘程序的 **账号管理** 操作：

```json
{
  "id": "liepin-a",
  "name": "猎聘A账号",
  "platform": "liepin",
  "keywords": {
    "search": ["新零售总经理", "电商总监"],
    "jobTitle": ["总经理", "总监", "负责人"]
  },
  "greeting": "贵公司该岗位要求和方向和我匹配，比较感兴趣，附件简历中有我详细的经历和专业管理经验，方便您可以先看一下，期待与您进一步沟通。",
  "enabled": true
}
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CHROME_PATH` | Chrome 浏览器路径 | 自动检测 |

### 自定义 Chrome 路径

```bash
# macOS (Intel)
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node index.js

# macOS (Apple Silicon - Edge)
CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" node index.js

# Linux
CHROME_PATH="/usr/bin/chromium-browser" node index.js

# Windows
CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" node index.js
```

## 🏗 项目架构

```
auto-apply/
├── index.js              # 主入口 + 健康值守 + 断点续传
├── menu.js               # 终端控制台（替代 Electron）
├── package.json          # 项目配置
├── engine/
│   └── chrome.js         # Chrome CDP 引擎
├── platforms/
│   ├── liepin.js         # 猎聘自动化流程
│   └── boss.js           # Boss直聘自动化流程
├── config/
│   ├── accounts.js       # 账号配置 + Chrome 检测
│   └── defaults.js       # 超时/重试/防风控参数
├── tray/
│   ├── main.js           # Electron 托盘程序
│   ├── dialogs/
│   │   └── keywords.html # 关键词编辑窗口
│   └── gen-icon.js       # 图标生成
└── .gitignore
```

## 📖 运行原理

```
三层引擎架构:

┌─ 健康值守层 ─────────────────────────┐
│  3分钟结果超时 → 切搜索模式            │
│  5分钟页面无操作 → 切搜索模式          │
│  15分钟完全无进度 → 冻结              │
│  连续失败 → 降速 → 暂停              │
└──────────────────────────────────────┘
         │
┌─ 卡片处理层 ─────────────────────────┐
│  猎聘: hover→聊一聊→发简历→确认→打招呼 │
│  Boss: 点击卡片→立即沟通→留在此页      │
│  岗位关键词筛选 → 已处理去重           │
└──────────────────────────────────────┘
         │
┌─ 搜索模式层 ─────────────────────────┐
│  求职期望标签 → 关键词搜索 → 推荐列表   │
│  无限滚动(SPA翻页) → 模式循环          │
│  断点续传 → 从中断处继续               │
└──────────────────────────────────────┘
```

## 🛠 开发

```bash
# 语法检查
node --check index.js
node --check platforms/liepin.js
node --check platforms/boss.js

# 单独测试
node index.js --account liepin-a
node index.js --account boss-a
```

## 📝 技术栈

- **运行时**: Node.js 18+
- **浏览器驱动**: Chrome DevTools Protocol (CDP) — 原生 WebSocket，零依赖
- **UI**: Electron（托盘）/ Readline（终端控制台）
- **设计原则**: 零 npm 依赖核心功能，Electron 仅用于托盘

## ⚠️ 注意事项

- 请合理控制投递频率，避免被平台风控
- Boss直聘 每日沟通上限约 120 次，达到后会自动暂停
- 建议每个平台准备 2-3 个账号轮换使用
- 使用代理/VPN 可能导致 CDP 连接不稳定

## 📄 License

MIT

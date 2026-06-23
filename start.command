#!/bin/bash
# AutoApply — macOS 双击启动脚本
# 有 Electron → 仅显示托盘图标（无终端窗口）
# 无 Electron → 启动终端控制台

cd "$(dirname "$0")"

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "❌ 未安装 Node.js"
  echo "请从 https://nodejs.org 下载安装"
  read -n 1
  exit 1
fi

# 优先托盘模式（无终端窗口）
if [ -f "./node_modules/.bin/electron" ]; then
  # 后台启动托盘，不显示终端
  nohup "./node_modules/.bin/electron" tray/main.js --disable-gpu >/dev/null 2>&1 &
  disown
  exit 0
fi

# 无 Electron → 终端控制台
echo ""
echo "📋 AutoApply 控制台"
echo "  [1] ▶ 立即运行"
echo "  [2] ⏹ 停止"
echo "  [q] 退出"
echo ""
node menu.js
echo "已退出"
read -n 1

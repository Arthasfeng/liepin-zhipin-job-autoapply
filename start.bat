@echo off
REM AutoApply — Windows 双击启动脚本
cd /d "%~dp0"

echo === AutoApply 自动投递 ===
echo.

REM 检查 Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [错误] 未安装 Node.js
    echo 请从 https://nodejs.org 下载安装
    pause
    exit /b 1
)

echo [1] ▶ 立即运行所有账号
echo [2] ▶ 仅运行猎聘
echo [3] ▶ 仅运行Boss直聘
echo [4] ⏹ 停止
echo [5] 🖥️ 启动托盘
echo [q] 退出
echo.

set /p choice="选择: "

if "%choice%"=="1" node index.js
if "%choice%"=="2" node index.js --account liepin-a
if "%choice%"=="3" node index.js --account boss-a
if "%choice%"=="5" start electron tray/main.js
if "%choice%"=="q" exit /b 0

pause

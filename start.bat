@echo off
echo ========================================
echo   DSH Desktop - 启动类 ChatGPT 桌面端
echo ========================================
echo.

REM 检查 node_modules 是否存在
if not exist "node_modules" (
    echo [1/2] 首次运行，正在安装依赖...
    call npm install
    echo.
)

echo [2/2] 启动 DSH Desktop...
echo.
echo 提示：应用会自动启动 DSH Web 服务，首次可能需要等待 10-30 秒
echo 快捷键: Ctrl+Shift+D 呼出/隐藏窗口
echo.

call npm start

pause

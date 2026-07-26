@echo off
chcp 65001 >nul
title 部署 blades-of-hex

:: ============================================================
:: blades-of-hex 一键部署脚本
:: 用法：双击运行，或从命令行执行
:: ============================================================

setlocal enabledelayedexpansion

:: 项目根目录（脚本所在目录）
set PROJECT_DIR=%~dp0
cd /d "%PROJECT_DIR%"

:: ---- 1. Git 提交 ----
set /p COMMIT_MSG=请输入提交信息（直接回车使用默认）:
if "%COMMIT_MSG%"=="" set COMMIT_MSG=auto-deploy

echo.
echo [1/5] Git 提交...
git add -A
git commit -m "%COMMIT_MSG%"
if %ERRORLEVEL% neq 0 (
    echo ! Git 提交失败（可能没有改动），继续推送...
)

:: ---- 2. Git 推送 ----
echo.
echo [2/5] Git 推送...
git push
if %ERRORLEVEL% neq 0 (
    echo ! Git 推送失败，请检查网络连接
    pause
    exit /b 1
)

:: ---- 3. 服务器拉取 ----
echo.
echo [3/5] 服务器拉取最新代码...
ssh -i D:/Frostrain.pem -o StrictHostKeyChecking=no root@116.62.179.231 "cd /root/blades-of-hex && git pull"
if %ERRORLEVEL% neq 0 (
    echo ! 服务器拉取失败
    pause
    exit /b 1
)

:: ---- 4. 服务器构建 ----
echo.
echo [4/5] 服务器构建...
ssh -i D:/Frostrain.pem root@116.62.179.231 "cd /root/blades-of-hex && npm run build"
if %ERRORLEVEL% neq 0 (
    echo ! 服务器构建失败
    pause
    exit /b 1
)

:: ---- 5. 服务器重启 ----
echo.
echo [5/5] 服务器重启...
ssh -i D:/Frostrain.pem root@116.62.179.231 "cd /root/blades-of-hex && pm2 restart blades-of-hex"
if %ERRORLEVEL% neq 0 (
    echo ! 服务器重启失败
    pause
    exit /b 1
)

echo.
echo ====== 部署完成 ======
pause

@echo off
echo === Blades of Hex v2.0 ===
echo Installing dependencies...
call npm install
echo.
echo Starting server...
node server.js
pause

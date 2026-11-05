@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found on this computer.
  echo Install Node.js 18 or newer from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not defined PORT set PORT=4400
set URL=http://127.0.0.1:%PORT%

if not exist "node_modules" (
  call npm install
)

start "" cmd /c "timeout /t 2 >nul && start chrome %URL% || start %URL%"
node server\index.js

endlocal

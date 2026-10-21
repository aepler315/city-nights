@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 LTS from https://nodejs.org/ and try again.
  pause
  exit /b 1
)
echo Preparing City Nights...
call npm install
if errorlevel 1 (
  echo Dependency setup failed. Check your internet connection and Node.js version.
  pause
  exit /b 1
)
echo Starting http://localhost:5173
call npm run dev -- --open
pause

@echo off
setlocal EnableExtensions
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN-HISTORICAL-L2-REPLAY.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo Historical replay stopped with exit code %RC%.
pause
exit /b %RC%

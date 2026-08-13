@echo off
setlocal EnableExtensions
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-30-DAY-EVIDENCE.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo Collector supervisor stopped with exit code %RC%.
pause
exit /b %RC%

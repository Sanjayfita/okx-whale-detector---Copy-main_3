@echo off
setlocal EnableExtensions
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-30-DAY-EVIDENCE.ps1" -RemoveResumeTask
if errorlevel 1 (
  echo.
  echo Could not remove the task automatically.
  pause
  exit /b 1
)
echo.
echo Automatic logon/reboot resume is disabled.
pause

@echo off
setlocal EnableExtensions
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0START-30-DAY-EVIDENCE.ps1" -InstallResumeTask
if errorlevel 1 (
  echo.
  echo Could not register automatic logon resume. The 30-day collector can still run normally while its supervisor window remains open.
  pause
  exit /b 1
)
echo.
echo Automatic logon/reboot resume registered.
pause

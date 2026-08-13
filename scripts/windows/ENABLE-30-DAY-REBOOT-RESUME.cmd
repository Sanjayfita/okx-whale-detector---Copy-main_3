@echo off
setlocal
set "SCRIPT=%~dp0START-30-DAY-EVIDENCE.cmd"
schtasks /Create /F /SC ONLOGON /TN "OKX 30-Day Evidence Collector" /TR "\"%SCRIPT%\"" /RL LIMITED
if errorlevel 1 (
  echo Failed to register the per-user logon task.
  pause
  exit /b 1
)
echo Registered. The collector launcher will start at the next Windows logon.
echo Disable it with DISABLE-30-DAY-REBOOT-RESUME.cmd when the 30-day run is finished.
pause

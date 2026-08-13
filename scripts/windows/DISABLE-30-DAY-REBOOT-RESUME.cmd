@echo off
schtasks /Delete /F /TN "OKX 30-Day Evidence Collector"
echo Reboot/logon resume task removed.
pause

@echo off
REM Sync Monday → Supabase a cada 15 minutos.
REM Configura no Task Scheduler:
REM   - Trigger: Daily, repeat task every 15 minutes, indefinitely
REM   - Action: Start a program → este .bat
REM   - Run whether user is logged on or not (pra rodar 24/7)
REM
REM Modo `auto`: smart delta — só puxa do Monday o que mudou desde último sync.

cd /d "%~dp0\.."
python scripts\sync_monday_to_supabase.py --mode=auto >> scripts\sync_monday.log 2>&1
exit /b %ERRORLEVEL%

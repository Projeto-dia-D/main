@echo off
REM Backfill INICIAL: puxa TODO o histórico (180 dias) do Monday pro Supabase.
REM Roda UMA VEZ na primeira instalação. Depois deixa o sync_monday_15min.bat
REM cuidar do delta.

cd /d "%~dp0\.."
echo === Backfill Monday → Supabase (180 dias) ===
echo Isso pode levar de 5 a 15 minutos. Aguarde.
python scripts\sync_monday_to_supabase.py --mode=backfill
echo.
echo Pronto. Agora agende o sync_monday_15min.bat no Task Scheduler.
pause

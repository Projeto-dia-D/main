@echo off
REM Backfill inicial — puxa TODAS as mensagens (até MAX_MSGS_PER_GROUP) de
REM TODOS os grupos Burst (~540 grupos). Pode levar 30-60 min na 1ª execução.
REM
REM Roda 1 vez na instalação. Depois deixa o sync_whatsapp_domingo.bat cuidar.

cd /d "%~dp0\.."
echo === Backfill WhatsApp grupos -^> Supabase ===
echo Pode levar 30-60 min. Aguarde.
python scripts\sync_whatsapp_to_supabase.py --mode=backfill
echo.
echo Pronto. Agende o sync_whatsapp_domingo.bat no Task Scheduler (domingo 23h).
pause

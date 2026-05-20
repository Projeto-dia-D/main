@echo off
REM Sync semanal WhatsApp → Supabase.
REM Agendar no Task Scheduler pra todo DOMINGO às 23:00.
REM Modo `delta`: só puxa msgs novas desde o último sync (rápido, 5-15 min).

cd /d "%~dp0\.."
python scripts\sync_whatsapp_to_supabase.py --mode=delta >> scripts\sync_whatsapp.log 2>&1
exit /b %ERRORLEVEL%

@echo off
REM ============================================================
REM Backfill diario — rodar via Windows Task Scheduler
REM Pega transicoes pra Feito e Manutencao dos ultimos 3 dias
REM Idempotente: nao duplica nada
REM ============================================================

cd /d "C:\Users\noteb\Documents\Dia D"

REM Cria pasta de logs se nao existir
if not exist "logs" mkdir logs

REM Roda backfill, gravando log com data
set LOG=logs\backfill_%date:~6,4%-%date:~3,2%-%date:~0,2%.log
python scripts\run_daily_backfill.py >> "%LOG%" 2>&1

exit /b %ERRORLEVEL%

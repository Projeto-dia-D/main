"""
Wrapper que roda os 2 backfills (feitos + manutenções) pros últimos N dias.
Pensado pra rodar via Windows Task Scheduler todo dia à noite.

Idempotente: pode rodar várias vezes sem duplicar (usa monday_activity_log_id).

Uso (default = últimos 3 dias):
    python scripts/run_daily_backfill.py

Customizado:
    python scripts/run_daily_backfill.py --dias 7
"""
import os
import sys
import subprocess
import datetime as dt

sys.stdout.reconfigure(encoding='utf-8')

# Default: pega últimos 3 dias (cobertura conservadora se rodar todo dia)
DIAS = 3
for i, arg in enumerate(sys.argv):
    if arg == '--dias' and i + 1 < len(sys.argv):
        DIAS = int(sys.argv[i + 1])

hoje = dt.date.today()
inicio = hoje - dt.timedelta(days=DIAS - 1)

date_from = inicio.isoformat()
date_to = hoje.isoformat()

print(f'=' * 60)
print(f'BACKFILL DIÁRIO — {date_from} até {date_to}')
print(f'Iniciado em: {dt.datetime.now().isoformat()}')
print(f'=' * 60)

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPTS_DIR)

# 1. Backfill de feitos
print()
print('>>> 1/2 — Backfill de demandas FEITAS')
result1 = subprocess.run(
    [sys.executable, os.path.join(SCRIPTS_DIR, 'backfill_feitos_central.py'),
     date_from, date_to, '--apply'],
    cwd=ROOT,
    capture_output=False,
)

# 2. Backfill de manutenções
print()
print('>>> 2/2 — Backfill de MANUTENÇÕES')
result2 = subprocess.run(
    [sys.executable, os.path.join(SCRIPTS_DIR, 'backfill_manutencoes_central.py'),
     date_from, date_to, '--apply'],
    cwd=ROOT,
    capture_output=False,
)

print()
print(f'=' * 60)
print(f'CONCLUÍDO em {dt.datetime.now().isoformat()}')
print(f'  Feitos: {"✓" if result1.returncode == 0 else "✗ FALHOU"}')
print(f'  Manutenções: {"✓" if result2.returncode == 0 else "✗ FALHOU"}')
print(f'=' * 60)

sys.exit(0 if (result1.returncode == 0 and result2.returncode == 0) else 1)

"""
Enriquece a coluna data_feito em design_demandas com a data REAL de quando
cada demanda foi marcada como "Feito" no Monday (buscado no Activity Log).

Necessário porque log_criacao é a DATA DE CRIAÇÃO do item, mas o critério
de "entregas/mês" precisa ser a DATA DE QUANDO FICOU FEITO.

Pré-requisito: rodar a migration db/migrations/005_add_data_feito.sql

Uso:
    # Dry-run (só mostra quantos seriam atualizados)
    python scripts/enrich_data_feito.py

    # Aplicar (atualiza o banco)
    python scripts/enrich_data_feito.py --apply
"""
import os
import sys
import json
import time
import datetime as dt
from collections import defaultdict
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

sys.stdout.reconfigure(encoding='utf-8')

# --- Config ---
ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '.env')
SUPABASE_URL = ''
SUPABASE_KEY = ''
MONDAY_TOKEN = ''
if os.path.exists(ENV_PATH):
    for line in open(ENV_PATH, encoding='utf-8'):
        line = line.strip()
        if not line or '=' not in line:
            continue
        k, v = line.split('=', 1)
        v = v.strip().strip('"').strip("'")
        if k.strip() == 'VITE_SUPABASE_URL':
            SUPABASE_URL = v
        elif k.strip() == 'VITE_SUPABASE_SERVICE_ROLE_SECRET':
            SUPABASE_KEY = v
        elif k.strip() == 'VITE_MONDAY_TOKEN':
            MONDAY_TOKEN = v

for var, val in [('VITE_MONDAY_TOKEN', MONDAY_TOKEN),
                 ('VITE_SUPABASE_URL', SUPABASE_URL),
                 ('VITE_SUPABASE_SERVICE_ROLE_SECRET', SUPABASE_KEY)]:
    if not val:
        print(f'ERRO: {var} não encontrado no .env')
        sys.exit(1)

MONDAY_URL = 'https://api.monday.com/v2'
# Boards que potencialmente têm transições pra "Feito" no Status do Designer.
# Central + Demandas feitas ATIVAS + Backup Demandas feitas
BOARDS = ['3519879202', '6900515649', '6900586110']

APPLY = '--apply' in sys.argv


# --- HTTP session com retry ---
def build_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(total=6, connect=6, read=6, backoff_factor=1.5,
                  status_forcelist=[429, 500, 502, 503, 504],
                  allowed_methods=['GET', 'POST'], respect_retry_after_header=True)
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
    s.mount('https://', adapter)
    s.mount('http://', adapter)
    return s


http = build_session()


def normalize_title(s: str) -> str:
    return (s or '').lower().strip().replace('ç', 'c').replace('ã', 'a').replace('é', 'e').replace('õ', 'o')


def is_feito(label: str) -> bool:
    s = (label or '').strip().lower().replace('ç', 'c').replace('ã', 'a').rstrip('.').strip()
    return s.startswith('feito')


def monday_ticks_to_iso(raw) -> str | None:
    """Monday Activity Log retorna created_at como string numérica de 17 dígitos
    (epoch * 10_000_000 — 100ns ticks). Converte pra ISO UTC."""
    if raw is None:
        return None
    try:
        n = float(raw)
    except (ValueError, TypeError):
        return str(raw)
    if not (n == n) or n <= 0:
        return None
    if n > 1e16:
        secs = n / 10_000_000
    elif n > 1e13:
        secs = n / 1_000_000
    elif n > 1e10:
        secs = n / 1_000
    else:
        secs = n
    try:
        return dt.datetime.fromtimestamp(secs, tz=dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')
    except (ValueError, OSError, OverflowError):
        return None


def iter_month_windows(start: dt.date, end: dt.date):
    cur = dt.date(start.year, start.month, 1)
    while cur <= end:
        if cur.month == 12:
            nxt = dt.date(cur.year + 1, 1, 1)
        else:
            nxt = dt.date(cur.year, cur.month + 1, 1)
        win_end = min(nxt - dt.timedelta(days=1), end)
        win_start = max(cur, start)
        yield win_start, win_end
        cur = nxt


# ============================================================
# ETAPA 1: descobre coluna "Status do Designer" em cada board
# ============================================================
print('>>> Descobrindo coluna "Status do Designer" em cada board...')
board_designer_col: dict[str, str] = {}
for board_id in BOARDS:
    res = http.post(
        MONDAY_URL,
        headers={'Authorization': MONDAY_TOKEN, 'Content-Type': 'application/json',
                 'API-Version': '2024-01'},
        json={'query': f'{{ boards(ids: [{board_id}]) {{ columns {{ id title type }} }} }}'},
        timeout=60,
    )
    col_data = res.json()
    if 'errors' in col_data:
        print(f'  ⚠ erro buscando colunas do board {board_id}: {col_data["errors"]}')
        continue
    boards = col_data.get('data', {}).get('boards', []) or []
    if not boards:
        print(f'  ⚠ board {board_id} sem retorno (talvez arquivado)')
        continue
    columns = boards[0].get('columns', [])
    STATUS_TYPES = {'color', 'status'}
    found = None
    for c in columns:
        t = normalize_title(c['title'])
        if 'designer' in t and 'status' in t and c['type'] in STATUS_TYPES:
            found = c['id']
            break
    if found:
        board_designer_col[board_id] = found
        print(f'  Board {board_id}: coluna {found}')
    else:
        print(f'  ⚠ Board {board_id}: não achei "Status do Designer"')


# ============================================================
# ETAPA 2: busca activity_logs de TODOS os boards
# (período largo: 2024-01-01 até hoje + alguns dias futuros)
# ============================================================
d_from = dt.date(2024, 1, 1)
d_to = dt.date.today() + dt.timedelta(days=30)

print()
print(f'>>> Buscando Activity Log de {len(board_designer_col)} board(s) — '
      f'{d_from} até {d_to}...')

# item_id → lista de (timestamp_iso, board_id)
item_to_feito_events: dict[str, list[str]] = defaultdict(list)


def fetch_activity_logs(board_id: str, col_id: str, from_iso: str, to_iso: str) -> list:
    logs = []
    page = 1
    while True:
        query = f'''
        {{
          boards(ids: [{board_id}]) {{
            activity_logs(
              from: "{from_iso}",
              to: "{to_iso}",
              column_ids: ["{col_id}"],
              limit: 1000,
              page: {page}
            ) {{ id event data created_at }}
          }}
        }}'''
        try:
            res = http.post(
                MONDAY_URL,
                headers={'Authorization': MONDAY_TOKEN, 'Content-Type': 'application/json',
                         'API-Version': '2024-01'},
                json={'query': query},
                timeout=60,
            )
            rj = res.json()
        except Exception as e:
            print(f'    ⚠ falha page {page}: {e}')
            return logs
        if 'errors' in rj:
            print(f'    ⚠ erro Monday: {rj["errors"]}')
            return logs
        boards = rj.get('data', {}).get('boards', []) or []
        if not boards:
            return logs
        chunk = boards[0].get('activity_logs') or []
        if not chunk:
            break
        logs.extend(chunk)
        if len(chunk) < 1000:
            break
        page += 1
    return logs


for board_id, col_id in board_designer_col.items():
    print(f'  Board {board_id} (col {col_id}):')
    for win_start, win_end in iter_month_windows(d_from, d_to):
        iso_from = f'{win_start.isoformat()}T00:00:00Z'
        iso_to = f'{win_end.isoformat()}T23:59:59Z'
        logs = fetch_activity_logs(board_id, col_id, iso_from, iso_to)
        n_feito = 0
        for log in logs:
            try:
                d = json.loads(log['data']) if isinstance(log['data'], str) else log['data']
            except Exception:
                continue
            new_val = ''
            val = d.get('value')
            if isinstance(val, dict):
                new_val = (val.get('label', {}) or {}).get('text', '') or val.get('text', '') or ''
            if not is_feito(new_val):
                continue
            item_id = str(d.get('pulse_id') or d.get('item_id') or '')
            if not item_id:
                continue
            iso = monday_ticks_to_iso(log['created_at'])
            if not iso:
                continue
            item_to_feito_events[item_id].append(iso)
            n_feito += 1
        print(f'    {win_start} → {win_end}: {len(logs)} eventos / {n_feito} viraram "Feito"')

print()
print(f'>>> {len(item_to_feito_events)} items únicos com pelo menos 1 evento "Feito"')
print()


# ============================================================
# ETAPA 3: lê banco (paginado) — só feitos sem data_feito
# ============================================================
print('>>> Lendo eventos "feito" do banco (sem data_feito populado)...')
banco_headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
banco: list[dict] = []
offset = 0
PAGE = 1000
while True:
    h = {**banco_headers, 'Range-Unit': 'items', 'Range': f'{offset}-{offset + PAGE - 1}'}
    url = (f'{SUPABASE_URL}/rest/v1/design_demandas'
           f'?tipo_evento=eq.feito'
           f'&data_feito=is.null'
           f'&monday_item_id=not.is.null'
           f'&select=id,monday_item_id,nome,log_criacao,origem'
           f'&order=id.asc')
    try:
        res = http.get(url, headers=h, timeout=60)
        chunk = res.json()
    except Exception as e:
        print(f'  ⚠ falha offset {offset}: {e}')
        break
    if not isinstance(chunk, list) or not chunk:
        break
    banco.extend(chunk)
    if len(chunk) < PAGE:
        break
    offset += PAGE

print(f'  {len(banco)} linhas pra processar')
print()


# ============================================================
# ETAPA 4: mapeia cada linha pra uma data_feito
# Strategy: pra cada item, ordena os eventos Feito por data;
# atribui sequencialmente às linhas do mesmo item no banco.
# Se sobrar linhas (banco > eventos), usa a última data.
# Se sobrar eventos (eventos > banco), perde os extras (improvável).
# ============================================================
# Agrupa linhas do banco por monday_item_id
linhas_por_item: dict[str, list[dict]] = defaultdict(list)
for row in banco:
    mid = str(row['monday_item_id'])
    linhas_por_item[mid].append(row)

updates: list[tuple] = []  # [(row_id, data_feito_iso), ...]
matched = 0
no_event = 0
for mid, linhas in linhas_por_item.items():
    eventos = sorted(item_to_feito_events.get(mid, []))
    if not eventos:
        no_event += 1
        continue
    # Ordena linhas por id (mesma ordem que o banco)
    linhas.sort(key=lambda r: r['id'])
    for i, linha in enumerate(linhas):
        ev_iso = eventos[i] if i < len(eventos) else eventos[-1]
        updates.append((linha['id'], ev_iso))
        matched += 1

print(f'>>> Linhas com data_feito identificada: {matched}')
print(f'>>> Items sem evento "Feito" no Activity Log: {no_event}')
print()

if not updates:
    print('Nada pra atualizar.')
    sys.exit(0)


# ============================================================
# ETAPA 5: UPDATE em massa
# ============================================================
if not APPLY:
    print('=' * 60)
    print('DRY-RUN — nada foi atualizado.')
    print(f'Pra atualizar de verdade {len(updates)} linhas:')
    print('  python scripts/enrich_data_feito.py --apply')
    sys.exit(0)


print(f'>>> ATUALIZANDO {len(updates)} linhas no banco...')
REST = f'{SUPABASE_URL}/rest/v1/design_demandas'
H = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
}

# Agrupa updates por data (eficiência: 1 PATCH por valor único)
# OBS: PostgREST não suporta UPDATE com lista de pares; vamos PATCH individual em batches.
# Otimização: agrupar por mesma data_feito em vez de fazer 10k requests
by_value: dict[str, list[int]] = defaultdict(list)
for row_id, iso in updates:
    by_value[iso].append(row_id)

print(f'  Agrupando: {len(by_value)} valor(es) único(s) de data_feito')

done = 0
total_groups = len(by_value)
for i, (iso, row_ids) in enumerate(by_value.items(), 1):
    # PATCH em grupos de 500 ids por chamada (URL fica grande mas funciona)
    for j in range(0, len(row_ids), 500):
        batch = row_ids[j:j + 500]
        ids_csv = ','.join(str(x) for x in batch)
        url = f'{REST}?id=in.({ids_csv})'
        try:
            r = http.patch(url, headers=H, json={'data_feito': iso}, timeout=60)
        except Exception as e:
            print(f'  ⚠ falha PATCH ({iso}): {e}')
            continue
        if r.status_code >= 300:
            print(f'  ⚠ ERRO PATCH ({r.status_code}): {r.text[:300]}')
            continue
        done += len(batch)
    if i % 100 == 0 or i == total_groups:
        print(f'  ✓ grupo {i}/{total_groups} — {done}/{len(updates)} linhas')

print()
print(f'✅ {done} linhas atualizadas com data_feito')

"""
Backfill de eventos "Feito" (Status do Designer = Feito) no board Central de Design.

Espelha o backfill de manutenções, mas pra entregas (status do designer mudando
pra "Feito"). Útil pra recuperar dias em que o webhook não estava ativo.

Fonte da verdade: Monday Activity Log da coluna "Status do Designer".
Compara com a tabela design_demandas e (com --apply) insere o que falta.

Idempotente: usa monday_activity_log_id pra evitar duplicar.

Uso:
    # Dry-run (default — só lista)
    python scripts/backfill_feitos_central.py 2026-05-01 2026-05-14

    # Aplicar
    python scripts/backfill_feitos_central.py 2026-05-01 2026-05-14 --apply

Pré-requisitos (mesmos do backfill de manutenções):
    db/migrations/003_add_central_backfill_origem.sql
    db/migrations/004_add_activity_log_id.sql
"""
import os
import re
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
BOARD_ID = '3519879202'


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


# --- Args ---
if len(sys.argv) < 3:
    print('Uso: python scripts/backfill_feitos_central.py YYYY-MM-DD YYYY-MM-DD [--apply]')
    sys.exit(1)

date_from = sys.argv[1]
date_to = sys.argv[2]
APPLY = '--apply' in sys.argv

d_from = dt.date.fromisoformat(date_from)
d_to = dt.date.fromisoformat(date_to)

print(f'Período: {date_from} até {date_to}')
print(f'Modo: {"APPLY (insere no banco)" if APPLY else "DRY-RUN (só lista)"}')
print(f'Board: {BOARD_ID} (Central de Design)')
print()


# ============================================================
# ETAPA 0: descobre coluna "Status do Designer"
# ============================================================
print('>>> Descobrindo coluna "Status do Designer"...')
res = http.post(
    MONDAY_URL,
    headers={'Authorization': MONDAY_TOKEN, 'Content-Type': 'application/json',
             'API-Version': '2024-01'},
    json={'query': f'{{ boards(ids: [{BOARD_ID}]) {{ columns {{ id title type }} }} }}'},
    timeout=60,
)
col_data = res.json()
if 'errors' in col_data:
    print(f'ERRO Monday: {col_data["errors"]}')
    sys.exit(1)
columns = col_data['data']['boards'][0]['columns']
STATUS_TYPES = {'color', 'status'}


def normalize_title(s: str) -> str:
    return (s or '').lower().strip().replace('ç', 'c').replace('ã', 'a').replace('é', 'e').replace('õ', 'o')


# Procura coluna "Status do Designer" (sem o "gestor", que é a outra)
status_designer_col = None
for c in columns:
    title_norm = normalize_title(c['title'])
    if 'designer' in title_norm and 'status' in title_norm and c['type'] in STATUS_TYPES:
        status_designer_col = c
        break

if not status_designer_col:
    print('ERRO: não achei coluna "Status do Designer". Colunas disponíveis:')
    for c in columns:
        print(f'  {c["id"]:30s} {c["type"]:15s} {c["title"]}')
    sys.exit(1)

STATUS_DESIGNER_COL_ID = status_designer_col['id']
print(f'  Coluna escolhida: id={STATUS_DESIGNER_COL_ID} title="{status_designer_col["title"]}"')
COL_TITLE_BY_ID = {c['id']: c['title'] for c in columns}
print()


# ============================================================
# ETAPA 1: busca activity_logs em janelas mensais
# ============================================================
def fetch_activity_logs(from_iso: str, to_iso: str) -> list:
    logs = []
    page = 1
    while True:
        query = f'''
        {{
          boards(ids: [{BOARD_ID}]) {{
            activity_logs(
              from: "{from_iso}",
              to: "{to_iso}",
              column_ids: ["{STATUS_DESIGNER_COL_ID}"],
              limit: 1000,
              page: {page}
            ) {{ id event data entity created_at }}
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
            print(f'  ⚠ falha em activity_logs page {page}: {e}')
            return logs
        if 'errors' in rj:
            print(f'  ERRO Monday: {rj["errors"]}')
            return logs
        chunk = rj['data']['boards'][0]['activity_logs'] or []
        if not chunk:
            break
        logs.extend(chunk)
        if len(chunk) < 1000:
            break
        page += 1
    return logs


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


print('>>> Buscando activity_logs (janelas mensais)...')
all_logs = []
for win_start, win_end in iter_month_windows(d_from, d_to):
    iso_from = f'{win_start.isoformat()}T00:00:00Z'
    iso_to = f'{win_end.isoformat()}T23:59:59Z'
    logs = fetch_activity_logs(iso_from, iso_to)
    all_logs.extend(logs)
    print(f'  {win_start} → {win_end}: {len(logs)} evento(s)')

print(f'  Total: {len(all_logs)} eventos da coluna')
print()


# ============================================================
# ETAPA 2: filtra eventos que viraram "Feito"
# ============================================================
def is_feito(label: str) -> bool:
    s = (label or '').strip().lower().replace('ç', 'c').replace('ã', 'a').rstrip('.').strip()
    return s.startswith('feito')


TESTE_RE = re.compile(r'^\s*(teste|test|koko|atraso\s*-\s*teste)(\s+\d+)?\s*$', re.IGNORECASE)


feito_events = []
descartados_outros = 0
descartados_teste = 0
for log in all_logs:
    try:
        d = json.loads(log['data']) if isinstance(log['data'], str) else log['data']
    except Exception:
        continue
    new_val = ''
    val = d.get('value')
    if isinstance(val, dict):
        new_val = (val.get('label', {}) or {}).get('text', '') or val.get('text', '') or ''
    if not is_feito(new_val):
        descartados_outros += 1
        continue
    item_name = d.get('pulse_name', '') or ''
    if TESTE_RE.match(item_name):
        descartados_teste += 1
        continue
    feito_events.append({
        'log_id': str(log.get('id') or ''),
        'item_id': str(d.get('pulse_id') or d.get('item_id') or ''),
        'item_name': item_name or '(sem nome)',
        'created_at': log['created_at'],
    })

print(f'>>> Eventos de "Feito": {len(feito_events)}')
if descartados_outros:
    print(f'    (descartados {descartados_outros} eventos com outros status)')
if descartados_teste:
    print(f'    (descartados {descartados_teste} de items "teste/koko")')
print()


# ============================================================
# ETAPA 3: lê banco (paginado)
# ============================================================
print('>>> Lendo eventos de "feito" do banco...')
banco_headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
banco: list[dict] = []
offset = 0
PAGE = 1000
while True:
    h = {**banco_headers, 'Range-Unit': 'items', 'Range': f'{offset}-{offset + PAGE - 1}'}
    url = (f'{SUPABASE_URL}/rest/v1/design_demandas'
           f'?tipo_evento=eq.feito'
           f'&select=id,nome,monday_item_id,log_criacao,tipo_evento,origem,monday_activity_log_id'
           f'&order=id.asc')
    try:
        res = http.get(url, headers=h, timeout=60)
        chunk = res.json()
    except Exception as e:
        print(f'  ⚠ falha lendo banco offset {offset}: {e}')
        break
    if not isinstance(chunk, list) or not chunk:
        break
    banco.extend(chunk)
    if len(chunk) < PAGE:
        break
    offset += PAGE
print(f'  {len(banco)} eventos "feito" no banco (todos os períodos)')


already_inserted_log_ids = {
    str(r.get('monday_activity_log_id'))
    for r in banco
    if r.get('monday_activity_log_id')
}
print(f'  {len(already_inserted_log_ids)} já têm monday_activity_log_id (runs anteriores)')

# IMPORTANTE: o banco já tem MUITOS feitos vindos de outras origens (webhook,
# xlsx) que NÃO têm monday_activity_log_id setado. Pra NÃO duplicar esses,
# montamos um índice (monday_item_id, data) — se o item já tem evento no banco
# no mesmo dia, pulamos no insert.
def _parse_log_date(s):
    if not s: return None
    s = str(s)
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', s)
    if m:
        try: return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except: pass
    EN={'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12}
    m = re.search(r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})', s, re.IGNORECASE)
    if m:
        try: return dt.date(int(m.group(3)), EN[m.group(1).lower()[:3]], int(m.group(2)))
        except: pass
    return None

existing_item_dates: set = set()  # (monday_item_id, data_iso)
for r in banco:
    mid = r.get('monday_item_id')
    if not mid: continue
    d = _parse_log_date(r.get('log_criacao'))
    if d:
        existing_item_dates.add((str(mid), d.isoformat()))
print(f'  {len(existing_item_dates)} pares (item,dia) já no banco — pulando na inserção')


# Parser de log_criacao (mesmo do script de manutenções)
EN_MONTHS = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
             'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}
PT_MONTHS = {'jan': 1, 'fev': 2, 'mar': 3, 'abr': 4, 'mai': 5, 'jun': 6,
             'jul': 7, 'ago': 8, 'set': 9, 'out': 10, 'nov': 11, 'dez': 12}

DATE_REGEXES = [
    (re.compile(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})', re.IGNORECASE),
     lambda m: dt.date(int(m.group(3)), EN_MONTHS[m.group(1).lower()[:3]], int(m.group(2)))),
    (re.compile(r'\b(\d{1,2})\s+(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\s+(?:de\s+)?(\d{4})', re.IGNORECASE),
     lambda m: dt.date(int(m.group(3)), PT_MONTHS[m.group(2).lower()[:3]], int(m.group(1)))),
    (re.compile(r'(\d{4})-(\d{2})-(\d{2})'),
     lambda m: dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))),
    (re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})'),
     lambda m: dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))),
    (re.compile(r'(\d{1,2})-(\d{1,2})-(\d{4})'),
     lambda m: dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))),
    (re.compile(r'(\d{1,2})/(\d{1,2})/(\d{2})\b'),
     lambda m: dt.date(2000 + int(m.group(3)), int(m.group(2)), int(m.group(1)))),
    (re.compile(r'(\d{1,2})-(\d{1,2})-(\d{2})\b'),
     lambda m: dt.date(2000 + int(m.group(3)), int(m.group(2)), int(m.group(1)))),
]


def parse_log_data(s):
    if not s:
        return None
    s = str(s).strip()
    if not s:
        return None
    for rx, builder in DATE_REGEXES:
        m = rx.search(s)
        if m:
            try:
                return builder(m)
            except (ValueError, TypeError):
                continue
    return None


def norm_name(s):
    return (s or '').strip().lower()


banco_periodo = []
for row in banco:
    d = parse_log_data(row.get('log_criacao'))
    if d and d_from <= d <= d_to:
        banco_periodo.append(row)
print(f'  {len(banco_periodo)} eventos no período {date_from}..{date_to}')
print()


# ============================================================
# ETAPA 4: identifica órfãos
# ============================================================
banco_by_item: dict[str, list] = defaultdict(list)
banco_by_name: dict[str, list] = defaultdict(list)
for row in banco_periodo:
    mid = row.get('monday_item_id')
    if mid:
        banco_by_item[str(mid)].append(row)
    nm = norm_name(row.get('nome'))
    if nm:
        banco_by_name[nm].append(row)

monday_by_item: dict[str, list] = defaultdict(list)
for ev in feito_events:
    if ev['item_id']:
        monday_by_item[ev['item_id']].append(ev)

orfaos = []
for item_id, events in monday_by_item.items():
    banco_count = len(banco_by_item.get(item_id, []))
    if banco_count == 0 and events:
        nm = norm_name(events[0]['item_name'])
        if nm and nm in banco_by_name:
            sem_id = [r for r in banco_by_name[nm] if not r.get('monday_item_id')]
            banco_count = len(sem_id)

    monday_count = len(events)
    if monday_count > banco_count:
        diff = monday_count - banco_count
        sorted_evs = sorted(events, key=lambda e: e['created_at'], reverse=True)
        for i in range(diff):
            orfaos.append(sorted_evs[i] if i < len(sorted_evs) else sorted_evs[-1])

def _orfao_data_iso(o):
    """Data ISO do evento Activity Log do Monday (created_at em ticks)."""
    try:
        n = float(o['created_at'])
        if n > 1e16: secs = n / 10_000_000
        elif n > 1e13: secs = n / 1_000_000
        elif n > 1e10: secs = n / 1_000
        else: secs = n
        return dt.datetime.fromtimestamp(secs, tz=dt.timezone.utc).date().isoformat()
    except (ValueError, TypeError):
        return None

# Filtra órfãos: pula os já processados via log_id E os que já existem no banco
# como (monday_item_id, data) — evita duplicar com webhook/xlsx
orfaos_novos = []
ja_log_id = 0
ja_item_data = 0
for o in orfaos:
    if o['log_id'] in already_inserted_log_ids:
        ja_log_id += 1
        continue
    data_iso = _orfao_data_iso(o)
    if data_iso and (o['item_id'], data_iso) in existing_item_dates:
        ja_item_data += 1
        continue
    orfaos_novos.append(o)
ja_processados = ja_log_id + ja_item_data

print(f'>>> Comparativo:')
print(f'  Monday (eventos feito): {len(feito_events)}')
print(f'  Banco (eventos feito no período): {len(banco_periodo)}')
print(f'  Órfãos detectados (bruto): {len(orfaos)}')
if ja_log_id:
    print(f'  Já têm monday_activity_log_id no banco: {ja_log_id} (pulando)')
if ja_item_data:
    print(f'  Já existem como (item,dia) no banco: {ja_item_data} (pulando — evita duplicar)')
print(f'  Órfãos para processar agora: {len(orfaos_novos)}')
print()

if not orfaos_novos:
    print('✅ Sem órfãos novos — banco está alinhado.')
    sys.exit(0)


# ============================================================
# ETAPA 5: busca dados via Monday em BATCH
# ============================================================
COLUMN_MAP = {
    'link da demanda': 'link_demanda',
    'designer responsavel': 'designer_responsavel',
    'designer responsável': 'designer_responsavel',
    'padrao tarefa': 'padrao_tarefa',
    'padrão tarefa': 'padrao_tarefa',
    'tipo de edicao': 'tipo_edicao',
    'tipo de edição': 'tipo_edicao',
    'log de criacao': 'log_criacao',
    'log de criação': 'log_criacao',
    'clientes': 'clientes',
    'prioridade': 'prioridade',
    'tempo atrasado!!!': 'tempo_atrasado',
    'tempo atrasado': 'tempo_atrasado',
    'status da tarefa': 'status_tarefa',
    'status do designer': 'status_designer',
    'priority': 'priority',
    'status principal': 'status_principal',
    'status individual': 'status_individual',
    'gestor responsavel': 'gestor_responsavel',
    'gestor responsável': 'gestor_responsavel',
    'tipo de manutencao': 'tipo_manutencao',
    'tipo de manutenção': 'tipo_manutencao',
}


def fetch_items_batch(item_ids: list) -> dict:
    if not item_ids:
        return {}
    query = '''
    query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        name
        column_values { id text type }
      }
    }'''
    try:
        res = http.post(
            MONDAY_URL,
            headers={'Authorization': MONDAY_TOKEN, 'Content-Type': 'application/json',
                     'API-Version': '2024-01'},
            json={'query': query, 'variables': {'ids': item_ids}},
            timeout=120,
        )
        rj = res.json()
    except Exception as e:
        print(f'    ⚠ falha no batch ({len(item_ids)} items): {e}')
        return {}
    if 'errors' in rj:
        print(f'    ⚠ erro Monday no batch: {rj["errors"]}')
        return {}
    items = rj.get('data', {}).get('items', []) or []
    return {str(it['id']): it for it in items}


def monday_time_to_iso(raw):
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
        return dt.datetime.fromtimestamp(secs, tz=dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    except (ValueError, OSError, OverflowError):
        return str(raw)


def build_record(item: dict, ev: dict) -> dict:
    rec = {
        'nome': item.get('name'),
        'monday_item_id': str(item.get('id')),
        'monday_activity_log_id': ev['log_id'],
        'origem': 'central_backfill',
        'tipo_evento': 'feito',
        'link_demanda': f'{item.get("name")} - https://burstmidia.monday.com/boards/{BOARD_ID}/pulses/{item.get("id")}',
        'log_criacao': monday_time_to_iso(ev['created_at']) or '',
    }
    for cv in (item.get('column_values') or []):
        title = COL_TITLE_BY_ID.get(cv['id'], cv['id'])
        key = COLUMN_MAP.get(normalize_title(title))
        if key == 'log_criacao':
            continue
        if key and cv.get('text'):
            rec[key] = cv['text']
    return rec


unique_ids = sorted({o['item_id'] for o in orfaos_novos if o['item_id']})
print(f'>>> Buscando {len(unique_ids)} items únicos via Monday (batch de 25)...')

items_map: dict = {}
BATCH = 25
for i in range(0, len(unique_ids), BATCH):
    batch = unique_ids[i:i + BATCH]
    res = fetch_items_batch(batch)
    items_map.update(res)
    print(f'  {min(i + BATCH, len(unique_ids))}/{len(unique_ids)} ({len(res)} retornados)')
    time.sleep(0.3)

items_nao_encontrados = len(unique_ids) - len(items_map)
if items_nao_encontrados:
    print(f'  (⚠ {items_nao_encontrados} items não existem mais — serão pulados)')
print()


# ============================================================
# ETAPA 6: monta registros e (se --apply) insere
# ============================================================
records_to_insert = []
skipped_no_item = 0
for ev in orfaos_novos:
    item = items_map.get(ev['item_id'])
    if not item:
        skipped_no_item += 1
        continue
    rec = build_record(item, ev)
    records_to_insert.append(rec)

print(f'>>> {len(records_to_insert)} registro(s) prontos para inserir')
if skipped_no_item:
    print(f'  ({skipped_no_item} órfão(s) pulado(s): item deletado do Monday)')
print()

if not APPLY:
    print('=' * 60)
    print('DRY-RUN — nada foi inserido.')
    print('Pra inserir de verdade:')
    print(f'  python scripts/backfill_feitos_central.py {date_from} {date_to} --apply')
    sys.exit(0)


print('>>> INSERINDO no banco...')
REST = f'{SUPABASE_URL}/rest/v1/design_demandas'
HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
}

all_keys = set()
for rec in records_to_insert:
    all_keys.update(rec.keys())
all_keys = sorted(all_keys)
normalized = [{k: rec.get(k) for k in all_keys} for rec in records_to_insert]

inseridos = 0
for i in range(0, len(normalized), 100):
    chunk = normalized[i:i + 100]
    try:
        r = http.post(REST, headers=HEADERS, json=chunk, timeout=60)
    except Exception as e:
        print(f'  ⚠ falha no insert chunk {i}: {e} — rode de novo (é idempotente)')
        sys.exit(1)
    if r.status_code >= 300:
        print(f'  ERRO insert ({r.status_code}): {r.text[:500]}')
        sys.exit(1)
    inseridos += len(chunk)
    print(f'  ✓ {inseridos}/{len(normalized)}')

print()
print(f'✅ {inseridos} eventos de "feito" inseridos com origem=central_backfill')

"""
Backfill genérico de eventos de Manutenção/Manutenção C no board Central de Design.

Fonte da verdade: Monday Activity Log da coluna "Status gestor responsável".
Compara com a tabela design_demandas e (com --apply) insere o que falta.

Idempotente: pode rodar várias vezes — usa monday_activity_log_id pra evitar duplicar.

Uso:
    python scripts/backfill_manutencoes_central.py 2024-01-01 2026-05-13
    python scripts/backfill_manutencoes_central.py 2024-01-01 2026-05-13 --apply

IMPORTANTE: antes do primeiro uso, rode no Supabase SQL Editor:
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
STATUS_GESTOR_COL_ID = 'status_13'

# --- HTTP session com retry/backoff (resiliente a SSL flaky, 429, 5xx) ---
def build_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=6,
        connect=6,
        read=6,
        backoff_factor=1.5,           # 1.5, 3, 6, 12, 24, 48s
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=['GET', 'POST'],
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
    s.mount('https://', adapter)
    s.mount('http://', adapter)
    return s


http = build_session()


# --- Args ---
if len(sys.argv) < 3:
    print('Uso: python scripts/backfill_manutencoes_central.py YYYY-MM-DD YYYY-MM-DD [--apply]')
    sys.exit(1)

date_from = sys.argv[1]
date_to = sys.argv[2]
APPLY = '--apply' in sys.argv

d_from = dt.date.fromisoformat(date_from)
d_to = dt.date.fromisoformat(date_to)

print(f'Período: {date_from} até {date_to}')
print(f'Modo: {"APPLY (insere no banco)" if APPLY else "DRY-RUN (só lista)"}')
print(f'Board: {BOARD_ID} (Central de Design)')
print(f'Coluna: {STATUS_GESTOR_COL_ID}')
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
              column_ids: ["{STATUS_GESTOR_COL_ID}"],
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
            print(f'  ⚠ falha em activity_logs page {page}: {e} — tentando próxima janela')
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
# ETAPA 2: filtra eventos REAIS de manutenção
# ============================================================
def is_real_manut(label: str) -> bool:
    s = (label or '').strip().lower().replace('ç', 'c').replace('ã', 'a').rstrip('.').strip()
    if s in ('manutencao', 'manut'):
        return True
    if s.startswith('manutencao c') or s.startswith('manut c') or s.startswith('manut. c'):
        return True
    return False


def infer_tipo_evento(label: str) -> str:
    s = (label or '').strip().lower().replace('ç', 'c').replace('ã', 'a').rstrip('.').strip()
    if s.startswith('manutencao c') or s.startswith('manut c') or s.startswith('manut. c'):
        return 'manutencao_c'
    return 'manutencao'


TESTE_RE = re.compile(r'^\s*(teste|test|koko|atraso\s*-\s*teste)(\s+\d+)?\s*$', re.IGNORECASE)


manut_events = []
descartados_validar = 0
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
    nv = (new_val or '').strip().lower()
    if 'manut' not in nv:
        continue
    if not is_real_manut(new_val):
        descartados_validar += 1
        continue
    item_name = d.get('pulse_name', '') or ''
    if TESTE_RE.match(item_name):
        descartados_teste += 1
        continue
    manut_events.append({
        'log_id': str(log.get('id') or ''),
        'item_id': str(d.get('pulse_id') or d.get('item_id') or ''),
        'item_name': item_name or '(sem nome)',
        'novo_status': new_val,
        'tipo_evento': infer_tipo_evento(new_val),
        'created_at': log['created_at'],
    })

print(f'>>> Eventos reais de Manutenção/Manutenção C: {len(manut_events)}')
if descartados_validar:
    print(f'    (descartados {descartados_validar} de "Validar manutenção")')
if descartados_teste:
    print(f'    (descartados {descartados_teste} de items "teste/koko")')
print()


# ============================================================
# ETAPA 3: lê banco (paginado)
# ============================================================
print('>>> Lendo eventos de manutenção do banco...')
banco_headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
banco: list[dict] = []
offset = 0
PAGE = 1000
while True:
    h = {**banco_headers, 'Range-Unit': 'items', 'Range': f'{offset}-{offset + PAGE - 1}'}
    url = (f'{SUPABASE_URL}/rest/v1/design_demandas'
           f'?tipo_evento=in.(manutencao,manutencao_c)'
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
print(f'  {len(banco)} eventos no banco (todos os períodos)')


# Set de log_ids já processados pelo backfill (idempotência forte)
already_inserted_log_ids = {
    str(r.get('monday_activity_log_id'))
    for r in banco
    if r.get('monday_activity_log_id')
}
print(f'  {len(already_inserted_log_ids)} eventos já têm monday_activity_log_id (do backfill anterior)')

# Idempotência fraca pra eventos vindos de outras origens (sem log_id setado).
# Vai ser populado depois que parse_log_data for definido.
existing_item_data: set = set()  # (monday_item_id, tipo_evento, data_iso)


# Parser de log_criacao
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
    # Popula índice (item, tipo, data) pra idempotência fraca
    mid = row.get('monday_item_id')
    te = row.get('tipo_evento')
    if mid and te and d:
        existing_item_data.add((str(mid), te, d.isoformat()))
print(f'  {len(banco_periodo)} eventos no período {date_from}..{date_to}')
print(f'  {len(existing_item_data)} pares (item,tipo,dia) no banco — pulando na inserção')
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
for ev in manut_events:
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

# Idempotência forte: log_id já no banco
# Idempotência fraca: (item, tipo, data) já no banco (evita duplicar com webhook/xlsx)
def _orfao_data_iso(o):
    try:
        n = float(o['created_at'])
        if n > 1e16: secs = n / 10_000_000
        elif n > 1e13: secs = n / 1_000_000
        elif n > 1e10: secs = n / 1_000
        else: secs = n
        return dt.datetime.fromtimestamp(secs, tz=dt.timezone.utc).date().isoformat()
    except (ValueError, TypeError):
        return None

orfaos_novos = []
ja_log_id = 0
ja_item_data = 0
for o in orfaos:
    if o['log_id'] in already_inserted_log_ids:
        ja_log_id += 1
        continue
    data_iso = _orfao_data_iso(o)
    if data_iso and (o['item_id'], o['tipo_evento'], data_iso) in existing_item_data:
        ja_item_data += 1
        continue
    orfaos_novos.append(o)
ja_processados = ja_log_id + ja_item_data

print(f'>>> Comparativo:')
print(f'  Monday (eventos): {len(manut_events)}')
print(f'  Banco (eventos no período): {len(banco_periodo)}')
print(f'  Órfãos detectados (bruto): {len(orfaos)}')
if ja_log_id:
    print(f'  Já têm monday_activity_log_id no banco: {ja_log_id} (pulando)')
if ja_item_data:
    print(f'  Já existem como (item,tipo,dia) no banco: {ja_item_data} (pulando — evita duplicar)')
print(f'  Órfãos para processar agora: {len(orfaos_novos)}')
print()

if not orfaos_novos:
    print('✅ Sem órfãos novos — banco está alinhado.')
    sys.exit(0)


# ============================================================
# ETAPA 5: busca dados via Monday em BATCH (25 items por query)
# ============================================================
print('>>> Buscando títulos das colunas do board...')
try:
    col_res = http.post(
        MONDAY_URL,
        headers={'Authorization': MONDAY_TOKEN, 'Content-Type': 'application/json',
                 'API-Version': '2024-01'},
        json={'query': f'{{ boards(ids: [{BOARD_ID}]) {{ columns {{ id title }} }} }}'},
        timeout=60,
    )
    col_data = col_res.json()
    COL_TITLE_BY_ID = {c['id']: c['title'] for c in col_data['data']['boards'][0]['columns']}
except Exception as e:
    print(f'ERRO buscando colunas: {e}')
    sys.exit(1)

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


def normalize_title(s: str) -> str:
    return (s or '').lower().strip().replace('ç', 'c').replace('ã', 'a').replace('é', 'e').replace('õ', 'o')


def fetch_items_batch(item_ids: list) -> dict:
    """Busca múltiplos items de uma vez. Retorna {id: item_dict}."""
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


def monday_time_to_iso(raw) -> str | None:
    """Monday Activity Log retorna created_at como string numérica de 17 dígitos
    (epoch * 10_000_000 — formato "ticks" de 100ns). Outros endpoints podem
    retornar em ms, us, ou ISO. Detecta pela magnitude e devolve ISO."""
    if raw is None:
        return None
    try:
        n = float(raw)
    except (ValueError, TypeError):
        return str(raw)  # já é string ISO ou similar
    if not (n == n) or n <= 0:  # NaN / zero
        return None
    if n > 1e16:
        secs = n / 10_000_000   # 100ns ticks (Monday activity_log)
    elif n > 1e13:
        secs = n / 1_000_000    # microsegundos
    elif n > 1e10:
        secs = n / 1_000        # milissegundos
    else:
        secs = n                # já em segundos
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
        'tipo_evento': ev['tipo_evento'],
        'link_demanda': f'{item.get("name")} - https://burstmidia.monday.com/boards/{BOARD_ID}/pulses/{item.get("id")}',
        # IMPORTANTE: pra eventos de manutenção, a "data" relevante é QUANDO o
        # status mudou pra Manutenção (created_at do activity log), não a data
        # de criação original do item. Monday retorna como 100ns ticks; vira ISO.
        'log_criacao': monday_time_to_iso(ev['created_at']) or '',
    }
    for cv in (item.get('column_values') or []):
        title = COL_TITLE_BY_ID.get(cv['id'], cv['id'])
        key = COLUMN_MAP.get(normalize_title(title))
        # NÃO sobrescreve log_criacao com o do item — já setamos com o do evento
        if key == 'log_criacao':
            continue
        if key and cv.get('text'):
            rec[key] = cv['text']
    return rec


# Coleta unique item_ids dos órfãos
unique_ids = sorted({o['item_id'] for o in orfaos_novos if o['item_id']})
print(f'>>> Buscando {len(unique_ids)} items únicos via Monday (batch de 25)...')

items_map: dict = {}
BATCH = 25
for i in range(0, len(unique_ids), BATCH):
    batch = unique_ids[i:i + BATCH]
    res = fetch_items_batch(batch)
    items_map.update(res)
    print(f'  {min(i + BATCH, len(unique_ids))}/{len(unique_ids)} ({len(res)} retornados)')
    time.sleep(0.3)  # rate limit suave entre batches

items_nao_encontrados = len(unique_ids) - len(items_map)
if items_nao_encontrados:
    print(f'  (⚠ {items_nao_encontrados} items não existem mais no Monday — serão pulados)')
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
    print(f'  python scripts/backfill_manutencoes_central.py {date_from} {date_to} --apply')
    sys.exit(0)


print('>>> INSERINDO no banco...')
REST = f'{SUPABASE_URL}/rest/v1/design_demandas'
HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
}

# PostgREST exige que TODOS os objects no batch tenham as MESMAS chaves.
# Normaliza completando com None as chaves ausentes em cada record.
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
        print(f'  ⚠ falha no insert chunk {i}: {e} — tente rodar novamente (é idempotente)')
        sys.exit(1)
    if r.status_code >= 300:
        print(f'  ERRO insert ({r.status_code}): {r.text[:500]}')
        sys.exit(1)
    inseridos += len(chunk)
    print(f'  ✓ {inseridos}/{len(normalized)}')

print()
print(f'✅ {inseridos} eventos de manutenção inseridos com origem=central_backfill')

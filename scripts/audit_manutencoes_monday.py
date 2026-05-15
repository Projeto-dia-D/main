"""
Audita manutenções comparando 2 fontes:
  1. Monday Activity Log do board Central de Design (3519879202) — fonte da verdade
  2. design_demandas no Supabase — o que o app usa

Mostra:
  - Quantas mudanças "Status do Gestor → Manutenção/Manutenção C" rolaram no período
  - Quantas dessas estão no banco
  - Lista os items que estão na verdade do Monday mas faltam no banco

Uso:
  python scripts/audit_manutencoes_monday.py 2026-03-01 2026-03-31
"""
import os
import re
import sys
import json
import datetime as dt
from collections import defaultdict
import requests

sys.stdout.reconfigure(encoding='utf-8')

# --- Config: lê do .env ---
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

for var, val in [('VITE_MONDAY_TOKEN', MONDAY_TOKEN), ('VITE_SUPABASE_URL', SUPABASE_URL),
                 ('VITE_SUPABASE_SERVICE_ROLE_SECRET', SUPABASE_KEY)]:
    if not val:
        print(f'ERRO: {var} não encontrado no .env')
        sys.exit(1)

MONDAY_URL = 'https://api.monday.com/v2'
BOARD_ID = '3519879202'  # Central de Design

# --- Args ---
if len(sys.argv) < 3:
    print('Uso: python scripts/audit_manutencoes_monday.py YYYY-MM-DD YYYY-MM-DD [column_id]')
    print('     (column_id é opcional — se omitido tenta achar automaticamente)')
    sys.exit(1)
date_from = sys.argv[1]
date_to = sys.argv[2]
forced_col_id = sys.argv[3] if len(sys.argv) > 3 else None
iso_from = f'{date_from}T00:00:00Z'
iso_to = f'{date_to}T23:59:59Z'

print(f'Período: {date_from} até {date_to}')
print(f'Board: {BOARD_ID} (Central de Design)')
print()

# --- Etapa 1: descobre coluna "Status gestor responsável" ---
print('>>> Listando colunas do board...')
res = requests.post(
    MONDAY_URL,
    headers={'Authorization': MONDAY_TOKEN, 'Content-Type': 'application/json',
             'API-Version': '2024-01'},
    json={'query': f'{{ boards(ids: [{BOARD_ID}]) {{ columns {{ id title type }} }} }}'},
)
data = res.json()
if 'errors' in data:
    print('ERRO Monday:', data['errors'])
    sys.exit(1)
columns = data['data']['boards'][0]['columns']

# Tipos comuns de status no Monday: 'color' (legacy) e 'status' (atual)
STATUS_TYPES = {'color', 'status'}

# Modo manual: usuario forçou um column_id
if forced_col_id:
    status_gestor = next((c for c in columns if c['id'] == forced_col_id), None)
    if not status_gestor:
        print(f'ERRO: column_id "{forced_col_id}" não existe no board')
        print('Disponíveis:')
        for c in columns:
            print(f'  - {c["id"]:30s} {c["type"]:15s} {c["title"]}')
        sys.exit(1)
else:
    # Tenta achar coluna que contenha "gestor" e seja status
    candidatos = [c for c in columns
                  if 'gestor' in c['title'].lower() and c['type'] in STATUS_TYPES]
    if len(candidatos) == 0:
        print('Não achei nenhuma coluna com "gestor" no nome e tipo status. Disponíveis:')
        for c in columns:
            print(f'  - {c["id"]:30s} {c["type"]:15s} {c["title"]}')
        print('\nRode de novo passando o column_id como 3º argumento:')
        print(f'  python scripts/audit_manutencoes_monday.py {date_from} {date_to} <column_id>')
        sys.exit(1)
    if len(candidatos) > 1:
        print('Múltiplas colunas casam com "gestor":')
        for c in candidatos:
            print(f'  - {c["id"]:30s} {c["type"]:15s} {c["title"]}')
        print('\nRode passando o column_id explicitamente como 3º argumento:')
        print(f'  python scripts/audit_manutencoes_monday.py {date_from} {date_to} <column_id>')
        sys.exit(1)
    status_gestor = candidatos[0]

print(f'  Coluna escolhida: id={status_gestor["id"]} type={status_gestor["type"]} title="{status_gestor["title"]}"')
print()

# --- Etapa 2: busca activity_logs paginado ---
print(f'>>> Buscando activity_logs entre {date_from} e {date_to}...')
all_logs = []
page = 1
while True:
    query = f'''
    {{
      boards(ids: [{BOARD_ID}]) {{
        activity_logs(
          from: "{iso_from}",
          to: "{iso_to}",
          column_ids: ["{status_gestor["id"]}"],
          limit: 1000,
          page: {page}
        ) {{
          id event data entity created_at
        }}
      }}
    }}
    '''
    res = requests.post(
        MONDAY_URL,
        headers={'Authorization': MONDAY_TOKEN, 'Content-Type': 'application/json',
                 'API-Version': '2024-01'},
        json={'query': query},
    )
    rj = res.json()
    if 'errors' in rj:
        print('ERRO Monday:', rj['errors'])
        sys.exit(1)
    logs = rj['data']['boards'][0]['activity_logs'] or []
    if not logs:
        break
    all_logs.extend(logs)
    print(f'  Página {page}: +{len(logs)} (total {len(all_logs)})')
    if len(logs) < 1000:
        break
    page += 1

print(f'  Total de eventos da coluna: {len(all_logs)}')
print()

# --- Etapa 3: filtra os que viraram Manutenção/Manutenção C ---
# Cuidado: "Validar manutenção" NÃO conta — é triagem antes da manutenção real.
def is_real_manut(label: str) -> bool:
    """True só pra 'Manutenção' ou 'Manutenção C' (com variações de pontuação/acentos).
       Exclui 'Validar manutenção' e qualquer outro status que contenha 'manut'."""
    s = (label or '').strip().lower().replace('ç', 'c').replace('ã', 'a')
    s = s.rstrip('.').strip()
    if s in ('manutencao', 'manut'):
        return True
    # Manutenção C / Manut. C / Manutencao C. etc.
    if s.startswith('manutencao c') or s.startswith('manut c') or s.startswith('manut. c'):
        return True
    if s in ('manutencao c', 'manut c', 'manut. c'):
        return True
    return False


manut_events = []
descartados_validar = 0
for log in all_logs:
    try:
        d = json.loads(log['data']) if isinstance(log['data'], str) else log['data']
    except Exception:
        continue
    new_val = (d.get('value', {}) or {}).get('label', {}).get('text', '') if isinstance(d.get('value'), dict) else ''
    if not new_val:
        new_val = (d.get('value', {}) or {}).get('text', '') if isinstance(d.get('value'), dict) else ''
    nv = (new_val or '').strip().lower()
    if 'manut' not in nv:
        continue
    if not is_real_manut(new_val):
        descartados_validar += 1
        continue
    manut_events.append({
        'item_id': str(d.get('pulse_id') or d.get('item_id') or ''),
        'item_name': d.get('pulse_name', '(sem nome)'),
        'novo_status': new_val,
        'data': log['created_at'],
    })

print(f'>>> Eventos de mudança PARA "Manutenção"/"Manutenção C": {len(manut_events)}')
if descartados_validar:
    print(f'    (descartados {descartados_validar} eventos de "Validar manutenção" e similares)')
print()

# --- Etapa 4: lê o banco (paginado — PostgREST default = 1000) ---
print('>>> Lendo eventos de manutenção do Supabase...')
headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
banco: list[dict] = []
offset = 0
PAGE = 1000
while True:
    page_headers = {**headers, 'Range-Unit': 'items', 'Range': f'{offset}-{offset + PAGE - 1}'}
    url = (f'{SUPABASE_URL}/rest/v1/design_demandas'
           f'?tipo_evento=in.(manutencao,manutencao_c)'
           f'&select=id,nome,monday_item_id,log_criacao,origem'
           f'&order=id.asc')
    res = requests.get(url, headers=page_headers, timeout=60)
    chunk = res.json()
    if not isinstance(chunk, list) or not chunk:
        break
    banco.extend(chunk)
    if len(chunk) < PAGE:
        break
    offset += PAGE
print(f'  {len(banco)} eventos totais de manutenção no banco (todos os períodos)')


# --- Etapa 4b: filtra banco pelo MESMO período (parseando log_criacao) ---
# Monday exporta log_criacao em vários formatos; testamos os mais comuns.
LOG_FORMATS = [
    '%Y-%m-%d %H:%M:%S',
    '%Y-%m-%dT%H:%M:%S',
    '%Y-%m-%d',
    '%d/%m/%Y %H:%M:%S',
    '%d/%m/%Y %H:%M',
    '%d/%m/%Y',
    '%d/%m/%y %H:%M',
    '%d/%m/%y',
    '%b %d, %Y, %I:%M %p',
    '%b %d, %Y %I:%M %p',
    '%b %d, %Y',
    '%d %b %Y %I:%M %p',
    '%d %b %Y',
    '%d de %b de %Y',
    '%d de %B de %Y',
    '%d %B %Y',
    '%B %d, %Y',
]

# Regex pra extrair só a primeira ocorrência de uma data tipo "YYYY-MM-DD"
# ou "DD/MM/YYYY" ou "DD-MM-YYYY" dentro de uma string maior
EN_MONTHS = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
             'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}
PT_MONTHS = {'jan': 1, 'fev': 2, 'mar': 3, 'abr': 4, 'mai': 5, 'jun': 6,
             'jul': 7, 'ago': 8, 'set': 9, 'out': 10, 'nov': 11, 'dez': 12}


def _en_month_match(m):
    mon = EN_MONTHS[m.group(1).lower()[:3]]
    return dt.date(int(m.group(3)), mon, int(m.group(2)))


def _pt_month_match(m):
    mon = PT_MONTHS[m.group(2).lower()[:3]]
    return dt.date(int(m.group(3)), mon, int(m.group(1)))


DATE_REGEXES = [
    # Formato Monday: "Jun 12, 2024 4:48 PM" (com ou sem texto antes)
    (re.compile(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})', re.IGNORECASE), _en_month_match),
    # PT-BR: "12 de jun de 2024" / "12 jun 2024"
    (re.compile(r'\b(\d{1,2})\s+(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\s+(?:de\s+)?(\d{4})', re.IGNORECASE), _pt_month_match),
    # ISO
    (re.compile(r'(\d{4})-(\d{2})-(\d{2})'), lambda m: dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))),
    # BR com 4 dígitos no ano
    (re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})'), lambda m: dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))),
    (re.compile(r'(\d{1,2})-(\d{1,2})-(\d{4})'), lambda m: dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))),
    # BR com 2 dígitos no ano
    (re.compile(r'(\d{1,2})/(\d{1,2})/(\d{2})\b'), lambda m: dt.date(2000 + int(m.group(3)), int(m.group(2)), int(m.group(1)))),
    (re.compile(r'(\d{1,2})-(\d{1,2})-(\d{2})\b'), lambda m: dt.date(2000 + int(m.group(3)), int(m.group(2)), int(m.group(1)))),
]


def parse_log_data(s):
    if not s:
        return None
    s = str(s).strip()
    if not s:
        return None
    for fmt in LOG_FORMATS:
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    # ISO com timezone (ex: 2026-03-15T14:30:00.000Z)
    try:
        return dt.datetime.fromisoformat(s.replace('Z', '+00:00')).date()
    except ValueError:
        pass
    # Último recurso: regex extraindo qualquer data dentro da string
    for rx, builder in DATE_REGEXES:
        m = rx.search(s)
        if m:
            try:
                return builder(m)
            except (ValueError, TypeError):
                continue
    return None


d_from = dt.date.fromisoformat(date_from)
d_to = dt.date.fromisoformat(date_to)

banco_periodo = []
banco_sem_data = 0
banco_data_invalida = 0
amostra_invalidos: list[str] = []
for row in banco:
    log = row.get('log_criacao')
    d = parse_log_data(log)
    if d is None:
        if log:
            banco_data_invalida += 1
            if len(amostra_invalidos) < 10:
                amostra_invalidos.append(str(log))
        else:
            banco_sem_data += 1
        continue
    if d_from <= d <= d_to:
        banco_periodo.append(row)

print(f'  {len(banco_periodo)} eventos no período {date_from}..{date_to}')
if banco_data_invalida:
    print(f'  ⚠ {banco_data_invalida} linha(s) com log_criacao em formato não reconhecido (ignoradas)')
    print('     Amostra:')
    for s in amostra_invalidos:
        print(f'       {s!r}')
if banco_sem_data:
    print(f'  ⚠ {banco_sem_data} linha(s) sem log_criacao (ignoradas)')

# Indexa banco do período por item_id e por nome normalizado
def norm_name(s):
    return (s or '').strip().lower()


banco_by_item: dict[str, list] = defaultdict(list)
banco_by_name: dict[str, list] = defaultdict(list)
for row in banco_periodo:
    mid = row.get('monday_item_id')
    if mid:
        banco_by_item[str(mid)].append(row)
    nm = norm_name(row.get('nome'))
    if nm:
        banco_by_name[nm].append(row)

print(f'  {len(banco_by_item)} items distintos com monday_item_id no período')
print(f'  {sum(1 for r in banco_periodo if not r.get("monday_item_id"))} linha(s) sem monday_item_id (matching por nome)')
print()


# --- Etapa 5: identifica missing ---
print('>>> Comparando (mesmo período, com fallback por nome)...')
monday_by_item: dict[str, list] = defaultdict(list)
for ev in manut_events:
    if ev['item_id']:
        monday_by_item[ev['item_id']].append(ev)

# Marca quais linhas do banco_by_name já foram "consumidas" por match por id
# (pra evitar dupla contagem no fallback por nome)
consumed_name_keys: set = set()

faltando_no_banco = []
for item_id, events in monday_by_item.items():
    banco_count = len(banco_by_item.get(item_id, []))
    monday_count = len(events)

    # Fallback: se não achou por id, tenta por nome do item
    if banco_count == 0 and events:
        nm = norm_name(events[0]['item_name'])
        if nm and nm in banco_by_name:
            # Conta apenas linhas SEM monday_item_id (as com id já contam acima)
            sem_id = [r for r in banco_by_name[nm] if not r.get('monday_item_id')]
            banco_count = len(sem_id)
            if banco_count:
                consumed_name_keys.add(nm)

    if monday_count > banco_count:
        diff = monday_count - banco_count
        for i in range(diff):
            # Usa eventos diferentes (não só o [0]) pra mostrar datas distintas
            ev = events[i] if i < len(events) else events[-1]
            faltando_no_banco.append(ev)

print(f'  Items únicos com manutenção no Monday: {len(monday_by_item)}')
print(f'  Items únicos com manutenção no banco (período): {len(banco_by_item)}')
print(f'  Eventos totais Monday (período): {len(manut_events)}')
print(f'  Eventos totais banco (período): {len(banco_periodo)}')
print(f'  Eventos faltando no banco: {len(faltando_no_banco)}')
print()

if faltando_no_banco:
    print('=== EVENTOS FALTANDO NO BANCO ===')
    for ev in faltando_no_banco[:80]:
        print(f'  {ev["data"][:10]}  {ev["novo_status"]:15s}  {ev["item_name"][:60]:60s}  id={ev["item_id"]}')
    if len(faltando_no_banco) > 80:
        print(f'  ... e mais {len(faltando_no_banco) - 80}')

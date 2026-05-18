"""
Segundo passo do enriquecimento: resolve eventos sem designer_responsavel
E sem monday_item_id (não recuperáveis pelo script enrich_designer_responsavel.py).

Estratégias:
  1. Extrai monday_item_id do campo link_demanda se possível (regex /pulses/(\\d+))
  2. Fallback: faz match por nome do item nos 3 boards de design (Central,
     Demandas Feitas ativo, Backup Demandas Feitas)

Idempotente.

Uso:
    python scripts/enrich_designer_by_name.py
    python scripts/enrich_designer_by_name.py --apply
"""
import os
import re
import sys
import time
from collections import defaultdict
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

sys.stdout.reconfigure(encoding='utf-8')

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

MONDAY_URL = 'https://api.monday.com/v2'
BOARDS = ['3519879202', '6900515649', '6900586110']  # Central, Demandas Feitas ATIVO, Backup
PULSE_RE = re.compile(r'/pulses/(\d+)', re.IGNORECASE)
APPLY = '--apply' in sys.argv


def build_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(total=6, backoff_factor=1.5,
                  status_forcelist=[429, 500, 502, 503, 504],
                  allowed_methods=['GET', 'POST', 'PATCH'])
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
    s.mount('https://', adapter)
    s.mount('http://', adapter)
    return s


http = build_session()


def normalize_title(s: str) -> str:
    return (s or '').lower().strip().replace('ç', 'c').replace('ã', 'a').replace('é', 'e').replace('õ', 'o')


def normalize_name(s: str) -> str:
    """Normaliza nome pra match exato (trim, lower)."""
    return (s or '').strip().lower().replace('  ', ' ')


# Padrões de "prefixos descartáveis" (emojis/símbolos no início do nome)
PREFIX_JUNK_RE = re.compile(r'^[\W_]+', re.UNICODE)
# "Whitespace + emojis + símbolos + espaços extras" colados ao núcleo
INTERNAL_JUNK_RE = re.compile(r'[☀-➿\U0001F000-\U0001FFFF]', re.UNICODE)


def normalize_name_strong(s: str) -> str:
    """Normalização FUZZY: remove emojis, símbolos, espaços extras.
    Usado quando match exato falha (ex: nome no Monday agora começa com
    '🚨🚨🚨🚨' mas no banco tá '🔴' — o núcleo do nome continua igual)."""
    if not s:
        return ''
    s = INTERNAL_JUNK_RE.sub('', s)           # remove emojis em qualquer posição
    s = PREFIX_JUNK_RE.sub('', s)             # remove pontuação/símbolo do início
    s = re.sub(r'\s+', ' ', s)                # múltiplos espaços → 1
    return s.strip().lower()


# ============================================================
# ETAPA 1: lê banco
# ============================================================
print('>>> Lendo feitos sem designer E sem monday_item_id...')
banco_headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
rows: list[dict] = []
offset = 0
while True:
    h = {**banco_headers, 'Range-Unit': 'items', 'Range': f'{offset}-{offset + 999}'}
    url = (f'{SUPABASE_URL}/rest/v1/design_demandas'
           f'?designer_responsavel=is.null'
           f'&monday_item_id=is.null'
           f'&select=id,nome,link_demanda,origem'
           f'&order=id.asc')
    res = http.get(url, headers=h, timeout=60)
    chunk = res.json()
    if not isinstance(chunk, list) or not chunk:
        break
    rows.extend(chunk)
    if len(chunk) < 1000:
        break
    offset += 1000
print(f'  {len(rows)} eventos pra processar')

if not rows:
    print('Nada pra fazer.')
    sys.exit(0)


# ============================================================
# ETAPA 2: tenta extrair monday_item_id do link_demanda
# ============================================================
recovered_from_link: dict[int, str] = {}  # row_id → monday_item_id
for r in rows:
    link = r.get('link_demanda') or ''
    m = PULSE_RE.search(link)
    if m:
        recovered_from_link[r['id']] = m.group(1)
print(f'  {len(recovered_from_link)} têm monday_item_id no link_demanda (recuperáveis)')


# ============================================================
# ETAPA 3: pega TODOS items dos 3 boards via items_page (pra fallback por nome)
# ============================================================
print()
print(f'>>> Listando items dos 3 boards (Central, Demandas Feitas, Backup)...')


def get_board_columns(board_id: str) -> tuple[dict[str, str], str | None]:
    """Retorna ({col_id: col_title}, designer_col_id)."""
    res = http.post(
        MONDAY_URL,
        headers={'Authorization': MONDAY_TOKEN, 'Content-Type': 'application/json',
                 'API-Version': '2024-01'},
        json={'query': f'{{ boards(ids: [{board_id}]) {{ columns {{ id title }} }} }}'},
        timeout=60,
    )
    cols = res.json().get('data', {}).get('boards', [{}])[0].get('columns', [])
    col_title = {c['id']: c['title'] for c in cols}
    designer_col = None
    for cid, title in col_title.items():
        nt = normalize_title(title)
        if 'designer' in nt and 'respons' in nt:
            designer_col = cid
            break
    return col_title, designer_col


# Map global: nome_normalizado → {monday_item_id, designer}
name_index: dict[str, dict] = {}
# Map fuzzy: nome SEM emojis/símbolos → {monday_item_id, designer}
name_index_fuzzy: dict[str, dict] = {}

for board_id in BOARDS:
    print(f'  Board {board_id}...')
    _, designer_col = get_board_columns(board_id)
    if not designer_col:
        print(f'    (sem coluna Designer Responsável — pulando)')
        continue

    cursor = None
    page_n = 0
    total_in_board = 0
    while True:
        page_n += 1
        cursor_arg = f', cursor: "{cursor}"' if cursor else ''
        query = f'''
        {{
          boards(ids: [{board_id}]) {{
            items_page(limit: 500{cursor_arg}) {{
              cursor
              items {{
                id
                name
                column_values(ids: ["{designer_col}"]) {{ id text }}
              }}
            }}
          }}
        }}'''
        res = http.post(
            MONDAY_URL,
            headers={'Authorization': MONDAY_TOKEN, 'Content-Type': 'application/json',
                     'API-Version': '2024-01'},
            json={'query': query},
            timeout=120,
        )
        rj = res.json()
        if 'errors' in rj:
            print(f'    ⚠ erro Monday: {rj["errors"]}')
            break
        page = rj.get('data', {}).get('boards', [{}])[0].get('items_page', {}) or {}
        items = page.get('items') or []
        for it in items:
            raw_name = it.get('name') or ''
            nm = normalize_name(raw_name)
            nm_fuzzy = normalize_name_strong(raw_name)
            if not nm:
                continue
            designer = ''
            for cv in (it.get('column_values') or []):
                if cv.get('id') == designer_col:
                    designer = cv.get('text', '') or ''
                    break
            if designer:
                entry = {
                    'monday_item_id': str(it['id']),
                    'designer': designer,
                }
                if nm not in name_index:
                    name_index[nm] = entry
                if nm_fuzzy and nm_fuzzy not in name_index_fuzzy:
                    name_index_fuzzy[nm_fuzzy] = entry
        total_in_board += len(items)
        cursor = page.get('cursor')
        if not cursor:
            break
        time.sleep(0.2)
    print(f'    {total_in_board} items lidos')

print(f'  Total no índice por nome: {len(name_index)}')
print()


# ============================================================
# ETAPA 4: monta UPDATEs combinando as estratégias
# ============================================================
print('>>> Cruzando com banco...')
updates: list[dict] = []  # cada update: {row_id, designer, monday_item_id?}
recovered_link_count = 0
recovered_name_count = 0
recovered_fuzzy_count = 0
nao_resolvidos = 0

# Pra os com link_demanda válido, busca também o designer via API
unique_link_ids = list(set(recovered_from_link.values()))
designer_por_link_id: dict[str, str] = {}


def fetch_items_designer(item_ids: list, designer_col_titles_lower) -> dict:
    """Busca designer (de qualquer board) pros items."""
    if not item_ids:
        return {}
    query = '''
    query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        board { id }
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
        print(f'    ⚠ {e}')
        return {}
    items = rj.get('data', {}).get('items', []) or []
    out = {}
    for it in items:
        bid = str(it.get('board', {}).get('id', ''))
        if not bid:
            continue
        col_titles, designer_col = get_board_columns(bid)
        if not designer_col:
            continue
        for cv in (it.get('column_values') or []):
            if cv.get('id') == designer_col:
                text = cv.get('text', '') or ''
                if text:
                    out[str(it['id'])] = text
                break
    return out


if unique_link_ids:
    print(f'  Buscando designer pros {len(unique_link_ids)} ids extraídos do link...')
    for i in range(0, len(unique_link_ids), 25):
        batch = unique_link_ids[i:i + 25]
        res = fetch_items_designer(batch, None)
        designer_por_link_id.update(res)
        time.sleep(0.2)
    print(f'    {len(designer_por_link_id)} designers recuperados via link')


for r in rows:
    row_id = r['id']
    raw_name = r.get('nome') or ''
    nm = normalize_name(raw_name)
    nm_fuzzy = normalize_name_strong(raw_name)
    # Estratégia 1: link_demanda
    if row_id in recovered_from_link:
        link_mid = recovered_from_link[row_id]
        designer = designer_por_link_id.get(link_mid)
        if designer:
            updates.append({'row_id': row_id, 'designer': designer, 'monday_item_id': link_mid})
            recovered_link_count += 1
            continue
    # Estratégia 2: match exato por nome
    if nm in name_index:
        info = name_index[nm]
        updates.append({
            'row_id': row_id,
            'designer': info['designer'],
            'monday_item_id': info['monday_item_id'],
        })
        recovered_name_count += 1
        continue
    # Estratégia 3: match fuzzy (item renomeou no Monday — ex: 🔴 virou 🚨🚨🚨🚨)
    if nm_fuzzy and nm_fuzzy in name_index_fuzzy:
        info = name_index_fuzzy[nm_fuzzy]
        updates.append({
            'row_id': row_id,
            'designer': info['designer'],
            'monday_item_id': info['monday_item_id'],
        })
        recovered_fuzzy_count += 1
        continue
    nao_resolvidos += 1

print()
print(f'>>> Resumo:')
print(f'  Recuperados via link_demanda: {recovered_link_count}')
print(f'  Recuperados via nome exato: {recovered_name_count}')
print(f'  Recuperados via fuzzy (sem emojis): {recovered_fuzzy_count}')
print(f'  Não resolvidos: {nao_resolvidos}')
print()


# ============================================================
# ETAPA 5: UPDATE
# ============================================================
if not updates:
    print('Nada pra atualizar.')
    sys.exit(0)

if not APPLY:
    print('Amostra (15 primeiros):')
    for u in updates[:15]:
        nome = next((r['nome'] for r in rows if r['id'] == u['row_id']), '?')
        print(f"  id={u['row_id']:5} designer=\"{u['designer'][:40]}\"  mid={u['monday_item_id']:12}  nome={nome[:55]}")
    print()
    print(f'DRY-RUN — pra aplicar:')
    print(f'  python scripts/enrich_designer_by_name.py --apply')
    sys.exit(0)


print(f'>>> ATUALIZANDO {len(updates)} linhas...')
REST = f'{SUPABASE_URL}/rest/v1/design_demandas'
H = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
}

done = 0
for u in updates:
    url = f"{REST}?id=eq.{u['row_id']}"
    body = {'designer_responsavel': u['designer'], 'monday_item_id': u['monday_item_id']}
    try:
        r = http.patch(url, headers=H, json=body, timeout=60)
    except Exception as e:
        print(f'  ⚠ falha id={u["row_id"]}: {e}')
        continue
    if r.status_code >= 300:
        print(f'  ⚠ ERRO ({r.status_code}) id={u["row_id"]}: {r.text[:150]}')
        continue
    done += 1
    if done % 50 == 0 or done == len(updates):
        print(f'  ✓ {done}/{len(updates)}')

print()
print(f'✅ {done} linhas atualizadas')

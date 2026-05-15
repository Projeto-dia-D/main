"""
Recupera o campo designer_responsavel de eventos em design_demandas que
ficaram com NULL (geralmente porque o xlsx exportado do Monday veio sem
preencher essa coluna). Busca os items via Monday API em batch e atualiza.

Idempotente: só processa linhas com designer_responsavel IS NULL.

Uso:
    # Dry-run (só lista quantos seriam atualizados)
    python scripts/enrich_designer_responsavel.py

    # Aplicar
    python scripts/enrich_designer_responsavel.py --apply
"""
import os
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

for var, val in [('VITE_MONDAY_TOKEN', MONDAY_TOKEN),
                 ('VITE_SUPABASE_URL', SUPABASE_URL),
                 ('VITE_SUPABASE_SERVICE_ROLE_SECRET', SUPABASE_KEY)]:
    if not val:
        print(f'ERRO: {var} não encontrado no .env')
        sys.exit(1)

MONDAY_URL = 'https://api.monday.com/v2'
APPLY = '--apply' in sys.argv


def build_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(total=6, connect=6, read=6, backoff_factor=1.5,
                  status_forcelist=[429, 500, 502, 503, 504],
                  allowed_methods=['GET', 'POST', 'PATCH'], respect_retry_after_header=True)
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
    s.mount('https://', adapter)
    s.mount('http://', adapter)
    return s


http = build_session()


# ============================================================
# ETAPA 1: lê do banco os feitos sem designer + com monday_item_id
# ============================================================
print('>>> Lendo eventos sem designer_responsavel (com monday_item_id)...')
banco_headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
rows: list[dict] = []
offset = 0
PAGE = 1000
while True:
    h = {**banco_headers, 'Range-Unit': 'items', 'Range': f'{offset}-{offset + PAGE - 1}'}
    url = (f'{SUPABASE_URL}/rest/v1/design_demandas'
           f'?designer_responsavel=is.null'
           f'&monday_item_id=not.is.null'
           f'&select=id,monday_item_id,nome,origem'
           f'&order=id.asc')
    res = http.get(url, headers=h, timeout=60)
    chunk = res.json()
    if not isinstance(chunk, list) or not chunk:
        break
    rows.extend(chunk)
    if len(chunk) < PAGE:
        break
    offset += PAGE

print(f'  {len(rows)} eventos pra processar')
if not rows:
    print('Nada pra fazer.')
    sys.exit(0)


# Agrupa por monday_item_id (pode ter várias linhas mesmo item)
linhas_por_item: dict[str, list[dict]] = defaultdict(list)
for r in rows:
    linhas_por_item[str(r['monday_item_id'])].append(r)

unique_ids = list(linhas_por_item.keys())
print(f'  {len(unique_ids)} items únicos no Monday')
print()


# ============================================================
# ETAPA 2: busca designer via Monday API (batch 25)
# ============================================================
def normalize_title(s: str) -> str:
    return (s or '').lower().strip().replace('ç', 'c').replace('ã', 'a').replace('é', 'e').replace('õ', 'o')


# Cache: board_id → {column_id: column_title}
_board_columns_cache: dict[str, dict[str, str]] = {}


def get_board_columns(board_id: str) -> dict[str, str]:
    """Retorna {column_id: column_title} pra um board (com cache)."""
    if board_id in _board_columns_cache:
        return _board_columns_cache[board_id]
    res = http.post(
        MONDAY_URL,
        headers={'Authorization': MONDAY_TOKEN, 'Content-Type': 'application/json',
                 'API-Version': '2024-01'},
        json={'query': f'{{ boards(ids: [{board_id}]) {{ columns {{ id title }} }} }}'},
        timeout=60,
    )
    try:
        cols = res.json().get('data', {}).get('boards', [{}])[0].get('columns', [])
    except Exception:
        cols = []
    out = {c['id']: c['title'] for c in cols}
    _board_columns_cache[board_id] = out
    return out


def fetch_items_batch(item_ids: list) -> dict:
    """Retorna {item_id: designer_text} APENAS da coluna 'Designer Responsável'."""
    if not item_ids:
        return {}
    # IMPORTANTE: incluir board { id } pra saber em que board cada item vive,
    # assim consigo mapear o id da coluna "Designer Responsável" pelo título.
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
        print(f'    ⚠ falha no batch: {e}')
        return {}
    if 'errors' in rj:
        print(f'    ⚠ erro Monday: {rj["errors"]}')
        return {}
    items = rj.get('data', {}).get('items', []) or []
    out = {}
    for it in items:
        iid = str(it['id'])
        board_id = str(it.get('board', {}).get('id', ''))
        if not board_id:
            continue
        col_titles = get_board_columns(board_id)
        # Acha o(s) id(s) das colunas cujo título normalizado é "designer responsavel"
        designer_col_ids = {
            cid for cid, title in col_titles.items()
            if 'designer' in normalize_title(title) and 'respons' in normalize_title(title)
        }
        if not designer_col_ids:
            continue
        for cv in (it.get('column_values') or []):
            if cv.get('id') in designer_col_ids:
                text = cv.get('text', '') or ''
                if text and iid not in out:
                    out[iid] = text
                break
    return out


print('>>> Buscando designer no Monday (batch de 25)...')
designer_por_item: dict[str, str] = {}
BATCH = 25
for i in range(0, len(unique_ids), BATCH):
    batch = unique_ids[i:i + BATCH]
    res = fetch_items_batch(batch)
    designer_por_item.update(res)
    if (i // BATCH) % 10 == 0 or i + BATCH >= len(unique_ids):
        print(f'  {min(i + BATCH, len(unique_ids))}/{len(unique_ids)} — designer encontrado: {len(designer_por_item)}')
    time.sleep(0.3)

print()
print(f'>>> {len(designer_por_item)} items com designer recuperado')
print(f'>>> {len(unique_ids) - len(designer_por_item)} items sem designer no Monday (continuam NULL)')
print()


# ============================================================
# ETAPA 3: monta UPDATEs
# ============================================================
updates: list[tuple] = []  # [(row_id, designer), ...]
for iid, linhas in linhas_por_item.items():
    designer = designer_por_item.get(iid)
    if not designer:
        continue
    for linha in linhas:
        updates.append((linha['id'], designer))

print(f'>>> {len(updates)} linhas a atualizar')

if not APPLY:
    print()
    print('=' * 60)
    print('DRY-RUN — nada foi atualizado.')
    print('Amostra (10 primeiros):')
    for row_id, designer in updates[:10]:
        nome = next((r['nome'] for r in rows if r['id'] == row_id), '?')
        print(f'  id={row_id:6} designer="{designer}"  nome={nome[:60]}')
    print()
    print(f'Pra aplicar: python scripts/enrich_designer_responsavel.py --apply')
    sys.exit(0)


# ============================================================
# ETAPA 4: UPDATE em massa (agrupado por valor único de designer)
# ============================================================
print()
print('>>> ATUALIZANDO banco...')
REST = f'{SUPABASE_URL}/rest/v1/design_demandas'
H = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
}

# Agrupa updates pelo MESMO valor de designer
by_value: dict[str, list[int]] = defaultdict(list)
for row_id, designer in updates:
    by_value[designer].append(row_id)

print(f'  {len(by_value)} valor(es) único(s) de designer')

done = 0
for i, (designer, row_ids) in enumerate(by_value.items(), 1):
    for j in range(0, len(row_ids), 500):
        batch = row_ids[j:j + 500]
        ids_csv = ','.join(str(x) for x in batch)
        url = f'{REST}?id=in.({ids_csv})'
        try:
            r = http.patch(url, headers=H, json={'designer_responsavel': designer}, timeout=60)
        except Exception as e:
            print(f'  ⚠ falha PATCH "{designer}": {e}')
            continue
        if r.status_code >= 300:
            print(f'  ⚠ ERRO PATCH ({r.status_code}): {r.text[:200]}')
            continue
        done += len(batch)
    if i % 20 == 0 or i == len(by_value):
        print(f'  ✓ grupo {i}/{len(by_value)} — {done}/{len(updates)} linhas')

print()
print(f'✅ {done} linhas atualizadas com designer_responsavel')

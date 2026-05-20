"""Debuga 'Data de entrada' do Monday."""
import sys, os, requests
sys.stdout.reconfigure(encoding='utf-8')

env = {}
for line in open(os.path.join(os.path.dirname(__file__), '..', '.env'), encoding='utf-8'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

MH = {'Authorization': env['VITE_MONDAY_TOKEN'], 'Content-Type': 'application/json', 'API-Version': '2024-01'}
bid = env['VITE_MONDAY_BOARD_ID']

# 1. Lista TODAS as colunas do board principal pra ver se tem "Data de entrada"
r = requests.post('https://api.monday.com/v2', headers=MH, json={
    'query': 'query ($bid: ID!) { boards(ids: [$bid]) { columns { id title type } } }',
    'variables': {'bid': bid},
}, timeout=30).json()
cols = r['data']['boards'][0]['columns']
print(f'Total colunas: {len(cols)}\n')
print('Colunas que parecem ser de DATA:')
for c in cols:
    t = c['title'].lower()
    if 'entrada' in t or 'data' in t or 'contrato' in t or 'inicio' in t or 'início' in t:
        print(f'  id={c["id"]:35s} type={c["type"]:25s} title={c["title"]!r}')

# 2. Sample 5 clientes com a coluna "Data de entrada" expandida
# Acha id da coluna primeiro
import unicodedata
def norm(s): return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn').lower().strip()
targets = ['data de entrada', 'data entrada', 'entrou em', 'inicio do contrato', 'início do contrato']
col_id = None
for c in cols:
    if norm(c['title']) in targets:
        col_id = c['id']
        print(f'\nColuna escolhida exata: id={col_id} title={c["title"]!r} type={c["type"]}')
        break
if not col_id:
    # Substring fallback
    for c in cols:
        if 'entrada' in norm(c['title']) or 'contrato' in norm(c['title']):
            col_id = c['id']
            print(f'\nColuna substring: id={col_id} title={c["title"]!r} type={c["type"]}')
            break

# 3. Sample 5 clientes
print('\n--- Sample valores ---')
q = '''query ($bid: ID!, $cols: [String!]) {
  boards(ids: [$bid]) {
    items_page(limit: 5) {
      items {
        id name
        column_values(ids: $cols) {
          id text value
          ... on FormulaValue { display_value }
          ... on MirrorValue { display_value }
          ... on DateValue { date }
        }
      }
    }
  }
}'''
r2 = requests.post('https://api.monday.com/v2', headers=MH, json={
    'query': q, 'variables': {'bid': bid, 'cols': [col_id] if col_id else []},
}, timeout=30).json()
for it in r2['data']['boards'][0]['items_page']['items']:
    print(f'\n{it["name"]}')
    for cv in it.get('column_values') or []:
        print(f'  text={cv.get("text")!r}  value={cv.get("value")!r}  display_value={cv.get("display_value")!r}')

"""Lista clientes Monday com dataEntrada VAZIA (causam fallback ao firstLead)."""
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

# Pega todos os items + dataEntrada
all_items = []
cursor = None
while True:
    if cursor:
        q = f'query ($c: String!) {{ next_items_page(cursor: $c, limit: 100) {{ cursor items {{ id name column_values(ids: ["formula_mkyhpsf2"]) {{ id text ... on FormulaValue {{ display_value }} }} }} }} }}'
        r = requests.post('https://api.monday.com/v2', headers=MH, json={'query': q, 'variables': {'c': cursor}}, timeout=60).json()
        page = r.get('data', {}).get('next_items_page', {})
    else:
        q = f'query {{ boards(ids: [{bid}]) {{ items_page(limit: 100) {{ cursor items {{ id name column_values(ids: ["formula_mkyhpsf2"]) {{ id text ... on FormulaValue {{ display_value }} }} }} }} }} }}'
        r = requests.post('https://api.monday.com/v2', headers=MH, json={'query': q}, timeout=60).json()
        if r.get('errors'):
            print(f'Erro Monday: {r["errors"]}')
            break
        boards = (r.get('data') or {}).get('boards', [])
        if not boards:
            print('Sem boards retornados')
            break
        page = (boards[0] or {}).get('items_page') or {}
    items = page.get('items', [])
    if not items: break
    all_items.extend(items)
    cursor = page.get('cursor')
    if not cursor: break

print(f'Total items: {len(all_items)}')
vazios = []
com_data = []
for it in all_items:
    cv = (it.get('column_values') or [{}])[0]
    de = cv.get('display_value') or cv.get('text') or ''
    if not de.strip():
        vazios.append(it['name'])
    else:
        com_data.append((it['name'], de))

print(f'\nCom dataEntrada: {len(com_data)}')
print(f'SEM dataEntrada: {len(vazios)}')
print('\nClientes sem dataEntrada (afetados pelo bug do fallback):')
for nm in vazios[:30]:
    print(f'  · {nm}')
if len(vazios) > 30:
    print(f'  ... +{len(vazios) - 30}')

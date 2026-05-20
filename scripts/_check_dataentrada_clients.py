"""Verifica dataEntrada de clientes específicos."""
import sys, os, requests
sys.stdout.reconfigure(encoding='utf-8')

env = {}
for line in open(os.path.join(os.path.dirname(__file__), '..', '.env'), encoding='utf-8'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

MH = {'Authorization': env['VITE_MONDAY_TOKEN'], 'Content-Type': 'application/json', 'API-Version': '2024-01'}

# Verifica vários clientes
NEEDLES = ['ana luiza garcia', 'breno', 'ady reis']
for needle in NEEDLES:
    q = f'''query {{ boards(ids: [{env['VITE_MONDAY_BOARD_ID']}]) {{
      items_page(limit: 5, query_params: {{ rules: [{{ column_id: "name", compare_value: ["{needle}"], operator: contains_text }}] }}) {{
        items {{
          id name
          column_values(ids: ["formula_mkyhpsf2"]) {{
            id text
            ... on FormulaValue {{ display_value }}
          }}
        }}
      }}
    }} }}'''
    r = requests.post('https://api.monday.com/v2', headers=MH, json={'query': q}, timeout=30).json()
    if r.get('errors'):
        print(f'\n[{needle}] erro: {r["errors"]}')
        continue
    items = (((r.get('data') or {}).get('boards') or [{}])[0].get('items_page') or {}).get('items', [])
    print(f'\n[{needle}]')
    for it in items:
        cv = (it.get('column_values') or [{}])[0]
        de = cv.get('display_value') or cv.get('text') or '(vazio)'
        print(f'  {it["name"]:50s}  dataEntrada={de!r}')

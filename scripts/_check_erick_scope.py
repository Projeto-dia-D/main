"""Diagnostica por que o Erick zera quando ele mesmo loga.

Compara:
 1. user.scope cadastrado em monday_auth_emails pra Erick
 2. valores do campo 'gestor' nos clientes do Monday (board principal)
 3. Aplica a logica do nameMatchesScope(scope, gestor) pra ver se bate
"""
import os, sys
import requests

sys.stdout.reconfigure(encoding='utf-8')

env = {}
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
with open(env_path, encoding='utf-8') as f:
    for line in f:
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()

supa = env['VITE_SUPABASE_URL'].rstrip('/')
key = env['VITE_SUPABASE_SERVICE_ROLE_SECRET']
H = {'apikey': key, 'Authorization': f'Bearer {key}'}

print('=' * 70)
print('  1. monday_auth_emails — entradas pra Erick')
print('=' * 70)

r = requests.get(
    f'{supa}/rest/v1/monday_auth_emails?or=(name.ilike.*erick*,email.ilike.*erick*)&select=email,name,role',
    headers=H, timeout=15,
)
emails = r.json()
if not emails:
    print('  NADA encontrado com "erick" em name ou email.')
else:
    for e in emails:
        print(f'  email: {e.get("email"):<35s}  name: {e.get("name"):<25s}  role: {e.get("role")}')

# Pega o scope (full name) cadastrado
scopes = [e['name'] for e in emails if e.get('role') == 'gestor']
if not scopes:
    print('  AVISO: nenhuma entrada com role=gestor pra Erick.')


print('\n' + '=' * 70)
print('  2. Monday — valores unicos do campo gestor nos clientes')
print('=' * 70)

# Token Monday pra buscar diretamente
monday_tok = env['VITE_MONDAY_TOKEN']
board_id = env['VITE_MONDAY_BOARD_ID']

# Query da coluna gestor (column id pode variar)
q = '''
{
  boards(ids: [%s]) {
    items_page(limit: 500) {
      items {
        name
        column_values { id text }
      }
    }
  }
}
''' % board_id

r = requests.post(
    'https://api.monday.com/v2',
    headers={'Authorization': monday_tok, 'Content-Type': 'application/json', 'API-Version': '2024-10'},
    json={'query': q}, timeout=60,
)
data = r.json()
if 'errors' in data:
    print(f'  ERRO Monday: {data["errors"]}')
    sys.exit(1)

items = data['data']['boards'][0]['items_page']['items']
print(f'  Total items no board: {len(items)}')

# Acha a coluna gestor (alguma chamada "gestor" ou que tenha valores conhecidos)
# Vamos olhar todos os column_values e detectar a coluna que mais frequentemente
# tem nomes como "Weslei", "André", "Erick"
KEYWORDS_GESTOR = ['weslei', 'andré', 'andre', 'erick', 'eric', 'ricardo', 'gabriel anacleto']

# Conta por col_id quais batem
col_hits = {}
for it in items:
    for cv in it['column_values']:
        text = (cv.get('text') or '').lower()
        if any(kw in text for kw in KEYWORDS_GESTOR):
            col_hits[cv['id']] = col_hits.get(cv['id'], 0) + 1

if not col_hits:
    print('  Nenhuma coluna com nomes de gestor detectada.')
    sys.exit(1)

# Coluna gestor = a com mais hits
gestor_col_id = max(col_hits, key=col_hits.get)
print(f'  Coluna detectada pra gestor: {gestor_col_id} ({col_hits[gestor_col_id]} hits)')

# Lista valores unicos de gestor
gestores = {}
clientes_erick = []
for it in items:
    g_text = None
    for cv in it['column_values']:
        if cv['id'] == gestor_col_id:
            g_text = (cv.get('text') or '').strip()
            break
    if not g_text:
        continue
    gestores[g_text] = gestores.get(g_text, 0) + 1
    if 'eric' in g_text.lower():
        clientes_erick.append({'name': it['name'], 'gestor': g_text})

print(f'\n  Valores unicos do campo gestor:')
for g, n in sorted(gestores.items(), key=lambda x: -x[1]):
    marker = '  <-- erick' if 'eric' in g.lower() else ''
    print(f'    "{g}" — {n} clientes{marker}')

print(f'\n  Clientes com Erick como gestor: {len(clientes_erick)}')
for c in clientes_erick[:10]:
    print(f'    · {c["name"]}  (gestor: "{c["gestor"]}")')
if len(clientes_erick) > 10:
    print(f'    ... +{len(clientes_erick) - 10}')


print('\n' + '=' * 70)
print('  3. Match: scope cadastrado vs gestor do Monday')
print('=' * 70)


def name_matches_scope(scope: str, candidate: str) -> bool:
    """Replica da funcao TS em src/lib/monday.ts."""
    a = scope.strip().lower()
    b = candidate.strip().lower()
    if not a or not b:
        return False
    if a == b:
        return True
    if a.startswith(b + ' '):
        return True
    if b.startswith(a + ' '):
        return True
    return False


if not scopes:
    print('  Sem scope cadastrado pra Erick — ele entra como cliente, sem dados.')
elif not clientes_erick:
    print('  Sem clientes no Monday com gestor=Erick — nada pra agrupar.')
else:
    for scope in scopes:
        print(f'\n  Scope: "{scope}"')
        gestor_values_erick = set(c['gestor'] for c in clientes_erick)
        for g in gestor_values_erick:
            match = name_matches_scope(scope, g)
            icon = '✓' if match else '✗'
            print(f'    {icon} match contra gestor "{g}"')

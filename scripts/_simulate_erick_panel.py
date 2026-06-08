"""Simula o painel do Erick — pega clientes Monday cujo gestor = Erick e
verifica se eles tem link Meta no client_meta_links.

Saida diz se os dados Meta vao agregar (token disponivel via Weslei/Andre)
ou nao (sem link → painel zerado).
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
monday_tok = env['VITE_MONDAY_TOKEN']
board_id = env['VITE_MONDAY_BOARD_ID']

# 1. Pega clientes Erick no Monday principal
q = '''
{
  boards(ids: [%s]) {
    items_page(limit: 500) {
      items {
        id
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
items = r.json()['data']['boards'][0]['items_page']['items']

GESTOR_COL = 'pessoas_1__1'  # detectado no diagnostico anterior
erick_clients = []
for it in items:
    g_text = None
    for cv in it['column_values']:
        if cv['id'] == GESTOR_COL:
            g_text = (cv.get('text') or '').strip()
            break
    if g_text and 'eric' in g_text.lower():
        erick_clients.append({'monday_id': it['id'], 'name': it['name'], 'gestor_monday': g_text})

print(f'Clientes Monday com gestor=Erick: {len(erick_clients)}')

# 2. Pra cada cliente, ve se existe link em client_meta_links
print('\n' + '=' * 80)
print('  MAPEAMENTO: Cliente Monday → link no client_meta_links')
print('=' * 80)

monday_ids = [c['monday_id'] for c in erick_clients]
ids_filter = ','.join(monday_ids)
r = requests.get(
    f'{supa}/rest/v1/client_meta_links?monday_client_id=in.({ids_filter})&select=monday_client_id,monday_client_name,meta_account_id,meta_account_name,gestor',
    headers=H, timeout=30,
)
links = r.json()
links_by_monday = {l['monday_client_id']: l for l in links}

print(f'{"Monday ID":<14} {"Cliente":<45} {"Tem link?":<10} {"Token via":<10}')
print('-' * 80)

com_link = 0
sem_link = 0
for c in erick_clients:
    link = links_by_monday.get(c['monday_id'])
    name = c['name'][:45]
    if link:
        com_link += 1
        token = link.get('gestor', '?')
        print(f'{c["monday_id"]:<14} {name:<45} ✓         {token}')
    else:
        sem_link += 1
        print(f'{c["monday_id"]:<14} {name:<45} ✗         —')

print('\n' + '=' * 80)
print(f'  RESUMO: {len(erick_clients)} clientes Erick no Monday')
print(f'   - {com_link} com link Meta (token disponivel)')
print(f'   - {sem_link} SEM link Meta (spend=0, transf=0 no painel)')
print('=' * 80)

# 3. Verifica se eles estao na lista de Bia ativos (mondayClients)
# Bia Soft tem um board separado; verifica via monday_bia_fase_timeline
# se eles estao em fase ativa
print('\nVerificando se Erick tem clientes em fase Bia ATIVA...')
r = requests.get(
    f'{supa}/rest/v1/monday_bia_fase_timeline?select=client_id,fase&order=ts.desc&limit=2000',
    headers=H, timeout=30,
)
fase_data = r.json()
# Pega ultima fase por client_id
fase_atual = {}
for row in fase_data:
    cid = str(row.get('client_id') or '')
    if cid and cid not in fase_atual:
        fase_atual[cid] = row.get('fase')

# Fases ativas (mesmo set do app)
FASES_ATIVAS = {'I.A', 'I.A ativa', 'I.A pronta', 'Bia ativa', 'Em produção', 'Em manutenção'}

ativos = sum(1 for c in erick_clients if fase_atual.get(c['monday_id']) in FASES_ATIVAS)
print(f'  {ativos}/{len(erick_clients)} clientes Erick em fase Bia ativa')
print(f'  (apenas ativos contam pra "ativos" no painel; inativos sem link Meta')
print(f'   sao filtrados de clientesParaMetricas)')

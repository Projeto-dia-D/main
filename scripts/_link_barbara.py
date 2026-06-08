"""Vincula Barbara Guimaraes (Monday 11844063779) a conta Meta 1405066924265289."""
import requests, sys

ACCOUNT_ID = 'act_1405066924265289'
MONDAY_CLIENT_ID = '11844063779'
MONDAY_CLIENT_NAME = 'Dra. Barbara Guimarães'

# 1. Le tokens do .env
ENV = {}
with open('.env', encoding='utf-8') as f:
    for line in f:
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            ENV[k.strip()] = v.strip()

# 2. Acha conta em algum dos tokens, pega o nome e identifica gestor (token owner)
found = None
for var, gestor_name in [('VITE_META_TOKEN_RENAN','Renan'),
                         ('VITE_META_TOKEN_WESLEI','Weslei'),
                         ('VITE_META_TOKEN_ANDRE','André')]:
    tok = ENV.get(var)
    if not tok: continue
    r = requests.get(f'https://graph.facebook.com/v21.0/{ACCOUNT_ID}',
                     params={'access_token': tok, 'fields': 'id,name,account_status,currency,business'},
                     timeout=30)
    if r.status_code == 200:
        data = r.json()
        if 'error' not in data:
            found = (data, gestor_name)
            break

if not found:
    print(f'ERRO: conta {ACCOUNT_ID} nao acessivel por nenhum token (Renan/Weslei/Andre)')
    print('Confirme que o ID esta correto e que voce tem acesso a essa conta.')
    sys.exit(1)

acc, gestor = found
print(f'Conta validada via token {gestor}:')
print(f'  id:     {acc.get("id")}')
print(f'  name:   {acc.get("name")}')
print(f'  status: {acc.get("account_status")}')
print(f'  curr:   {acc.get("currency")}')
print()

# 3. Insere/atualiza em client_meta_links
SUPABASE_URL = ENV['VITE_SUPABASE_URL']
SUPABASE_KEY = ENV['VITE_SUPABASE_SERVICE_ROLE_SECRET']
H = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}', 'Content-Type': 'application/json'}

import datetime as dt
row = {
    'monday_client_id': MONDAY_CLIENT_ID,
    'monday_client_name': MONDAY_CLIENT_NAME,
    'meta_account_id': acc['id'],
    'meta_account_name': acc.get('name'),
    'gestor': gestor,
    'updated_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
}
print(f'Inserindo vinculo: {row}')
print()

r = requests.post(
    f'{SUPABASE_URL}/rest/v1/client_meta_links?on_conflict=monday_client_id',
    headers={**H, 'Prefer': 'resolution=merge-duplicates,return=representation'},
    json=row, timeout=30
)
print(f'Status: {r.status_code}')
print(r.json() if r.status_code in (200,201) else r.text[:500])

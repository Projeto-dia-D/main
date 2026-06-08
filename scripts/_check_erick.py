"""Diagnostica por que Erick aparece zerado no painel de Gestor.

Verifica:
 1. Quais contas estao linkadas a 'Erick' no client_meta_links
 2. Se essas contas existem nos tokens Weslei/Andre (unicos com Meta token)
 3. Comparacao com outros gestores pra contexto
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

# 1. Distribuicao por gestor no client_meta_links
print('=' * 70)
print('  CLIENT_META_LINKS — distribuicao por gestor')
print('=' * 70)
r = requests.get(
    f'{supa}/rest/v1/client_meta_links?select=monday_client_id,monday_client_name,meta_account_id,meta_account_name,gestor',
    headers=H, timeout=30,
)
links = r.json()
by_gestor = {}
for l in links:
    g = (l.get('gestor') or '(SEM GESTOR)').strip()
    by_gestor.setdefault(g, []).append(l)
print(f'\nTotal de links: {len(links)}')
for g in sorted(by_gestor.keys()):
    print(f'  {g:30s} -> {len(by_gestor[g])} contas')

# 2. Detalhar contas do Erick
print('\n' + '=' * 70)
print('  CONTAS LINKADAS A ERICK')
print('=' * 70)
erick_contas = []
for g_name, contas in by_gestor.items():
    if 'erick' in g_name.lower() or 'eric' == g_name.lower():
        erick_contas.extend(contas)
        print(f'\nGestor "{g_name}": {len(contas)} contas')
        for c in contas[:20]:
            print(f'  · {c.get("meta_account_id"):20s}  {c.get("meta_account_name", "?")[:50]}  (monday: {c.get("monday_client_name", "?")[:30]})')
        if len(contas) > 20:
            print(f'  ... +{len(contas) - 20} contas')

if not erick_contas:
    print('  NENHUM link com gestor "Erick" encontrado.')
    print('  -> e por isso que o painel zera.')

# 3. Pra cada token, lista contas acessiveis e ve se o Erick consegue ser acessado
print('\n' + '=' * 70)
print('  TESTANDO ACESSO ÀS CONTAS DO ERICK VIA TOKENS DISPONIVEIS')
print('=' * 70)

tokens = []
for var, label in [('VITE_META_TOKEN_RENAN', 'Renan'),
                    ('VITE_META_TOKEN_WESLEI', 'Weslei'),
                    ('VITE_META_TOKEN_ANDRE', 'André')]:
    tok = env.get(var)
    if tok:
        tokens.append((label, tok))
    else:
        print(f'  Token {label}: VAZIO no .env')

if not erick_contas:
    print('\n(skipping — Erick nao tem contas linkadas pra testar)')
    sys.exit(0)

# Pra cada token, pega TODAS as adaccounts e ve quais batem com o Erick
print('\nBuscando adaccounts em cada token...')
acessivel_por_token = {label: set() for label, _ in tokens}
for label, tok in tokens:
    accounts = []
    url = 'https://graph.facebook.com/v21.0/me/adaccounts'
    params = {'access_token': tok, 'fields': 'id', 'limit': 500}
    while url:
        rr = requests.get(url, params=params, timeout=60)
        if rr.status_code != 200:
            print(f'  {label}: ERRO {rr.status_code}')
            break
        data = rr.json()
        accounts.extend(data.get('data', []))
        nxt = (data.get('paging') or {}).get('next')
        if not nxt: break
        url = nxt
        params = None
    ids = {a['id'] for a in accounts}
    acessivel_por_token[label] = ids
    print(f'  {label}: {len(ids)} contas acessiveis')

# Pra cada conta do Erick, mostra se algum token consegue ler
print('\nContas do Erick vs tokens:')
sem_acesso = []
for c in erick_contas:
    aid = c.get('meta_account_id') or ''
    name = (c.get('meta_account_name') or '')[:40]
    quem_acessa = [label for label in acessivel_por_token if aid in acessivel_por_token[label]]
    status = 'OK via ' + ', '.join(quem_acessa) if quem_acessa else 'NENHUM TOKEN ACESSA'
    print(f'  {aid:22s}  {name:42s}  {status}')
    if not quem_acessa:
        sem_acesso.append(c)

print('\n' + '=' * 70)
print(f'  RESUMO: {len(erick_contas)} contas do Erick, {len(sem_acesso)} sem acesso')
print('=' * 70)

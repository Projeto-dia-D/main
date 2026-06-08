"""Busca EXAUSTIVA por Barbara em todas as contas Meta (Weslei + Andre)."""
import requests, unicodedata, re

ENV = {}
with open('.env', encoding='utf-8') as f:
    for line in f:
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            ENV[k.strip()] = v.strip()

def norm(s):
    if not s: return ''
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.lower()

# Termos a procurar (variacoes)
KEYWORDS = [
    'barbara', 'barbára', 'bárbara',  # nome
    'giovana', 'rocha',                # nome do meio
    'guimaraes', 'guimar',             # sobrenome
    'goiania', 'goiân', 'go',          # cidade
    'lentes',                          # especialidade
    'dra_barbara',                     # instagram
    '85056', '6492',                   # parte do telefone
]

for token_var in ['VITE_META_TOKEN_WESLEI', 'VITE_META_TOKEN_ANDRE']:
    tok = ENV.get(token_var)
    if not tok:
        continue
    print(f'\n{"="*70}')
    print(f'TOKEN: {token_var}')
    print('=' * 70)

    # Pagina TODAS as contas (limit 500 e ja max)
    accounts = []
    url = 'https://graph.facebook.com/v21.0/me/adaccounts'
    params = {'access_token': tok, 'fields': 'id,name,account_status', 'limit': 500}
    while url:
        r = requests.get(url, params=params, timeout=60)
        if r.status_code != 200:
            print(f'  ERRO {r.status_code}: {r.text[:200]}')
            break
        data = r.json()
        accounts.extend(data.get('data', []))
        # paging next
        nxt = (data.get('paging') or {}).get('next')
        if not nxt:
            break
        url = nxt
        params = None  # ja vem na URL

    print(f'Total contas: {len(accounts)}')

    # Procura cada keyword
    for kw in KEYWORDS:
        kw_norm = norm(kw)
        matches = [a for a in accounts if kw_norm in norm(a.get('name', ''))]
        if matches:
            print(f'\n  "{kw}":')
            for a in matches:
                st = a.get('account_status')
                st_label = {1:'ATIVA',2:'OFF',3:'PEND',7:'RISCO',100:'PEND_OFF',101:'CLOSED'}.get(st, f'?({st})')
                print(f'    [{st_label}] {a.get("id"):<22} {a.get("name")}')

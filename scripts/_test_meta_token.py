"""Testa o NOVO token Meta do Weslei (le do .env)."""
import json, os
import requests

# Le do .env
ENV = {}
with open('.env', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        ENV[k.strip()] = v.strip()

WESLEI_TOKEN = ENV.get('VITE_META_TOKEN_WESLEI', '')
GRAPH = 'https://graph.facebook.com/v21.0'

print(f'Token (primeiros 40): {WESLEI_TOKEN[:40]}...')
print(f'Token (ultimos 20):  ...{WESLEI_TOKEN[-20:]}')
print(f'Comprimento total:   {len(WESLEI_TOKEN)} chars')
print()

def get(path, params=None):
    p = {**(params or {}), 'access_token': WESLEI_TOKEN}
    try:
        r = requests.get(f'{GRAPH}{path}', params=p, timeout=30)
        return r.status_code, r.json()
    except Exception as e:
        return None, str(e)

# 1. /me
print('=' * 70)
print('1. Validando token (/me)...')
print('=' * 70)
status, data = get('/me')
print(f'Status: {status}')
print(json.dumps(data, indent=2, ensure_ascii=False))
print()

# 2. /me/adaccounts
print('=' * 70)
print('2. Contas de anuncio (/me/adaccounts)...')
print('=' * 70)
status, data = get('/me/adaccounts',
                   {'fields': 'id,name,account_status,currency,business_name,spend_cap'})
print(f'Status: {status}')
if status == 200:
    accounts = data.get('data', [])
    print(f'Total contas: {len(accounts)}\n')
    for a in accounts:
        st = a.get('account_status')
        st_label = {1: 'ATIVA', 2: 'DESATIVADA', 3: 'PEND_FECHADA', 7: 'RISCO',
                    100: 'PEND_FECHAR', 101: 'CLOSED'}.get(st, f'? ({st})')
        biz = a.get('business_name') or ''
        print(f"  {a.get('id','?'):<22}  {st_label:<14}  {a.get('currency','?'):<4}  {a.get('name','')}")
        if biz:
            print(f"  {'':22}  └─ Business: {biz}")
else:
    print(json.dumps(data, indent=2, ensure_ascii=False))
print()

# 3. /debug_token
print('=' * 70)
print('3. Debug do token...')
print('=' * 70)
status, data = get('/debug_token', {'input_token': WESLEI_TOKEN})
if status == 200:
    d = data.get('data', {})
    print(f"  type:       {d.get('type')}")
    print(f"  app_id:     {d.get('app_id')}")
    print(f"  application:{d.get('application')}")
    exp = d.get('expires_at', 0)
    if exp == 0:
        print(f"  expires:    NUNCA (long-lived/system user)")
    else:
        import datetime as dt
        print(f"  expires:    {dt.datetime.fromtimestamp(exp).strftime('%Y-%m-%d %H:%M')}")
    print(f"  valid:      {d.get('is_valid')}")
    scopes = d.get('scopes', [])
    print(f"  scopes:     {scopes}")
else:
    print(json.dumps(data, indent=2, ensure_ascii=False))

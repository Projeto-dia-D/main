"""Lista contas Meta do Andre filtrando 'CA - 01 -' (padrao Anacleto)."""
import requests

with open('.env', encoding='utf-8') as f:
    for line in f:
        if line.startswith('VITE_META_TOKEN_ANDRE='):
            ANDRE = line.split('=', 1)[1].strip()
            break

r = requests.get('https://graph.facebook.com/v21.0/me/adaccounts',
                 params={'access_token': ANDRE, 'fields': 'id,name,account_status', 'limit': 500}, timeout=60)
data = r.json().get('data', [])
print(f'Total contas Andre: {len(data)}\n')

# Padrao CA - 01 -
ca01 = [a for a in data if (a.get('name') or '').startswith('CA - 01 -')]
print(f'Contas com prefixo "CA - 01 -": {len(ca01)}\n')
for a in sorted(ca01, key=lambda x: x.get('name','')):
    st = a.get('account_status')
    flag = '✓' if st == 1 else f'({st})'
    print(f"  {flag} {a.get('id'):<22} {a.get('name')}")

print()
# Procura tudo que possa ser Barbara
print('=== Procurando Barbara / Giovana / Guimaraes / Goiania em TODAS as contas Andre ===')
for kw in ['barbara','giovana','guimaraes','guimarães','goiania','goiânia','lentes']:
    matches = [a for a in data if kw in (a.get('name') or '').lower()]
    if matches:
        print(f'\n  "{kw}":')
        for a in matches:
            st = a.get('account_status')
            print(f'    [{st}] {a.get("id"):<22} {a.get("name")}')

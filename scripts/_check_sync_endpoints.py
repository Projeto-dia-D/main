"""Procura endpoints UAZAPI pra sync de histórico."""
import sys, os, requests
sys.stdout.reconfigure(encoding='utf-8')

env = {}
for line in open(os.path.join(os.path.dirname(__file__), '..', '.env'), encoding='utf-8'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

UAZ = env['VITE_UAZAPI_URL'].rstrip('/')
TOKEN = '0e800197-d3e5-4ef5-b75c-a482b427dab2'
H = {'token': TOKEN, 'Content-Type': 'application/json'}
TEST_JID = '120363426945267465@g.us'

# Tenta endpoints conhecidos de history sync
endpoints = [
    ('/chat/history/sync', 'POST', {'chatid': TEST_JID}),
    ('/chat/sync', 'POST', {'chatid': TEST_JID}),
    ('/history/request', 'POST', {'chatid': TEST_JID}),
    ('/message/sync', 'POST', {'chatid': TEST_JID}),
    ('/sync/history', 'POST', {'chatid': TEST_JID}),
    ('/instance/sync', 'POST', {}),
    ('/chat/request-history', 'POST', {'chatid': TEST_JID}),
    ('/group/messages', 'POST', {'groupjid': TEST_JID}),
    ('/messages', 'POST', {'chatid': TEST_JID}),
    # GETs também
    ('/chat/history', 'GET', None),
    ('/messages/history', 'GET', None),
]

for path, method, payload in endpoints:
    try:
        if method == 'POST':
            r = requests.post(f'{UAZ}{path}', headers=H, json=payload, timeout=15)
        else:
            r = requests.get(f'{UAZ}{path}?chatid={TEST_JID}', headers=H, timeout=15)
        print(f'  {method} {path}: {r.status_code}', end=' ')
        if r.status_code == 200:
            print(f'OK  body={r.text[:200]}')
        else:
            print(r.text[:80])
    except Exception as e:
        print(f'  {method} {path}: ERR {e}')

# Lista geral
print('\n--- Tenta listar endpoints disponíveis (Swagger/OpenAPI) ---')
for path in ['/docs', '/swagger', '/openapi.json', '/api-docs', '/v1/docs']:
    try:
        r = requests.get(f'{UAZ}{path}', timeout=10)
        print(f'  GET {path}: {r.status_code}')
    except Exception:
        pass

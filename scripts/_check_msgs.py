"""Investiga quantas mensagens UAZAPI tem pra um grupo."""
import sys, os, requests, json, datetime as dt
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
TEST_JID = '120363426945267465@g.us'  # Ana Luiza Garcia

print(f'Investigando msgs do grupo {TEST_JID}\n')

# Vai paginando até esgotar
offset = 0
total = 0
oldest_ts = None
newest_ts = None
while True:
    r = requests.post(f'{UAZ}/message/find', headers=H,
                      json={'chatid': TEST_JID, 'limit': 200, 'offset': offset}, timeout=60)
    if r.status_code != 200:
        print(f'  HTTP {r.status_code}: {r.text[:200]}')
        break
    data = r.json()
    msgs = data.get('messages', []) or []
    if not msgs:
        break
    total += len(msgs)
    for m in msgs:
        ts = m.get('messageTimestamp')
        if ts:
            if oldest_ts is None or ts < oldest_ts:
                oldest_ts = ts
            if newest_ts is None or ts > newest_ts:
                newest_ts = ts
    has_more = data.get('hasMore')
    print(f'  offset={offset:5d}  got={len(msgs):3d}  total_acumulado={total:5d}  hasMore={has_more}  nextOffset={data.get("nextOffset")}')
    if not has_more:
        break
    offset = data.get('nextOffset', offset + 200)
    if offset > 10000:
        print('  STOP (offset > 10000)')
        break

print(f'\nTotal mensagens: {total}')
if oldest_ts:
    o = dt.datetime.fromtimestamp(oldest_ts / 1000, tz=dt.timezone.utc)
    n = dt.datetime.fromtimestamp(newest_ts / 1000, tz=dt.timezone.utc)
    print(f'Mais antiga: {o.isoformat()}')
    print(f'Mais recente: {n.isoformat()}')

# Tenta outros endpoints
print('\n--- Tenta outros endpoints ---')
for path in ['/chat/history', '/history', '/messages/find', '/instance/messages', '/chat/find/messages']:
    r = requests.post(f'{UAZ}{path}', headers=H, json={'chatid': TEST_JID, 'limit': 1000}, timeout=30)
    print(f'  POST {path}: {r.status_code}', r.text[:100] if r.status_code != 200 else 'OK')

# Info da instância — quando ela foi criada?
print('\n--- Info da instância ---')
r = requests.get(f'{UAZ}/instance/status', headers=H, timeout=15)
print(f'  /instance/status: {r.status_code}', r.text[:600] if r.status_code == 200 else r.text[:200])

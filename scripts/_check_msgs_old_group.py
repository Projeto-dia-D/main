"""Compara qtd de mensagens entre grupo recente (Ana Luiza) e antigo (Eduardo Delfim)."""
import sys, os, requests, datetime as dt
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

# Compara 3 grupos: recente vs antigo
TESTS = [
    ('120363426945267465@g.us', 'Ana Luiza Garcia (recente)'),
    ('120363337602229495@g.us', 'Eduardo Delfim (set/2024)'),
    ('120363144429550439@g.us', 'Carlos Godoy (jul/2023)'),
    ('120363048209974588@g.us', 'Smart Lion (jan/2023)'),
]
for jid, label in TESTS:
    print(f'\n>>> {label}  ({jid})')
    offset = 0
    total = 0
    oldest = None
    newest = None
    while True:
        r = requests.post(f'{UAZ}/message/find', headers=H,
                          json={'chatid': jid, 'limit': 500, 'offset': offset}, timeout=60)
        if r.status_code != 200:
            print(f'  HTTP {r.status_code}')
            break
        data = r.json()
        msgs = data.get('messages', []) or []
        if not msgs:
            break
        total += len(msgs)
        for m in msgs:
            ts = m.get('messageTimestamp')
            if ts:
                if oldest is None or ts < oldest:
                    oldest = ts
                if newest is None or ts > newest:
                    newest = ts
        if not data.get('hasMore'):
            break
        offset = data.get('nextOffset', offset + 500)
        if offset > 50000:
            break
    print(f'  Total: {total} msgs')
    if oldest:
        o = dt.datetime.fromtimestamp(oldest / 1000)
        n = dt.datetime.fromtimestamp(newest / 1000)
        print(f'  {o.strftime("%Y-%m-%d")} -> {n.strftime("%Y-%m-%d")}')

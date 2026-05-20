"""Helper temporário pra verificar status atual do sync WhatsApp."""
import sys, requests
sys.stdout.reconfigure(encoding='utf-8')

env = {}
with open('.env', 'r', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")

KEY = env['VITE_SUPABASE_SERVICE_ROLE_SECRET']
SUPA = env['VITE_SUPABASE_URL']
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}


def count(table: str, params: str = '') -> str:
    h = {**H, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0'}
    sep = '&' if params else ''
    r = requests.get(f'{SUPA}/rest/v1/{table}?select=*{sep}{params}', headers=h, timeout=15)
    cr = r.headers.get('content-range', '')
    return cr.split('/')[-1] if cr else '?'


print('=== Status atual ===')
print(f'whatsapp_groups (total): {count("whatsapp_groups")}')
print(f'  burst:                  {count("whatsapp_groups", "is_burst_group=eq.true")}')
print(f'  com members carregados: {count("whatsapp_groups", "participants_count=not.is.null")}')
print(f'whatsapp_group_members:  {count("whatsapp_group_members")}')
print(f'whatsapp_messages:       {count("whatsapp_messages")}')
print(f'whatsapp_group_events:   {count("whatsapp_group_events")}')
print(f'whatsapp_group_scores:   {count("whatsapp_group_scores")}')

# Lista grupos com mais mensagens já sincronizadas (pra validar)
print('\n=== Top 10 grupos com mensagens já no Supabase ===')
r = requests.get(
    f'{SUPA}/rest/v1/whatsapp_messages?select=chat_jid&limit=20000',
    headers=H, timeout=30,
)
data = r.json() if r.status_code == 200 else []
counts = {}
for m in data:
    cj = m.get('chat_jid')
    if cj:
        counts[cj] = counts.get(cj, 0) + 1

top = sorted(counts.items(), key=lambda x: -x[1])[:10]
# Pega nome dos grupos top
if top:
    jids = ','.join(f'"{j}"' for j, _ in top)
    r2 = requests.get(
        f'{SUPA}/rest/v1/whatsapp_groups?chat_jid=in.({jids})&select=chat_jid,name,participants_count',
        headers=H, timeout=15,
    )
    name_map = {g['chat_jid']: g for g in r2.json()}
    for jid, n in top:
        g = name_map.get(jid, {})
        nm = g.get('name', '?')
        pc = g.get('participants_count', '?')
        print(f'  {n:5d} msgs  · {pc:>3} membros  · {nm[:60]}')

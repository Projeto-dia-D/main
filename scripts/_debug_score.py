"""Debuga por que compute_scores_weekly retorna 0."""
import sys, os, requests, datetime as dt, urllib.parse
sys.stdout.reconfigure(encoding='utf-8')

env = {}
for line in open(os.path.join(os.path.dirname(__file__), '..', '.env'), encoding='utf-8'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

SUPA = env['VITE_SUPABASE_URL']
KEY = env['VITE_SUPABASE_SERVICE_ROLE_SECRET']
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}

# Testa filtro de data com +00:00 raw
period_start = dt.datetime.now(tz=dt.timezone.utc) - dt.timedelta(days=7)
iso_raw = period_start.isoformat()
iso_enc = urllib.parse.quote(iso_raw)

# Grupo do Ana Luiza
JID = '120363426945267465@g.us'

for label, ts_param in [('raw (+00:00)', iso_raw), ('encoded', iso_enc), ('Z format', iso_raw.replace('+00:00', 'Z'))]:
    url = f'{SUPA}/rest/v1/whatsapp_messages?chat_jid=eq.{JID}&ts=gte.{ts_param}&select=count'
    r = requests.get(url, headers={**H, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0'}, timeout=15)
    cr = r.headers.get('content-range', '')
    print(f'  {label:20s}  status={r.status_code}  count={cr.split("/")[-1] if cr else "?"}  body_preview={r.text[:100]}')

# Total geral de msgs do grupo
url = f'{SUPA}/rest/v1/whatsapp_messages?chat_jid=eq.{JID}&select=count'
r = requests.get(url, headers={**H, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0'}, timeout=15)
print(f'\n  TOTAL msgs do grupo: {r.headers.get("content-range", "").split("/")[-1]}')

# Mensagens mais recentes
url2 = f'{SUPA}/rest/v1/whatsapp_messages?chat_jid=eq.{JID}&select=ts&order=ts.desc&limit=3'
r2 = requests.get(url2, headers=H, timeout=15)
print(f'  Mensagens mais recentes:')
for m in r2.json():
    print(f'    {m["ts"]}')

print(f'\n  period_start (7 dias atrás) = {iso_raw}')

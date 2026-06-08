"""Mostra quao fresca esta a sync de WhatsApp em cada tabela.

Le monday_sync_meta + os ultimos timestamps reais das tabelas WhatsApp
pra dar uma resposta definitiva: "ta vindo dados ou nao?".
"""
import os, sys, datetime as dt
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


def rel(iso: str | None) -> str:
    if not iso:
        return '?'
    try:
        d = dt.datetime.fromisoformat(iso.replace('Z', '+00:00'))
        diff = dt.datetime.now(dt.timezone.utc) - d
        if diff.total_seconds() < 60:
            return f'{int(diff.total_seconds())}s atras'
        if diff.total_seconds() < 3600:
            return f'{int(diff.total_seconds()/60)}min atras'
        if diff.total_seconds() < 86400:
            return f'{int(diff.total_seconds()/3600)}h atras'
        return f'{int(diff.total_seconds()/86400)}d atras'
    except Exception:
        return iso


print('=' * 70)
print('  FRESCURA DA SYNC WHATSAPP')
print('=' * 70)

# 1. monday_sync_meta — o sync grava aqui apos cada run
r = requests.get(
    f'{supa}/rest/v1/monday_sync_meta?select=key,value',
    headers=H, timeout=15,
)
meta = {row['key']: row.get('value', {}) for row in r.json()}
keys_wa = [k for k in meta if 'whatsapp' in k or 'group' in k or 'message' in k]
print('\nmonday_sync_meta (chaves relacionadas a WhatsApp):')
if not keys_wa:
    print('  (nenhuma entrada de sync WhatsApp registrada)')
for k in sorted(keys_wa):
    v = meta[k]
    last = v.get('last_sync_at')
    extra = ''
    if 'rows_updated' in v:
        extra = f"  (rows: {v.get('rows_updated', '?')})"
    print(f'  {k:35s} -> {rel(last):20s} ({last}){extra}')

# 2. Timestamp da ULTIMA mensagem armazenada — mostra ate quando temos dados
for tbl, ts_col in [
    ('whatsapp_messages', 'ts'),
    ('whatsapp_groups', 'last_message_at'),
    ('whatsapp_group_events', 'ts'),
    ('whatsapp_group_scores', 'snapshot_at'),
]:
    r = requests.get(
        f'{supa}/rest/v1/{tbl}?select={ts_col}&order={ts_col}.desc.nullslast&limit=1',
        headers=H, timeout=15,
    )
    data = r.json()
    if data:
        latest = data[0].get(ts_col)
        # Total de rows tambem
        rh = requests.get(
            f'{supa}/rest/v1/{tbl}?select=*&limit=1',
            headers={**H, 'Prefer': 'count=exact'}, timeout=15,
        )
        total = rh.headers.get('content-range', '?/?').split('/')[-1]
        print(f'\n{tbl}:')
        print(f'  mais recente: {rel(latest)} ({latest})')
        print(f'  total de rows: {total}')
    else:
        print(f'\n{tbl}: (vazio)')

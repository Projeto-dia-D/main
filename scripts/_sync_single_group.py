"""Sync ISOLADO de UM grupo WhatsApp pelo nome (substring).

Usado pra validar a aba "Grupo WhatsApp" da Saúde do Cliente sem esperar
o backfill grande terminar. Roda em paralelo sem conflito (idempotente via
PK no Supabase).

Uso:
    python scripts/_sync_single_group.py "julio mota"
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import runpy

if len(sys.argv) < 2:
    print('Uso: python scripts/_sync_single_group.py "<nome do doutor>"')
    sys.exit(1)

needle = sys.argv[1].lower().strip()
print(f'>>> Procurando grupo com "{needle}" no nome...')

# Importa as funções do sync_whatsapp_to_supabase.py
wa = runpy.run_path('scripts/sync_whatsapp_to_supabase.py', run_name='__noop__')

fetch_chats = wa['fetch_chats']
fetch_group_info = wa['fetch_group_info']
fetch_messages = wa['fetch_messages']
extract_events = wa['extract_events']
compute_response_times = wa['compute_response_times']
compute_score = wa['compute_score']
load_auth_emails_map = wa['load_auth_emails_map']
infer_role = wa['infer_role']
ts_to_iso = wa['ts_to_iso']
clean_phone = wa['clean_phone']
supa_upsert = wa['supa_upsert']
import re, datetime as dt

# 1. Lista chats e acha o grupo
print('Carregando chats da instância...')
chats = fetch_chats()
matches = []
for c in chats:
    name = (c.get('name') or c.get('wa_name') or '').lower()
    if c.get('wa_isGroup') and needle in name:
        matches.append(c)

if not matches:
    print(f'❌ Nenhum grupo encontrado com "{needle}"')
    sys.exit(1)

print(f'Grupos encontrados: {len(matches)}')
for m in matches:
    print(f'  · {m.get("name") or m.get("wa_name")}  ({m.get("wa_chatid") or m.get("id")})')

# Pega o primeiro
target = matches[0]
chat_jid = target.get('wa_chatid') or target.get('id')
group_name = target.get('name') or target.get('wa_name')
last_ts_iso = ts_to_iso(target.get('wa_lastMsgTimestamp'))
print(f'\n>>> Sincronizando: {group_name}')
print(f'    JID: {chat_jid}')

# 2. Upsert do grupo
import requests, os
env = {}
for line in open(os.path.join(os.path.dirname(__file__), '..', '.env'), encoding='utf-8'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

supa_upsert('whatsapp_groups', [{
    'chat_jid': chat_jid,
    'name': group_name,
    'monday_client_id': None,
    'participants_count': None,
    'group_created_at': None,
    'last_message_at': last_ts_iso,
    'uazapi_instance_token': '0e800197-d3e5-4ef5-b75c-a482b427dab2',
    'is_burst_group': True,
    'updated_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
}], on_conflict='chat_jid')
print('  ✓ Grupo registrado')

# 3. Membros
print('\n>>> Buscando membros...')
info = fetch_group_info(chat_jid)
auth_map = load_auth_emails_map()
print(f'  {len(auth_map)} entradas em monday_auth_emails')

participants = (info or {}).get('Participants', []) or []
print(f'  {len(participants)} participantes')

rows_members = []
roles_seen = {}
for p in participants:
    phone = clean_phone(p.get('PhoneNumber')) or clean_phone(p.get('JID')) or clean_phone(p.get('LID'))
    if not phone:
        continue
    display = p.get('DisplayName') or ''
    role, inferred_name, monday_email = infer_role(display, None, auth_map)
    roles_seen[role] = roles_seen.get(role, 0) + 1
    rows_members.append({
        'chat_jid': chat_jid,
        'phone': phone,
        'display_name': display or None,
        'inferred_role': role,
        'inferred_name': inferred_name,
        'monday_email': monday_email,
    })
n_m = supa_upsert('whatsapp_group_members', rows_members, on_conflict='chat_jid,phone')
print(f'  ✓ {n_m} membros salvos')
print(f'  Papéis: {roles_seen}')

# Atualiza participants_count + group_created_at
supa_upsert('whatsapp_groups', [{
    'chat_jid': chat_jid,
    'name': group_name,
    'participants_count': len(participants),
    'group_created_at': (info or {}).get('GroupCreated'),
    'updated_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
}], on_conflict='chat_jid')

# 4. Mensagens
print('\n>>> Buscando mensagens (até 2000)...')
msgs = fetch_messages(chat_jid, max_msgs=2000, since_iso=None)
print(f'  {len(msgs)} mensagens obtidas')

# Indexa role por phone
members_by_phone = {m['phone']: m['inferred_role'] for m in rows_members}

rows_msgs = []
rows_events = []
for m in msgs:
    msg_id = m.get('messageid') or m.get('id')
    if not msg_id:
        continue
    sender_jid = m.get('sender')
    sender_phone = clean_phone(sender_jid)
    sender_name = m.get('senderName')
    ts = ts_to_iso(m.get('messageTimestamp'))
    if not ts:
        continue
    text = m.get('text') or (m.get('content', {}) or {}).get('text') if isinstance(m.get('content'), dict) else None
    if not text:
        text = m.get('text')
    msg_type = m.get('messageType') or 'unknown'

    role = 'unknown'
    if sender_phone and sender_phone in members_by_phone:
        role = members_by_phone[sender_phone]
    else:
        inf, _, _ = infer_role(sender_name, sender_name, auth_map)
        role = inf
    is_from_burst = role in ('cs', 'gestor', 'designer', 'programador', 'admin')

    rows_msgs.append({
        'message_id': str(msg_id),
        'chat_jid': chat_jid,
        'sender_phone': sender_phone,
        'sender_name': sender_name,
        'text': text[:8000] if text else None,
        'message_type': msg_type,
        'ts': ts,
        'is_from_burst': is_from_burst,
        'inferred_role': role,
    })
    rows_events.extend(extract_events(str(msg_id), chat_jid, ts, text, sender_phone, role))

n_msg = supa_upsert('whatsapp_messages', rows_msgs, on_conflict='message_id', batch_size=500)
n_ev = supa_upsert('whatsapp_group_events', rows_events, on_conflict='event_id', batch_size=500)
print(f'  ✓ {n_msg} mensagens e {n_ev} eventos salvos')

# 5. Score
print('\n>>> Calculando score (últimos 7 dias)...')
now = dt.datetime.now(tz=dt.timezone.utc)
period_start = now - dt.timedelta(days=7)
msgs_period = [m for m in rows_msgs if m['ts'] >= period_start.isoformat()]
msgs_from_client = sum(1 for m in msgs_period if m.get('inferred_role') == 'cliente')
msgs_from_burst = sum(1 for m in msgs_period if m.get('is_from_burst'))
resp_times = compute_response_times(msgs_period)
avg_resp = sum(resp_times) / len(resp_times) if resp_times else None
median_resp = sorted(resp_times)[len(resp_times) // 2] if resp_times else None
max_resp = max(resp_times) if resp_times else None
under_30 = sum(1 for t in resp_times if t < 30)
over_2h = sum(1 for t in resp_times if t > 120)
pct_under_30 = (under_30 / len(resp_times) * 100) if resp_times else 0

events_period = [e for e in rows_events if e['ts'] >= period_start.isoformat()]
cnt = {'reclamacao': 0, 'atraso': 0, 'erro_escrita': 0, 'elogio': 0, 'demora_resposta': 0}
for e in events_period:
    t = e.get('event_type')
    if t in cnt:
        cnt[t] += 1

score, breakdown = compute_score(avg_resp, pct_under_30, cnt['reclamacao'], cnt['atraso'])

supa_upsert('whatsapp_group_scores', [{
    'chat_jid': chat_jid,
    'snapshot_at': now.isoformat(),
    'period_start': period_start.isoformat(),
    'period_end': now.isoformat(),
    'total_messages': len(msgs_period),
    'messages_from_client': msgs_from_client,
    'messages_from_burst': msgs_from_burst,
    'avg_response_time_minutes': round(avg_resp, 2) if avg_resp else None,
    'median_response_time_minutes': round(median_resp, 2) if median_resp else None,
    'max_response_time_minutes': round(max_resp, 2) if max_resp else None,
    'responses_under_30min': under_30,
    'responses_over_2h': over_2h,
    'pct_responses_under_30min': round(pct_under_30, 2),
    'count_reclamacoes': cnt['reclamacao'],
    'count_atrasos': cnt['atraso'],
    'count_erros_escrita': cnt['erro_escrita'],
    'count_elogios': cnt['elogio'],
    'count_demora_resposta': cnt['demora_resposta'],
    'score': score,
    'score_breakdown': breakdown,
}], on_conflict='chat_jid,snapshot_at')

print(f'\n✅ Score calculado: {score}/100')
print(f'   Tempo médio resposta (úteis): {round(avg_resp, 1) if avg_resp else "—"} min')
print(f'   % <30min: {round(pct_under_30, 1)}%')
print(f'   Reclamações: {cnt["reclamacao"]}  ·  Atrasos: {cnt["atraso"]}  ·  Elogios: {cnt["elogio"]}')
print(f'\nValide na aba Saúde do Cliente → procurar "{group_name.split(" X ")[0]}"')

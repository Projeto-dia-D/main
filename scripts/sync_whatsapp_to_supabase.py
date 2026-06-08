"""
Sync WhatsApp grupos (UAZAPI) → Supabase.

Espelha grupos, membros e mensagens da instância UAZAPI da Burst nas tabelas
`whatsapp_groups`, `whatsapp_group_members`, `whatsapp_messages`,
`whatsapp_group_events`, `whatsapp_group_scores`.

Modos:
  --mode=backfill (1ª vez): puxa TODAS as mensagens (até MAX_MSGS_PER_GROUP por grupo)
  --mode=delta (sync semanal): só mensagens NOVAS desde último sync
  --mode=analyze: re-roda análise de eventos + score sem refetch das mensagens

Uso:
    # 1ª execução (pesado — ~30-60 min)
    python scripts/sync_whatsapp_to_supabase.py --mode=backfill

    # Agendado pra domingo (Task Scheduler)
    python scripts/sync_whatsapp_to_supabase.py --mode=delta
"""
import os
import sys
import re
import time
import argparse
import datetime as dt
import json
import hashlib
import unicodedata
from typing import Any
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

sys.stdout.reconfigure(encoding='utf-8')

# ------------------------------------------------------------
# Config
# ------------------------------------------------------------
ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '.env')
SUPABASE_URL = ''
SUPABASE_KEY = ''
UAZAPI_URL = ''
if os.path.exists(ENV_PATH):
    for line in open(ENV_PATH, encoding='utf-8'):
        line = line.strip()
        if not line or '=' not in line or line.startswith('#'):
            continue
        k, v = line.split('=', 1)
        v = v.strip().strip('"').strip("'")
        if k.strip() == 'VITE_SUPABASE_URL':
            SUPABASE_URL = v
        elif k.strip() == 'VITE_SUPABASE_SERVICE_ROLE_SECRET':
            SUPABASE_KEY = v
        elif k.strip() == 'VITE_UAZAPI_URL':
            UAZAPI_URL = v.rstrip('/')

for var, val in [
    ('VITE_SUPABASE_URL', SUPABASE_URL),
    ('VITE_SUPABASE_SERVICE_ROLE_SECRET', SUPABASE_KEY),
    ('VITE_UAZAPI_URL', UAZAPI_URL),
]:
    if not val:
        print(f'ERRO: {var} não encontrado no .env')
        sys.exit(1)

# Token da instância "bia demonstração" (a master de grupos Burst).
# Eventualmente pode virar config do .env, mas por enquanto hardcoded.
BURST_GROUPS_TOKEN = '0e800197-d3e5-4ef5-b75c-a482b427dab2'

# Limites
MAX_MSGS_PER_GROUP_BACKFILL = 2000  # No 1º backfill, máx por grupo
MAX_MSGS_PER_GROUP_DELTA = 1000     # No delta, máx por grupo (cobre 1 semana com folga)
PAGE_SIZE_MSGS = 200                # Mensagens por chamada
RATE_LIMIT_SLEEP = 0.3              # Sleep entre chamadas UAZAPI

# Horário comercial (pra cálculo de tempo de resposta).
# Burst trabalha: seg-sex, 08:00-12:00 + 13:12-18:00.
# 4h + 4h48min = 8h48min úteis por dia (528 minutos).
COMERCIAL_WINDOWS = [
    # (hora_inicio, minuto_inicio, hora_fim, minuto_fim)
    (8, 0, 12, 0),    # Manhã: 08:00 - 12:00
    (13, 12, 18, 0),  # Tarde: 13:12 - 18:00
]
MINUTES_PER_WORKDAY = 4 * 60 + (18 * 60 + 0 - (13 * 60 + 12))  # 528 min


# ------------------------------------------------------------
# HTTP session
# ------------------------------------------------------------
def build_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=6, connect=6, read=6, backoff_factor=1.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=['GET', 'POST', 'PATCH', 'DELETE'],
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
    s.mount('https://', adapter)
    s.mount('http://', adapter)
    return s


http = build_session()

UAZ_HEADERS = {'token': BURST_GROUPS_TOKEN, 'Content-Type': 'application/json'}
SUPA_HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
}


def normalize(s: str | None) -> str:
    if not s:
        return ''
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn').lower().strip()


def clean_phone(jid_or_phone: str | None) -> str | None:
    """Extrai número limpo de '5512345678@s.whatsapp.net' / '@lid'."""
    if not jid_or_phone:
        return None
    s = str(jid_or_phone).split('@')[0].split(':')[0]
    digits = ''.join(c for c in s if c.isdigit())
    return digits or None


def ts_to_iso(ts: Any) -> str | None:
    """Converte milliseconds → ISO UTC."""
    try:
        n = int(ts)
        if n <= 0:
            return None
        return dt.datetime.fromtimestamp(n / 1000, tz=dt.timezone.utc).isoformat()
    except (ValueError, TypeError):
        return None


# ------------------------------------------------------------
# Supabase helpers
# ------------------------------------------------------------
def supa_upsert(table: str, rows: list[dict], on_conflict: str = '', batch_size: int = 200) -> int:
    if not rows:
        return 0
    url = f'{SUPABASE_URL}/rest/v1/{table}'
    if on_conflict:
        url += f'?on_conflict={on_conflict}'
    h = {**SUPA_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal'}
    total = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        res = http.post(url, headers=h, json=chunk, timeout=120)
        if res.status_code < 300:
            total += len(chunk)
            continue
        # Falhou → tenta row-by-row
        print(f'  ⚠ batch falhou ({res.status_code}). Row-by-row em {len(chunk)} rows…')
        ok = 0; errs = 0
        for r in chunk:
            rres = http.post(url, headers=h, json=[r], timeout=30)
            if rres.status_code < 300:
                ok += 1
            else:
                errs += 1
                if errs <= 3:
                    print(f'    ❌ ({rres.status_code}): {rres.text[:200]}')
        print(f'    recovery: {ok} ok, {errs} erros')
        total += ok
    return total


def supa_get(table: str, params: str = '') -> list:
    url = f'{SUPABASE_URL}/rest/v1/{table}'
    if params:
        url += '?' + params
    h = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
    res = http.get(url, headers=h, timeout=60)
    return res.json() if res.status_code == 200 else []


# ------------------------------------------------------------
# UAZAPI fetchers
# ------------------------------------------------------------
def fetch_chats() -> list[dict]:
    """Pega TODOS os chats (paginação)."""
    out = []
    offset = 0
    while True:
        try:
            r = http.post(f'{UAZAPI_URL}/chat/find', headers=UAZ_HEADERS,
                          json={'limit': 200, 'offset': offset}, timeout=60)
        except Exception as e:
            print(f'  ⚠ /chat/find offset={offset}: {e}')
            break
        if r.status_code != 200:
            print(f'  ⚠ /chat/find offset={offset}: {r.status_code} {r.text[:200]}')
            break
        chats = r.json().get('chats', []) or []
        if not chats:
            break
        out.extend(chats)
        if len(chats) < 200:
            break
        offset += 200
        time.sleep(RATE_LIMIT_SLEEP)
    return out


def fetch_group_info(group_jid: str) -> dict | None:
    """Info + lista de participantes de um grupo."""
    try:
        r = http.post(f'{UAZAPI_URL}/group/info', headers=UAZ_HEADERS,
                      json={'groupjid': group_jid}, timeout=30)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f'  ⚠ /group/info {group_jid}: {e}')
    return None


def fetch_messages(chat_jid: str, max_msgs: int, since_iso: str | None = None) -> list[dict]:
    """Pega mensagens de um chat. Para quando atinge max_msgs ou bate em msg
    mais antiga que since_iso (delta sync)."""
    out = []
    offset = 0
    since_ts_ms = None
    if since_iso:
        try:
            since_ts_ms = int(dt.datetime.fromisoformat(since_iso.replace('Z', '+00:00')).timestamp() * 1000)
        except Exception:
            pass
    while len(out) < max_msgs:
        try:
            r = http.post(f'{UAZAPI_URL}/message/find', headers=UAZ_HEADERS,
                          json={'chatid': chat_jid, 'limit': PAGE_SIZE_MSGS, 'offset': offset}, timeout=60)
        except Exception as e:
            print(f'    ⚠ /message/find chat={chat_jid[:20]} offset={offset}: {e}')
            break
        if r.status_code != 200:
            break
        data = r.json()
        msgs = data.get('messages', []) or []
        if not msgs:
            break
        # Filtra por since_ts_ms
        if since_ts_ms is not None:
            filtered = [m for m in msgs if m.get('messageTimestamp', 0) >= since_ts_ms]
            out.extend(filtered)
            # Se TODAS as msgs dessa página são mais antigas, paramos
            if len(filtered) < len(msgs):
                break
        else:
            out.extend(msgs)
        if not data.get('hasMore'):
            break
        offset = data.get('nextOffset', offset + PAGE_SIZE_MSGS)
        time.sleep(0.15)
    return out[:max_msgs]


# ------------------------------------------------------------
# Identificação de papel (PRIMEIRO por telefone, fallback por nome)
# ------------------------------------------------------------
#
# Phone book hardcoded da equipe Burst — mantido em sincronia com
# src/lib/teamPhones.ts. Chave = ULTIMOS 8 DIGITOS do telefone
# (cobre numeros com ou sem o 9-prefix obrigatorio desde 2014).
#
# Por que existe: name-matching (display_name do WhatsApp vs nome no
# Monday) errava muito ("Paulo Burst", "Paulo Lentes", emojis, etc).
# Telefone é estavel.
TEAM_PHONES = {
    # Designers
    '91287493': ('Paulo', 'designer'),
    '98325611': ('Lais', 'designer'),
    '99868274': ('Felipe', 'designer'),
    # Gestores
    '92027739': ('Gabriel Anacleto', 'gestor'),
    '99562859': ('Ricardo', 'gestor'),
    '99164139': ('Erick', 'gestor'),
    # CS
    '98144940': ('Hellen', 'cs'),
    '99948791': ('Maria', 'cs'),
    '91178059': ('Thuisa', 'cs'),
    '91739073': ('Yasmin', 'cs'),
    '99079063': ('Laura', 'cs'),
    '99671923': ('Anne', 'cs'),
    '99386746': ('Julia', 'cs'),
    '98112865': ('Lilian', 'cs'),
    '99672621': ('Paula', 'cs'),
}


def identify_team_member(phone: str | None) -> tuple[str, str] | None:
    """Retorna (name, role) se telefone bate com a equipe, senao None."""
    if not phone:
        return None
    digits = re.sub(r'\D', '', phone)
    if len(digits) < 8:
        return None
    return TEAM_PHONES.get(digits[-8:])


def load_auth_emails_map() -> dict[str, tuple[str, str]]:
    """Retorna {nome_normalizado: (display_name, role)} de monday_auth_emails."""
    rows = supa_get('monday_auth_emails', 'select=email,name,role')
    out: dict[str, tuple[str, str]] = {}
    for r in rows:
        n = normalize(r.get('name'))
        if not n:
            continue
        out[n] = (r.get('name'), r.get('role'))
        # Adiciona também primeiro nome (pra match com "Anne" → "Anne Camargo")
        first = n.split()[0] if n else ''
        if first and len(first) >= 3 and first not in out:
            out[first] = (r.get('name'), r.get('role'))
    return out


def infer_role(display_name: str | None, sender_name: str | None,
               auth_map: dict[str, tuple[str, str]],
               phone: str | None = None) -> tuple[str, str, str | None]:
    """Retorna (role, inferred_name, monday_email_se_souber).

    Ordem de match:
      1. TELEFONE (TEAM_PHONES) — fonte mais confiavel, ignora display_name
      2. Nome exato em auth_map
      3. Nome por substring em auth_map (com garantia de palavra em comum)
      4. Default: 'cliente'
    """
    # 1. Phone-first: se telefone bate com a equipe, usa direto
    team = identify_team_member(phone)
    if team:
        return team[1], team[0], None

    # 2/3. Fallback por nome (caso o phone book ainda nao tenha esse numero)
    candidates = [display_name, sender_name]
    for cand in candidates:
        if not cand:
            continue
        n = normalize(cand)
        if not n:
            continue
        # Match exato
        if n in auth_map:
            name, role = auth_map[n]
            return role, name, None
        # Match por substring (Burst member contém o nome do WhatsApp)
        for key, (name, role) in auth_map.items():
            if n in key or key in n:
                # Garantia: o nome deve compartilhar pelo menos 5 chars
                if len(set(n.split()) & set(key.split())) >= 1:
                    return role, name, None
    return 'cliente', display_name or sender_name or '?', None


# ------------------------------------------------------------
# Análise de eventos (regex de eventos relevantes)
# ------------------------------------------------------------
EVENT_PATTERNS = {
    'reclamacao': [
        r'\bdecep[cç][ãa]o\b', r'decepcionad[ao]', r'p[eé]ssim[ao]', r'horr[ií]vel',
        r'n[ãa]o gostei', r'insatisfeit[ao]', r'absurd[ao]', r'\bruim\b',
        r't[áa] uma vergonha', r'cad[êe] o servi[cç]o', r'\bbosta\b',
    ],
    'atraso': [
        r'\batrasou\b', r'\batraso\b', r'\batrasad[ao]\b', r'\bdemora\b',
        r'esperando h[áa]', r'ainda n[ãa]o chegou', r'cad[êe] (a (arte|demanda|edi[cç][ãa]o)|o (post|criativo|video|reels))',
        r'estou esperando', r'tem previs[ãa]o', r'quando fica pronto',
    ],
    'erro_escrita': [
        r'\berrad[ao]\b', r'\bcorrigir\b', r'tem (um )?erro', r'est[áa] errad[ao]',
        r'escrito errad[ao]', r'errei', r'\bcorre[cç][ãa]o\b',
    ],
    'elogio': [
        r'\bobrigad[ao]\b', r'\b[óo]tim[ao]\b', r'\bperfeit[ao]\b', r'\bshow\b',
        r'incr[ií]vel', r'\bamei\b', r'\bmaravilh', r'\bsensacional\b',
        r'muito bom', r'gostei muito', r'\bparab[eé]ns\b',
    ],
    'duvida': [
        r'^\?+\s', r'\?$', r'tem como', r'pode (me )?explicar', r'd[úu]vida',
    ],
    'aprovacao': [
        r'\baprovad[ao]\b', r'\baprovo\b', r'\bok\b\s*$', r'\bpode\b.*\bpostar\b',
        r'pode publicar', r'\bvalidad[ao]\b',
    ],
}


def extract_events(message_id: str, chat_jid: str, ts: str, text: str | None,
                   sender_phone: str | None, sender_role: str | None) -> list[dict]:
    """Retorna eventos extraídos de uma mensagem. Pode ser vazio."""
    if not text:
        return []
    txt = text.lower()
    out = []
    for event_type, patterns in EVENT_PATTERNS.items():
        for pat in patterns:
            if re.search(pat, txt, re.IGNORECASE):
                # Só conta "reclamacao"/"atraso" se vem do CLIENTE
                if event_type in ('reclamacao', 'atraso') and sender_role != 'cliente':
                    continue
                # Só conta "aprovacao"/"elogio" se vem do CLIENTE também
                if event_type in ('aprovacao', 'elogio') and sender_role != 'cliente':
                    continue
                severity = 'high' if event_type == 'reclamacao' else 'medium' if event_type in ('atraso', 'erro_escrita') else 'low'
                ev_id = hashlib.md5(f'{message_id}-{event_type}-{pat}'.encode()).hexdigest()[:24]
                out.append({
                    'event_id': ev_id,
                    'chat_jid': chat_jid,
                    'message_id': message_id,
                    'event_type': event_type,
                    'detail': text[:500],
                    'ts': ts,
                    'severity': severity,
                    'triggered_by_phone': sender_phone,
                    'triggered_by_role': sender_role,
                })
                break  # 1 evento por tipo por mensagem
    return out


# ------------------------------------------------------------
# Tempo de resposta — usa horário COMERCIAL ÚTIL (descontando noite + almoço + fds)
# ------------------------------------------------------------
def _to_brasilia(d: dt.datetime) -> dt.datetime:
    """Converte UTC pra horário de Brasília (-3h, sem DST)."""
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(dt.timezone(dt.timedelta(hours=-3)))


def is_horario_comercial(ts_iso: str) -> bool:
    """True se o timestamp cai dentro de uma janela comercial Burst."""
    try:
        d = dt.datetime.fromisoformat(ts_iso.replace('Z', '+00:00'))
        d_br = _to_brasilia(d)
        if d_br.weekday() >= 5:
            return False
        hm = d_br.hour * 60 + d_br.minute
        for sh, sm, eh, em in COMERCIAL_WINDOWS:
            if sh * 60 + sm <= hm < eh * 60 + em:
                return True
        return False
    except Exception:
        return False


def _seconds_overlap_in_window(t1: dt.datetime, t2: dt.datetime,
                                wstart: dt.datetime, wend: dt.datetime) -> float:
    """Intersecção [t1,t2] ∩ [wstart, wend] em segundos."""
    s = max(t1, wstart)
    e = min(t2, wend)
    return max(0.0, (e - s).total_seconds())


def working_minutes_between(start_iso: str, end_iso: str) -> float | None:
    """Conta SÓ minutos úteis (dentro de COMERCIAL_WINDOWS, seg-sex) entre os
    dois timestamps. Descontando noite, almoço e fim de semana.

    Exemplo: cliente mandou sexta 17:30, equipe respondeu segunda 09:15.
    - Sexta 17:30 → 18:00 = 30 min úteis
    - Sex 18-Sáb-Dom-Seg 8h = 0 min úteis
    - Segunda 08:00 → 09:15 = 75 min úteis
    - TOTAL = 105 min úteis
    """
    try:
        t1 = _to_brasilia(dt.datetime.fromisoformat(start_iso.replace('Z', '+00:00')))
        t2 = _to_brasilia(dt.datetime.fromisoformat(end_iso.replace('Z', '+00:00')))
    except Exception:
        return None
    if t2 <= t1:
        return 0.0
    if (t2 - t1).total_seconds() > 60 * 60 * 24 * 30:
        return None  # ignora intervalos > 30 dias (lixo)

    total_seconds = 0.0
    # Itera dia por dia
    cur_day = t1.date()
    end_day = t2.date()
    while cur_day <= end_day:
        if cur_day.weekday() < 5:  # seg-sex
            for sh, sm, eh, em in COMERCIAL_WINDOWS:
                wstart = dt.datetime.combine(cur_day, dt.time(sh, sm), tzinfo=t1.tzinfo)
                wend = dt.datetime.combine(cur_day, dt.time(eh, em), tzinfo=t1.tzinfo)
                total_seconds += _seconds_overlap_in_window(t1, t2, wstart, wend)
        cur_day += dt.timedelta(days=1)
    return total_seconds / 60.0


def compute_response_times(messages: list[dict]) -> list[float]:
    """Retorna lista de tempos de resposta (em MINUTOS ÚTEIS).

    Cada vez que o CLIENTE manda mensagem, marcamos o relógio. A primeira
    resposta da equipe Burst (cs/gestor/designer/programador/admin) define
    o delta. O tempo é calculado SÓ contando minutos dentro do horário
    comercial Burst (seg-sex 08-12 + 13:12-18).

    Se o cliente manda fora do horário comercial, conta a partir do próximo
    horário útil — `working_minutes_between` cuida disso automaticamente.
    """
    times = []
    msgs = sorted(messages, key=lambda m: m.get('ts', ''))
    last_client_msg_ts = None
    for m in msgs:
        role = m.get('inferred_role')
        ts = m.get('ts')
        if not ts:
            continue
        if role == 'cliente':
            # Cliente mandou — marca relógio (sempre, mesmo fora do comercial:
            # o working_minutes_between vai pular as horas não-úteis)
            if last_client_msg_ts is None:
                last_client_msg_ts = ts
        elif role and role != 'cliente' and role != 'unknown' and last_client_msg_ts:
            # Equipe respondeu
            mins = working_minutes_between(last_client_msg_ts, ts)
            if mins is not None and mins >= 0:
                times.append(mins)
            last_client_msg_ts = None
    return times


# ------------------------------------------------------------
# Cálculo de score (0-100)
# ------------------------------------------------------------
def compute_score(avg_resp_min: float | None, pct_under_30: float,
                  count_reclamacoes: int, count_atrasos: int) -> tuple[int, dict]:
    """Retorna (score, breakdown_dict)."""
    # 1. Tempo médio de resposta (40 pts)
    if avg_resp_min is None:
        pts_resp = 0
    elif avg_resp_min < 15:
        pts_resp = 40
    elif avg_resp_min < 30:
        pts_resp = 35
    elif avg_resp_min < 60:
        pts_resp = 25
    elif avg_resp_min < 120:
        pts_resp = 15
    elif avg_resp_min < 240:
        pts_resp = 8
    else:
        pts_resp = 0

    # 2. % respostas <30min (20 pts)
    if pct_under_30 >= 90:
        pts_pct = 20
    elif pct_under_30 >= 70:
        pts_pct = 15
    elif pct_under_30 >= 50:
        pts_pct = 10
    elif pct_under_30 >= 30:
        pts_pct = 5
    else:
        pts_pct = 0

    # 3. Sem reclamações (25 pts)
    if count_reclamacoes == 0:
        pts_recl = 25
    elif count_reclamacoes <= 2:
        pts_recl = 18
    elif count_reclamacoes <= 5:
        pts_recl = 10
    else:
        pts_recl = 0

    # 4. Sem atrasos (15 pts)
    if count_atrasos == 0:
        pts_atr = 15
    elif count_atrasos <= 2:
        pts_atr = 10
    elif count_atrasos <= 5:
        pts_atr = 5
    else:
        pts_atr = 0

    score = pts_resp + pts_pct + pts_recl + pts_atr
    breakdown = {
        'tempo_resposta_pts': pts_resp,
        'pct_under_30_pts': pts_pct,
        'sem_reclamacoes_pts': pts_recl,
        'sem_atrasos_pts': pts_atr,
        'avg_resp_min': avg_resp_min,
        'pct_under_30': pct_under_30,
        'count_reclamacoes': count_reclamacoes,
        'count_atrasos': count_atrasos,
    }
    return score, breakdown


# ------------------------------------------------------------
# Pipeline principal
# ------------------------------------------------------------
def link_group_to_monday_client(group_name: str, monday_clients_by_name: dict[str, str]) -> str | None:
    """Tenta achar monday_client_id pelo nome do grupo.
    Ex: 'Dr. Eduardo Delfim X Burst Mídia' → procura 'Eduardo Delfim' no monday.
    """
    # Remove "X Burst Mídia" e variações
    n = re.sub(r'\s*[xX]\s*burst\s*m[ií]dia\s*$', '', group_name, flags=re.IGNORECASE).strip()
    n = re.sub(r'\s*[/-]\s*burst\s*$', '', n, flags=re.IGNORECASE).strip()
    nn = normalize(n)
    if not nn:
        return None
    # Match exato
    if nn in monday_clients_by_name:
        return monday_clients_by_name[nn]
    # Substring
    for k, v in monday_clients_by_name.items():
        if nn in k or k in nn:
            words_common = set(nn.split()) & set(k.split())
            # Pelo menos 1 palavra com 5+ chars em comum
            if any(len(w) >= 5 for w in words_common):
                return v
    return None


def sync_groups_and_members() -> tuple[int, int]:
    """Sync metadados + membros de TODOS os grupos."""
    print('\n>>> Buscando chats da instância...')
    chats = fetch_chats()
    print(f'  Total: {len(chats)} chats')

    # Filtra grupos
    grupos = [c for c in chats if c.get('wa_isGroup')]
    print(f'  Grupos: {len(grupos)}')

    # Carrega monday clients por nome pra vincular
    print('  Carregando clientes Monday pra vincular...')
    # Lê monday_clients da nossa view ou usa fetch_board (mas é caro). Aqui só
    # uso o nome do grupo pra vincular — o lookup acontece no app.
    # TODO: cache de clientes do Monday no Supabase futuramente.
    monday_clients_by_name: dict[str, str] = {}
    # Hack: usa relatorio_bias.nomeDoutor pra ter algum mapping (mas sem IDs Monday).
    # Por ora, deixa monday_client_id = NULL e o app resolve.

    rows_groups = []
    for g in grupos:
        chat_jid = g.get('wa_chatid') or g.get('id')
        name = g.get('name') or g.get('wa_name') or '?'
        last_ts = ts_to_iso(g.get('wa_lastMsgTimestamp'))
        is_burst = bool(re.search(r'burst', name, re.IGNORECASE))
        rows_groups.append({
            'chat_jid': chat_jid,
            'name': name,
            'monday_client_id': link_group_to_monday_client(name, monday_clients_by_name),
            'participants_count': None,  # preenche depois
            'group_created_at': None,
            'last_message_at': last_ts,
            'uazapi_instance_token': BURST_GROUPS_TOKEN,
            'is_burst_group': is_burst,
            'updated_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
        })
    n_g = supa_upsert('whatsapp_groups', rows_groups, on_conflict='chat_jid')
    print(f'  ✓ {n_g} grupos salvos no Supabase')

    # Membros — busca pra cada grupo BURST (economiza calls em grupos não-burst)
    print('\n>>> Buscando membros de grupos Burst...')
    auth_map = load_auth_emails_map()
    print(f'  {len(auth_map)} entradas em monday_auth_emails pra cruzar')

    burst_groups = [g for g in grupos if re.search(r'burst', (g.get('name') or g.get('wa_name') or ''), re.I)]
    print(f'  {len(burst_groups)} grupos Burst pra processar...')

    rows_members = []
    rows_group_update = []
    for i, g in enumerate(burst_groups, 1):
        chat_jid = g.get('wa_chatid') or g.get('id')
        info = fetch_group_info(chat_jid)
        if not info:
            continue
        participants = info.get('Participants', []) or []
        rows_group_update.append({
            'chat_jid': chat_jid,
            'name': info.get('Name') or g.get('name'),
            'participants_count': len(participants),
            'group_created_at': info.get('GroupCreated'),
            'updated_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
        })
        for p in participants:
            phone = clean_phone(p.get('PhoneNumber')) or clean_phone(p.get('JID')) or clean_phone(p.get('LID'))
            if not phone:
                continue
            display = p.get('DisplayName') or ''
            role, inferred_name, monday_email = infer_role(display, None, auth_map, phone=phone)
            rows_members.append({
                'chat_jid': chat_jid,
                'phone': phone,
                'display_name': display or None,
                'inferred_role': role,
                'inferred_name': inferred_name,
                'monday_email': monday_email,
            })
        if i % 25 == 0:
            print(f'    {i}/{len(burst_groups)} grupos processados')
        time.sleep(RATE_LIMIT_SLEEP)

    n_m = supa_upsert('whatsapp_group_members', rows_members, on_conflict='chat_jid,phone')
    print(f'  ✓ {n_m} membros salvos')
    # Atualiza participants_count
    n_g_update = supa_upsert('whatsapp_groups', rows_group_update, on_conflict='chat_jid')
    print(f'  ✓ {n_g_update} grupos atualizados (participants_count, group_created)')
    return n_g, n_m


def sync_messages(mode: str) -> int:
    """Sync mensagens de TODOS os grupos Burst. Modo backfill/delta."""
    print('\n>>> Sync mensagens (modo={})'.format(mode))
    auth_map = load_auth_emails_map()

    # Pega grupos Burst do Supabase
    burst_groups = supa_get('whatsapp_groups',
        'select=chat_jid,name,last_message_at&is_burst_group=eq.true&order=last_message_at.desc.nullslast')
    print(f'  {len(burst_groups)} grupos Burst pra processar')

    # Pra delta: pega last_message_at de cada grupo do Supabase
    if mode == 'delta':
        # last_message_at no Supabase reflete a maior ts já salva.
        # Re-fetch desde 24h ANTES do last_message_at pra cobrir eventuais lacunas.
        pass

    # Pra membros (pra inferir role das mensagens)
    members_by_chat: dict[str, dict[str, str]] = {}  # chat_jid → {phone → role}
    members_data = supa_get('whatsapp_group_members', 'select=chat_jid,phone,inferred_role,inferred_name&limit=20000')
    for m in members_data:
        members_by_chat.setdefault(m['chat_jid'], {})[m['phone']] = m['inferred_role']

    total_msgs = 0
    total_events = 0

    for i, g in enumerate(burst_groups, 1):
        chat_jid = g['chat_jid']
        last_msg_at = g.get('last_message_at')
        # Delta: refaz desde last_msg_at - 24h (overlap pra zero perda)
        since_iso = None
        if mode == 'delta' and last_msg_at:
            try:
                since_dt = dt.datetime.fromisoformat(last_msg_at.replace('Z', '+00:00')) - dt.timedelta(hours=24)
                since_iso = since_dt.isoformat()
            except Exception:
                since_iso = None
        max_msgs = MAX_MSGS_PER_GROUP_BACKFILL if mode == 'backfill' else MAX_MSGS_PER_GROUP_DELTA
        msgs = fetch_messages(chat_jid, max_msgs, since_iso)
        if not msgs:
            continue

        # Constrói rows + events
        rows_msgs = []
        rows_events = []
        chat_members = members_by_chat.get(chat_jid, {})
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
            msg_type = m.get('messageType') or 'unknown'

            # Inferir role:
            #   1) phone book hardcoded (TEAM_PHONES) — fonte de verdade
            #   2) membros do grupo (whatsapp_group_members cacheado)
            #   3) cruzar nome com monday_auth_emails
            role = 'unknown'
            team = identify_team_member(sender_phone)
            if team:
                role = team[1]
            elif sender_phone and sender_phone in chat_members:
                role = chat_members[sender_phone]
            else:
                # Tenta inferir pelo nome (passa o phone tambem caso o sender
                # nao esteja na tabela members mas esteja no TEAM_PHONES)
                inf_role, _, _ = infer_role(sender_name, sender_name, auth_map, phone=sender_phone)
                role = inf_role
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

            # Extrai eventos
            evs = extract_events(str(msg_id), chat_jid, ts, text, sender_phone, role)
            rows_events.extend(evs)

        n_m = supa_upsert('whatsapp_messages', rows_msgs, on_conflict='message_id', batch_size=500)
        n_e = supa_upsert('whatsapp_group_events', rows_events, on_conflict='event_id', batch_size=500)
        total_msgs += n_m
        total_events += n_e
        if i % 10 == 0 or i == len(burst_groups):
            print(f'  [{i}/{len(burst_groups)}] {g["name"][:40]:40s} → {n_m} msgs, {n_e} eventos')
        time.sleep(RATE_LIMIT_SLEEP)

    print(f'\n✓ {total_msgs} mensagens, {total_events} eventos sincronizados')
    return total_msgs


def compute_scores_weekly() -> int:
    """Calcula score por grupo nos últimos 7 dias e salva snapshot."""
    print('\n>>> Calculando scores semanais...')
    now = dt.datetime.now(tz=dt.timezone.utc)
    period_end = now
    period_start = now - dt.timedelta(days=7)

    burst_groups = supa_get('whatsapp_groups', 'select=chat_jid&is_burst_group=eq.true')
    total = 0
    for g in burst_groups:
        chat_jid = g['chat_jid']
        # Mensagens nos últimos 7 dias
        params = (f'select=message_id,inferred_role,is_from_burst,ts'
                  f'&chat_jid=eq.{chat_jid}'
                  f'&ts=gte.{period_start.isoformat()}'
                  f'&order=ts.asc'
                  f'&limit=5000')
        msgs = supa_get('whatsapp_messages', params)
        if not msgs:
            continue

        msgs_from_client = sum(1 for m in msgs if m.get('inferred_role') == 'cliente')
        msgs_from_burst = sum(1 for m in msgs if m.get('is_from_burst'))
        resp_times = compute_response_times(msgs)
        avg_resp = sum(resp_times) / len(resp_times) if resp_times else None
        median_resp = sorted(resp_times)[len(resp_times) // 2] if resp_times else None
        max_resp = max(resp_times) if resp_times else None
        under_30 = sum(1 for t in resp_times if t < 30)
        over_2h = sum(1 for t in resp_times if t > 120)
        pct_under_30 = (under_30 / len(resp_times) * 100) if resp_times else 0

        # Eventos nos últimos 7 dias
        ev_params = (f'select=event_type'
                     f'&chat_jid=eq.{chat_jid}'
                     f'&ts=gte.{period_start.isoformat()}'
                     f'&limit=2000')
        evs = supa_get('whatsapp_group_events', ev_params)
        cnt = {'reclamacao': 0, 'atraso': 0, 'erro_escrita': 0, 'elogio': 0, 'demora_resposta': 0}
        for e in evs:
            t = e.get('event_type')
            if t in cnt:
                cnt[t] += 1

        score, breakdown = compute_score(avg_resp, pct_under_30, cnt['reclamacao'], cnt['atraso'])

        supa_upsert('whatsapp_group_scores', [{
            'chat_jid': chat_jid,
            'snapshot_at': now.isoformat(),
            'period_start': period_start.isoformat(),
            'period_end': period_end.isoformat(),
            'total_messages': len(msgs),
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
        total += 1

    print(f'  ✓ {total} scores calculados')
    return total


# ------------------------------------------------------------
# Main
# ------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['backfill', 'delta', 'analyze'], default='delta')
    parser.add_argument('--skip-members', action='store_true', help='Pula refresh de grupos+membros')
    args = parser.parse_args()
    mode = args.mode

    print(f'=== SYNC WhatsApp → Supabase ({mode}) ===')
    started = time.time()

    if mode in ('backfill', 'delta') and not args.skip_members:
        sync_groups_and_members()

    if mode in ('backfill', 'delta'):
        sync_messages(mode)

    # Sempre roda análise/score (rápido, lê do Supabase)
    compute_scores_weekly()

    elapsed = time.time() - started
    print(f'\n✅ Completo em {elapsed:.0f}s')


if __name__ == '__main__':
    main()

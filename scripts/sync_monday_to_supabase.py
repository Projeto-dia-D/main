"""
Sync Monday → Supabase (smart delta sync).

Espelha dados do Monday pras tabelas `monday_*` no Supabase. Roda em 3 modos:

  --mode=auto (DEFAULT)
      Lê monday_sync_meta pra descobrir o último sync.
      - Activity logs: pega desde `last_sync_at - 5 min` (overlap pra zero perda)
      - Links board_relation: refresh se `last_relations_sync_at` > 1h atrás
      - Itens criados: refresh se `last_items_sync_at` > 1h atrás
      Idempotente via PRIMARY KEY (ON CONFLICT DO NOTHING) → seguro rodar
      múltiplas vezes.

  --mode=backfill
      Força full sync de TUDO (180 dias atrás). Usa na 1ª execução.

  --mode=delta
      Só activity logs (últimos 20 min). Modo "fast" pra rodar a cada 15 min.

  --mode=slow
      Só links board_relation + itens criados. Roda 1×/dia.

Uso:
    # Primeira execução (full backfill — pode levar 5-15 min)
    python scripts/sync_monday_to_supabase.py --mode=backfill

    # Agendado a cada 15 min (Windows Task Scheduler / cron)
    python scripts/sync_monday_to_supabase.py --mode=auto

REGRA CRÍTICA: Monday é READ-ONLY. Esse script SÓ consulta — nunca escreve no Monday.
"""
import os
import sys
import json
import time
import argparse
import datetime as dt
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
MONDAY_TOKEN = ''
MONDAY_BOARD_ID = ''
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
        elif k.strip() == 'VITE_MONDAY_TOKEN':
            MONDAY_TOKEN = v
        elif k.strip() == 'VITE_MONDAY_BOARD_ID':
            MONDAY_BOARD_ID = v

for var, val in [
    ('VITE_SUPABASE_URL', SUPABASE_URL),
    ('VITE_SUPABASE_SERVICE_ROLE_SECRET', SUPABASE_KEY),
    ('VITE_MONDAY_TOKEN', MONDAY_TOKEN),
]:
    if not val:
        print(f'ERRO: {var} não encontrado no .env')
        sys.exit(1)

MONDAY_URL = 'https://api.monday.com/v2'
MONDAY_API_VERSION = '2024-01'
PAGE_LIMIT = 100

# Boards do Design (com activity logs + board_relation + items)
DESIGN_BOARDS = [
    ('3519879202', 'Central de Design'),
    ('6900515649', 'Demandas feitas (ativas)'),
    ('6791838447', 'Manutenções do Design'),
    ('6713230292', 'Atrasos do Design'),
]
# Boards EXTRAS que têm board_relation Clientes (backups, mas sem activity logs ativos)
DESIGN_BOARDS_RELATIONS_ONLY = [
    ('6900586110', 'Backup Demandas feitas'),
    ('18412400257', 'Demandas 2024-2026'),
]
BIA_SOFT_BOARD_ID = '9887531051'
BIA_FASE_COL_ID = 'color_mktr1m3s'
BIA_CLIENT_REL_COL_ID = 'board_relation_mkzc177b'
# Colunas de auth (Email CS / Gestor / Programador) no board Bia Soft
BIA_EMAIL_CS_COL_ID = 'text_mm1kad0k'
BIA_EMAIL_GESTOR_COL_ID = 'text_mm1k92bf'
BIA_EMAIL_PROG_COL_ID = 'text_mm1m7x5r'
BIA_CS_NAME_COL_ID = 'lookup_mkzp69ax'      # mirror
BIA_GESTOR_NAME_COL_ID = 'lookup_mkzphsas'  # mirror
BIA_RESP_COL_ID = 'person'                   # responsável (programador)

# Default lookback pra full backfill
BACKFILL_DAYS = 180
# Delta window — pega 20 min pra ter overlap de 5 min com o último sync de 15min
DELTA_MINUTES = 20

# ------------------------------------------------------------
# HTTP session + retries
# ------------------------------------------------------------
def build_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=6, connect=6, read=6, backoff_factor=1.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=['GET', 'POST', 'PATCH'],
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
    s.mount('https://', adapter)
    s.mount('http://', adapter)
    return s


http = build_session()

MONDAY_HEADERS = {
    'Authorization': MONDAY_TOKEN,
    'Content-Type': 'application/json',
    'API-Version': MONDAY_API_VERSION,
}

SUPA_HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
}


def gql(query: str, variables: dict | None = None) -> dict:
    """Chama Monday GraphQL. Levanta exception em erro."""
    res = http.post(
        MONDAY_URL,
        headers=MONDAY_HEADERS,
        json={'query': query, 'variables': variables or {}},
        timeout=120,
    )
    data = res.json()
    if data.get('errors') or data.get('error_message'):
        msg = data.get('error_message') or (data['errors'][0] if data.get('errors') else 'erro Monday')
        raise RuntimeError(f'Monday error: {msg}')
    return data


def normalize(s: str | None) -> str:
    if not s:
        return ''
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn').lower().strip()


def monday_ticks_to_iso(raw: Any) -> str | None:
    """Converte Monday timestamp (vários formatos) pra ISO UTC."""
    if raw is None:
        return None
    try:
        n = float(raw)
    except (ValueError, TypeError):
        return None
    if n <= 0:
        return None
    if n > 1e16:
        secs = n / 10_000_000
    elif n > 1e13:
        secs = n / 1_000_000
    elif n > 1e10:
        secs = n / 1_000
    else:
        secs = n
    try:
        return dt.datetime.fromtimestamp(secs, tz=dt.timezone.utc).isoformat()
    except (ValueError, OSError, OverflowError):
        return None


# ------------------------------------------------------------
# Supabase helpers
# ------------------------------------------------------------
def _clean_value(v: Any) -> Any:
    """Sanitiza valor antes de enviar pro Supabase:
       - String: remove null bytes (PostgreSQL rejeita); trunca em 65k chars
       - Outros: passa direto"""
    if isinstance(v, str):
        v = v.replace('\x00', '').strip() or None
        if v and len(v) > 65000:
            v = v[:65000]
    return v


def _clean_row(row: dict) -> dict:
    """Aplica clean em todos os valores do row."""
    return {k: _clean_value(v) for k, v in row.items()}


def supa_upsert(table: str, rows: list[dict], on_conflict: str = '', batch_size: int = 100) -> int:
    """Upsert em batch. Retorna total inserido/atualizado.

    Batch reduzido pra 100 (era 500) — em batches grandes, um único row com
    problema (caracter inválido, tipo incompatível, etc) faz o Supabase retornar
    500 pra TODO o batch sem dizer qual row falhou. Com batch=100 isolamos mais.

    Quando dá 500, faz fallback row-by-row pra identificar o culpado.
    """
    if not rows:
        return 0
    # Sanitiza todos os rows uma vez
    cleaned = [_clean_row(r) for r in rows]

    url = f'{SUPABASE_URL}/rest/v1/{table}'
    if on_conflict:
        url += f'?on_conflict={on_conflict}'
    headers = {
        **SUPA_HEADERS,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
    }
    total = 0
    for i in range(0, len(cleaned), batch_size):
        chunk = cleaned[i:i + batch_size]
        res = http.post(url, headers=headers, json=chunk, timeout=120)
        if res.status_code < 300:
            total += len(chunk)
            continue
        # Falhou — tenta isolar row por row
        if res.status_code in (400, 500):
            print(f'  ⚠ batch falhou ({res.status_code}). Fazendo row-by-row em {len(chunk)} rows…')
            ok = 0
            errs = 0
            for r in chunk:
                rres = http.post(url, headers=headers, json=[r], timeout=30)
                if rres.status_code < 300:
                    ok += 1
                else:
                    errs += 1
                    if errs <= 3:  # loga só os 3 primeiros pra não inundar
                        keys_preview = {k: (str(v)[:80] if v else None) for k, v in r.items()}
                        print(f'  ❌ row falhou ({rres.status_code}): {rres.text[:300]}')
                        print(f'     row: {keys_preview}')
            print(f'  → recovery: {ok} ok, {errs} erros')
            total += ok
        else:
            print(f'  ❌ erro upsert {table} ({res.status_code}): {res.text[:400]}')
            sys.exit(1)
    return total


def supa_get_sync_meta(key: str) -> dict | None:
    """Lê monday_sync_meta[key]. None se não existe."""
    url = f'{SUPABASE_URL}/rest/v1/monday_sync_meta?key=eq.{key}&select=value'
    res = http.get(url, headers={'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}, timeout=30)
    if res.status_code != 200:
        return None
    data = res.json()
    if isinstance(data, list) and len(data) > 0:
        return data[0].get('value')
    return None


def supa_set_sync_meta(key: str, value: dict) -> None:
    """Upsert em monday_sync_meta."""
    url = f'{SUPABASE_URL}/rest/v1/monday_sync_meta?on_conflict=key'
    payload = [{
        'key': key,
        'value': value,
        'updated_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
    }]
    headers = {**SUPA_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal'}
    res = http.post(url, headers=headers, json=payload, timeout=30)
    if res.status_code >= 300:
        print(f'  ❌ erro sync_meta {key} ({res.status_code}): {res.text[:300]}')


# ------------------------------------------------------------
# Monday: descoberta de colunas
# ------------------------------------------------------------
def fetch_board_meta(board_id: str) -> dict:
    """Retorna {columns: [{id, title, type}], groups: [...]}."""
    res = gql(
        'query ($boardId: ID!) { boards(ids: [$boardId]) { id columns { id title type } } }',
        {'boardId': board_id},
    )
    b = res.get('data', {}).get('boards', [None])[0]
    if not b:
        return {'columns': []}
    return b


def find_column_id(columns: list[dict], titles: list[str], type_filter: str | None = None) -> str | None:
    norm_titles = [normalize(t) for t in titles]
    for c in columns:
        if type_filter and c.get('type') != type_filter:
            continue
        n = normalize(c.get('title'))
        if n in norm_titles:
            return c['id']
    # Fallback substring
    for c in columns:
        if type_filter and c.get('type') != type_filter:
            continue
        n = normalize(c.get('title'))
        if any(t in n for t in norm_titles):
            return c['id']
    return None


# ------------------------------------------------------------
# Sync: activity_logs de um board
# ------------------------------------------------------------
def fetch_board_activity(board_id: str, col_ids: list[str], since_iso: str) -> list[dict]:
    """Pega activity_logs de um board nas colunas dadas, desde a data."""
    if not col_ids:
        return []
    out = []
    page = 1
    while page < 100:
        try:
            res = gql(
                '''query ($boardId: ID!, $limit: Int!, $page: Int!, $colIds: [String!], $from: ISO8601DateTime!) {
                    boards(ids: [$boardId]) {
                        activity_logs(limit: $limit, page: $page, column_ids: $colIds, from: $from) {
                            id event data created_at user_id
                        }
                    }
                }''',
                {'boardId': board_id, 'limit': 500, 'page': page, 'colIds': col_ids, 'from': since_iso},
            )
            logs = res.get('data', {}).get('boards', [{}])[0].get('activity_logs', []) or []
        except Exception as e:
            print(f'  ⚠ board {board_id} page {page}: {e}')
            break
        if not logs:
            break
        out.extend(logs)
        if len(logs) < 500:
            break
        page += 1
        time.sleep(0.3)
    return out


def parse_activity_log(raw: dict, board_id: str) -> dict | None:
    """Converte o JSON do activity_log do Monday em row pra monday_design_activity."""
    try:
        d = json.loads(raw['data']) if isinstance(raw['data'], str) else raw['data']
    except Exception:
        return None
    pulse_id = d.get('pulse_id') or d.get('item_id')
    if pulse_id is None:
        return None
    ts = monday_ticks_to_iso(raw.get('created_at'))
    if not ts:
        return None
    prev = (d.get('previous_value') or {}).get('label', {}).get('text') if isinstance(d.get('previous_value'), dict) else None
    nxt = (d.get('value') or {}).get('label', {}).get('text') if isinstance(d.get('value'), dict) else None
    return {
        'log_id': str(raw['id']),
        'board_id': str(board_id),
        'pulse_id': str(pulse_id),
        'pulse_name': d.get('pulse_name') or None,
        'column_id': d.get('column_id') or '',
        'prev_label': prev,
        'next_label': nxt,
        'ts': ts,
        'user_id': str(raw['user_id']) if raw.get('user_id') is not None else None,
    }


# ------------------------------------------------------------
# Sync: board_relation links
# ------------------------------------------------------------
def fetch_board_relation_links(board_id: str, rel_col_id: str) -> dict[str, list[str]]:
    """Retorna {pulse_id: [linked_item_ids]} pra TODOS os items do board."""
    out: dict[str, list[str]] = {}
    first = gql(
        '''query ($boardId: ID!, $limit: Int!, $colIds: [String!]) {
            boards(ids: [$boardId]) {
                items_page(limit: $limit) {
                    cursor items {
                        id
                        column_values(ids: $colIds) {
                            id
                            ... on BoardRelationValue { linked_item_ids }
                        }
                    }
                }
            }
        }''',
        {'boardId': board_id, 'limit': PAGE_LIMIT, 'colIds': [rel_col_id]},
    )
    page = first.get('data', {}).get('boards', [{}])[0].get('items_page')
    if not page:
        return out
    items = page.get('items', [])
    cursor = page.get('cursor')
    while True:
        for it in items:
            cv = (it.get('column_values') or [{}])[0]
            linked = cv.get('linked_item_ids') or []
            if linked:
                out[str(it['id'])] = [str(x) for x in linked]
        if not cursor:
            break
        nxt = gql(
            '''query ($cursor: String!, $limit: Int!) {
                next_items_page(cursor: $cursor, limit: $limit) {
                    cursor items {
                        id
                        column_values {
                            id
                            ... on BoardRelationValue { linked_item_ids }
                        }
                    }
                }
            }''',
            {'cursor': cursor, 'limit': PAGE_LIMIT},
        )
        np = nxt.get('data', {}).get('next_items_page')
        if not np:
            break
        items = [
            {**i, 'column_values': [cv for cv in (i.get('column_values') or []) if cv.get('id') == rel_col_id]}
            for i in np.get('items', [])
        ]
        cursor = np.get('cursor')
    return out


# ------------------------------------------------------------
# Sync: items created_at
# ------------------------------------------------------------
def fetch_board_items_created(board_id: str, since: dt.datetime | None = None) -> dict[str, str]:
    """Retorna {pulse_id: ISO created_at}."""
    out: dict[str, str] = {}
    first = gql(
        '''query ($boardId: ID!, $limit: Int!) {
            boards(ids: [$boardId]) {
                items_page(limit: $limit) {
                    cursor items { id created_at }
                }
            }
        }''',
        {'boardId': board_id, 'limit': PAGE_LIMIT},
    )
    page = first.get('data', {}).get('boards', [{}])[0].get('items_page')
    if not page:
        return out
    items = page.get('items', [])
    cursor = page.get('cursor')
    while True:
        for it in items:
            cat = it.get('created_at')
            if not cat:
                continue
            try:
                d = dt.datetime.fromisoformat(cat.replace('Z', '+00:00'))
            except Exception:
                continue
            if since and d < since:
                continue
            out[str(it['id'])] = d.isoformat()
        if not cursor:
            break
        nxt = gql(
            '''query ($cursor: String!, $limit: Int!) {
                next_items_page(cursor: $cursor, limit: $limit) {
                    cursor items { id created_at }
                }
            }''',
            {'cursor': cursor, 'limit': PAGE_LIMIT},
        )
        np = nxt.get('data', {}).get('next_items_page')
        if not np:
            break
        items = np.get('items', [])
        cursor = np.get('cursor')
    return out


# ------------------------------------------------------------
# Bridge entre boards de clientes (Comercial Clientes ↔ Principal)
# ------------------------------------------------------------
def fetch_board_items_names(board_id: str) -> dict[str, str]:
    """Retorna {item_id: name_normalizado} de TODOS os items do board."""
    out: dict[str, str] = {}
    first = gql(
        '''query ($boardId: ID!, $limit: Int!) {
            boards(ids: [$boardId]) {
                items_page(limit: $limit) { cursor items { id name } }
            }
        }''',
        {'boardId': board_id, 'limit': PAGE_LIMIT},
    )
    page = first.get('data', {}).get('boards', [{}])[0].get('items_page')
    if not page:
        return out
    items = page.get('items', [])
    cursor = page.get('cursor')
    while True:
        for it in items:
            n = normalize(it.get('name'))
            if n:
                out[str(it['id'])] = n
        if not cursor:
            break
        nxt = gql(
            '''query ($cursor: String!, $limit: Int!) {
                next_items_page(cursor: $cursor, limit: $limit) {
                    cursor items { id name }
                }
            }''',
            {'cursor': cursor, 'limit': PAGE_LIMIT},
        )
        np = nxt.get('data', {}).get('next_items_page')
        if not np:
            break
        items = np.get('items', [])
        cursor = np.get('cursor')
    return out


def build_clientes_bridge(comercial_board_id: str) -> dict[str, list[str]]:
    """Constrói mapa {comercial_id → [principal_id, ...]} fazendo match por nome.

    O board "💎 Comercial Clientes" guarda os IDs do COMERCIAL, mas o app usa IDs
    do board PRINCIPAL de clientes. Esse mapa converte um pro outro.

    Match por nome NORMALIZADO (case+accent-insensitive) exato. Se 2 itens no
    principal têm mesmo nome, todos viram targets (raro).
    """
    print(f'  bridge: lendo items do comercial ({comercial_board_id})...')
    comercial = fetch_board_items_names(comercial_board_id)
    print(f'  bridge: lendo items do principal ({MONDAY_BOARD_ID})...')
    principal = fetch_board_items_names(MONDAY_BOARD_ID)

    # Indexa principal por nome
    by_name: dict[str, list[str]] = {}
    for pid, pname in principal.items():
        by_name.setdefault(pname, []).append(pid)

    bridge: dict[str, list[str]] = {}
    for cid, cname in comercial.items():
        if cname in by_name:
            bridge[cid] = by_name[cname]
    print(f'  bridge: {len(bridge)} de {len(comercial)} items do Comercial bateram com Principal')
    return bridge


# ------------------------------------------------------------
# Sync: encontra board de Otimização
# ------------------------------------------------------------
def find_otimizacao_board() -> tuple[str, str] | None:
    """Lista todos os boards do workspace e acha um cujo nome bate 'Otimização Clientes'.

    EXCLUI explicitamente boards de SUBELEMENTOS e DUPLICATAS — esses são
    boards-filhos que o Monday cria automaticamente e não têm os dados reais.
    """
    termos = [normalize(t) for t in [
        'otimizacao clientes', 'otimizacoes clientes',
        'otimizacao de clientes', 'otimizacao de cliente',
    ]]
    # Excluir esses prefixos no nome — são boards auxiliares
    excluir = ['subelementos', 'subitens', 'duplicata', 'copia', 'arquivado']
    out = []
    page = 1
    while page < 50:
        try:
            res = gql(
                'query ($limit: Int!, $page: Int!) { boards(limit: $limit, page: $page, state: active) { id name } }',
                {'limit': 100, 'page': page},
            )
            boards = res.get('data', {}).get('boards', []) or []
        except Exception as e:
            print(f'  ⚠ findOtimizacao page {page}: {e}')
            break
        if not boards:
            break
        out.extend(boards)
        if len(boards) < 100:
            break
        page += 1

    def is_excluido(name: str) -> bool:
        n = normalize(name)
        return any(e in n for e in excluir)

    # Match exato (excluindo subelementos/duplicatas)
    for b in out:
        if is_excluido(b['name']):
            continue
        if normalize(b['name']) in termos:
            return (str(b['id']), b['name'])
    # Substring (excluindo subelementos/duplicatas)
    for b in out:
        if is_excluido(b['name']):
            continue
        n = normalize(b['name'])
        if any(t in n for t in termos):
            return (str(b['id']), b['name'])
    print('  ⚠ Board "Otimização Clientes" não encontrado (excluindo subelementos/duplicatas).')
    print('  Boards do workspace com "otimiz" no nome:')
    for b in out:
        if 'otimiz' in normalize(b['name']):
            print(f'    {b["id"]:15s} {b["name"]}')
    return None


# ------------------------------------------------------------
# Modos de execução
# ------------------------------------------------------------
def get_since(default_days: int, mode: str, key: str) -> dt.datetime:
    """Determina o cutoff de busca baseado em mode + meta salva."""
    if mode == 'backfill':
        return dt.datetime.now(tz=dt.timezone.utc) - dt.timedelta(days=default_days)
    if mode == 'delta':
        return dt.datetime.now(tz=dt.timezone.utc) - dt.timedelta(minutes=DELTA_MINUTES)
    # auto: usa último sync da meta, com overlap de 5 min
    meta = supa_get_sync_meta(key) or {}
    last = meta.get('last_sync_at')
    if last:
        try:
            last_dt = dt.datetime.fromisoformat(last.replace('Z', '+00:00'))
            # Overlap pra zero perda
            return last_dt - dt.timedelta(minutes=5)
        except Exception:
            pass
    # Sem meta — assume backfill
    return dt.datetime.now(tz=dt.timezone.utc) - dt.timedelta(days=default_days)


def sync_design_activity(mode: str) -> dict:
    """Sync activity_logs dos boards de Design."""
    print('\n>>> SYNC: monday_design_activity')
    since = get_since(BACKFILL_DAYS, mode, 'design_activity')
    since_iso = since.isoformat()
    print(f'  desde: {since_iso}')

    total_rows = 0
    for board_id, label in DESIGN_BOARDS:
        # Descobre colunas relevantes (status_*)
        meta = fetch_board_meta(board_id)
        cols = meta.get('columns', []) or []
        # Pega TODAS as colunas tipo color/status — captura tudo de uma vez
        status_col_ids = [c['id'] for c in cols if c.get('type') in ('color', 'status')]
        if not status_col_ids:
            print(f'  [{label}] sem colunas de status')
            continue
        logs = fetch_board_activity(board_id, status_col_ids, since_iso)
        rows = []
        for raw in logs:
            parsed = parse_activity_log(raw, board_id)
            if parsed:
                rows.append(parsed)
        n = supa_upsert('monday_design_activity', rows, on_conflict='log_id')
        print(f'  [{label}] {len(logs)} logs → {n} rows')
        total_rows += n
        time.sleep(0.3)
    print(f'  TOTAL: {total_rows} rows')
    supa_set_sync_meta('design_activity', {
        'last_sync_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
        'rows_synced': total_rows,
    })
    return {'rows': total_rows}


def sync_design_demanda_links() -> dict:
    """Sync board_relation Clientes de TODOS os boards de Design (slow)."""
    print('\n>>> SYNC: monday_design_demanda_links (slow, full refresh)')
    all_boards = DESIGN_BOARDS + DESIGN_BOARDS_RELATIONS_ONLY
    total_rows = 0
    for board_id, label in all_boards:
        meta = fetch_board_meta(board_id)
        cols = meta.get('columns', []) or []
        # Acha coluna board_relation "Clientes"
        rel = None
        for c in cols:
            if c.get('type') == 'board_relation' and 'cliente' in normalize(c.get('title')):
                rel = c['id']
                break
        if not rel:
            print(f'  [{label}] sem board_relation Clientes')
            continue
        links = fetch_board_relation_links(board_id, rel)
        rows = [
            {
                'pulse_id': pid,
                'board_id': str(board_id),
                'monday_client_ids': cids,
            }
            for pid, cids in links.items()
        ]
        n = supa_upsert('monday_design_demanda_links', rows, on_conflict='pulse_id')
        print(f'  [{label}] {len(links)} items → {n} rows')
        total_rows += n
        time.sleep(0.3)
    print(f'  TOTAL: {total_rows} rows')
    supa_set_sync_meta('design_demanda_links', {
        'last_sync_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
        'rows_synced': total_rows,
    })
    return {'rows': total_rows}


def sync_design_items_created(mode: str) -> dict:
    """Sync created_at de itens dos boards de Design."""
    print('\n>>> SYNC: monday_design_items')
    since = get_since(BACKFILL_DAYS, mode, 'design_items')
    print(f'  desde: {since.isoformat()}')
    total_rows = 0
    for board_id, label in DESIGN_BOARDS:
        items = fetch_board_items_created(board_id, since)
        rows = [
            {'pulse_id': pid, 'board_id': str(board_id), 'created_at': ts}
            for pid, ts in items.items()
        ]
        n = supa_upsert('monday_design_items', rows, on_conflict='pulse_id')
        print(f'  [{label}] {len(items)} items → {n} rows')
        total_rows += n
        time.sleep(0.3)
    print(f'  TOTAL: {total_rows} rows')
    supa_set_sync_meta('design_items', {
        'last_sync_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
        'rows_synced': total_rows,
    })
    return {'rows': total_rows}


def sync_otimizacao(mode: str) -> dict:
    """Sync events + links do board Otimização Clientes."""
    print('\n>>> SYNC: monday_otimizacao_events + monday_otimizacao_links')
    # Descobre boardId (cache em meta)
    meta = supa_get_sync_meta('otimizacao_board') or {}
    board_id = meta.get('board_id')
    board_name = meta.get('board_name')
    if not board_id:
        found = find_otimizacao_board()
        if not found:
            print('  ❌ Board Otimização não encontrado — pulando')
            return {'rows': 0}
        board_id, board_name = found
        supa_set_sync_meta('otimizacao_board', {'board_id': board_id, 'board_name': board_name})

    print(f'  board: {board_name} ({board_id})')

    # 1. Events (activity logs de colunas status + created_at)
    since = get_since(BACKFILL_DAYS, mode, 'otimizacao_events')
    since_iso = since.isoformat()
    bmeta = fetch_board_meta(board_id)
    cols = bmeta.get('columns', []) or []
    status_col_ids = [c['id'] for c in cols if c.get('type') in ('color', 'status')]
    logs = fetch_board_activity(board_id, status_col_ids, since_iso) if status_col_ids else []
    items_created = fetch_board_items_created(board_id, since)

    event_rows = []
    for raw in logs:
        parsed = parse_activity_log(raw, board_id)
        if not parsed:
            continue
        nxt = parsed.get('next_label')
        if not nxt or not str(nxt).strip():
            continue
        event_rows.append({
            'event_id': parsed['log_id'],
            'board_id': board_id,
            'pulse_id': parsed['pulse_id'],
            'pulse_name': parsed.get('pulse_name'),
            'kind': 'status',
            'detail': nxt,
            'ts': parsed['ts'],
        })
    for pid, ts in items_created.items():
        event_rows.append({
            'event_id': f'created_{pid}',
            'board_id': board_id,
            'pulse_id': pid,
            'pulse_name': None,
            'kind': 'criacao',
            'detail': None,
            'ts': ts,
        })
    n_ev = supa_upsert('monday_otimizacao_events', event_rows, on_conflict='event_id')
    print(f'  events: {len(logs)} logs + {len(items_created)} created → {n_ev} rows')

    # 2. Links board_relation Clientes (slow refresh).
    # ATENÇÃO: a coluna board_relation aponta pro board "💎 Comercial Clientes"
    # (board separado), NÃO pro principal. Precisamos converter os IDs com um
    # bridge de nomes Comercial → Principal pra que o frontend ache o cliente certo.
    rel_col = None
    rel_col_links_to_board: str | None = None
    for c in cols:
        if c.get('type') == 'board_relation' and 'cliente' in normalize(c.get('title')):
            rel_col = c['id']
            break
    n_li = 0
    if rel_col:
        links = fetch_board_relation_links(board_id, rel_col)
        # Descobre pra qual board os linked_item_ids apontam (pega 1 item de amostra)
        if links:
            sample_pid = next(iter(links))
            sample_linked = links[sample_pid][:1]
            if sample_linked:
                try:
                    sres = gql(
                        '''query ($ids: [ID!]) { items(ids: $ids) { board { id } } }''',
                        {'ids': sample_linked},
                    )
                    sample_board = sres.get('data', {}).get('items', [{}])[0].get('board', {}).get('id')
                    if sample_board:
                        rel_col_links_to_board = str(sample_board)
                        print(f'  links apontam pro board: {sample_board}')
                except Exception as e:
                    print(f'  ⚠ falha checando board destino: {e}')

        # Se o board destino NÃO é o principal, aplica bridge por nome
        if rel_col_links_to_board and rel_col_links_to_board != str(MONDAY_BOARD_ID):
            print(f'  ⚠ board {rel_col_links_to_board} != principal ({MONDAY_BOARD_ID}) → aplicando bridge')
            bridge = build_clientes_bridge(rel_col_links_to_board)
            converted: dict[str, list[str]] = {}
            for pid, comercial_ids in links.items():
                principal_ids: list[str] = []
                for cid in comercial_ids:
                    principal_ids.extend(bridge.get(cid, []))
                seen = set()
                deduped = [x for x in principal_ids if not (x in seen or seen.add(x))]
                if deduped:
                    converted[pid] = deduped
            print(f'  bridge aplicado: {len(converted)} items com link convertido (de {len(links)})')
            links = converted

        # 2.b FALLBACK por NOME do item de Otimização → cliente Principal.
        # Muitos itens no board Otimização foram criados sem preencher a coluna
        # board_relation (ex: Dr. Breno). Como o NOME do item geralmente é o
        # nome do cliente, fazemos match por nome.
        print('  fallback por nome: lendo todos itens do board Otimização...')
        otim_items_by_name = fetch_board_items_names(board_id)
        print(f'  fallback: {len(otim_items_by_name)} itens no Otimização')
        print('  fallback: lendo todos itens do Principal...')
        principal_items = fetch_board_items_names(MONDAY_BOARD_ID)
        principal_by_name: dict[str, list[str]] = {}
        for pid, pname in principal_items.items():
            principal_by_name.setdefault(pname, []).append(pid)

        added_fallback = 0
        for otim_pid, otim_name in otim_items_by_name.items():
            # Se já temos link via board_relation, mantém
            if otim_pid in links and links[otim_pid]:
                continue
            # Senão, tenta match exato por nome no Principal
            matches = principal_by_name.get(otim_name)
            if matches:
                links[otim_pid] = matches
                added_fallback += 1
        print(f'  fallback por nome adicionou: {added_fallback} links')

        link_rows = [
            {'pulse_id': pid, 'board_id': board_id, 'monday_client_ids': cids}
            for pid, cids in links.items()
            if cids  # só salva se tem pelo menos 1 cliente
        ]
        n_li = supa_upsert('monday_otimizacao_links', link_rows, on_conflict='pulse_id')
        print(f'  links: {len(link_rows)} items → {n_li} rows')

    supa_set_sync_meta('otimizacao_events', {
        'last_sync_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
        'rows_synced': n_ev + n_li,
    })
    return {'rows': n_ev + n_li}


def fetch_items_updates(item_ids: list[str]) -> list[dict]:
    """Busca updates (comentários) de até 25 items por chamada GraphQL.

    Cada update inclui id, text_body (texto limpo), created_at, creator.name.
    """
    if not item_ids:
        return []
    out = []
    BATCH = 25
    for i in range(0, len(item_ids), BATCH):
        chunk = item_ids[i:i + BATCH]
        try:
            res = gql(
                '''query ($ids: [ID!]) {
                    items(ids: $ids) {
                        id
                        updates {
                            id
                            text_body
                            created_at
                            creator { name }
                        }
                    }
                }''',
                {'ids': chunk},
            )
            items = res.get('data', {}).get('items', []) or []
            for it in items:
                pulse_id = str(it['id'])
                for u in (it.get('updates') or []):
                    text = (u.get('text_body') or '').strip()
                    if not text:
                        continue  # ignora updates vazios
                    ts = u.get('created_at')
                    if not ts:
                        continue
                    out.append({
                        'update_id': str(u['id']),
                        'pulse_id': pulse_id,
                        'text_body': text,
                        'creator_name': (u.get('creator') or {}).get('name'),
                        'created_at': ts,
                    })
        except Exception as e:
            print(f'  ⚠ batch updates falhou ({i}..{i+BATCH}): {e}')
            continue
        time.sleep(0.2)
    return out


def sync_item_updates_for_board(board_id: str, label: str) -> int:
    """Busca updates de TODOS os items de um board específico."""
    print(f'  [{label}] lendo items...')
    item_ids = list(fetch_board_items_names(board_id).keys())
    print(f'  [{label}] {len(item_ids)} items → buscando updates em batch')
    updates = fetch_items_updates(item_ids)
    # Adiciona board_id em cada row
    for u in updates:
        u['board_id'] = str(board_id)
    n = supa_upsert('monday_item_updates', updates, on_conflict='update_id')
    print(f'  [{label}] {len(updates)} updates → {n} rows')
    return n


def sync_item_updates() -> dict:
    """Sync de updates (comentários) dos boards Otimização + Design.

    Esses comentários aparecem inline nos eventos da timeline da Saúde do
    Cliente — tanto pra otimizações quanto pra demandas de design.
    """
    print('\n>>> SYNC: monday_item_updates')
    total = 0

    # 1. Board Otimização Clientes (descoberto via meta)
    meta = supa_get_sync_meta('otimizacao_board') or {}
    otim_board_id = meta.get('board_id')
    if otim_board_id:
        total += sync_item_updates_for_board(str(otim_board_id), 'Otimização Clientes')

    # 2. Boards Design ativos (Central + Demandas)
    for bid, label in [
        ('3519879202', 'Central de Design'),
        ('6900515649', 'Demandas feitas (ativas)'),
    ]:
        total += sync_item_updates_for_board(bid, label)
        time.sleep(0.3)

    supa_set_sync_meta('item_updates', {
        'last_sync_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
        'rows_synced': total,
    })
    print(f'  TOTAL: {total} updates')
    return {'rows': total}


def sync_auth_emails() -> dict:
    """Sync de emails+roles do time — lista hardcoded.

    A app tem time pequeno (~20 pessoas) e role estavel. Em vez de tentar
    detectar role automaticamente (que falha — Bia Soft tem typos, title
    Monday e incompleto), mantemos uma LISTA UNICA hardcoded aqui.

    Funcionamento:
      1. Lista TEAM_ROLES define email → role pra cada membro.
      2. Sync valida via Monday /users que o email ainda existe e pega o
         nome real (no caso do nome no Monday ter mudado).
      3. Upsert em monday_auth_emails com (email, name, role).

    Quando alguem entra/sai: edita TEAM_ROLES + commit + sync.

    Roles:
      - admin       : acesso total (Renan, Vanessa, Rone, Joao Velho)
      - gestor      : ve so seus clientes
      - cs          : ve so seus clientes
      - designer    : ve so seus eventos de design
      - programador : ve todos os setores (sem Saude/Notificacoes)
    """
    print('\n>>> SYNC: monday_auth_emails (lista hardcoded + validacao Monday)')

    # =========================================================================
    # LISTA OFICIAL DO TIME
    # =========================================================================
    # Quando alguem entra/sai: edita aqui, faz commit, roda o sync.
    TEAM_ROLES: dict[str, str] = {
        # --- ADMIN (acesso total) ---
        'renan@burstmidia.com':           'admin',
        'vanessarocha@burstmidia.com':    'admin',
        'ronematheus@burstmidia.com':     'admin',
        'joaovitor@burstmidia.com':       'admin',
        'joaovitorvelho@burstmidia.com':  'admin',

        # --- CS ---
        'annecamargo@burstmidia.com':     'cs',
        'julia@burstmidia.com':           'cs',
        'lauracordova@burstmidia.com':    'cs',
        'lilian@burstmidia.com':          'cs',
        'paulasouza@burstmidia.com':      'cs',
        'yasminxavier@burstmidia.com':    'cs',

        # --- Gestor de Trafego ---
        'erickdemoraes@burstmidia.com':   'gestor',
        'gabrielanacleto@burstmidia.com': 'gestor',
        'hellendeoliveira@burstmidia.com':'gestor',
        'marialucia@burstmidia.com':      'gestor',
        'ricardo@burstmidia.com':         'gestor',
        'thuisa@burstmidia.com':          'gestor',

        # --- Designer ---
        'felipe@burstmidia.com':          'designer',
        'laisbeisheim@burstmidia.com':    'designer',
        'paulohenrique@burstmidia.com':   'designer',
        'camiledeoliveira@burstmidia.com':'designer',

        # --- Programador ---
        'eduardohenckemaier@burstmidia.com': 'programador',
        'gabrielvelho@burstmidia.com':       'programador',
    }

    # ---- 1. Busca Monday /users pra validar emails + pegar nome real ----
    print('  buscando Monday /users (validacao)...')
    users_resp = gql('{ users(limit: 500) { id name email enabled } }', {})
    monday_users = users_resp.get('data', {}).get('users', []) or []
    by_email = {(u.get('email') or '').lower(): u for u in monday_users if u.get('email')}
    print(f'  {len(monday_users)} usuarios Monday')

    # ---- 2. Monta a lista final: TEAM_ROLES validado contra Monday ----
    # Importante: role 'admin' NAO entra na monday_auth_emails — admins sao
    # detectados via ADMIN_EMAILS hardcoded em src/lib/auth.ts (que checa
    # primeiro no fluxo de login). A constraint da tabela tambem nao aceita
    # 'admin' como valor de role. Os admins ficam aqui no TEAM_ROLES so pra
    # documentacao da lista oficial do time.
    rows: list[dict] = []
    nao_encontrados: list[str] = []
    desabilitados: list[str] = []
    admins_skip: list[str] = []
    for email, role in TEAM_ROLES.items():
        email_lc = email.lower()
        if role == 'admin':
            admins_skip.append(email_lc)
            continue
        mu = by_email.get(email_lc)
        if not mu:
            nao_encontrados.append(email)
            continue
        if not mu.get('enabled'):
            desabilitados.append(email)
            continue
        rows.append({
            'email': email_lc,
            'name': mu.get('name') or email_lc,
            'role': role,
        })

    if admins_skip:
        print(f'  admins (pulados — usam ADMIN_EMAILS no auth.ts): {len(admins_skip)} → {admins_skip}')

    print(f'  validados:        {len(rows)}')
    if nao_encontrados:
        print(f'  nao encontrados:  {len(nao_encontrados)} → {nao_encontrados}')
    if desabilitados:
        print(f'  desabilitados:    {len(desabilitados)} → {desabilitados}')

    # ---- 3. Apaga registros antigos (limpa Bia Soft typos antigos) ----
    url_del = f'{SUPABASE_URL}/rest/v1/monday_auth_emails?email=neq.__nothing__'
    try:
        r = http.delete(url_del, headers={**SUPA_HEADERS, 'Prefer': 'return=minimal'}, timeout=30)
        print(f'  delete antigos: status {r.status_code}')
    except Exception as e:
        print(f'  delete antigos falhou: {e}')

    # ---- 4. Insere os novos ----
    n = supa_upsert('monday_auth_emails', rows, on_conflict='email')
    print(f'  {n} emails inseridos')
    supa_set_sync_meta('auth_emails', {
        'last_sync_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
        'rows_synced': n,
    })
    return {'rows': n}


def sync_bia_fase_timeline(mode: str) -> dict:
    """Sync activity_logs da coluna Fase do board Bia Soft."""
    print('\n>>> SYNC: monday_bia_fase_timeline')
    since = get_since(BACKFILL_DAYS, mode, 'bia_fase_timeline')
    since_iso = since.isoformat()
    print(f'  desde: {since_iso}')
    logs = fetch_board_activity(BIA_SOFT_BOARD_ID, [BIA_FASE_COL_ID], since_iso)

    # Pra cada log, preciso achar os monday_client_ids vinculados ao bia_item_id.
    # Faço isso UMA VEZ por sync, buscando todos os items + board_relation.
    print('  buscando board_relation Bia → Clientes...')
    bia_links = fetch_board_relation_links(BIA_SOFT_BOARD_ID, BIA_CLIENT_REL_COL_ID)

    rows = []
    for raw in logs:
        parsed = parse_activity_log(raw, BIA_SOFT_BOARD_ID)
        if not parsed:
            continue
        bia_item_id = parsed['pulse_id']
        rows.append({
            'log_id': parsed['log_id'],
            'bia_item_id': bia_item_id,
            'monday_client_ids': bia_links.get(bia_item_id, []),
            'prev_label': parsed.get('prev_label'),
            'next_label': parsed.get('next_label'),
            'ts': parsed['ts'],
        })
    n = supa_upsert('monday_bia_fase_timeline', rows, on_conflict='log_id')
    print(f'  {len(logs)} logs → {n} rows')
    supa_set_sync_meta('bia_fase_timeline', {
        'last_sync_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
        'rows_synced': n,
    })
    return {'rows': n}


# ------------------------------------------------------------
# Main
# ------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['auto', 'backfill', 'delta', 'slow'], default='auto')
    args = parser.parse_args()
    mode = args.mode

    print(f'=== SYNC Monday → Supabase ({mode}) ===')
    print(f'Supabase: {SUPABASE_URL}')
    started = time.time()
    total_rows = 0

    # Modos:
    #  - backfill: TUDO
    #  - delta: SÓ activity logs (rápido, a cada 15 min)
    #  - slow: SÓ refreshes lentos (board_relations + items_created)
    #  - auto: decide via meta — activity sempre, slow se > 1h atrás
    if mode in ('backfill', 'auto', 'delta'):
        total_rows += sync_design_activity(mode if mode != 'auto' else 'auto').get('rows', 0)
        total_rows += sync_bia_fase_timeline(mode if mode != 'auto' else 'auto').get('rows', 0)
        total_rows += sync_otimizacao(mode if mode != 'auto' else 'auto').get('rows', 0)

    if mode in ('backfill', 'slow', 'auto'):
        # Em auto: só roda links/items se passou >= 1h desde último
        should_run_slow = True
        if mode == 'auto':
            meta = supa_get_sync_meta('design_demanda_links') or {}
            last = meta.get('last_sync_at')
            if last:
                try:
                    last_dt = dt.datetime.fromisoformat(last.replace('Z', '+00:00'))
                    age = (dt.datetime.now(tz=dt.timezone.utc) - last_dt).total_seconds() / 60
                    if age < 60:
                        should_run_slow = False
                        print(f'\n>>> slow sync SKIP (último foi há {age:.0f} min, < 60min)')
                except Exception:
                    pass
        if should_run_slow:
            total_rows += sync_design_demanda_links().get('rows', 0)
            total_rows += sync_design_items_created(mode if mode != 'auto' else 'backfill').get('rows', 0)
            # Auth emails — usado pelo login do app. Refresh slow (1×/hora) basta.
            total_rows += sync_auth_emails().get('rows', 0)

            # Updates (comentários) dos items — caro (16k items × 3k complexity).
            # Roda só 1×/DIA pra economizar Monday API. Comentários mudam pouco
            # então 24h de defasagem é aceitável. Force via --mode=backfill.
            should_run_updates = mode == 'backfill'
            if mode == 'auto':
                meta_u = supa_get_sync_meta('item_updates') or {}
                last_u = meta_u.get('last_sync_at')
                if not last_u:
                    should_run_updates = True
                else:
                    try:
                        last_u_dt = dt.datetime.fromisoformat(last_u.replace('Z', '+00:00'))
                        age_h = (dt.datetime.now(tz=dt.timezone.utc) - last_u_dt).total_seconds() / 3600
                        if age_h >= 24:
                            should_run_updates = True
                        else:
                            print(f'\n>>> updates sync SKIP (último foi há {age_h:.1f}h, < 24h)')
                    except Exception:
                        should_run_updates = True
            if should_run_updates:
                total_rows += sync_item_updates().get('rows', 0)

    elapsed = time.time() - started
    print(f'\n✅ Sync completo em {elapsed:.1f}s — {total_rows} rows totais')

    # Atualiza meta global do último sync (pra mostrar no app)
    supa_set_sync_meta('global', {
        'last_sync_at': dt.datetime.now(tz=dt.timezone.utc).isoformat(),
        'mode': mode,
        'rows_total': total_rows,
        'elapsed_seconds': round(elapsed, 1),
    })


if __name__ == '__main__':
    main()

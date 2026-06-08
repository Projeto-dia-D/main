"""Testa TODOS os tokens do .env (Supabase, UAZAPI, Meta x3, Monday).

Pra cada um:
  - faz uma chamada minimalista que valida o token
  - imprime status (OK / FALHA + razao)

Uso:
    python scripts/_test_all_tokens.py
"""
import sys
import os
import requests

sys.stdout.reconfigure(encoding='utf-8')

# 1. Le .env
ENV = {}
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
with open(env_path, encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            ENV[k.strip()] = v.strip()


def print_header(name: str):
    print(f'\n{"=" * 70}')
    print(f'  {name}')
    print('=' * 70)


def ok(msg: str):
    print(f'  [OK]    {msg}')


def fail(msg: str):
    print(f'  [FALHA] {msg}')


def warn(msg: str):
    print(f'  [AVISO] {msg}')


results = {}  # nome -> bool


# ============================================================
# 1. SUPABASE
# ============================================================
print_header('SUPABASE')

supa_url = ENV.get('VITE_SUPABASE_URL', '').rstrip('/')
supa_key = ENV.get('VITE_SUPABASE_SERVICE_ROLE_SECRET', '')

if not supa_url or not supa_key:
    fail('VITE_SUPABASE_URL ou VITE_SUPABASE_SERVICE_ROLE_SECRET faltando no .env')
    results['supabase'] = False
else:
    try:
        # OpenAPI introspection — chamada baratissima, retorna o schema
        r = requests.get(
            f'{supa_url}/rest/v1/',
            headers={'apikey': supa_key, 'Authorization': f'Bearer {supa_key}'},
            timeout=15,
        )
        if r.status_code == 200:
            data = r.json()
            n_tables = len((data.get('definitions') or {}))
            ok(f'URL: {supa_url}')
            ok(f'Tabelas expostas no schema public: {n_tables}')
            results['supabase'] = True
        else:
            fail(f'HTTP {r.status_code}: {r.text[:200]}')
            results['supabase'] = False
    except Exception as e:
        fail(f'Exception: {e}')
        results['supabase'] = False


# ============================================================
# 2. UAZAPI (WhatsApp)
# ============================================================
print_header('UAZAPI (WhatsApp)')

uaz_url = ENV.get('VITE_UAZAPI_URL', '').rstrip('/')
uaz_token = ENV.get('VITE_UAZAPI_TOKEN', '')

if not uaz_url or not uaz_token:
    fail('VITE_UAZAPI_URL ou VITE_UAZAPI_TOKEN faltando no .env')
    results['uazapi'] = False
else:
    try:
        # Usa o MESMO endpoint do sync_whatsapp_to_supabase.py — /chat/find
        # com payload minimo. Header de auth = 'token' (nao 'Authorization').
        r = requests.post(
            f'{uaz_url}/chat/find',
            headers={'token': uaz_token, 'Content-Type': 'application/json'},
            json={'operator': 'AND', 'limit': 1},
            timeout=20,
        )
        if r.status_code == 200:
            data = r.json() if r.headers.get('content-type', '').startswith('application/json') else {}
            n_chats = len(data.get('chats') or data.get('data') or [])
            ok(f'URL: {uaz_url}')
            ok(f'Token valido — /chat/find devolveu {n_chats} chat(s)')
            results['uazapi'] = True
        elif r.status_code == 401:
            fail('Token UAZAPI invalido (401 "Invalid token"). UAZAPI rotaciona')
            fail('o token quando a instancia reconecta. Pegar novo em uazapi.com')
            fail('e atualizar VITE_UAZAPI_TOKEN no .env (e no EasyPanel se aplicavel).')
            results['uazapi'] = False
        else:
            fail(f'HTTP {r.status_code}: {r.text[:200]}')
            results['uazapi'] = False
    except Exception as e:
        fail(f'Exception: {e}')
        results['uazapi'] = False


# ============================================================
# 3. META (3 tokens: Renan, Weslei, Andre)
# ============================================================
META_VARS = [
    ('VITE_META_TOKEN_RENAN', 'Renan'),
    ('VITE_META_TOKEN_WESLEI', 'Weslei'),
    ('VITE_META_TOKEN_ANDRE', 'André'),
]

for var, label in META_VARS:
    print_header(f'META — {label} ({var})')
    tok = ENV.get(var, '')
    if not tok:
        fail(f'{var} faltando no .env')
        results[f'meta_{label.lower()}'] = False
        continue
    try:
        # /me retorna info do usuario dono do token — validacao basica
        r = requests.get(
            'https://graph.facebook.com/v21.0/me',
            params={'access_token': tok, 'fields': 'id,name'},
            timeout=15,
        )
        if r.status_code != 200:
            data = r.json() if r.headers.get('content-type', '').startswith('application/json') else {}
            err_msg = data.get('error', {}).get('message', r.text[:200])
            fail(f'HTTP {r.status_code}: {err_msg}')
            results[f'meta_{label.lower()}'] = False
            continue

        me = r.json()
        ok(f'Usuario: {me.get("name", "?")} (id {me.get("id", "?")})')

        # Conta as adaccounts pra confirmar permissao ads_management/business
        r2 = requests.get(
            'https://graph.facebook.com/v21.0/me/adaccounts',
            params={'access_token': tok, 'fields': 'id', 'limit': 500},
            timeout=30,
        )
        if r2.status_code == 200:
            d2 = r2.json()
            n_accounts = len(d2.get('data', []))
            has_next = bool((d2.get('paging') or {}).get('next'))
            extra = '+' if has_next else ''
            ok(f'Ad accounts acessiveis: {n_accounts}{extra}')
        else:
            warn(f'/me/adaccounts falhou: HTTP {r2.status_code}')

        results[f'meta_{label.lower()}'] = True
    except Exception as e:
        fail(f'Exception: {e}')
        results[f'meta_{label.lower()}'] = False


# ============================================================
# 4. MONDAY
# ============================================================
print_header('MONDAY')

monday_tok = ENV.get('VITE_MONDAY_TOKEN', '')
monday_board = ENV.get('VITE_MONDAY_BOARD_ID', '')

if not monday_tok:
    fail('VITE_MONDAY_TOKEN faltando no .env')
    results['monday'] = False
else:
    try:
        # Query me{} valida o token. Tambem pega o board pra confirmar acesso.
        query = '{ me { id name email } }'
        r = requests.post(
            'https://api.monday.com/v2',
            headers={
                'Authorization': monday_tok,
                'Content-Type': 'application/json',
                'API-Version': '2024-10',
            },
            json={'query': query},
            timeout=15,
        )
        if r.status_code != 200:
            fail(f'HTTP {r.status_code}: {r.text[:200]}')
            results['monday'] = False
        else:
            data = r.json()
            if data.get('errors'):
                fail(f'GraphQL errors: {data["errors"][:1]}')
                results['monday'] = False
            else:
                me = data.get('data', {}).get('me', {})
                ok(f'Usuario: {me.get("name", "?")} ({me.get("email", "?")})')

                # Confirma acesso ao board configurado
                if monday_board:
                    q2 = '{ boards (ids: [%s]) { id name items_count } }' % monday_board
                    r2 = requests.post(
                        'https://api.monday.com/v2',
                        headers={
                            'Authorization': monday_tok,
                            'Content-Type': 'application/json',
                            'API-Version': '2024-10',
                        },
                        json={'query': q2},
                        timeout=15,
                    )
                    if r2.status_code == 200:
                        d2 = r2.json()
                        boards = d2.get('data', {}).get('boards', [])
                        if boards:
                            b = boards[0]
                            ok(f'Board {b.get("id")}: "{b.get("name")}" ({b.get("items_count", "?")} items)')
                        else:
                            warn(f'Board {monday_board} nao encontrado (token pode nao ter acesso)')
                    else:
                        warn(f'Query do board falhou: HTTP {r2.status_code}')
                results['monday'] = True
    except Exception as e:
        fail(f'Exception: {e}')
        results['monday'] = False


# ============================================================
# RESUMO
# ============================================================
print('\n' + '=' * 70)
print('  RESUMO')
print('=' * 70)
total = len(results)
ok_count = sum(1 for v in results.values() if v)
print(f'  {ok_count}/{total} tokens OK\n')
for name, status in results.items():
    icon = '✓' if status else '✗'
    print(f'  {icon} {name}')

sys.exit(0 if ok_count == total else 1)

"""
Importa os 2 backups xlsx do Design para a tabela design_demandas no Supabase.

Uso:
    1. Garanta que o SQL em db/design_demandas.sql já foi executado no Supabase
    2. Configure VITE_SUPABASE_URL e VITE_SUPABASE_SERVICE_ROLE_SECRET no .env
       da raiz do projeto (já devem estar pra app rodar)
    3. python scripts/import_design_backups.py

Idempotente: roda quantas vezes quiser. Linhas com `monday_item_id` extraído
do link são deduplicadas pelo índice único. Linhas sem link são deduplicadas
pela combinação (origem, nome, log_criacao) na tabela.
"""
import os
import re
import sys
import math
import pandas as pd
import requests

sys.stdout.reconfigure(encoding='utf-8')

# Lê .env da raiz
ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '.env')
SUPABASE_URL = ''
SUPABASE_KEY = ''
if os.path.exists(ENV_PATH):
    with open(ENV_PATH, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            v = v.strip().strip('"').strip("'")
            if k.strip() == 'VITE_SUPABASE_URL':
                SUPABASE_URL = v
            elif k.strip() == 'VITE_SUPABASE_SERVICE_ROLE_SECRET':
                SUPABASE_KEY = v

if not SUPABASE_URL or not SUPABASE_KEY:
    print('ERRO: VITE_SUPABASE_URL e VITE_SUPABASE_SERVICE_ROLE_SECRET não encontrados no .env')
    sys.exit(1)

REST = f'{SUPABASE_URL}/rest/v1/design_demandas'
HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
}

# Mapeamento posição → coluna no banco para cada tipo de backup.
# (Linha Excel NMR sempre descartada — não existe no schema)
COLS_FEITO = [
    'nome',
    'link_demanda',
    'clientes',
    'prioridade',
    'tempo_atrasado',
    'designer_responsavel',
    'status_tarefa',
    'status_designer',
    'padrao_tarefa',
    'tipo_edicao',
    'priority',
    'log_criacao',
]

COLS_MANUTENCAO = [
    'nome',
    'status_principal',
    'status_individual',
    'link_demanda',
    'gestor_responsavel',
    'tipo_manutencao',
    'designer_responsavel',
    'padrao_tarefa',
    'tipo_edicao',
    'log_criacao',
]

# Regex pra extrair pulse_id (item_id Monday) do link
# Formato: "Nome - https://burstmidia.monday.com/boards/XXX/pulses/YYY"
PULSE_RE = re.compile(r'/pulses/(\d+)', re.IGNORECASE)


def extract_monday_item_id(link: str | None) -> str | None:
    if not link:
        return None
    m = PULSE_RE.search(str(link))
    return m.group(1) if m else None


def clean(v):
    """Converte NaN, pd.NA, strings vazias em None."""
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if pd.isna(v):
        return None
    s = str(v).strip()
    return s if s else None


def parse_int(v):
    c = clean(v)
    if c is None:
        return None
    try:
        return int(float(c))
    except (ValueError, TypeError):
        return None


def infer_tipo_evento(rec: dict, origem: str) -> str:
    """Decide tipo_evento a partir do contexto.
       - Origens de demandas feitas (backup ou ativas) → 'feito'
       - Origens de manutenção (backup ou ativas) → 'manutencao_c' se tipo_manutencao
         contém 'C', senão 'manutencao'
       - Central (não usado aqui — vem da Edge Function)"""
    if origem in ('backup_atual', 'backup_2024', 'demandas_atual'):
        return 'feito'
    if origem in ('backup_manutencao', 'manutencao_atual'):
        tm = (rec.get('tipo_manutencao') or '').lower()
        if 'manutencao c' in tm.replace('ç', 'c') or 'manut. c' in tm or ' c.' in tm or tm.endswith(' c'):
            return 'manutencao_c'
        return 'manutencao'
    return 'feito'


def load_xlsx(path: str, origem: str, cols: list[str]) -> list[dict]:
    """Lê xlsx, pula header (linha 0 do conteúdo após multi-header já contém os títulos
    reais), retorna lista de dicts prontos pra inserir.
    Ignora também linhas de cabeçalho repetidas quando o xlsx tem múltiplos grupos
    (Monday repete a linha de títulos entre grupos)."""
    df = pd.read_excel(path, sheet_name=0, header=[0, 1])
    rows = []
    # Marcadores que indicam linha de cabeçalho repetida no meio dos dados
    HEADER_VALUES = {'Nome', 'Status Principal', 'Status Individual', 'Link da demanda',
                     'Designer Responsável', 'Tipo de manutenção', 'Padrão tarefa',
                     'Tipo de Edição', 'Log de criação', 'Linha Excel', 'Status da Tarefa',
                     'Status do Designer', 'Priority', '👥 Clientes', 'Prioridade',
                     'Tempo atrasado!!!', 'Gestor responsável'}
    for idx in range(1, len(df)):
        raw = [df.iloc[idx][col] for col in df.columns]
        if all((v is None) or (isinstance(v, float) and math.isnan(v)) or pd.isna(v) for v in raw):
            continue

        # Detecta linha de cabeçalho repetida: se vários valores são strings do conjunto
        # de títulos, é cabeçalho de outro grupo no mesmo xlsx — ignora.
        header_matches = sum(
            1 for v in raw if isinstance(v, str) and v.strip() in HEADER_VALUES
        )
        if header_matches >= 3:
            continue

        rec: dict = {}
        for i, key in enumerate(cols):
            if i >= len(raw):
                rec[key] = None
                continue
            rec[key] = clean(raw[i])
        rec['monday_item_id'] = extract_monday_item_id(rec.get('link_demanda'))
        rec['origem'] = origem
        rec['tipo_evento'] = infer_tipo_evento(rec, origem)
        if not rec.get('nome') and not rec.get('link_demanda') and not rec.get('log_criacao'):
            continue

        # Detecta linhas de SEPARADOR DE GRUPO que vêm dos boards de manutenção
        # (ex: 'Manutenção "boa" - Fora do conhecimento do Designer'). São títulos
        # de grupo do Monday que vieram como linha no xlsx — não são demandas reais.
        # Identificação: nome começa com "Manutenção" + sem link + sem outros campos.
        nome_str = rec.get('nome') or ''
        is_group_header = (
            nome_str.lower().startswith('manutenç')
            and not rec.get('link_demanda')
            and not rec.get('monday_item_id')
            and not rec.get('designer_responsavel')
        )
        if is_group_header:
            continue

        rows.append(rec)
    return rows


def count_duplicates(rows: list[dict]) -> dict[str, int]:
    """Conta quantas vezes cada monday_item_id aparece (pra relatório)."""
    counts: dict[str, int] = {}
    for r in rows:
        mid = r.get('monday_item_id')
        if mid:
            counts[mid] = counts.get(mid, 0) + 1
    return {mid: c for mid, c in counts.items() if c > 1}


def delete_by_origem(origem: str) -> int:
    """Apaga todas as linhas de uma origem específica. Idempotência do import."""
    url = f'{REST}?origem=eq.{origem}'
    headers = {**HEADERS, 'Prefer': 'return=representation'}
    r = requests.delete(url, headers=headers, timeout=60)
    if r.status_code >= 300:
        print(f'  ERRO delete ({r.status_code}): {r.text[:500]}')
        sys.exit(1)
    # Tenta contar deletados pelo body
    try:
        deleted = len(r.json())
    except Exception:
        deleted = -1
    return deleted


def fetch_webhook_item_ids() -> set:
    """Retorna set de monday_item_id que JÁ existem no banco com origem='central'
    ou 'central_backfill'. Usado pra evitar duplicar com webhook recente."""
    headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
    ids = set()
    offset = 0
    while True:
        h = {**headers, 'Range-Unit': 'items', 'Range': f'{offset}-{offset + 999}'}
        url = (f'{SUPABASE_URL}/rest/v1/design_demandas'
               f'?origem=in.(central,central_backfill)'
               f'&monday_item_id=not.is.null'
               f'&select=monday_item_id,tipo_evento')
        r = requests.get(url, headers=h, timeout=60)
        chunk = r.json()
        if not isinstance(chunk, list) or not chunk:
            break
        for row in chunk:
            mid = row.get('monday_item_id')
            te = row.get('tipo_evento')
            if mid and te:
                ids.add((str(mid), te))
        if len(chunk) < 1000:
            break
        offset += 1000
    return ids


def batch_insert(rows: list[dict], batch_size: int = 500) -> int:
    """Insere todas as linhas em lotes. Pula items que já existem no banco
    como origem='central' ou 'central_backfill' (webhook é mais confiável)."""
    # Carrega ids já vindos via webhook (1 vez por chamada)
    webhook_keys = fetch_webhook_item_ids()
    skipped = 0
    to_insert = []
    for rec in rows:
        mid = rec.get('monday_item_id')
        te = rec.get('tipo_evento')
        if mid and te and (str(mid), te) in webhook_keys:
            skipped += 1
            continue
        to_insert.append(rec)
    if skipped:
        print(f'  ⊘ {skipped} linha(s) puladas (já existem via webhook central)')

    total = 0
    for i in range(0, len(to_insert), batch_size):
        chunk = to_insert[i:i + batch_size]
        r = requests.post(REST, headers=HEADERS, json=chunk, timeout=60)
        if r.status_code >= 300:
            print(f'  ERRO insert ({r.status_code}): {r.text[:500]}')
            sys.exit(1)
        total += len(chunk)
        print(f'  ✓ {min(i + batch_size, len(to_insert))} / {len(to_insert)}')
    return total


SOURCES = [
    # Backups históricos (boards ARQUIVADAS) — snapshot 14/05/2026
    (
        r'C:\Users\noteb\Downloads\Backup_Demandas_feitas_do_Design_1778785823.xlsx',
        'backup_atual',
        COLS_FEITO,
    ),
    (
        r'C:\Users\noteb\Downloads\Demandas_feitas_do_Design_2024_2026_1778689534.xlsx',
        'backup_2024',
        COLS_FEITO,
    ),
    (
        r'C:\Users\noteb\Downloads\Backup_Manuten_es_do_Design_1778785840.xlsx',
        'backup_manutencao',
        COLS_MANUTENCAO,
    ),
    # Boards ATIVAS (estado operacional atual) — snapshot 14/05/2026
    (
        r'C:\Users\noteb\Downloads\Demandas_feitas_pelo_Design_1778785805.xlsx',
        'demandas_atual',
        COLS_FEITO,
    ),
    (
        r'C:\Users\noteb\Downloads\Manuten_es_do_Design_1778785849.xlsx',
        'manutencao_atual',
        COLS_MANUTENCAO,
    ),
]


def main():
    print(f'Supabase: {SUPABASE_URL}')
    print(f'Tabela: design_demandas')
    print()

    grand_total = 0
    for path, origem, cols in SOURCES:
        print(f'>>> {os.path.basename(path)} → origem={origem}')
        if not os.path.exists(path):
            print(f'  AVISO: arquivo não encontrado, pulando')
            continue

        rows = load_xlsx(path, origem, cols)
        print(f'  {len(rows)} linhas no xlsx')

        # Relatório de manutenções (mesmo monday_item_id aparecendo várias vezes)
        dups = count_duplicates(rows)
        if dups:
            total_eventos_extras = sum(c - 1 for c in dups.values())
            print(f'  ℹ {len(dups)} item(ns) com manutenção — {total_eventos_extras} evento(s) extra(s)')

        # Idempotência: apaga tudo dessa origem antes de reinserir
        deleted = delete_by_origem(origem)
        if deleted > 0:
            print(f'  🗑 {deleted} linha(s) antiga(s) dessa origem apagada(s) antes do reimport')
        elif deleted == 0:
            print(f'  (nenhuma linha existente dessa origem — primeiro import)')

        if not rows:
            continue
        inserted = batch_insert(rows)
        print(f'  → {inserted} linhas inseridas no Supabase')
        grand_total += inserted
        print()

    print(f'=== TOTAL: {grand_total} linhas processadas ===')


if __name__ == '__main__':
    main()

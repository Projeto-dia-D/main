"""Inspeciona schema dos 2 xlsx novos do design."""
import pandas as pd
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

PATHS = [
    (r'C:\Users\noteb\Downloads\Demandas_feitas_pelo_Design_1778709171.xlsx', 'DEMANDAS (board 6900515649)'),
    (r'C:\Users\noteb\Downloads\Manuten_es_do_Design_1778708554.xlsx', 'MANUTENÇÕES (board 6791838447)'),
]

for path, label in PATHS:
    print('=' * 80)
    print(label)
    print(path)
    print('=' * 80)
    xls = pd.ExcelFile(path)
    print(f'Sheets: {xls.sheet_names}')
    for s in xls.sheet_names:
        print(f'\n--- Sheet: {s} ---')
        try:
            df = pd.read_excel(path, sheet_name=s, header=[0, 1])
        except ValueError as e:
            print(f'  (sheet vazia ou inválida: {e})')
            continue
        print(f'Rows: {len(df)}')
        print(f'Columns ({len(df.columns)}):')
        for i, col in enumerate(df.columns):
            grupo, nome = col
            if 'Unnamed' in str(grupo):
                grupo = ''
            print(f'  [{i:02d}] grupo={grupo!r:35s} nome={nome!r}')

        if len(df) > 0:
            print('\nPrimeira linha de dados (= cabeçalho real do Monday):')
            for col in df.columns:
                v = df.iloc[0][col]
                if pd.notna(v):
                    print(f'  {col[1]!s:45s} = {str(v)[:80]}')

            if len(df) > 1:
                print('\nSegunda linha (dados reais):')
                for col in df.columns:
                    v = df.iloc[1][col]
                    if pd.notna(v):
                        print(f'  {col[1]!s:45s} = {str(v)[:80]}')
        print()

"""Inspeciona os 2 xlsx de backup de demandas do design e imprime schema + amostras."""
import pandas as pd
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

PATHS = [
    r'C:\Users\noteb\Downloads\Backup_Demandas_feitas_do_Design_1778689570.xlsx',
    r'C:\Users\noteb\Downloads\Demandas_feitas_do_Design_2024_2026_1778689534.xlsx',
]

for path in PATHS:
    print('=' * 70)
    print(os.path.basename(path))
    print('=' * 70)
    # Header com 2 níveis (linha 1 título do grupo, linha 2 nome da coluna)
    df = pd.read_excel(path, sheet_name=0, header=[0, 1])
    print(f'Linhas: {len(df)}')
    print(f'Colunas ({len(df.columns)}):')
    for i, col in enumerate(df.columns):
        # col é uma tupla (grupo, coluna)
        grupo, nome = col
        if 'Unnamed' in str(grupo):
            grupo = ''
        print(f'  [{i:02d}] grupo={grupo!r:40s} nome={nome!r}')

    print()
    print('Primeiras 3 linhas de dados:')
    for idx in range(min(3, len(df))):
        print(f'  --- linha {idx} ---')
        for col in df.columns:
            v = df.iloc[idx][col]
            if pd.notna(v):
                s = str(v)
                if len(s) > 60:
                    s = s[:60] + '...'
                print(f'    {col[1]!s:40s} = {s}')
    print()
    print('Contagem de não-nulos por coluna:')
    for col in df.columns:
        nn = df[col].notna().sum()
        print(f'  {col[1]!s:40s} {nn}/{len(df)} preenchidos')
    print()

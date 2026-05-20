"""Procura grupos WhatsApp por palavras-chave."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import runpy, unicodedata

wa = runpy.run_path('scripts/sync_whatsapp_to_supabase.py', run_name='__noop__')
chats = wa['fetch_chats']()


def norm(s: str | None) -> str:
    if not s:
        return ''
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn').lower()


needles = sys.argv[1:] if len(sys.argv) > 1 else ['julio', 'mota', 'daniele', 'coi']
for n in needles:
    matches = [c for c in chats if c.get('wa_isGroup') and n in norm(c.get('name') or c.get('wa_name') or '')]
    print(f'\n"{n}": {len(matches)} grupos')
    for m in matches[:10]:
        print(f'  · {m.get("name") or m.get("wa_name")}')

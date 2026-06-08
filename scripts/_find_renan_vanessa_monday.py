"""Lista todos usuarios Monday e busca Erick / Ricardo."""
import json
import requests

MONDAY_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjU4NjU3Nzg0OCwiYWFpIjoxMSwidWlkIjoyOTE0MjY2NSwiaWFkIjoiMjAyNS0xMS0xNFQxNjo1MzoxMi4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTA1NTI1NTYsInJnbiI6InVzZTEifQ.C1GorIgh3pGVqauh8tAtO8x0jFUrv2rbAHNcJ6PrzOE'

URL = 'https://api.monday.com/v2'
HEADERS = {'Authorization': MONDAY_TOKEN, 'Content-Type': 'application/json',
           'API-Version': '2024-01'}

query = """
{
  users(limit: 500) {
    id
    name
    email
    enabled
    is_admin
    is_guest
    title
  }
}
"""

r = requests.post(URL, headers=HEADERS, json={'query': query}, timeout=30)
users = r.json().get('data', {}).get('users', [])
print(f'Total usuarios Monday: {len(users)}\n')

# Lista TODOS
print('Lista completa (nome | email | title):')
print('=' * 90)
for u in sorted(users, key=lambda x: (x.get('name') or '').lower()):
    n = u.get('name','')
    e = u.get('email','')
    t = u.get('title') or '—'
    print(f"  {n:<35} {e:<35} {t}")

print()
print('=' * 90)
print('Procurando "erick" ou "ricardo" ou "fronza":')
print('=' * 90)
for u in users:
    nm = (u.get('name') or '').lower()
    em = (u.get('email') or '').lower()
    if 'erick' in nm or 'ricardo' in nm or 'fronza' in nm or 'erick' in em or 'ricardo' in em or 'fronza' in em:
        print(f"  Nome:    {u.get('name')}")
        print(f"  Email:   {u.get('email')}")
        print(f"  Title:   {u.get('title') or '—'}")
        print(f"  Enabled: {u.get('enabled')}")
        print(f"  ID:      {u.get('id')}")
        print('-' * 90)

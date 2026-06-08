"""Verifica se o Monday tem teams configurados pra usar como fonte de role."""
import json
import requests

TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjU4NjU3Nzg0OCwiYWFpIjoxMSwidWlkIjoyOTE0MjY2NSwiaWFkIjoiMjAyNS0xMS0xNFQxNjo1MzoxMi4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTA1NTI1NTYsInJnbiI6InVzZTEifQ.C1GorIgh3pGVqauh8tAtO8x0jFUrv2rbAHNcJ6PrzOE'
H = {'Authorization': TOKEN, 'Content-Type': 'application/json', 'API-Version': '2024-01'}

q = '{ teams { id name picture_url users { id name email } } }'
r = requests.post('https://api.monday.com/v2', headers=H, json={'query': q}, timeout=30)
data = r.json()
teams = data.get('data', {}).get('teams', []) or []
print(f'Total teams: {len(teams)}\n')
for t in teams:
    print(f'TEAM: {t.get("name")} (id={t.get("id")})')
    for u in t.get('users', []) or []:
        print(f'  - {u.get("name"):<35} {u.get("email")}')
    print()

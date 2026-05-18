# Edge Function: `design-feito`

Recebe webhook do **Monday** quando a coluna "Status do Designer" muda para
"Feito" no board **Central de Design (3519879202)**, busca os dados completos
do item via Monday API e insere uma nova linha em `design_demandas` no
Supabase com `origem='central'`.

## Setup (uma vez)

### 1. Instalar Supabase CLI (se não tiver)

```powershell
# Windows (com Scoop)
scoop install supabase

# Ou via npm
npm install -g supabase
```

### 2. Login e link do projeto

```powershell
cd "C:\Users\noteb\Documents\Dia D"
supabase login
supabase link --project-ref ndjxlyjpagfsueafgmzp
```

(Use o ref do seu Supabase — visível na URL do dashboard, parte antes de `.supabase.co`.)

### 3. Configurar secrets

```powershell
# Token de admin do Monday (mesmo do .env)
supabase secrets set MONDAY_TOKEN="eyJhbGc..."

# Board ID da Central de Design
supabase secrets set MONDAY_BOARD_ID="3519879202"

# Secret pra validar o webhook (gere algo aleatório, ex: openssl rand -hex 24)
supabase secrets set WEBHOOK_SECRET="cole-aqui-um-secret-aleatorio"
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são injetados automaticamente
pela plataforma — não precisa configurar.

### 4. Deploy da função

```powershell
supabase functions deploy design-feito --no-verify-jwt
```

A flag `--no-verify-jwt` permite que o Monday chame sem JWT (a autenticação é
feita pelo `WEBHOOK_SECRET` na URL).

A função fica disponível em:

```
https://ndjxlyjpagfsueafgmzp.supabase.co/functions/v1/design-feito
```

### 5. Configurar a Automation no Monday

1. Abra o board **Central de Design** (3519879202)
2. Botão **Automate** (canto superior direito)
3. **Create Custom Automation**
4. **When** → "Status do Designer" changes to "Feito"
5. **Then** → **Send webhook**
6. Cole a URL:
   ```
   https://ndjxlyjpagfsueafgmzp.supabase.co/functions/v1/design-feito?secret=COLE-O-WEBHOOK-SECRET-AQUI
   ```
7. Salvar

Pronto. Toda vez que alguém marcar "Status do Designer = Feito" (entrega
inicial ou manutenção), uma nova linha entra em `design_demandas`.

## Como verificar se está funcionando

### Teste manual

No board, mude um item de teste de "Em andamento" → "Feito" e volte. Em
segundos a linha aparece na tabela:

```sql
SELECT * FROM design_demandas
WHERE origem = 'central'
ORDER BY imported_at DESC
LIMIT 10;
```

### Logs da função

```powershell
supabase functions logs design-feito
```

## Comportamento

- **Cada "Feito" gera uma linha** — entrega original e manutenções são eventos
  separados (mesmo `monday_item_id`, registros diferentes)
- **Sem dedup** — se a automação disparar 2x pro mesmo evento, dá 2 linhas
- **Origem = 'central'** — pra distinguir dos backups históricos
- **`link_demanda` sempre preenchido** — construído como `Nome - https://burstmidia.monday.com/boards/3519879202/pulses/<id>`

## Troubleshooting

- **Função não responde:** verifica o handshake — quando você salva o webhook
  no Monday, ele envia `{ "challenge": "..." }` esperando o mesmo de volta.
  A função já cuida disso.
- **403 forbidden:** o `secret` na URL não bate com `WEBHOOK_SECRET`.
- **500 com erro de inserção:** veja `supabase functions logs design-feito`.
  Normalmente é coluna no banco que não existe ou tipo errado.
- **Status muda mas nada acontece:** confirme que a automation do Monday
  está ativada (toggle on) e olha o histórico de execuções no próprio Monday.

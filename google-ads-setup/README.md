# 📘 Manual COMPLETO — Acesso à API do Google Ads (do zero ao fim)

> Objetivo: ler campanhas/gasto/conversão das suas contas Google Ads via API,
> pra integrar no Dia D. Tudo roda **localmente** (os scripts em `google-ads-setup/`).

## ✅ O que você precisa no fim (5 valores no `.env`)

| Variável | O que é | Status / onde pega |
|---|---|---|
| `VITE_ID_GOOGLE` | Client ID | ✅ já tem |
| `VITE_CHAVE_API_GOOGLE` | Client Secret | ✅ já tem |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Developer token | ❌ PARTE 3 |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | ID do MCC | ❌ PARTE 4 (trivial) |
| `GOOGLE_ADS_REFRESH_TOKEN` | Login autorizado | ❌ PARTE 5 (rodar 1 script) |

**Resumo honesto:** além do token, você ainda precisa: ativar a API no projeto (PARTE 1),
liberar seu login (PARTE 2), pegar o ID do MCC (PARTE 4) e gerar o refresh token (PARTE 5).
Nenhum é difícil — siga na ordem.

---

# PARTE 1 — Cloud Console: ativar a API (5 min)

> Sem isso, TODA chamada falha com erro 403 ("Google Ads API has not been used…").

1. Confirme o projeto: abra **https://console.cloud.google.com/apis/credentials**, e no
   seletor do topo veja em qual projeto está o client `1078044147134-...`. Fixe esse projeto.
2. Ative a API: **https://console.cloud.google.com/apis/library/googleads.googleapis.com**
   → confirme o projeto no topo → **Ativar**.

# PARTE 2 — Cloud Console: liberar o seu login (5 min)

> Sem isso, o login do PARTE 5 é bloqueado / o token expira sozinho.

1. Abra **https://console.cloud.google.com/apis/credentials/consent**
2. Em **Usuários de teste** → **Adicionar usuários** → coloque o e-mail Google que você vai
   usar pra logar (tem que ser um e-mail com acesso ao Google Ads).
3. ⚠️ **Decisão importante:**
   - Modo **"Em teste"**: o refresh token **expira em 7 dias** (bom pra testar).
   - Botão **"PUBLICAR APP"**: refresh token **não expira** (use pra valer de verdade).
   - 👉 Recomendo já **publicar** pra não ter que refazer o login toda semana.

### Confira o TIPO do seu OAuth client (decide se precisa cadastrar redirect)
1. Em https://console.cloud.google.com/apis/credentials → abra o client `1078044147134-...`
2. No topo diz o tipo:
   - **"App para computador" (Desktop)** → ✅ não precisa fazer mais nada de redirect.
   - **"Aplicativo da Web"** → adicione em **URIs de redirecionamento autorizados**:
     ```
     http://localhost:5180/
     ```
     e salve. (Tem que ser idêntico, com a barra no fim.)
   - 💡 Não sabe / quer simplificar: **Criar credenciais → ID do cliente OAuth → "App para
     computador"**, e troque `VITE_ID_GOOGLE` / `VITE_CHAVE_API_GOOGLE` pelos novos valores.

---

# PARTE 3 — Developer Token (o que te falta)

### Pré-requisito: conta Administrador (MCC)
O token **só sai de um MCC**.
- **Não tem MCC?** Crie grátis: **https://ads.google.com/home/tools/manager-accounts/**
  → "Criar conta de administrador". Use um e-mail Google **ainda não vinculado** a uma conta
  de anúncios.
- **Vincule suas contas de anúncios ao MCC** (senão a API não as enxerga):
  no MCC → **Contas → Sub-contas → "+" → Vincular conta existente** → manda o convite →
  o dono da conta aceita. (Ou crie as contas já dentro do MCC.)

### Solicitar o token
1. Logue no Google Ads **na conta MCC**.
2. Abra **https://ads.google.com/aw/apicenter** (a "Central de API" **só aparece em MCC** —
   se não aparecer, você não está logado no MCC).
3. Preencha o **formulário de Acesso à API**:
   - **Nome da empresa:** Burst Mídia
   - **Site:** a URL **real** da Burst (genérica tipo `test.com` é recusada)
   - **E-mail de contato** monitorado (compliance do Google pode escrever)
   - **Uso:** ex. "dashboard interno pra consolidar métricas das contas dos clientes"
4. Aceite os termos.
5. **Nível recebido:**
   - 🟢 **Explorer** → na hora, **já lê contas REAIS** (com limite de chamadas/dia). Suficiente pro Dia D.
   - 🟡 **Teste** ("Pendente") → só contas de teste → peça upgrade pra Básico.
   - 🔵 **Básico/Padrão** → remove limites; pedir upgrade + esperar (dias).
6. Copie o **token de desenvolvedor** → `GOOGLE_ADS_DEVELOPER_TOKEN`.

# PARTE 4 — Login Customer ID (o ID do MCC) — trivial

1. No Google Ads logado no **MCC**, canto superior direito: número `123-456-7890`.
2. Tire os traços → `1234567890` → `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.

---

# PARTE 5 — Refresh Token (o login) — **única parte que só você faz**

Coloque no `.env` (⚠️ **sem `VITE_`** nos novos):
```
GOOGLE_ADS_DEVELOPER_TOKEN=seu_token
GOOGLE_ADS_LOGIN_CUSTOMER_ID=1234567890
```
Rode na raiz do projeto:
```powershell
node google-ads-setup/1-get-refresh-token.mjs
```
→ abre o navegador → **login** na conta do Google Ads → **autorizar**.
O terminal imprime o refresh token. Cole no `.env`:
```
GOOGLE_ADS_REFRESH_TOKEN=1//0g...
```

# PARTE 6 — Testar
```powershell
node google-ads-setup/2-test-ads.mjs
```
Deve listar as contas + a árvore do MCC + gasto dos últimos 30 dias. **Funcionou? Pronto.**

---

# 🆘 Erros comuns (e a solução) — pra não travar

| Erro / sintoma | Causa | Solução |
|---|---|---|
| `PERMISSION_DENIED` "Google Ads API has not been used in project…" | API não ativada | PARTE 1 |
| `redirect_uri_mismatch` no login | client é Web e o redirect não bate | PARTE 2 (add `http://localhost:5180/`) ou use client Desktop |
| Login mostra "app não verificado / bloqueado" | seu e-mail não é usuário de teste | PARTE 2 (add usuário de teste) ou publicar |
| Script 1 não imprime refresh token | Google não devolveu (já autorizado antes) | revogue em https://myaccount.google.com/permissions e rode de novo |
| `invalid_grant` ao rodar script 2 (depois de dias) | refresh token expirou (modo Teste = 7 dias) | **Publicar app** (PARTE 2) e refazer o login |
| `DEVELOPER_TOKEN_NOT_APPROVED` | token nível Teste | use conta de teste **ou** peça upgrade (PARTE 3) |
| `USER_PERMISSION_DENIED` | usuário do login não acessa a conta, ou `login-customer-id` errado | logue com usuário que gerencia o MCC; confira o ID do MCC sem traços |
| `CUSTOMER_NOT_ENABLED` / conta some da lista | conta não vinculada ao MCC | vincule a conta ao MCC (PARTE 3) |
| Central de API não aparece | você não está num MCC | troque pra conta administrador |

# 🔒 Segurança (não pule)
- `GOOGLE_ADS_DEVELOPER_TOKEN` e `GOOGLE_ADS_REFRESH_TOKEN` **nunca** com prefixo `VITE_`
  (o Vite embute `VITE_*` no JS do site = vazaria pra qualquer um).
- Idealmente o client secret também deveria sair do `VITE_` e as chamadas rodarem num
  **backend**. Esses scripts são locais (só na sua máquina), então estão ok pra setup/teste.

# 📌 Checklist final
- [ ] PARTE 1 — API ativada no projeto
- [ ] PARTE 2 — usuário de teste add (ou app publicado) + tipo do client conferido
- [ ] PARTE 3 — developer token no `.env`
- [ ] PARTE 4 — ID do MCC no `.env`
- [ ] PARTE 5 — refresh token no `.env`
- [ ] PARTE 6 — `2-test-ads.mjs` listou as contas ✅

// ===========================================================================
// PASSO 2 — Testa o acesso: lista as contas Google Ads e o gasto (30 dias).
// ---------------------------------------------------------------------------
// Rode na raiz do projeto:   node google-ads-setup/2-test-ads.mjs
//
// PRÉ-REQUISITOS no .env (sem prefixo VITE_ nos segredos novos):
//   VITE_ID_GOOGLE                 = client id   (já tem)
//   VITE_CHAVE_API_GOOGLE          = client secret (já tem)
//   GOOGLE_ADS_REFRESH_TOKEN       = saída do passo 1
//   GOOGLE_ADS_DEVELOPER_TOKEN     = developer token do seu MCC
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID   = ID do MCC (só números, sem traços)
// ===========================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const CLIENT_ID = env.VITE_ID_GOOGLE;
const CLIENT_SECRET = env.VITE_CHAVE_API_GOOGLE;
const REFRESH = env.GOOGLE_ADS_REFRESH_TOKEN;
const DEV_TOKEN = env.GOOGLE_ADS_DEVELOPER_TOKEN || env.VITE_MCC_TOKEN;
const LOGIN_CID = (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\D/g, '');
const API = 'https://googleads.googleapis.com/v23';

for (const [k, v] of Object.entries({
  VITE_ID_GOOGLE: CLIENT_ID,
  VITE_CHAVE_API_GOOGLE: CLIENT_SECRET,
  GOOGLE_ADS_REFRESH_TOKEN: REFRESH,
  'GOOGLE_ADS_DEVELOPER_TOKEN (ou VITE_MCC_TOKEN)': DEV_TOKEN,
})) {
  if (!v) { console.error('❌ Falta no .env: ' + k); process.exit(1); }
}

function headers(access, withLogin) {
  const h = {
    Authorization: 'Bearer ' + access,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (withLogin && LOGIN_CID) h['login-customer-id'] = LOGIN_CID;
  return h;
}

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const j = await r.json();
  if (!j.access_token) { console.error('❌ Falha ao obter access_token:', j); process.exit(1); }
  return j.access_token;
}

async function search(access, customerId, query) {
  const r = await fetch(API + '/customers/' + customerId + '/googleAds:search', {
    method: 'POST',
    headers: headers(access, true),
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || JSON.stringify(j));
  return j.results || [];
}

const access = await getAccessToken();
console.log('✅ access_token obtido\n');

// 1) Contas diretamente acessíveis por essa credencial
const accRes = await fetch(API + '/customers:listAccessibleCustomers', { headers: headers(access, false) });
const accJson = await accRes.json();
if (!accRes.ok) { console.error('❌ Erro listAccessibleCustomers:', JSON.stringify(accJson, null, 2)); process.exit(1); }
const topIds = (accJson.resourceNames || []).map((r) => r.split('/')[1]);
console.log('Contas acessíveis diretamente (' + topIds.length + '): ' + topIds.join(', '));

// 2) Se tem MCC, lista toda a árvore de contas-filhas
let alvos = [...topIds];
if (LOGIN_CID) {
  try {
    const rows = await search(access, LOGIN_CID,
      'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.level, customer_client.currency_code FROM customer_client');
    console.log('\nÁrvore do MCC ' + LOGIN_CID + ' (' + rows.length + ' nós):');
    alvos = [];
    for (const row of rows) {
      const c = row.customerClient;
      const tipo = c.manager ? '[MCC]' : '     ';
      console.log('  ' + tipo + ' ' + c.id + '  nv' + (c.level ?? '?') + '  ' + (c.descriptiveName || '(sem nome)') + '  ' + (c.currencyCode || ''));
      if (!c.manager) alvos.push(c.id); // só contas operacionais têm gasto
    }
  } catch (e) {
    console.log('\n(Não consegui listar a árvore do MCC: ' + e.message + ')');
  }
}

// 3) Gasto dos últimos 30 dias por conta operacional
console.log('\nGasto últimos 30 dias:');
for (const id of alvos) {
  try {
    const rows = await search(access, id,
      'SELECT customer.descriptive_name, customer.currency_code, metrics.cost_micros FROM customer WHERE segments.date DURING LAST_30_DAYS');
    const nome = rows[0]?.customer?.descriptiveName || '(sem nome)';
    const moeda = rows[0]?.customer?.currencyCode || '';
    const gasto = rows.reduce((s, x) => s + Number(x.metrics?.costMicros || 0), 0) / 1e6;
    console.log('  ' + id + '  ' + nome.padEnd(34) + gasto.toFixed(2) + ' ' + moeda);
  } catch (e) {
    console.log('  ' + id + '  -> erro: ' + e.message);
  }
}
console.log('\n✅ Fim. Se apareceram contas e gastos acima, a integração está funcionando.');

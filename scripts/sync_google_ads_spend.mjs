// ===========================================================================
// Sync Google Ads → Supabase (gasto diário por conta).
// ---------------------------------------------------------------------------
// Roda:  node scripts/sync_google_ads_spend.mjs            (últimos 35 dias)
//        node scripts/sync_google_ads_spend.mjs --days=90  (backfill)
//
// Descobre TODAS as contas acessíveis (diretas + árvore de cada MCC),
// puxa metrics.cost_micros por dia e faz upsert em public.google_ads_spend.
// Agendado no Task Scheduler (tarefa "GoogleAdsSync", a cada 1h).
//
// Credenciais do .env (raiz do projeto):
//   VITE_ID_GOOGLE / VITE_CHAVE_API_GOOGLE      — OAuth client (Desktop)
//   GOOGLE_ADS_REFRESH_TOKEN                    — refresh token (app Interno)
//   VITE_MCC_TOKEN ou GOOGLE_ADS_DEVELOPER_TOKEN— developer token
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID                — MCC principal (Renan)
//   VITE_SUPABASE_URL / VITE_SUPABASE_SERVICE_ROLE_SECRET
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
const MAIN_MCC = (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\D/g, '');
const SUPA_URL = env.VITE_SUPABASE_URL;
const SUPA_KEY = env.VITE_SUPABASE_SERVICE_ROLE_SECRET;
const API = 'https://googleads.googleapis.com/v23';

for (const [k, v] of Object.entries({
  VITE_ID_GOOGLE: CLIENT_ID, VITE_CHAVE_API_GOOGLE: CLIENT_SECRET,
  GOOGLE_ADS_REFRESH_TOKEN: REFRESH, DEV_TOKEN, VITE_SUPABASE_URL: SUPA_URL,
  VITE_SUPABASE_SERVICE_ROLE_SECRET: SUPA_KEY,
})) {
  if (!v) { console.error('FALTA no .env: ' + k); process.exit(1); }
}

const daysArg = process.argv.find((a) => a.startsWith('--days='));
const DAYS = daysArg ? Math.max(1, parseInt(daysArg.split('=')[1], 10) || 35) : 35;
const end = new Date();
const start = new Date(end.getTime() - DAYS * 24 * 60 * 60 * 1000);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const START = iso(start), END = iso(end);

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: REFRESH, grant_type: 'refresh_token',
    }).toString(),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('access_token falhou: ' + JSON.stringify(j));
  return j.access_token;
}

function headers(access, loginCid) {
  const h = {
    Authorization: 'Bearer ' + access,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCid) h['login-customer-id'] = loginCid;
  return h;
}

async function search(access, customerId, query, loginCid) {
  const r = await fetch(`${API}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers: headers(access, loginCid),
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || JSON.stringify(j).slice(0, 200));
  return j.results || [];
}

const access = await getAccessToken();
console.log(`[gads-sync] periodo ${START} → ${END}`);

// 1) Contas com acesso direto do usuário
const accRes = await fetch(`${API}/customers:listAccessibleCustomers`, { headers: headers(access) });
const accJson = await accRes.json();
if (!accRes.ok) { console.error('listAccessibleCustomers falhou:', JSON.stringify(accJson)); process.exit(1); }
const direct = (accJson.resourceNames || []).map((r) => r.split('/')[1]);
console.log(`[gads-sync] ${direct.length} contas diretas`);

// 2) Descobre MCCs entre as diretas e expande a árvore de cada um.
//    alvo: Map<accountId, { name, loginCid }> — loginCid = MCC pai (ou null se direta)
const alvos = new Map();
const mccs = [];
for (const id of direct) {
  try {
    const rows = await search(access, id, 'SELECT customer.manager, customer.descriptive_name FROM customer', null);
    const c = rows[0]?.customer;
    if (c?.manager) mccs.push(id);
    else alvos.set(id, { name: c?.descriptiveName || '', loginCid: null });
  } catch {
    // sem acesso direto utilizável — tenta depois via MCC principal
    alvos.set(id, { name: '', loginCid: MAIN_MCC || null });
  }
}
console.log(`[gads-sync] MCCs: ${mccs.join(', ') || '(nenhum)'}`);
for (const mcc of mccs) {
  try {
    const rows = await search(access, mcc,
      'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager FROM customer_client', mcc);
    for (const row of rows) {
      const cc = row.customerClient;
      if (!cc || cc.manager) continue;
      const id = String(cc.id);
      // árvore tem prioridade (traz loginCid certo pra contas que falham direto)
      alvos.set(id, { name: cc.descriptiveName || alvos.get(id)?.name || '', loginCid: mcc });
    }
  } catch (e) {
    console.warn(`[gads-sync] arvore do MCC ${mcc} falhou: ${e.message}`);
  }
}
console.log(`[gads-sync] ${alvos.size} contas operacionais pra coletar`);

// 3) Gasto diário por conta
const GAQL = `SELECT customer.descriptive_name, customer.currency_code, segments.date, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${START}' AND '${END}'`;
const upserts = [];
let okCount = 0, failCount = 0;
for (const [id, info] of alvos) {
  // tenta na ordem: loginCid conhecido → sem login → MCC principal
  const tentativas = [...new Set([info.loginCid, null, MAIN_MCC || null])];
  let rows = null, lastErr = null;
  for (const cid of tentativas) {
    try { rows = await search(access, id, GAQL, cid); break; }
    catch (e) { lastErr = e; }
  }
  if (!rows) {
    failCount++;
    console.warn(`[gads-sync] ${id} (${info.name}) FALHOU: ${lastErr?.message}`);
    continue;
  }
  okCount++;
  for (const r of rows) {
    const spend = Number(r.metrics?.costMicros || 0) / 1e6;
    if (!r.segments?.date) continue;
    upserts.push({
      account_id: id,
      date: r.segments.date,
      account_name: r.customer?.descriptiveName || info.name || null,
      currency: r.customer?.currencyCode || null,
      spend: Number(spend.toFixed(2)),
      synced_at: new Date().toISOString(),
    });
  }
}
console.log(`[gads-sync] contas ok=${okCount} falhas=${failCount}; ${upserts.length} linhas dia×conta`);

// 4) Upsert no Supabase em lotes
let saved = 0;
for (let i = 0; i < upserts.length; i += 500) {
  const batch = upserts.slice(i, i + 500);
  const r = await fetch(`${SUPA_URL}/rest/v1/google_ads_spend?on_conflict=account_id,date`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(batch),
  });
  if (!r.ok) {
    const t = await r.text();
    if (t.includes('42P01') || t.includes('does not exist') || t.includes('PGRST205') || t.includes('Could not find the table')) {
      console.error('\nTABELA google_ads_spend NAO EXISTE. Rode db/google_ads_spend.sql no SQL Editor do Supabase e execute o sync de novo.');
      process.exit(2);
    }
    console.error('[gads-sync] upsert falhou:', t.slice(0, 300));
    process.exit(1);
  }
  saved += batch.length;
}
console.log(`[gads-sync] OK — ${saved} linhas gravadas em google_ads_spend`);

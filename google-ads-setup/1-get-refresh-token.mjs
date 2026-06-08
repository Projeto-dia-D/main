// ===========================================================================
// PASSO 1 — Captura o REFRESH TOKEN do Google Ads (via login OAuth).
// ---------------------------------------------------------------------------
// Rode na raiz do projeto:   node google-ads-setup/1-get-refresh-token.mjs
//
// PRÉ-REQUISITO (uma vez, no Google Cloud Console):
//   APIs e serviços → Credenciais → seu OAuth Client ID →
//     Em "URIs de redirecionamento autorizados", adicione:  http://localhost:5180/
//   (Se o client for do tipo "App para computador/Desktop", o loopback já é
//    aceito sem precisar cadastrar.)
//   Garanta também que sua conta Google está como "usuário de teste" na tela
//   de consentimento (ou publique o app), senão o login é bloqueado.
//
// O script sobe um servidor local só pra receber o "code" do Google, troca
// pelo refresh token e imprime no terminal. Nada sai da sua máquina além da
// chamada oficial ao Google.
// ===========================================================================
import http from 'node:http';
import { exec } from 'node:child_process';
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
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Faltam VITE_ID_GOOGLE / VITE_CHAVE_API_GOOGLE no .env');
  process.exit(1);
}

const PORT = 5180;
const REDIRECT = `http://localhost:${PORT}/`;
const SCOPE = 'https://www.googleapis.com/auth/adwords';

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline', // necessário pra vir refresh_token
  prompt: 'consent',      // força refresh_token mesmo se já autorizou antes
}).toString();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }

  const err = u.searchParams.get('error');
  if (err) {
    res.end('Erro no consentimento: ' + err);
    console.error('❌ Erro no consentimento:', err);
    server.close(); process.exit(1);
  }
  const code = u.searchParams.get('code');
  if (!code) { res.writeHead(400); res.end('Sem code na URL.'); return; }

  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT,
        grant_type: 'authorization_code',
      }).toString(),
    });
    const tok = await r.json();

    if (!tok.refresh_token) {
      res.end('<h1>Veio SEM refresh_token.</h1><p>Acesse https://myaccount.google.com/permissions, remova o acesso deste app e rode o script de novo.</p>');
      console.error('\n❌ Resposta sem refresh_token:', tok);
      console.error('Dica: remova o app em https://myaccount.google.com/permissions e rode de novo.');
      server.close(); process.exit(1);
    }

    res.end('<h1>✅ Pronto! Refresh token capturado.</h1><p>Pode fechar esta aba e voltar ao terminal.</p>');
    console.log('\n========================================');
    console.log('✅ REFRESH TOKEN:');
    console.log(tok.refresh_token);
    console.log('========================================');
    console.log('\n👉 Adicione esta linha no .env (SEM o prefixo VITE_, é segredo de servidor):');
    console.log('GOOGLE_ADS_REFRESH_TOKEN=' + tok.refresh_token + '\n');
    server.close(); process.exit(0);
  } catch (e) {
    res.end('Falha ao trocar code por token: ' + e.message);
    console.error('❌', e);
    server.close(); process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('Servidor de callback ouvindo em ' + REDIRECT);
  console.log('\nSe o navegador não abrir sozinho, copie e cole esta URL nele');
  console.log('(faça login na conta Google que tem acesso ao Google Ads):\n');
  console.log(authUrl + '\n');
  exec('start "" "' + authUrl + '"', { shell: 'cmd.exe' }, () => {});
});

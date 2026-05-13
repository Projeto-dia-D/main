// Configuração centralizada — todas as variáveis vêm do .env
// Renomeie .env.example para .env e preencha os valores.

const env = import.meta.env;

// Trim defensivo: remove espaços, aspas e CRLF que podem ter sido coladas no .env
function clean(v: string | undefined): string {
  if (!v) return '';
  return v.replace(/^\s*["']?|["']?\s*$/g, '').trim();
}

function normalizeActId(id: string | undefined): string {
  const t = clean(id);
  if (!t) return '';
  return t.startsWith('act_') ? t : `act_${t}`;
}

export type GestorName = 'Renan' | 'Weslei' | 'André';

export interface MetaAccount {
  gestor: GestorName;
  token: string;
  accountId: string;
}

export const config = {
  SUPABASE_URL: clean(env.VITE_SUPABASE_URL),
  SUPABASE_SERVICE_ROLE_SECRET: clean(env.VITE_SUPABASE_SERVICE_ROLE_SECRET),
  UAZAPI_URL: clean(env.VITE_UAZAPI_URL).replace(/\/$/, ''),
  UAZAPI_TOKEN: clean(env.VITE_UAZAPI_TOKEN),

  META_ACCOUNTS: [
    {
      gestor: 'Renan',
      token: clean(env.VITE_META_TOKEN_RENAN),
      accountId: normalizeActId(env.VITE_META_ACCOUNT_RENAN),
    },
    {
      gestor: 'Weslei',
      token: clean(env.VITE_META_TOKEN_WESLEI),
      accountId: normalizeActId(env.VITE_META_ACCOUNT_WESLEI),
    },
    {
      gestor: 'André',
      // Aceita as duas grafias por robustez: VITE_META_TOKEN_ANDRE (sem acento, recomendado)
      // ou VITE_META_TOKEN_ANDRÉ (com acento).
      token: clean(
        env.VITE_META_TOKEN_ANDRE ||
          (env as Record<string, string | undefined>).VITE_META_TOKEN_ANDRÉ
      ),
      accountId: normalizeActId(
        env.VITE_META_ACCOUNT_ANDRE ||
          (env as Record<string, string | undefined>).VITE_META_ACCOUNT_ANDRÉ
      ),
    },
  ] as MetaAccount[],

  MONDAY_TOKEN: clean(env.VITE_MONDAY_TOKEN),
  MONDAY_BOARD_ID: clean(env.VITE_MONDAY_BOARD_ID),
};

// Gestores que NÃO estão mais como gestor de tráfego — filtrados em todos
// os pontos onde aparecem nomes vindos do Monday.
//   - roberta: saiu da empresa
//   - andrei: virou empacotador (não faz mais parte da equipe de tráfego)
// Obs: 'andrei' ≠ 'André' (com acento) — não conflita com a conta Meta do André.
export const GESTORES_EXCLUIDOS = ['roberta', 'andrei'];

export function isGestorExcluido(nome: string | null | undefined): boolean {
  if (!nome) return false;
  const n = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  return GESTORES_EXCLUIDOS.some((g) => n === g || n.includes(g));
}

// Fingerprint do token (primeiros 6 chars + tamanho) pra diagnóstico no UI.
// Não expõe o token completo.
export function tokenFingerprint(token: string): string {
  if (!token) return '(vazio)';
  const head = token.slice(0, 6);
  return `${head}… (${token.length} chars)`;
}

export function assertConfig(): string[] {
  const missing: string[] = [];
  if (!config.SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
  if (!config.SUPABASE_SERVICE_ROLE_SECRET) missing.push('VITE_SUPABASE_SERVICE_ROLE_SECRET');
  if (!config.UAZAPI_URL) missing.push('VITE_UAZAPI_URL');
  if (!config.UAZAPI_TOKEN) missing.push('VITE_UAZAPI_TOKEN');
  return missing;
}

export function assertGestorConfig(): string[] {
  const missing: string[] = [];
  const hasAnyToken = config.META_ACCOUNTS.some((a) => a.token);
  if (!hasAnyToken) {
    missing.push('VITE_META_TOKEN_RENAN, VITE_META_TOKEN_WESLEI ou VITE_META_TOKEN_ANDRE');
  }
  if (!config.MONDAY_TOKEN) missing.push('VITE_MONDAY_TOKEN');
  if (!config.MONDAY_BOARD_ID) missing.push('VITE_MONDAY_BOARD_ID');
  return missing;
}

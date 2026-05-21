// Auth: email + senha individual (criada no primeiro acesso, salva em
// public.user_passwords no Supabase como hash SHA-256 salgado pelo email).
// O escopo (CS, gestor, programador) é resolvido via Monday no login.

import { supabase } from './supabase';

export type UserRole =
  | 'admin'         // Renan, Vanessa — veem tudo
  | 'cs'            // CS — vê só seus clientes + média do setor
  | 'gestor'        // Gestor de tráfego — vê só seus clientes + média do setor
  | 'programador'   // Responsável de programação no Bia Soft
  | 'designer'      // Designer (Central de Design)
  | null;

export interface AuthUser {
  email: string;
  role: UserRole;
  /** Nome humano (ex: "Paula", "Maria", "Gabriel Velho dos Santos"). */
  displayName?: string;
  /** Identificador do escopo do usuário:
   *  - admin → null
   *  - cs    → nome do CS (ex: "Paula")
   *  - gestor → nome do gestor (ex: "Maria")
   *  - programador → nome do responsável (ex: "Gabriel Velho dos Santos") */
  scope?: string | null;
  /** Programadores como Gabriel e Eduardo veem TUDO mesmo sendo
   *  programadores (não admins). Esta flag é true quando o email está
   *  na lista SUPER_PROGRAMADOR_EMAILS. */
  viewAll?: boolean;
  /** URL da foto de perfil do Monday (campo photo_thumb). Pode ser null
   *  se o user não tem conta no workspace ou ainda não foi resolvido. */
  photoUrl?: string | null;
}

const STORAGE_KEY = 'auth:user:v1';

// ============================================================================
// Senhas: SHA-256(email + ':' + plain) → hex.
// O email serve de salt determinístico (não precisa de coluna salt).
// ============================================================================

const MIN_PASSWORD_LENGTH = 6;

/**
 * Hasher de senha. Usa Web Crypto (`crypto.subtle.digest`) quando disponível
 * (HTTPS/localhost), senão cai num SHA-256 em JS puro (pra rodar via IP da
 * rede local, ex: http://192.168.x.x:5173 no celular).
 *
 * Em ambos os casos o resultado é o mesmo hex de 64 chars — então pode trocar
 * de origem (HTTPS/IP local) sem invalidar a senha cadastrada.
 */
export async function hashPassword(email: string, plain: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${email.trim().toLowerCase()}:${plain}`);

  // 1. Tenta Web Crypto (rápido e nativo)
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return bytesToHex(new Uint8Array(buf));
    } catch {
      /* cai pro fallback */
    }
  }
  // 2. Fallback JS puro (funciona em qualquer contexto)
  return sha256Hex(data);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

// =========================================================================
// SHA-256 puro em JS — implementação compacta do FIPS 180-4.
// Usada como fallback quando `crypto.subtle` não tá disponível (HTTP simples
// em rede local, sem TLS). ~60 linhas, sem deps externas.
// =========================================================================
function sha256Hex(msg: Uint8Array): string {
  // Constantes K (primeiros 32 bits das raízes cúbicas dos 64 primeiros primos)
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);

  // Hash inicial H (primeiros 32 bits das raízes quadradas dos 8 primeiros primos)
  const H = new Uint32Array([
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
    0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
  ]);

  // Padding: mensagem + 0x80 + zeros + tamanho em bits (big-endian, 64 bits)
  const len = msg.length;
  const bitLen = len * 8;
  const padLen = (((len + 9) >>> 6) + 1) << 6; // próximo múltiplo de 64
  const padded = new Uint8Array(padLen);
  padded.set(msg);
  padded[len] = 0x80;
  // bitLen em big-endian nos últimos 8 bytes (assume < 2^32 bits → 4 bytes baixos)
  padded[padLen - 4] = (bitLen >>> 24) & 0xff;
  padded[padLen - 3] = (bitLen >>> 16) & 0xff;
  padded[padLen - 2] = (bitLen >>> 8) & 0xff;
  padded[padLen - 1] = bitLen & 0xff;

  const W = new Uint32Array(64);
  const ROTR = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let chunk = 0; chunk < padLen; chunk += 64) {
    // Carrega bloco de 64 bytes como 16 uint32 big-endian
    for (let i = 0; i < 16; i++) {
      W[i] = (padded[chunk + i*4] << 24)
           | (padded[chunk + i*4 + 1] << 16)
           | (padded[chunk + i*4 + 2] << 8)
           | (padded[chunk + i*4 + 3]);
      W[i] >>>= 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ROTR(W[i-15], 7) ^ ROTR(W[i-15], 18) ^ (W[i-15] >>> 3);
      const s1 = ROTR(W[i-2], 17) ^ ROTR(W[i-2], 19)  ^ (W[i-2]  >>> 10);
      W[i] = (W[i-16] + s0 + W[i-7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = [H[0], H[1], H[2], H[3], H[4], H[5], H[6], H[7]];
    for (let i = 0; i < 64; i++) {
      const S1 = ROTR(e, 6) ^ ROTR(e, 11) ^ ROTR(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = ROTR(a, 2) ^ ROTR(a, 13) ^ ROTR(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += H[i].toString(16).padStart(8, '0');
  }
  return hex;
}

/** Busca o hash salvo da senha do usuário. Retorna null quando ainda não criou. */
export async function fetchPasswordHash(email: string): Promise<string | null> {
  const e = normalizeEmail(email);
  if (!e) return null;
  const { data, error } = await supabase
    .from('user_passwords')
    .select('password_hash')
    .eq('email', e)
    .maybeSingle();
  if (error) {
    console.warn('[auth] fetchPasswordHash falhou:', error.message);
    return null;
  }
  return data?.password_hash ?? null;
}

/** Salva (upsert) hash da senha do usuário. */
export async function savePasswordHash(email: string, hash: string): Promise<{ error: string | null }> {
  const e = normalizeEmail(email);
  if (!e) return { error: 'Email inválido.' };
  const { error } = await supabase
    .from('user_passwords')
    .upsert(
      { email: e, password_hash: hash, updated_at: new Date().toISOString() },
      { onConflict: 'email' }
    );
  if (error) {
    console.warn('[auth] savePasswordHash falhou:', error.message);
    return { error: error.message };
  }
  return { error: null };
}

/** Valida regras mínimas de senha. Retorna msg de erro, ou null se OK. */
export function validatePassword(plain: string): string | null {
  if (!plain || plain.length < MIN_PASSWORD_LENGTH) {
    return `Senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  return null;
}

/** Emails ADMIN — veem tudo + ROLE label "Admin".
 *  Deve coincidir com os usuários marcados como 'admin' em
 *  TEAM_ROLES dentro de scripts/sync_monday_to_supabase.py.
 *
 *  Confirmado no Monday (/users):
 *    - Renan Rafaeli      → renan@burstmidia.com
 *    - Vanessa Rocha      → vanessarocha@burstmidia.com
 *    - Rone Matheus       → ronematheus@burstmidia.com
 *    - João Vitor Velho   → joaovitor@burstmidia.com
 *    - João Vitor Velho 2 → joaovitorvelho@burstmidia.com
 */
export const ADMIN_EMAILS = new Set<string>(
  [
    'renan@burstmidia.com',
    'vanessarocha@burstmidia.com',
    'ronematheus@burstmidia.com',
    'joaovitor@burstmidia.com',
    'joaovitorvelho@burstmidia.com',
  ].map((e) => e.toLowerCase())
);

/** Programadores que veem TUDO (sem filtro de scope), mas com role
 *  "programador" — não são admins. Mantém o label correto na header. */
export const SUPER_PROGRAMADOR_EMAILS = new Set<string>(
  [
    'gabrielvelho@burstmidia.com',
    'eduardohenckemaier@burstmidia.com',
  ].map((e) => e.toLowerCase())
);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function readCurrentUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as AuthUser;
    if (!u.email) return null;
    return u;
  } catch {
    return null;
  }
}

export function writeCurrentUser(user: AuthUser | null): void {
  try {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignora */
  }
}

/** Email → AuthUser resolvido. */
export interface MondayEmails {
  csByEmail: Map<string, string>;
  gestorByEmail: Map<string, string>;
  programadorByEmail: Map<string, string>;
  /** Designers do Central de Design (cruzado com workspace). */
  designerByEmail?: Map<string, string>;
  /** Opcional — quando presente, popula AuthUser.photoUrl */
  photoByEmail?: Map<string, string>;
  /** Workspace Monday: email → nome real do user. Usado como fallback quando
   *  o email do board Bia Soft está desatualizado (ex: app espera
   *  "ricardofronza@" mas o user real é "ricardo@"). */
  workspaceNameByEmail?: Map<string, string>;
}

/** Procura um user pelo NOME (que vem do workspace) em todos os maps de
 *  role do board Bia Soft. Usado quando o email exato não bate. */
function resolveByName(
  fullName: string,
  emails: MondayEmails
): { role: Exclude<UserRole, 'admin' | null>; scope: string } | null {
  const target = fullName.trim().toLowerCase();
  const firstName = target.split(/\s+/)[0];

  // Procura nos values dos maps (que são nomes)
  function match(map: Map<string, string>): string | null {
    for (const value of map.values()) {
      const v = value.trim().toLowerCase();
      if (v === target) return value;
      // Match parcial: primeiro nome bate
      const vFirst = v.split(/\s+/)[0];
      if (vFirst && firstName && vFirst === firstName) return value;
      // Ou se o nome do workspace contém o nome do board, ou vice-versa
      if (target.includes(v) || v.includes(target)) return value;
    }
    return null;
  }

  const cs = match(emails.csByEmail);
  if (cs) return { role: 'cs', scope: cs };
  const g = match(emails.gestorByEmail);
  if (g) return { role: 'gestor', scope: g };
  const p = match(emails.programadorByEmail);
  if (p) return { role: 'programador', scope: p };
  return null;
}

export function resolveUser(
  email: string,
  emails: MondayEmails
): AuthUser | null {
  const e = normalizeEmail(email);
  if (!e) return null;
  const photoUrl = emails.photoByEmail?.get(e) ?? null;
  const workspaceName = emails.workspaceNameByEmail?.get(e);

  // 1) Admin (hardcoded)
  if (ADMIN_EMAILS.has(e)) {
    return { email: e, role: 'admin', scope: null, displayName: friendlyAdminName(e), viewAll: true, photoUrl };
  }
  // 2) Super programador (hardcoded)
  if (SUPER_PROGRAMADOR_EMAILS.has(e)) {
    const scope =
      emails.programadorByEmail.get(e) ??
      // Fallback: procura pelo nome no workspace
      (workspaceName ? resolveByName(workspaceName, emails)?.scope ?? workspaceName : friendlyAdminName(e));
    return { email: e, role: 'programador', scope, displayName: scope, viewAll: true, photoUrl };
  }

  // 3) Match exato de email (board Bia Soft)
  const cs = emails.csByEmail.get(e);
  if (cs) return { email: e, role: 'cs', scope: cs, displayName: cs, photoUrl };
  const g = emails.gestorByEmail.get(e);
  if (g) return { email: e, role: 'gestor', scope: g, displayName: g, photoUrl };
  const p = emails.programadorByEmail.get(e);
  if (p) return { email: e, role: 'programador', scope: p, displayName: p, photoUrl };
  const dz = emails.designerByEmail?.get(e);
  if (dz) return { email: e, role: 'designer', scope: dz, displayName: dz, photoUrl };

  // 4) Fallback por nome do workspace
  //    Quando o email do board está desatualizado mas o user existe no
  //    workspace, conseguimos resolver via match de nome.
  if (workspaceName) {
    const byName = resolveByName(workspaceName, emails);
    if (byName) {
      return {
        email: e,
        role: byName.role,
        scope: byName.scope,
        displayName: byName.scope,
        photoUrl,
      };
    }
  }

  return null;
}

function friendlyAdminName(email: string): string {
  if (email.startsWith('gabriel')) return 'Gabriel Velho';
  if (email.startsWith('eduardo')) return 'Eduardo Henckemaier';
  if (email.startsWith('renan')) return 'Renan Rafaeli';
  if (email.startsWith('vanessa')) return 'Vanessa Rocha';
  return email;
}

export interface LoginAttemptResult {
  user: AuthUser | null;
  error: string | null;
}

/**
 * Verifica se o email está cadastrado no Monday (qualquer role válida)
 * e retorna o AuthUser resolvido. NÃO faz login ainda — só valida a
 * existência do email pra liberar o fluxo de "criar senha" ou "entrar".
 */
export function checkEmailRegistered(
  email: string,
  emails: MondayEmails
): { user: AuthUser | null; error: string | null } {
  const e = normalizeEmail(email);
  if (!e) return { user: null, error: 'Email inválido.' };
  const user = resolveUser(e, emails);
  if (!user) {
    return {
      user: null,
      error: 'Email não está cadastrado no Monday — verifique com seu gestor.',
    };
  }
  return { user, error: null };
}

/**
 * Verifica se o email está cadastrado consultando o SUPABASE direto
 * (tabela monday_auth_emails, populada pelo sync de 15 min).
 *
 * Vantagem: instantâneo (não espera Monday API carregar). Login
 * funciona mesmo sem cache local de emails.
 *
 * Admins (renan, vanessa) e Super programadores (gabriel, eduardo)
 * SEMPRE passam mesmo que não estejam na tabela.
 */
export async function checkEmailInSupabase(
  email: string
): Promise<{ user: AuthUser | null; error: string | null }> {
  const e = normalizeEmail(email);
  if (!e) return { user: null, error: 'Email inválido.' };

  // 1. Admin hardcoded — sempre passa
  if (ADMIN_EMAILS.has(e)) {
    return {
      user: {
        email: e,
        role: 'admin',
        scope: null,
        displayName: friendlyAdminName(e),
        viewAll: true,
        photoUrl: null,
      },
      error: null,
    };
  }
  // 2. Super programador hardcoded
  if (SUPER_PROGRAMADOR_EMAILS.has(e)) {
    return {
      user: {
        email: e,
        role: 'programador',
        scope: friendlyAdminName(e),
        displayName: friendlyAdminName(e),
        viewAll: true,
        photoUrl: null,
      },
      error: null,
    };
  }

  // 3. Consulta Supabase
  try {
    const { data, error } = await supabase
      .from('monday_auth_emails')
      .select('email, name, role')
      .eq('email', e)
      .maybeSingle();
    if (error) {
      console.warn('[auth] checkEmailInSupabase erro:', error.message);
      return {
        user: null,
        error: 'Erro consultando banco. Tente novamente.',
      };
    }
    if (!data) {
      return {
        user: null,
        error: 'Email não cadastrado. Verifique se digitou correto ou peça pro gestor.',
      };
    }
    return {
      user: {
        email: e,
        role: data.role as UserRole,
        scope: data.name,
        displayName: data.name,
        photoUrl: null,
      },
      error: null,
    };
  } catch (ex) {
    return {
      user: null,
      error: ex instanceof Error ? ex.message : 'Erro inesperado.',
    };
  }
}

/**
 * Tenta login com email + senha. Valida hash contra public.user_passwords.
 * Persiste o AuthUser no localStorage quando o login dá certo.
 */
export async function attemptLogin(
  email: string,
  password: string,
  emails: MondayEmails
): Promise<LoginAttemptResult> {
  const e = normalizeEmail(email);
  if (!e) return { user: null, error: 'Email inválido.' };

  const user = resolveUser(e, emails);
  if (!user) {
    return {
      user: null,
      error: 'Email não está cadastrado no Monday — verifique com seu gestor.',
    };
  }

  const savedHash = await fetchPasswordHash(e);
  if (!savedHash) {
    return {
      user: null,
      error: 'Você ainda não criou uma senha. Clique em "Criar senha" pra cadastrar.',
    };
  }
  const inputHash = await hashPassword(e, password);
  if (inputHash !== savedHash) {
    return { user: null, error: 'Senha incorreta.' };
  }
  writeCurrentUser(user);
  return { user, error: null };
}

/**
 * Versão "Supabase-first" do attemptLogin: recebe o AuthUser já resolvido
 * pelo checkEmailInSupabase. Não precisa de MondayEmails.
 */
export async function attemptLoginWithResolvedUser(
  email: string,
  password: string,
  resolvedUser: AuthUser
): Promise<LoginAttemptResult> {
  const e = normalizeEmail(email);
  if (!e) return { user: null, error: 'Email inválido.' };

  const savedHash = await fetchPasswordHash(e);
  if (!savedHash) {
    return {
      user: null,
      error: 'Você ainda não criou uma senha. Clique em "Criar senha" pra cadastrar.',
    };
  }
  const inputHash = await hashPassword(e, password);
  if (inputHash !== savedHash) {
    return { user: null, error: 'Senha incorreta.' };
  }
  writeCurrentUser(resolvedUser);
  return { user: resolvedUser, error: null };
}

/**
 * Versão "Supabase-first" do registerPassword: AuthUser já resolvido.
 */
export async function registerPasswordWithResolvedUser(
  email: string,
  password: string,
  resolvedUser: AuthUser
): Promise<LoginAttemptResult> {
  const e = normalizeEmail(email);
  if (!e) return { user: null, error: 'Email inválido.' };

  const valErr = validatePassword(password);
  if (valErr) return { user: null, error: valErr };

  const existing = await fetchPasswordHash(e);
  if (existing) {
    return {
      user: null,
      error: 'Esse email já tem senha cadastrada. Use "Entrar" ou peça reset ao admin.',
    };
  }

  const hash = await hashPassword(e, password);
  const { error } = await savePasswordHash(e, hash);
  if (error) {
    return { user: null, error: `Erro ao salvar senha: ${error}` };
  }
  writeCurrentUser(resolvedUser);
  return { user: resolvedUser, error: null };
}

/**
 * Cria a senha do usuário no banco. Valida primeiro se o email existe
 * no Monday e se ainda NÃO tem senha cadastrada (evita reset acidental
 * de senha alheia — quem quiser trocar usa outro fluxo no futuro).
 */
export async function registerPassword(
  email: string,
  password: string,
  emails: MondayEmails
): Promise<LoginAttemptResult> {
  const e = normalizeEmail(email);
  if (!e) return { user: null, error: 'Email inválido.' };

  const valErr = validatePassword(password);
  if (valErr) return { user: null, error: valErr };

  const user = resolveUser(e, emails);
  if (!user) {
    return {
      user: null,
      error: 'Email não está cadastrado no Monday — verifique com seu gestor.',
    };
  }

  // Bloqueia se já tem senha (evita reset acidental).
  const existing = await fetchPasswordHash(e);
  if (existing) {
    return {
      user: null,
      error: 'Esse email já tem senha cadastrada. Use "Entrar" ou peça reset ao admin.',
    };
  }

  const hash = await hashPassword(e, password);
  const { error } = await savePasswordHash(e, hash);
  if (error) {
    return { user: null, error: `Erro ao salvar senha: ${error}` };
  }
  writeCurrentUser(user);
  return { user, error: null };
}

export function logout(): void {
  writeCurrentUser(null);
}

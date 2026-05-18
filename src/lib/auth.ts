// Auth simples baseada em email + senha "123456".
// O escopo (CS, gestor, programador) é resolvido via Monday no login.

export type UserRole =
  | 'admin'         // Renan, Gabriel, Eduardo — veem tudo
  | 'cs'            // CS — vê só seus clientes + média do setor
  | 'gestor'        // Gestor de tráfego — vê só seus clientes + média do setor
  | 'programador'   // Responsável de programação no Bia Soft — vê só seus doutores
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
}

const STORAGE_KEY = 'auth:user:v1';
const DEFAULT_PASSWORD = '123456';

/** Emails que veem TUDO (sem filtro). */
export const ADMIN_EMAILS = new Set<string>(
  [
    'gabrielvelho@burstmidia.com',
    'eduardohenckemaier@burstmidia.com',
    'renanrafaeli@burstmidia.com',
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

/** Email → AuthUser resolvido. mondayEmails é o resultado de fetchUserEmails(). */
export interface MondayEmails {
  csByEmail: Map<string, string>;          // email → nome do CS
  gestorByEmail: Map<string, string>;      // email → nome do Gestor
  programadorByEmail: Map<string, string>; // email → nome do Responsavel (Bia Soft)
}

export function resolveUser(
  email: string,
  emails: MondayEmails
): AuthUser | null {
  const e = normalizeEmail(email);
  if (!e) return null;
  if (ADMIN_EMAILS.has(e)) {
    return { email: e, role: 'admin', scope: null, displayName: friendlyAdminName(e) };
  }
  const cs = emails.csByEmail.get(e);
  if (cs) return { email: e, role: 'cs', scope: cs, displayName: cs };
  const g = emails.gestorByEmail.get(e);
  if (g) return { email: e, role: 'gestor', scope: g, displayName: g };
  const p = emails.programadorByEmail.get(e);
  if (p) return { email: e, role: 'programador', scope: p, displayName: p };
  return null;
}

function friendlyAdminName(email: string): string {
  if (email.startsWith('gabriel')) return 'Gabriel Velho';
  if (email.startsWith('eduardo')) return 'Eduardo Henckemaier';
  if (email.startsWith('renan')) return 'Renan Rafaeli';
  return email;
}

export interface LoginAttemptResult {
  user: AuthUser | null;
  error: string | null;
}

export function attemptLogin(
  email: string,
  password: string,
  emails: MondayEmails
): LoginAttemptResult {
  if (password !== DEFAULT_PASSWORD) {
    return { user: null, error: 'Senha incorreta.' };
  }
  const user = resolveUser(email, emails);
  if (!user) {
    return {
      user: null,
      error: 'Email não está cadastrado no Monday — verifique com seu gestor.',
    };
  }
  writeCurrentUser(user);
  return { user, error: null };
}

export function logout(): void {
  writeCurrentUser(null);
}

// Auth simples baseada em email + senha "123456".
// O escopo (CS, gestor, programador) é resolvido via Monday no login.

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
const DEFAULT_PASSWORD = '123456';

/** Emails ADMIN — veem tudo + ROLE label "Admin". */
export const ADMIN_EMAILS = new Set<string>(
  [
    'renanrafaeli@burstmidia.com',
    'vanessarocha@burstmidia.com',
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

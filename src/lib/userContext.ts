import { createContext, useContext } from 'react';
import type { AuthUser } from './auth';

/** Contexto do usuário logado. `null` significa ainda não logado (não deveria
 *  acontecer dentro das tabs porque App.tsx mostra o Login antes). */
export const UserContext = createContext<AuthUser | null>(null);

export function useUser(): AuthUser {
  const u = useContext(UserContext);
  if (!u) {
    throw new Error(
      '[useUser] chamado fora de UserContext.Provider — usuário não está logado'
    );
  }
  return u;
}

/** Helpers de papel — facilitam ler condicionais nos componentes. */
export function isAdmin(u: AuthUser): boolean {
  return u.role === 'admin';
}
export function isCs(u: AuthUser): boolean {
  return u.role === 'cs';
}
export function isGestor(u: AuthUser): boolean {
  return u.role === 'gestor';
}
export function isProgramador(u: AuthUser): boolean {
  return u.role === 'programador';
}

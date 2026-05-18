import { useCallback, useEffect, useState } from 'react';
import {
  readCurrentUser,
  writeCurrentUser,
  attemptLogin,
  type AuthUser,
  type MondayEmails,
} from '../lib/auth';

export interface UseAuthResult {
  user: AuthUser | null;
  loading: boolean; // true enquanto não temos os dados do Monday p/ resolver email
  login: (email: string, password: string) => { ok: boolean; error: string | null };
  logout: () => void;
  /** Re-resolve o usuário atual com base nos novos emails do Monday.
   *  Útil quando alguém foi adicionado/removido no Monday enquanto a sessão estava aberta. */
  refreshUser: () => void;
}

export function useAuth(emails: MondayEmails | null): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(() => readCurrentUser());

  // Quando o usuário muda de função no Monday (ex: virou admin), a sessão é
  // atualizada na próxima carga de dados (a cada 10 min via useMondayClients).
  useEffect(() => {
    if (!emails || !user) return;
    // Mantém a sessão como está; se quiser refresh automático, descomente:
    // const refreshed = resolveUser(user.email, emails);
    // if (refreshed && JSON.stringify(refreshed) !== JSON.stringify(user)) setUser(refreshed);
  }, [emails, user]);

  const login = useCallback(
    (email: string, password: string) => {
      if (!emails) {
        return {
          ok: false,
          error: 'Aguarde, ainda carregando dados de usuários do Monday...',
        };
      }
      const { user: u, error } = attemptLogin(email, password, emails);
      if (u) setUser(u);
      return { ok: !!u, error };
    },
    [emails]
  );

  const logout = useCallback(() => {
    writeCurrentUser(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(() => {
    setUser(readCurrentUser());
  }, []);

  return { user, loading: emails === null, login, logout, refreshUser };
}

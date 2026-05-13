import { useCallback, useState } from 'react';
import { fetchAdAccountsByGestor, type AdAccountInfo, type GestorName } from '../lib/meta';
import { errorMessage } from '../lib/errors';

// Cache compartilhado entre instâncias do hook — sobrevive a remount enquanto
// a aba estiver aberta. F5 limpa.
const cache = new Map<GestorName, AdAccountInfo[]>();

export interface UseAdAccountsForGestorResult {
  accountsByGestor: Record<string, AdAccountInfo[]>;
  loading: Record<string, boolean>;
  errors: Record<string, string>;
  loadedGestores: GestorName[];
  load: (gestor: GestorName, force?: boolean) => Promise<void>;
  clearCache: (gestor?: GestorName) => void;
  // Lista achatada de todas as contas já carregadas (qualquer gestor)
  allAccounts: AdAccountInfo[];
}

export function useAdAccountsForGestor(): UseAdAccountsForGestorResult {
  const [accountsByGestor, setAccountsByGestor] = useState<Record<string, AdAccountInfo[]>>(
    () => Object.fromEntries(Array.from(cache.entries()))
  );
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async (gestor: GestorName, force = false) => {
    if (!force && cache.has(gestor)) {
      setAccountsByGestor((p) => ({ ...p, [gestor]: cache.get(gestor)! }));
      return;
    }
    setLoading((p) => ({ ...p, [gestor]: true }));
    setErrors((p) => {
      const c = { ...p };
      delete c[gestor];
      return c;
    });
    try {
      const accs = await fetchAdAccountsByGestor(gestor);
      cache.set(gestor, accs);
      setAccountsByGestor((p) => ({ ...p, [gestor]: accs }));
    } catch (e) {
      setErrors((p) => ({ ...p, [gestor]: errorMessage(e) }));
    } finally {
      setLoading((p) => ({ ...p, [gestor]: false }));
    }
  }, []);

  const clearCache = useCallback((gestor?: GestorName) => {
    if (gestor) {
      cache.delete(gestor);
      setAccountsByGestor((p) => {
        const c = { ...p };
        delete c[gestor];
        return c;
      });
    } else {
      cache.clear();
      setAccountsByGestor({});
    }
  }, []);

  const loadedGestores = Object.keys(accountsByGestor) as GestorName[];
  const allAccounts = loadedGestores.flatMap((g) => accountsByGestor[g] ?? []);

  return {
    accountsByGestor,
    loading,
    errors,
    loadedGestores,
    load,
    clearCache,
    allAccounts,
  };
}

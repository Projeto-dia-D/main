import { useEffect, useState } from 'react';
import {
  fetchMondayClients,
  fetchBiaSoftClientNames,
  isClientNoBiaSoft,
  type MondayClient,
} from '../lib/monday';

export interface UseMondayClientsResult {
  clients: MondayClient[];      // já filtrados pelos que têm Bia
  allClients: MondayClient[];   // raw, sem filtro de Bia
  biaNames: Set<string>;        // nomes que estão no board Bia Soft
  loading: boolean;
  error: string | null;
  lastUpdate: Date | null;
}

const REFRESH_MS = 1000 * 60 * 2; // 2 min — mudanças no Monday aparecem rapidamente

export function useMondayClients(): UseMondayClientsResult {
  const [clients, setClients] = useState<MondayClient[]>([]);
  const [allClients, setAllClients] = useState<MondayClient[]>([]);
  const [biaNames, setBiaNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        // Roda em paralelo: board principal + lista de clientes Bia Soft
        const [mainResult, names] = await Promise.all([
          fetchMondayClients(),
          fetchBiaSoftClientNames(),
        ]);
        if (!active) return;
        const filtered = mainResult.clients.filter((c) => isClientNoBiaSoft(c, names));
        setAllClients(mainResult.clients);
        setClients(filtered);
        setBiaNames(names);
        setError(null);
        setLastUpdate(new Date());
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  return { clients, allClients, biaNames, loading, error, lastUpdate };
}

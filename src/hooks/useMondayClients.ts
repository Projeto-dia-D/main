import { useEffect, useState } from 'react';
import { fetchMondayClients, type MondayClient } from '../lib/monday';

export interface UseMondayClientsResult {
  clients: MondayClient[];
  loading: boolean;
  error: string | null;
  lastUpdate: Date | null;
}

const REFRESH_MS = 1000 * 60 * 2; // 2 min — mudanças no Monday aparecem rapidamente

export function useMondayClients(): UseMondayClientsResult {
  const [clients, setClients] = useState<MondayClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const { clients: rows } = await fetchMondayClients();
        if (!active) return;
        setClients(rows);
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

  return { clients, loading, error, lastUpdate };
}

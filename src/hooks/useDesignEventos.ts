import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DesignEvento } from '../lib/designMetrics';
import { errorMessage, isMissingTableError } from '../lib/errors';
import { readCacheWithMeta, writeCache } from '../lib/cache';

const TABLE = 'design_demandas';
const POLL_MS = 1000 * 60 * 2; // 2 min — eventos são event-driven; polling é só safety net
const PAGE_SIZE = 1000;
const CACHE_KEY = 'design:eventos:v1';

export interface UseDesignEventosResult {
  eventos: DesignEvento[];
  loading: boolean;
  error: string | null;
  missingTable: boolean;
  lastUpdate: Date | null;
}

interface CachedEventos {
  eventos: DesignEvento[];
}

async function fetchAll(): Promise<DesignEvento[]> {
  const all: DesignEvento[] = [];
  let from = 0;
  for (let page = 0; page < 30; page++) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('imported_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as DesignEvento[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export function useDesignEventos(): UseDesignEventosResult {
  // Lê cache imediatamente → tela renderiza com dados sem esperar fetch.
  const cached = readCacheWithMeta<CachedEventos>(CACHE_KEY);
  const initialEventos = cached?.value.eventos ?? [];
  const initialUpdate = cached ? new Date(cached.savedAt) : null;

  const [eventos, setEventos] = useState<DesignEvento[]>(initialEventos);
  // Só fica "loading" se não temos cache pra mostrar — caso contrário UI já renderiza
  const [loading, setLoading] = useState(initialEventos.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [missingTable, setMissingTable] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(initialUpdate);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;

    async function refresh() {
      try {
        const rows = await fetchAll();
        if (!activeRef.current) return;
        // Skip re-set quando lista é exatamente igual — evita re-computação
        // pesada (buildEventosPorCliente é O(events) e roda a cada change).
        setEventos((prev) => {
          if (prev.length === rows.length && prev.length > 0) {
            const firstSame = prev[0]?.id === rows[0]?.id;
            const lastSame = prev[prev.length - 1]?.id === rows[rows.length - 1]?.id;
            if (firstSame && lastSame) return prev;
          }
          return rows;
        });
        setLastUpdate(new Date());
        setError(null);
        setMissingTable(false);
        writeCache<CachedEventos>(CACHE_KEY, { eventos: rows });
      } catch (e) {
        if (!activeRef.current) return;
        if (isMissingTableError(e)) {
          setMissingTable(true);
          setError(null);
        } else {
          setError(errorMessage(e));
          setMissingTable(false);
        }
      }
    }

    refresh().finally(() => {
      if (activeRef.current) setLoading(false);
    });

    const timer = setInterval(refresh, POLL_MS);

    const channel = supabase
      .channel(`design_demandas_rt_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: TABLE },
        () => {
          if (activeRef.current) refresh();
        }
      )
      .subscribe();

    return () => {
      activeRef.current = false;
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  return { eventos, loading, error, missingTable, lastUpdate };
}

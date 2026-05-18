import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DesignEvento } from '../lib/designMetrics';
import { errorMessage, isMissingTableError } from '../lib/errors';

const TABLE = 'design_demandas';
const POLL_MS = 1000 * 60 * 2; // 2 min — eventos são event-driven; polling é só safety net
const PAGE_SIZE = 1000;

export interface UseDesignEventosResult {
  eventos: DesignEvento[];
  loading: boolean;
  error: string | null;
  missingTable: boolean;
  lastUpdate: Date | null;
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
  const [eventos, setEventos] = useState<DesignEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingTable, setMissingTable] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;

    async function refresh() {
      try {
        const rows = await fetchAll();
        if (!activeRef.current) return;
        setEventos(rows);
        setLastUpdate(new Date());
        setError(null);
        setMissingTable(false);
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

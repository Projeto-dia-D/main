import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  ATESTADOS_TABLE,
  fetchAllAtestados,
  addAtestado as addRow,
  removeAtestado as removeRow,
  type Atestado,
} from '../lib/atestados';
import { errorMessage, isMissingTableError } from '../lib/errors';

export interface UseAtestadosResult {
  atestados: Atestado[];
  loading: boolean;
  error: string | null;
  missingTable: boolean;
  add: (designer: string, data_inicio: string, data_fim: string, motivo?: string | null) => Promise<void>;
  remove: (id: number) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAtestados(): UseAtestadosResult {
  const [atestados, setAtestados] = useState<Atestado[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingTable, setMissingTable] = useState(false);
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const rows = await fetchAllAtestados();
      if (!activeRef.current) return;
      setAtestados(rows);
      setError(null);
      setMissingTable(false);
    } catch (e) {
      if (!activeRef.current) return;
      if (isMissingTableError(e)) {
        setMissingTable(true);
        setError(null);
      } else {
        setError(errorMessage(e));
      }
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    refresh().finally(() => {
      if (activeRef.current) setLoading(false);
    });

    const channel = supabase
      .channel(`atestados_rt_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: ATESTADOS_TABLE }, () => {
        if (activeRef.current) refresh();
      })
      .subscribe();

    return () => {
      activeRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const add = useCallback(
    async (designer: string, data_inicio: string, data_fim: string, motivo?: string | null) => {
      const novo = await addRow(designer, data_inicio, data_fim, motivo ?? null);
      setAtestados((prev) => [novo, ...prev]);
    },
    [],
  );

  const remove = useCallback(async (id: number) => {
    await removeRow(id);
    setAtestados((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { atestados, loading, error, missingTable, add, remove, refresh };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  HOLIDAYS_TABLE,
  fetchAllHolidays,
  addHoliday as addRow,
  removeHoliday as removeRow,
  type Holiday,
} from '../lib/holidays';
import { errorMessage, isMissingTableError } from '../lib/errors';

export interface UseHolidaysResult {
  holidays: Holiday[];
  dateSet: Set<string>;             // YYYY-MM-DD pra lookup rápido
  loading: boolean;
  error: string | null;
  missingTable: boolean;
  add: (date: string, name: string) => Promise<void>;
  remove: (date: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useHolidays(): UseHolidaysResult {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingTable, setMissingTable] = useState(false);
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const rows = await fetchAllHolidays();
      if (!activeRef.current) return;
      setHolidays(rows);
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
      .channel(`holidays_rt_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: HOLIDAYS_TABLE }, () => {
        if (activeRef.current) refresh();
      })
      .subscribe();

    return () => {
      activeRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const add = useCallback(async (date: string, name: string) => {
    await addRow(date, name, 'custom');
    setHolidays((prev) => {
      const filtered = prev.filter((h) => h.date !== date);
      const novo: Holiday = { date, name, source: 'custom', created_at: new Date().toISOString() };
      return [...filtered, novo].sort((a, b) => a.date.localeCompare(b.date));
    });
  }, []);

  const remove = useCallback(async (date: string) => {
    await removeRow(date);
    setHolidays((prev) => prev.filter((h) => h.date !== date));
  }, []);

  const dateSet = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);

  return { holidays, dateSet, loading, error, missingTable, add, remove, refresh };
}

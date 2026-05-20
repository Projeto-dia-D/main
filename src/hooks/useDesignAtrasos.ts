import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { readCacheWithMeta, writeCache } from '../lib/cache';

export interface DesignAtraso {
  monday_item_id: string;
  nome: string;
  designer: string | null;
  status_designer: string | null;
  tipo_atraso: string | null;
  prioridade: string | null;
  dias_atrasado: number | null;
  cronograma_inicio: string | null;
  cronograma_fim: string | null;
  log_criacao: string | null;
}

export interface UseDesignAtrasosResult {
  atrasos: DesignAtraso[];
  loading: boolean;
  error: string | null;
}

const CACHE_KEY = 'design_atrasos:v1';

/**
 * Lê a tabela `design_atrasos` do Supabase (populada por import do board
 * "⌚ Atrasos do Design" do Monday). Subscribe realtime pra sincronizar
 * com mudanças.
 */
export function useDesignAtrasos(): UseDesignAtrasosResult {
  const cachedMeta = readCacheWithMeta<DesignAtraso[]>(CACHE_KEY);
  const cached = cachedMeta?.value ?? [];
  const [atrasos, setAtrasos] = useState<DesignAtraso[]>(cached);
  const [loading, setLoading] = useState(cached.length === 0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data, error } = await supabase
        .from('design_atrasos')
        .select('*')
        .order('dias_atrasado', { ascending: false });
      if (!active) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      const list = (data ?? []) as DesignAtraso[];
      // Skip re-set quando lista não mudou (evita re-render + recomputação)
      setAtrasos((prev) => {
        if (prev.length === list.length && prev.length > 0) {
          const firstSame = prev[0]?.monday_item_id === list[0]?.monday_item_id;
          const lastSame = prev[prev.length - 1]?.monday_item_id === list[list.length - 1]?.monday_item_id;
          if (firstSame && lastSame) return prev;
        }
        return list;
      });
      writeCache(CACHE_KEY, list);
      setError(null);
      setLoading(false);
    }
    load();

    const channel = supabase
      .channel('design_atrasos_rt_' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'design_atrasos' }, () => {
        if (active) load();
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return { atrasos, loading, error };
}

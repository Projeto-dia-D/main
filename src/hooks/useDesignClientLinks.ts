import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DesignClientLinks } from '../lib/monday';
import { readCacheWithMeta, writeCache } from '../lib/cache';

/**
 * Hook que retorna o mapa `monday_item_id (demanda/atraso) → monday_client_id[]`
 * cruzado pelas boards do Design via a coluna board_relation "👥 Clientes".
 *
 * LÊ DO SUPABASE (tabela monday_design_demanda_links), mantida atualizada pelo
 * script Python `scripts/sync_monday_to_supabase.py`.
 *
 * Usado pra casar demandas e atrasos com clientes 100% por ID — eliminando
 * fuzzy match no nome (que estava trazendo demandas erradas, ex: Dr. Breno
 * com 648 dias de relacionamento porque casou com demanda de outro cliente).
 *
 * REGRA CRÍTICA: Monday é READ-ONLY. Esse hook NÃO consulta o Monday — só
 * lê do Supabase + escuta realtime.
 */
export interface UseDesignClientLinksResult {
  /** Map<monday_item_id (da demanda), Set<monday_client_id>>. Vazio enquanto carrega. */
  links: DesignClientLinks;
  loading: boolean;
  error: string | null;
  lastUpdate: Date | null;
}

const CACHE_KEY = 'supa:designClientLinks:v1';
const POLL_MS = 1000 * 60 * 5; // 5 min — links mudam pouco; realtime cobre o resto

interface CachedShape {
  entries: [string, string[]][];
}

interface LinkRow {
  pulse_id: string;
  board_id: string;
  monday_client_ids: string[];
}

const PAGE_SIZE = 1000;

async function fetchAllLinks(): Promise<DesignClientLinks> {
  const out: DesignClientLinks = new Map();
  let from = 0;
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from('monday_design_demanda_links')
      .select('pulse_id, monday_client_ids')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as LinkRow[]) {
      const ids = r.monday_client_ids ?? [];
      if (ids.length === 0) continue;
      out.set(r.pulse_id, new Set(ids));
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

export function useDesignClientLinks(): UseDesignClientLinksResult {
  const cached = readCacheWithMeta<CachedShape>(CACHE_KEY);
  const initial: DesignClientLinks = new Map();
  if (cached) {
    for (const [k, arr] of cached.value.entries) {
      initial.set(k, new Set(arr));
    }
  }

  const [links, setLinks] = useState<DesignClientLinks>(initial);
  const [loading, setLoading] = useState(initial.size === 0);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(
    cached ? new Date(cached.savedAt) : null
  );
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;

    async function refresh() {
      try {
        const m = await fetchAllLinks();
        if (!activeRef.current) return;
        // Skip re-set quando tamanho não mudou (heurística simples — links mudam pouco)
        setLinks((prev) => {
          if (prev.size === m.size && prev.size > 0) return prev;
          return m;
        });
        setError(null);
        setLastUpdate(new Date());

        const entries: [string, string[]][] = [];
        for (const [k, set] of m) entries.push([k, Array.from(set)]);
        writeCache<CachedShape>(CACHE_KEY, { entries });
      } catch (e) {
        if (!activeRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (activeRef.current) setLoading(false);
      }
    }

    refresh();
    const timer = setInterval(refresh, POLL_MS);

    const channel = supabase
      .channel(`md_dl_rt_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'monday_design_demanda_links' },
        () => { if (activeRef.current) refresh(); }
      )
      .subscribe();

    return () => {
      activeRef.current = false;
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  return { links, loading, error, lastUpdate };
}

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { readCacheWithMeta, writeCache } from '../lib/cache';

/**
 * Hook que lê `monday_item_updates` do Supabase.
 *
 * Updates são comentários do Monday em items (otimizações + demandas). Aparecem
 * inline na timeline da Saúde do Cliente quando estão associados a um evento
 * (mesmo `pulse_id`).
 *
 * Sincronizado pelo script Python (scripts/sync_monday_to_supabase.py) no
 * slow window (1×/hora). REGRA CRÍTICA: Monday é READ-ONLY.
 */
export interface ItemUpdate {
  updateId: string;
  pulseId: string;
  boardId: string;
  text: string;
  creatorName: string | null;
  createdAt: string;
}

export interface UseItemUpdatesResult {
  /** Map<pulse_id, ItemUpdate[]> — updates agrupados por item. */
  updatesByPulseId: Map<string, ItemUpdate[]>;
  loading: boolean;
  error: string | null;
}

const CACHE_KEY = 'supa:itemUpdates:v1';
const POLL_MS = 1000 * 60 * 5; // 5 min — realtime cobre o resto
const PAGE_SIZE = 1000;

interface CachedShape {
  entries: [string, ItemUpdate[]][];
}

interface UpdateRow {
  update_id: string;
  pulse_id: string;
  board_id: string;
  text_body: string | null;
  creator_name: string | null;
  created_at: string;
}

async function fetchAllUpdates(): Promise<Map<string, ItemUpdate[]>> {
  const out = new Map<string, ItemUpdate[]>();
  let from = 0;
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from('monday_item_updates')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as UpdateRow[]) {
      const arr = out.get(r.pulse_id) ?? [];
      arr.push({
        updateId: r.update_id,
        pulseId: r.pulse_id,
        boardId: r.board_id,
        text: r.text_body ?? '',
        creatorName: r.creator_name,
        createdAt: r.created_at,
      });
      out.set(r.pulse_id, arr);
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

/**
 * @param enabled Quando false (default), só lê do cache localStorage — não
 *                dispara fetch. Use enabled=true só quando entrar num
 *                perfil específico de cliente (Saúde > selecionado).
 */
export function useItemUpdates(enabled: boolean = false): UseItemUpdatesResult {
  const cached = readCacheWithMeta<CachedShape>(CACHE_KEY);
  const initial = new Map<string, ItemUpdate[]>(cached?.value.entries ?? []);

  const [updatesByPulseId, setUpdatesByPulseId] = useState<Map<string, ItemUpdate[]>>(initial);
  const [loading, setLoading] = useState(enabled && initial.size === 0);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    if (!enabled) {
      setLoading(false);
      return;
    }

    async function refresh() {
      try {
        const m = await fetchAllUpdates();
        if (!activeRef.current) return;
        setUpdatesByPulseId((prev) => {
          if (prev.size === m.size && prev.size > 0) return prev;
          return m;
        });
        setError(null);
        const entries: [string, ItemUpdate[]][] = [];
        for (const [k, arr] of m) entries.push([k, arr]);
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
      .channel(`md_updates_rt_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monday_item_updates' }, () => {
        if (activeRef.current) refresh();
      })
      .subscribe();

    return () => {
      activeRef.current = false;
      if (timer) clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [enabled]);

  return { updatesByPulseId, loading, error };
}

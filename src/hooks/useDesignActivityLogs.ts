import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { BoardActivityEvent } from '../lib/monday';
import { readCacheWithMeta, writeCache } from '../lib/cache';

/**
 * Hook que lê activity_logs do Design DO SUPABASE (tabela monday_design_activity).
 *
 * O script Python `scripts/sync_monday_to_supabase.py` (rodando a cada 15 min)
 * é quem mantém essa tabela atualizada — esse hook só LÊ + escuta realtime.
 *
 * Eventos capturados:
 *  - Mudanças de "Status da Tarefa" (vira Aprovado, Atrasado, etc.)
 *  - Mudanças de "Status do Designer" (vira Em criação, Feito, etc.)
 *  - Mudanças de "Status Principal" / "Status Individual" (manutenções)
 *
 * REGRA CRÍTICA: Monday é READ-ONLY. Esse hook NÃO escreve no Monday — só
 * lê de uma tabela Supabase que o sync Python mantém.
 */
export interface UseDesignActivityLogsResult {
  /** Activity events lidos do Supabase. */
  events: BoardActivityEvent[];
  /** Map<monday_item_id, ISO_created_at> — quando cada demanda foi criada. */
  createdAtByItemId: Map<string, string>;
  loading: boolean;
  error: string | null;
  lastUpdate: Date | null;
}

const CACHE_KEY = 'supa:designActivity:v1';
const POLL_MS = 1000 * 60 * 2; // 2 min — realtime cobre tudo; isso é só safety net

interface CachedShape {
  events: BoardActivityEvent[];
  createdAt: [string, string][];
}

interface ActivityRow {
  log_id: string;
  board_id: string;
  pulse_id: string;
  pulse_name: string | null;
  column_id: string;
  prev_label: string | null;
  next_label: string | null;
  ts: string;
  user_id: string | null;
}

interface ItemRow {
  pulse_id: string;
  board_id: string;
  created_at: string;
}

const PAGE_SIZE = 1000;

async function fetchAllActivity(): Promise<BoardActivityEvent[]> {
  const all: BoardActivityEvent[] = [];
  let from = 0;
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from('monday_design_activity')
      .select('*')
      .order('ts', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as ActivityRow[]) {
      all.push({
        logId: r.log_id,
        boardId: r.board_id,
        pulseId: r.pulse_id,
        pulseName: r.pulse_name ?? '',
        columnId: r.column_id,
        prev: r.prev_label,
        next: r.next_label,
        ts: r.ts,
        userId: r.user_id,
      });
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function fetchAllItemsCreatedAt(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let from = 0;
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from('monday_design_items')
      .select('pulse_id, created_at')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as ItemRow[]) out.set(r.pulse_id, r.created_at);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

/**
 * @param enabled Quando false (default), só lê cache local — sem fetch.
 *                Use enabled=true quando entrar em perfil específico.
 */
export function useDesignActivityLogs(enabled: boolean = false): UseDesignActivityLogsResult {
  const cached = readCacheWithMeta<CachedShape>(CACHE_KEY);
  const initialEvents = cached?.value.events ?? [];
  const initialCreatedAt = new Map(cached?.value.createdAt ?? []);
  const initialUpdate = cached ? new Date(cached.savedAt) : null;

  const [events, setEvents] = useState<BoardActivityEvent[]>(initialEvents);
  const [createdAtByItemId, setCreatedAtByItemId] = useState<Map<string, string>>(initialCreatedAt);
  const [loading, setLoading] = useState(enabled && initialEvents.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(initialUpdate);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    if (!enabled) {
      setLoading(false);
      return;
    }

    async function refresh() {
      try {
        const [evs, created] = await Promise.all([
          fetchAllActivity(),
          fetchAllItemsCreatedAt(),
        ]);
        if (!activeRef.current) return;
        // Skip re-set quando lista não mudou (mesma quantidade + primeiro log igual)
        setEvents((prev) => {
          if (prev.length === evs.length && prev.length > 0 && prev[0]?.logId === evs[0]?.logId) {
            return prev;
          }
          return evs;
        });
        setCreatedAtByItemId(created);
        setError(null);
        setLastUpdate(new Date());

        writeCache<CachedShape>(CACHE_KEY, {
          events: evs,
          createdAt: Array.from(created.entries()),
        });
      } catch (e) {
        if (!activeRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (activeRef.current) setLoading(false);
      }
    }

    refresh();
    const timer = setInterval(refresh, POLL_MS);

    // Realtime — sync escreveu novos rows → frontend atualiza imediato
    const channel = supabase
      .channel(`md_activity_rt_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'monday_design_activity' },
        () => { if (activeRef.current) refresh(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'monday_design_items' },
        () => { if (activeRef.current) refresh(); }
      )
      .subscribe();

    return () => {
      activeRef.current = false;
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [enabled]);

  return { events, createdAtByItemId, loading, error, lastUpdate };
}

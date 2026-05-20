import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { readCacheWithMeta, writeCache } from '../lib/cache';

/**
 * Hook que lê eventos do board "Otimização Clientes" DO SUPABASE
 * (tabelas monday_otimizacao_events + monday_otimizacao_links).
 *
 * O script Python `scripts/sync_monday_to_supabase.py` mantém atualizado.
 *
 * REGRA CRÍTICA: Monday é READ-ONLY. Esse hook NÃO consulta o Monday — só
 * lê do Supabase + escuta realtime.
 */
export interface OtimizacaoEvent {
  ts: string;
  pulseName: string;
  pulseId: string;
  boardId: string;
  kind: 'criacao' | 'status';
  detail?: string;
}

export interface UseOtimizacaoEventsResult {
  events: OtimizacaoEvent[];
  /** Map<monday_item_id (otimização) → monday_client_id[]> */
  clientLinks: Map<string, string[]>;
  boardId: string | null;
  boardName: string | null;
  loading: boolean;
  error: string | null;
  lastUpdate: Date | null;
}

const CACHE_KEY = 'supa:otimizacao:v1';
const POLL_MS = 1000 * 60 * 2; // 2 min

interface CachedShape {
  events: OtimizacaoEvent[];
  clientLinks: [string, string[]][];
  boardId: string | null;
  boardName: string | null;
}

interface EventRow {
  event_id: string;
  board_id: string;
  pulse_id: string;
  pulse_name: string | null;
  kind: 'criacao' | 'status';
  detail: string | null;
  ts: string;
}

interface LinkRow {
  pulse_id: string;
  board_id: string;
  monday_client_ids: string[];
}

const PAGE_SIZE = 1000;

async function fetchEvents(): Promise<OtimizacaoEvent[]> {
  const out: OtimizacaoEvent[] = [];
  let from = 0;
  for (let page = 0; page < 30; page++) {
    const { data, error } = await supabase
      .from('monday_otimizacao_events')
      .select('*')
      .order('ts', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as EventRow[]) {
      out.push({
        ts: r.ts,
        pulseName: r.pulse_name ?? '',
        pulseId: r.pulse_id,
        boardId: r.board_id,
        kind: r.kind,
        detail: r.detail ?? undefined,
      });
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

async function fetchLinks(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  let from = 0;
  for (let page = 0; page < 30; page++) {
    const { data, error } = await supabase
      .from('monday_otimizacao_links')
      .select('pulse_id, monday_client_ids')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as LinkRow[]) {
      out.set(r.pulse_id, r.monday_client_ids ?? []);
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

async function fetchBoardMeta(): Promise<{ id: string | null; name: string | null }> {
  const { data, error } = await supabase
    .from('monday_sync_meta')
    .select('value')
    .eq('key', 'otimizacao_board')
    .maybeSingle();
  if (error) return { id: null, name: null };
  const v = (data?.value as { board_id?: string; board_name?: string } | null) ?? null;
  return {
    id: v?.board_id ?? null,
    name: v?.board_name ?? null,
  };
}

/**
 * @param enabled Quando false (default), só lê cache local — sem fetch.
 *                Use enabled=true quando entrar em perfil específico.
 */
export function useOtimizacaoEvents(enabled: boolean = false): UseOtimizacaoEventsResult {
  const cached = readCacheWithMeta<CachedShape>(CACHE_KEY);

  const [events, setEvents] = useState<OtimizacaoEvent[]>(cached?.value.events ?? []);
  const [clientLinks, setClientLinks] = useState<Map<string, string[]>>(
    new Map(cached?.value.clientLinks ?? [])
  );
  const [boardId, setBoardId] = useState<string | null>(cached?.value.boardId ?? null);
  const [boardName, setBoardName] = useState<string | null>(cached?.value.boardName ?? null);
  const [loading, setLoading] = useState(enabled && events.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(
    cached ? new Date(cached.savedAt) : null
  );
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    if (!enabled) {
      setLoading(false);
      return;
    }

    async function refresh() {
      try {
        const [evs, links, meta] = await Promise.all([
          fetchEvents(),
          fetchLinks(),
          fetchBoardMeta(),
        ]);
        if (!activeRef.current) return;
        setEvents((prev) => {
          if (prev.length === evs.length && prev.length > 0 && prev[0]?.pulseId === evs[0]?.pulseId && prev[0]?.ts === evs[0]?.ts) {
            return prev;
          }
          return evs;
        });
        setClientLinks(links);
        setBoardId(meta.id);
        setBoardName(meta.name);
        setError(null);
        setLastUpdate(new Date());

        writeCache<CachedShape>(CACHE_KEY, {
          events: evs,
          clientLinks: Array.from(links.entries()),
          boardId: meta.id,
          boardName: meta.name,
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

    const channel = supabase
      .channel(`md_otim_rt_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monday_otimizacao_events' }, () => {
        if (activeRef.current) refresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monday_otimizacao_links' }, () => {
        if (activeRef.current) refresh();
      })
      .subscribe();

    return () => {
      activeRef.current = false;
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [enabled]);

  return { events, clientLinks, boardId, boardName, loading, error, lastUpdate };
}

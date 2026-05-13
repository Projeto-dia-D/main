import { useEffect, useState, useRef } from 'react';
import { supabase, TABLE_NAME } from '../lib/supabase';
import type { RelatorioBias } from '../lib/types';
import { assertConfig } from '../config';
import { isPhoneBlocked } from '../lib/blockedPhones';
import { readCacheWithMeta, writeCache } from '../lib/cache';

const POLL_MS = 3000;
const PAGE_SIZE = 1000;
const CACHE_KEY = 'leads:v1';

interface CachedLeads {
  leads: RelatorioBias[];
}

export interface UseLeadsResult {
  leads: RelatorioBias[];
  loading: boolean;
  error: string | null;
  lastUpdate: Date | null;
  configMissing: string[];
}

async function fetchAllLeads(): Promise<RelatorioBias[]> {
  const all: RelatorioBias[] = [];
  let from = 0;
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('*')
      .order('dataCadastro', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as RelatorioBias[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

// Deleta linhas com telefone bloqueado do banco. Idempotente — múltiplos
// clientes rodando juntos não causam erro (delete em ID já apagado retorna 0).
// Roda em background, não bloqueia o refresh.
function deleteBlockedInBackground(ids: string[]) {
  if (ids.length === 0) return;
  supabase
    .from(TABLE_NAME)
    .delete()
    .in('id', ids)
    .then(({ error }) => {
      if (error) {
        console.error('[useLeads] erro ao deletar leads bloqueados:', error);
      } else {
        console.log(`[useLeads] ${ids.length} lead(s) bloqueados deletados do banco`);
      }
    });
}

export function useLeads(): UseLeadsResult {
  // Lê cache imediatamente — tela renderiza sem espera no primeiro paint
  const cached = readCacheWithMeta<CachedLeads>(CACHE_KEY);
  const initialLeads = cached?.value.leads ?? [];
  const initialUpdate = cached ? new Date(cached.savedAt) : null;

  const [leads, setLeads]           = useState<RelatorioBias[]>(initialLeads);
  // Só fica "loading" se não temos cache pra exibir
  const [loading, setLoading]       = useState(initialLeads.length === 0);
  const [error, setError]           = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(initialUpdate);
  const activeRef                   = useRef(true);

  const missing = assertConfig();

  useEffect(() => {
    if (missing.length > 0) { setLoading(false); return; }

    activeRef.current = true;

    async function refresh() {
      try {
        const rows = await fetchAllLeads();
        if (!activeRef.current) return;

        // Filtra telefones bloqueados localmente (some da UI imediatamente)
        // e dispara DELETE no banco em background.
        const blockedIds: string[] = [];
        const cleanRows: RelatorioBias[] = [];
        for (const r of rows) {
          if (isPhoneBlocked(r.telefone)) {
            blockedIds.push(r.id);
          } else {
            cleanRows.push(r);
          }
        }
        if (blockedIds.length > 0) {
          deleteBlockedInBackground(blockedIds);
        }

        setLeads(cleanRows);
        setLastUpdate(new Date());
        setError(null);
        // Persiste em localStorage para próximas aberturas
        writeCache<CachedLeads>(CACHE_KEY, { leads: cleanRows });
      } catch (e) {
        if (!activeRef.current) return;
        console.error('[useLeads] fetch error', e);
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    // Carga inicial
    refresh().finally(() => { if (activeRef.current) setLoading(false); });

    // Polling garantido a cada 3 s
    const timer = setInterval(refresh, POLL_MS);

    // Realtime — quando disparar, faz refresh completo imediatamente
    const channel = supabase
      .channel(`leads_rt_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: TABLE_NAME },
        () => { if (activeRef.current) refresh(); }
      )
      .subscribe((status) => {
        console.log('[useLeads] realtime status:', status);
      });

    return () => {
      activeRef.current = false;
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { leads, loading, error, lastUpdate, configMissing: missing };
}

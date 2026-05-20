import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Hook que mede uso do Supabase por tabela:
 *  - Quantas linhas (count exato via head request)
 *  - Tamanho estimado (linhas × média estimada de bytes/row)
 *  - Realtime channels ativos
 *
 * Útil pra monitorar se estamos perto dos limites do plano free:
 *  - 500 MB database storage
 *  - 2 GB egress/mês
 *  - 200 conexões realtime simultâneas
 */
export interface TableUsage {
  table: string;
  rows: number | null;
  estimatedBytes: number | null;
  lastSyncAt?: string | null;
  error?: string;
}

export interface SupabaseUsageResult {
  tables: TableUsage[];
  totalRows: number;
  estimatedTotalBytes: number;
  loading: boolean;
  error: string | null;
  lastUpdate: Date | null;
  refresh: () => Promise<void>;
}

// Tabelas que o app gerencia. Em parênteses uma estimativa de bytes/row.
// Estimativas são conservadoras (média): TEXT curto = ~50b, TEXT longo = ~200b.
const TABLES: Array<{ name: string; bytesPerRow: number }> = [
  { name: 'relatorio_bias', bytesPerRow: 400 },
  { name: 'design_demandas', bytesPerRow: 600 },          // webhook-fed (Design tab)
  { name: 'design_atrasos', bytesPerRow: 350 },
  { name: 'monday_design_activity', bytesPerRow: 220 },   // sync 15min
  { name: 'monday_design_demanda_links', bytesPerRow: 100 },
  { name: 'monday_design_items', bytesPerRow: 80 },
  { name: 'monday_otimizacao_events', bytesPerRow: 180 },
  { name: 'monday_otimizacao_links', bytesPerRow: 100 },
  { name: 'monday_bia_fase_timeline', bytesPerRow: 200 },
  { name: 'monday_sync_meta', bytesPerRow: 200 },
  { name: 'client_meta_links', bytesPerRow: 150 },
  { name: 'doutor_client_links', bytesPerRow: 120 },
  { name: 'user_passwords', bytesPerRow: 120 },
  { name: 'designer_atestados', bytesPerRow: 200 },
  { name: 'holidays', bytesPerRow: 60 },
];

export function useSupabaseUsage(): SupabaseUsageResult {
  const [tables, setTables] = useState<TableUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  async function fetchUsage() {
    setLoading(true);
    setError(null);
    try {
      // 1. Pega contagens em paralelo (usa { count: 'exact', head: true } pra
      //    contar sem transferir rows — só HEAD request).
      const counts = await Promise.all(
        TABLES.map(async (t): Promise<TableUsage> => {
          try {
            const { count, error: e } = await supabase
              .from(t.name)
              .select('*', { count: 'exact', head: true });
            if (e) {
              return { table: t.name, rows: null, estimatedBytes: null, error: e.message };
            }
            const rows = count ?? 0;
            return {
              table: t.name,
              rows,
              estimatedBytes: rows * t.bytesPerRow,
            };
          } catch (ex) {
            return {
              table: t.name,
              rows: null,
              estimatedBytes: null,
              error: ex instanceof Error ? ex.message : String(ex),
            };
          }
        })
      );

      // 2. Pega last_sync_at de cada chave em monday_sync_meta
      try {
        const { data: meta } = await supabase
          .from('monday_sync_meta')
          .select('key, value');
        if (meta) {
          const syncMap = new Map<string, string>();
          for (const m of meta as Array<{ key: string; value: { last_sync_at?: string } }>) {
            const ts = m.value?.last_sync_at;
            if (ts) syncMap.set(m.key, ts);
          }
          // Aplica last_sync_at a tabelas correspondentes
          const keyMap: Record<string, string> = {
            monday_design_activity: 'design_activity',
            monday_design_demanda_links: 'design_demanda_links',
            monday_design_items: 'design_items',
            monday_otimizacao_events: 'otimizacao_events',
            monday_otimizacao_links: 'otimizacao_events',
            monday_bia_fase_timeline: 'bia_fase_timeline',
          };
          for (const c of counts) {
            const metaKey = keyMap[c.table];
            if (metaKey) c.lastSyncAt = syncMap.get(metaKey) ?? null;
          }
        }
      } catch {
        /* meta opcional */
      }

      setTables(counts);
      setLastUpdate(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalRows = tables.reduce((s, t) => s + (t.rows ?? 0), 0);
  const estimatedTotalBytes = tables.reduce((s, t) => s + (t.estimatedBytes ?? 0), 0);

  return {
    tables,
    totalRows,
    estimatedTotalBytes,
    loading,
    error,
    lastUpdate,
    refresh: fetchUsage,
  };
}

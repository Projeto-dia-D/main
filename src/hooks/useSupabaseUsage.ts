import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { config } from '../config';

/**
 * Hook que mede uso do Supabase do projeto INTEIRO:
 *  - Descobre TODAS as tabelas do schema public via OpenAPI introspection
 *  - Conta linhas exatas de cada uma (HEAD request com count=exact)
 *  - Estima bytes (com bytesPerRow customizado pra tabelas conhecidas,
 *    senao usa 200 bytes/row como heuristica conservadora)
 *
 * Util pra monitorar se estamos perto dos limites do plano:
 *  - 500 MB database storage (free)
 *  - 2 GB egress/mes
 *  - 200 conexoes realtime simultaneas
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

// Estimativas customizadas (bytes/row) pra tabelas conhecidas — melhora
// a precisao em relacao ao default. As tabelas nao listadas aqui usam
// DEFAULT_BYTES_PER_ROW (200) como heuristica conservadora.
const BYTES_PER_ROW_OVERRIDES: Record<string, number> = {
  relatorio_bias: 400,
  design_demandas: 600,
  design_atrasos: 350,
  monday_design_activity: 220,
  monday_design_demanda_links: 100,
  monday_design_items: 80,
  monday_otimizacao_events: 180,
  monday_otimizacao_links: 100,
  monday_bia_fase_timeline: 200,
  monday_sync_meta: 200,
  client_meta_links: 150,
  doutor_client_links: 120,
  user_passwords: 120,
  designer_atestados: 200,
  holidays: 60,
  whatsapp_messages: 350,
  whatsapp_group_members: 180,
  whatsapp_groups: 200,
  monday_item_updates: 400,
  monday_auth_emails: 100,
  notifications: 300,
};
const DEFAULT_BYTES_PER_ROW = 200;

/**
 * Descobre todas as tabelas do schema 'public' via OpenAPI spec do PostgREST.
 * O endpoint raiz /rest/v1/ retorna um JSON com 'definitions' contendo o
 * schema de cada tabela exposta. Mais robusto que hardcoded list — tabelas
 * novas aparecem automaticamente.
 */
async function discoverTables(): Promise<string[]> {
  try {
    const res = await fetch(`${config.SUPABASE_URL}/rest/v1/`, {
      headers: {
        apikey: config.SUPABASE_SERVICE_ROLE_SECRET,
        Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_SECRET}`,
      },
    });
    if (!res.ok) return [];
    const spec = (await res.json()) as { definitions?: Record<string, unknown> };
    return Object.keys(spec.definitions ?? {}).sort();
  } catch {
    return [];
  }
}

export function useSupabaseUsage(): SupabaseUsageResult {
  const [tables, setTables] = useState<TableUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  async function fetchUsage() {
    setLoading(true);
    setError(null);
    try {
      // 1. Descobre TODAS as tabelas do schema public via OpenAPI introspection.
      //    Assim o painel mede o projeto INTEIRO, nao so as tabelas que o app
      //    consome — tabela nova aparece automaticamente sem precisar mexer aqui.
      const allTables = await discoverTables();
      if (allTables.length === 0) {
        throw new Error(
          'Nao consegui descobrir tabelas via OpenAPI. Verifique SUPABASE_URL e service_role.'
        );
      }

      // 2. Pega contagens em paralelo (usa { count: 'exact', head: true } pra
      //    contar sem transferir rows — só HEAD request).
      const counts = await Promise.all(
        allTables.map(async (name): Promise<TableUsage> => {
          try {
            const { count, error: e } = await supabase
              .from(name)
              .select('*', { count: 'exact', head: true });
            if (e) {
              return { table: name, rows: null, estimatedBytes: null, error: e.message };
            }
            const rows = count ?? 0;
            const bpr = BYTES_PER_ROW_OVERRIDES[name] ?? DEFAULT_BYTES_PER_ROW;
            return {
              table: name,
              rows,
              estimatedBytes: rows * bpr,
            };
          } catch (ex) {
            return {
              table: name,
              rows: null,
              estimatedBytes: null,
              error: ex instanceof Error ? ex.message : String(ex),
            };
          }
        })
      );

      // 3. Pega last_sync_at de cada chave em monday_sync_meta
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

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { readCacheWithMeta, writeCache } from '../lib/cache';
import {
  CONTROLS_TABLE,
  fetchAllControls,
  saveControl,
  type ClientMetricControl,
} from '../lib/clientMetricControl';

const CACHE_KEY = 'client_metric_controls:v1';

export interface UseClientMetricControlsResult {
  /** Map<monday_client_id, controle>. Ausência = conta em tudo (padrão). */
  controls: Map<string, ClientMetricControl>;
  /** Lista crua (só clientes com algum setor desligado). */
  controlsList: ClientMetricControl[];
  loading: boolean;
  error: string | null;
  /** Tabela client_metric_controls ainda não existe no Supabase. */
  missingTable: boolean;
  /** Grava (otimista) o controle de um cliente. Volta ao padrão → remove. */
  save: (ctrl: ClientMetricControl, updatedBy?: string | null) => Promise<void>;
}

function toMap(list: ClientMetricControl[]): Map<string, ClientMetricControl> {
  return new Map(list.map((c) => [c.monday_client_id, c]));
}

export function useClientMetricControls(): UseClientMetricControlsResult {
  const cached = readCacheWithMeta<ClientMetricControl[]>(CACHE_KEY);
  const [controlsList, setControlsList] = useState<ClientMetricControl[]>(cached?.value ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [missingTable, setMissingTable] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchAllControls();
      setControlsList(list);
      writeCache(CACHE_KEY, list);
      setError(null);
      setMissingTable(false);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      // 42P01 = tabela inexistente; PGRST205 = schema cache sem a tabela.
      if (err?.code === '42P01' || err?.code === 'PGRST205' || /does not exist|could not find the table/i.test(err?.message ?? '')) {
        setMissingTable(true);
        setError(null);
      } else {
        setError(err?.message ?? String(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    load();
    const channel = supabase
      .channel('client_metric_controls_rt_' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: CONTROLS_TABLE }, () => {
        if (active) load();
      })
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [load]);

  const save = useCallback(
    async (ctrl: ClientMetricControl, updatedBy?: string | null) => {
      // Otimista: atualiza a lista local na hora.
      setControlsList((prev) => {
        const padrao = ctrl.programacao && ctrl.gestor && ctrl.cs && ctrl.design;
        const rest = prev.filter((c) => c.monday_client_id !== ctrl.monday_client_id);
        return padrao ? rest : [...rest, ctrl];
      });
      try {
        await saveControl(ctrl, updatedBy);
      } catch (e: unknown) {
        // Reverte recarregando do servidor.
        setError((e as { message?: string })?.message ?? String(e));
        load();
      }
    },
    [load]
  );

  return {
    controls: toMap(controlsList),
    controlsList,
    loading,
    error,
    missingTable,
    save,
  };
}

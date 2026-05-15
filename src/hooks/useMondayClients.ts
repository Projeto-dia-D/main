import { useEffect, useState } from 'react';
import {
  fetchMondayClients,
  fetchBiaSoftData,
  isClientNoBiaSoftById,
  type MondayClient,
} from '../lib/monday';
import { readCacheWithMeta, writeCache } from '../lib/cache';

export interface UseMondayClientsResult {
  /** Clientes Monday que estão vinculados ao board Bia Soft (qualquer fase). */
  clients: MondayClient[];
  /** Lista crua do board principal Monday — sem filtro. */
  allClients: MondayClient[];
  /** Set de IDs com Bia em fase ATIVA (I.A ativa / Manutenção). */
  biaActiveIds: Set<string>;
  /** Set de IDs de todos os clientes vinculados no Bia Soft (qualquer fase). */
  biaAllIds: Set<string>;
  /** Map<monday_client_id → responsável>. */
  responsavelByClientId: Map<string, string>;
  /** Lista única de responsáveis (Gabriel, Eduardo) com pelo menos 1 ativo. */
  responsaveis: string[];
  loading: boolean;
  error: string | null;
  lastUpdate: Date | null;
}

const REFRESH_MS = 1000 * 60 * 10; // 10 min
const CACHE_KEY_CLIENTS = 'monday:clients:v2';
// v8: agora usa IDs (board_relation) em vez de match por nome
const CACHE_KEY_BIA = 'monday:biaData:v8';

interface CachedClients {
  clients: MondayClient[];
}

interface CachedBia {
  allIds: string[];
  activeIds: string[];
  responsavelByClientId: [string, string][];
  responsaveis: string[];
}

export function useMondayClients(): UseMondayClientsResult {
  const cachedClients = readCacheWithMeta<CachedClients>(CACHE_KEY_CLIENTS);
  const cachedBia = readCacheWithMeta<CachedBia>(CACHE_KEY_BIA);

  const initialAllIds = new Set<string>(cachedBia?.value.allIds ?? []);
  const initialActiveIds = new Set<string>(cachedBia?.value.activeIds ?? []);
  const initialRespMap = new Map<string, string>(
    cachedBia?.value.responsavelByClientId ?? []
  );
  const initialRespList = cachedBia?.value.responsaveis ?? [];
  const initialAll = cachedClients?.value.clients ?? [];
  const initialFiltered = initialAll.filter((c) =>
    isClientNoBiaSoftById(c, initialAllIds)
  );
  const initialUpdate = cachedClients
    ? new Date(Math.min(cachedClients.savedAt, cachedBia?.savedAt ?? cachedClients.savedAt))
    : null;

  const [clients, setClients] = useState<MondayClient[]>(initialFiltered);
  const [allClients, setAllClients] = useState<MondayClient[]>(initialAll);
  const [biaActiveIds, setBiaActiveIds] = useState<Set<string>>(initialActiveIds);
  const [biaAllIds, setBiaAllIds] = useState<Set<string>>(initialAllIds);
  const [responsavelByClientId, setResponsavelByClientId] = useState<Map<string, string>>(initialRespMap);
  const [responsaveis, setResponsaveis] = useState<string[]>(initialRespList);
  const [loading, setLoading] = useState(initialAll.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(initialUpdate);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [mainResult, biaData] = await Promise.all([
          fetchMondayClients(),
          fetchBiaSoftData(),
        ]);
        if (!active) return;
        const filtered = mainResult.clients.filter((c) =>
          isClientNoBiaSoftById(c, biaData.allIds)
        );
        setAllClients(mainResult.clients);
        setClients(filtered);
        setBiaActiveIds(biaData.activeIds);
        setBiaAllIds(biaData.allIds);
        setResponsavelByClientId(biaData.responsavelByClientId);
        setResponsaveis(biaData.responsaveis);
        setError(null);
        setLastUpdate(new Date());

        writeCache<CachedClients>(CACHE_KEY_CLIENTS, { clients: mainResult.clients });
        writeCache<CachedBia>(CACHE_KEY_BIA, {
          allIds: Array.from(biaData.allIds),
          activeIds: Array.from(biaData.activeIds),
          responsavelByClientId: Array.from(biaData.responsavelByClientId.entries()),
          responsaveis: biaData.responsaveis,
        });
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  return {
    clients,
    allClients,
    biaActiveIds,
    biaAllIds,
    responsavelByClientId,
    responsaveis,
    loading,
    error,
    lastUpdate,
  };
}

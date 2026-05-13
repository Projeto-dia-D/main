import { useEffect, useState } from 'react';
import {
  fetchMondayClients,
  fetchBiaSoftData,
  isClientNoBiaSoft,
  type MondayClient,
} from '../lib/monday';
import { readCacheWithMeta, writeCache } from '../lib/cache';

export interface UseMondayClientsResult {
  clients: MondayClient[];                  // filtrados pelos com Bia ativa
  allClients: MondayClient[];               // raw do board principal
  biaNames: Set<string>;                    // nomes (normalizados) com Bia ativa
  responsavelByClient: Map<string, string>; // nome normalizado → responsável
  responsaveis: string[];                   // lista única (Gabriel, Eduardo, …)
  loading: boolean;
  error: string | null;
  lastUpdate: Date | null;
}

const REFRESH_MS = 1000 * 30; // 30s — mudanças de Fase aparecem quase em tempo real
const CACHE_KEY_CLIENTS = 'monday:clients:v2';
// v5: adicionado mapa de responsáveis — invalida cache antigo
const CACHE_KEY_BIA = 'monday:biaData:v5';

interface CachedClients {
  clients: MondayClient[];
}

interface CachedBia {
  names: string[];
  responsavelByName: [string, string][]; // serializado pra JSON
  responsaveis: string[];
}

export function useMondayClients(): UseMondayClientsResult {
  // Lê cache imediatamente — tela já renderiza com dados anteriores
  const cachedClients = readCacheWithMeta<CachedClients>(CACHE_KEY_CLIENTS);
  const cachedBia = readCacheWithMeta<CachedBia>(CACHE_KEY_BIA);

  const initialBia = new Set<string>(cachedBia?.value.names ?? []);
  const initialRespMap = new Map<string, string>(
    cachedBia?.value.responsavelByName ?? []
  );
  const initialRespList = cachedBia?.value.responsaveis ?? [];
  const initialAll = cachedClients?.value.clients ?? [];
  const initialFiltered = initialAll.filter((c) => isClientNoBiaSoft(c, initialBia));
  const initialUpdate = cachedClients
    ? new Date(Math.min(cachedClients.savedAt, cachedBia?.savedAt ?? cachedClients.savedAt))
    : null;

  const [clients, setClients] = useState<MondayClient[]>(initialFiltered);
  const [allClients, setAllClients] = useState<MondayClient[]>(initialAll);
  const [biaNames, setBiaNames] = useState<Set<string>>(initialBia);
  const [responsavelByClient, setResponsavelByClient] = useState<Map<string, string>>(initialRespMap);
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
          isClientNoBiaSoft(c, biaData.activeNames)
        );
        setAllClients(mainResult.clients);
        setClients(filtered);
        setBiaNames(biaData.activeNames);
        setResponsavelByClient(biaData.responsavelByName);
        setResponsaveis(biaData.responsaveis);
        setError(null);
        setLastUpdate(new Date());

        writeCache<CachedClients>(CACHE_KEY_CLIENTS, { clients: mainResult.clients });
        writeCache<CachedBia>(CACHE_KEY_BIA, {
          names: Array.from(biaData.activeNames),
          responsavelByName: Array.from(biaData.responsavelByName.entries()),
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
    biaNames,
    responsavelByClient,
    responsaveis,
    loading,
    error,
    lastUpdate,
  };
}

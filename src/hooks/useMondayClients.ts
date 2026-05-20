import { useEffect, useState } from 'react';
import {
  fetchMondayClients,
  fetchBiaSoftData,
  fetchBiaFaseTimeline,
  fetchBiaFaseTimelineFromSupabase,
  isClientNoBiaSoftById,
  type MondayClient,
  type FaseTransition,
} from '../lib/monday';
import { readCacheWithMeta, writeCache } from '../lib/cache';

export interface UseMondayClientsResult {
  /** Clientes Monday que estão vinculados ao board Bia Soft (qualquer fase). */
  clients: MondayClient[];
  /** Clientes do Monday principal — filtrados por grupo ativo + tipo Bia Soft.
   *  Usado em Gestor/CS/Programação. */
  allClients: MondayClient[];
  /** TODOS os clientes do board principal SEM FILTRO — incluindo churnados,
   *  pausados, perdidos. Usado SOMENTE pela aba Saúde do Cliente. */
  clientsAll: MondayClient[];
  /** Set de IDs com Bia em fase ATIVA (I.A ativa). */
  biaActiveIds: Set<string>;
  /** Set de IDs de todos os clientes vinculados no Bia Soft (qualquer fase). */
  biaAllIds: Set<string>;
  /** Map<monday_client_id → responsável>. */
  responsavelByClientId: Map<string, string>;
  /** Map<nome do cliente normalizado → responsável>. Usado em Programação que
   *  só tem acesso ao nome do doutor (não ao monday_client_id). */
  responsavelByName: Map<string, string>;
  /** Map<monday_client_id (do Monday principal) → timeline de transições de Fase>.
   *  Usado pra ajustar spend nos períodos em que a Bia esteve em Manutenção. */
  biaTimelineByClientId: Map<string, FaseTransition[]>;
  /** Map<monday_client_id, fase_atual> — fase atual da Bia no board Bia Soft. */
  biaFaseByClientId: Map<string, string>;
  /** Map<monday_client_id (do Monday principal) → bia_item_id (no board Bia Soft)>.
   *  Usado pra montar link do item no Monday quando aparece evento de Bia. */
  biaItemIdByClientId: Map<string, string>;
  /** email lowercase → nome do CS. Pra autenticação. */
  csByEmail: Map<string, string>;
  /** email lowercase → nome do Gestor. Pra autenticação. */
  gestorByEmail: Map<string, string>;
  /** email lowercase → nome do Responsável de programação. Pra autenticação. */
  programadorByEmail: Map<string, string>;
  /** Lista única de responsáveis (Gabriel, Eduardo) com pelo menos 1 ativo. */
  responsaveis: string[];
  loading: boolean;
  error: string | null;
  lastUpdate: Date | null;
}

const REFRESH_MS = 1000 * 60 * 10; // 10 min
// v5: força re-fetch pra garantir dataEntrada (formula do Monday)
//     vir preenchida — antigo cache v4 podia ter dataEntrada null se foi
//     populado antes da coluna ser descoberta
const CACHE_KEY_CLIENTS = 'monday:clients:v5';
// v11: adicionados csByEmail/gestorByEmail/programadorByEmail (pra auth)
const CACHE_KEY_BIA = 'monday:biaData:v11';
const CACHE_KEY_TIMELINE = 'monday:biaTimeline:v1';

interface CachedClients {
  clients: MondayClient[];
  /** Inclui churn/pausados/perdidos — usado pela aba Saúde. */
  clientsAll?: MondayClient[];
}

interface CachedBia {
  allIds: string[];
  activeIds: string[];
  responsavelByClientId: [string, string][];
  responsavelByName?: [string, string][];
  responsaveis: string[];
  csByEmail?: [string, string][];
  gestorByEmail?: [string, string][];
  programadorByEmail?: [string, string][];
}

interface CachedTimeline {
  // Mapeia bia_item_id → transições (mas precisamos do monday_client_id)
  // Salvamos por monday_principal_client_id → transitions[]
  timeline: [string, FaseTransition[]][];
}

export function useMondayClients(): UseMondayClientsResult {
  const cachedClients = readCacheWithMeta<CachedClients>(CACHE_KEY_CLIENTS);
  const cachedBia = readCacheWithMeta<CachedBia>(CACHE_KEY_BIA);
  const cachedTimeline = readCacheWithMeta<CachedTimeline>(CACHE_KEY_TIMELINE);

  const initialAllIds = new Set<string>(cachedBia?.value.allIds ?? []);
  const initialActiveIds = new Set<string>(cachedBia?.value.activeIds ?? []);
  const initialRespMap = new Map<string, string>(
    cachedBia?.value.responsavelByClientId ?? []
  );
  const initialRespByName = new Map<string, string>(
    cachedBia?.value.responsavelByName ?? []
  );
  const initialRespList = cachedBia?.value.responsaveis ?? [];
  const initialAll = cachedClients?.value.clients ?? [];
  const initialClientsAll = cachedClients?.value.clientsAll ?? initialAll;
  const initialFiltered = initialAll.filter((c) =>
    isClientNoBiaSoftById(c, initialAllIds)
  );
  const initialTimeline = new Map<string, FaseTransition[]>(
    cachedTimeline?.value.timeline ?? []
  );
  const initialUpdate = cachedClients
    ? new Date(Math.min(cachedClients.savedAt, cachedBia?.savedAt ?? cachedClients.savedAt))
    : null;

  const [clients, setClients] = useState<MondayClient[]>(initialFiltered);
  const [allClients, setAllClients] = useState<MondayClient[]>(initialAll);
  const [clientsAll, setClientsAll] = useState<MondayClient[]>(initialClientsAll);
  const [biaActiveIds, setBiaActiveIds] = useState<Set<string>>(initialActiveIds);
  const [biaAllIds, setBiaAllIds] = useState<Set<string>>(initialAllIds);
  const [responsavelByClientId, setResponsavelByClientId] = useState<Map<string, string>>(initialRespMap);
  const [responsavelByName, setResponsavelByName] = useState<Map<string, string>>(initialRespByName);
  const [biaTimelineByClientId, setBiaTimelineByClientId] = useState<Map<string, FaseTransition[]>>(initialTimeline);
  const [biaFaseByClientId, setBiaFaseByClientId] = useState<Map<string, string>>(new Map());
  const [biaItemIdByClientId, setBiaItemIdByClientId] = useState<Map<string, string>>(new Map());
  const [csByEmail, setCsByEmail] = useState<Map<string, string>>(
    () => new Map<string, string>(cachedBia?.value.csByEmail ?? [])
  );
  const [gestorByEmail, setGestorByEmail] = useState<Map<string, string>>(
    () => new Map<string, string>(cachedBia?.value.gestorByEmail ?? [])
  );
  const [programadorByEmail, setProgramadorByEmail] = useState<Map<string, string>>(
    () => new Map<string, string>(cachedBia?.value.programadorByEmail ?? [])
  );
  const [responsaveis, setResponsaveis] = useState<string[]>(initialRespList);
  const [loading, setLoading] = useState(initialAll.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(initialUpdate);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        // Timeline da Bia agora le do Supabase (tabela espelho mantida pelo
        // sync de 15 em 15 min). Cai pra ~1 query rapida em vez de ate 50
        // paginas de activity_logs do Monday. Se vier vazio (tabela nao
        // populada ainda), faz fallback pro GraphQL.
        const [mainResult, biaData, biaTimelineSupa] = await Promise.all([
          fetchMondayClients(),
          fetchBiaSoftData(),
          fetchBiaFaseTimelineFromSupabase(90),
        ]);
        const biaTimelineRaw = biaTimelineSupa.size > 0
          ? biaTimelineSupa
          : await fetchBiaFaseTimeline(90);
        if (!active) return;
        const filtered = mainResult.clients.filter((c) =>
          isClientNoBiaSoftById(c, biaData.allIds)
        );
        setAllClients(mainResult.clients);
        setClientsAll(mainResult.clientsAll);
        setClients(filtered);
        setBiaActiveIds(biaData.activeIds);
        setBiaAllIds(biaData.allIds);
        setResponsavelByClientId(biaData.responsavelByClientId);
        setResponsavelByName(biaData.responsavelByName);
        setResponsaveis(biaData.responsaveis);

        // biaTimelineRaw vem indexado por bia_item_id (id do item no board Bia Soft).
        // Reindexa por monday_principal_client_id usando o bridge clientIdsByBiaItemId.
        const timelineByClient = new Map<string, FaseTransition[]>();
        for (const [biaItemId, transitions] of biaTimelineRaw) {
          const linkedIds = biaData.clientIdsByBiaItemId.get(biaItemId) ?? [];
          for (const cid of linkedIds) {
            // Se um mesmo monday_client_id aparece em multiplos bia_items,
            // concatenamos as transicoes (caso raro, mas seguro).
            const arr = timelineByClient.get(cid) ?? [];
            arr.push(...transitions);
            timelineByClient.set(cid, arr);
          }
        }
        // Re-ordena por timestamp asc
        for (const [k, arr] of timelineByClient) {
          arr.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
          timelineByClient.set(k, arr);
        }
        setBiaTimelineByClientId(timelineByClient);
        setBiaFaseByClientId(biaData.faseByClientId);
        // Inverte clientIdsByBiaItemId → biaItemIdByClientId (1 client pode
        // estar em múltiplos bia_items, raro; mantemos o primeiro).
        const biaItemByClient = new Map<string, string>();
        for (const [biaItemId, clientIds] of biaData.clientIdsByBiaItemId) {
          for (const cid of clientIds) {
            if (!biaItemByClient.has(cid)) biaItemByClient.set(cid, biaItemId);
          }
        }
        setBiaItemIdByClientId(biaItemByClient);
        setCsByEmail(biaData.csByEmail);
        setGestorByEmail(biaData.gestorByEmail);
        setProgramadorByEmail(biaData.programadorByEmail);

        setError(null);
        setLastUpdate(new Date());

        writeCache<CachedClients>(CACHE_KEY_CLIENTS, {
          clients: mainResult.clients,
          clientsAll: mainResult.clientsAll,
        });
        writeCache<CachedBia>(CACHE_KEY_BIA, {
          allIds: Array.from(biaData.allIds),
          activeIds: Array.from(biaData.activeIds),
          responsavelByClientId: Array.from(biaData.responsavelByClientId.entries()),
          responsavelByName: Array.from(biaData.responsavelByName.entries()),
          responsaveis: biaData.responsaveis,
          csByEmail: Array.from(biaData.csByEmail.entries()),
          gestorByEmail: Array.from(biaData.gestorByEmail.entries()),
          programadorByEmail: Array.from(biaData.programadorByEmail.entries()),
        });
        writeCache<CachedTimeline>(CACHE_KEY_TIMELINE, {
          timeline: Array.from(timelineByClient.entries()),
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
    clientsAll,
    biaActiveIds,
    biaAllIds,
    responsavelByClientId,
    responsavelByName,
    biaTimelineByClientId,
    biaFaseByClientId,
    biaItemIdByClientId,
    csByEmail,
    gestorByEmail,
    programadorByEmail,
    responsaveis,
    loading,
    error,
    lastUpdate,
  };
}

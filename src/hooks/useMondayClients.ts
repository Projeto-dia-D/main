import { useEffect, useRef, useState } from 'react';
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
  /** Map<monday_client_id, nome do item no Bia Soft> — nome que casa com o
   *  nomeDoutor dos leads. Usado pra listar clientes ativos sem lead no período. */
  nameByClientId: Map<string, string>;
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
  nameByClientId?: [string, string][];
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
  const [nameByClientId, setNameByClientId] = useState<Map<string, string>>(
    () => new Map<string, string>(cachedBia?.value.nameByClientId ?? [])
  );
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

  // Refs com o último tamanho aceito por bloco — usado pelo guard de
  // regressão (anti-oscilação). Refs em vez de state porque o useEffect tem
  // `[]` e capturaria valores stale dos state values dentro do `load()`.
  const lastSizesRef = useRef({
    clients: initialFiltered.length,
    clientsAll: initialClientsAll.length,
    biaAllIds: initialAllIds.size,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        // Timeline da Bia agora le do Supabase (tabela espelho mantida pelo
        // sync de 15 em 15 min). Cai pra ~1 query rapida em vez de ate 50
        // paginas de activity_logs do Monday. Se vier vazio (tabela nao
        // populada ainda), faz fallback pro GraphQL.
        // RESILIENTE: cada fonte com seu próprio catch — uma falha (Supabase
        // fora, rate limit do Monday) NÃO zera as outras. Antes era Promise.all
        // tudo-ou-nada: qualquer falha derrubava TODOS os clientes (foi o que
        // aconteceu na queda do Supabase — a timeline falhou e sumiu tudo).
        const [mainResult, biaData, biaTimelineSupa] = await Promise.all([
          fetchMondayClients().catch((e) => { console.warn('[useMondayClients] fetchMondayClients falhou:', e); return null; }),
          fetchBiaSoftData().catch((e) => { console.warn('[useMondayClients] fetchBiaSoftData falhou:', e); return null; }),
          fetchBiaFaseTimelineFromSupabase(90).catch(() => new Map<string, FaseTransition[]>()),
        ]);
        const biaTimelineRaw = biaTimelineSupa.size > 0
          ? biaTimelineSupa
          : await fetchBiaFaseTimeline(90).catch(() => new Map<string, FaseTransition[]>());
        if (!active) return;
        const biaAllIdsSafe = biaData ? biaData.allIds : new Set<string>();
        const filtered = mainResult
          ? mainResult.clients.filter((c) => isClientNoBiaSoftById(c, biaAllIdsSafe))
          : [];

        // === ANTI-OSCILACAO ===
        // Se a chamada do Monday retornou success mas com payload vazio
        // (rate limit silencioso, blip de rede, GraphQL parcial), nao wipa
        // o estado — preserva o que ja tinha. Sem isso, qualquer refetch
        // problematico fazia os cards "sumirem" temporariamente ate a
        // proxima rodada bem sucedida.
        //
        // ADICIONALMENTE: protege contra REGRESSÃO PARCIAL — se o fetch
        // novo trouxe < 80% do tamanho anterior (provavelmente truncou por
        // timeout / rate limit silencioso), descarta o resultado e mantém
        // o snapshot anterior. Sem esse guard, clientes (ex: Amanda Bragança)
        // "saíam e voltavam" do modal de vínculos a cada ciclo de 10min.
        //
        // Guard por bloco (main vs bia) pra permitir update parcial:
        //   - se Monday voltou OK mas Bia falhou: atualiza clients, mantem Bia
        //   - vice-versa
        //   - se ambos voltaram vazios E ja tinhamos dados: nao mexe em nada
        const SHRINK_THRESHOLD = 0.8;
        const previousClientsAllSize = lastSizesRef.current.clientsAll;
        const previousBiaAllSize = lastSizesRef.current.biaAllIds;

        const newClientsSize = mainResult ? mainResult.clients.length : 0;
        const newClientsAllSize = mainResult ? mainResult.clientsAll.length : 0;
        const newBiaAllSize = biaData ? biaData.allIds.size : 0;

        // Regressão parcial = veio com dados, mas significativamente menor que
        // o anterior. Considera só se tinha snapshot anterior (previousSize > 0).
        const mainRegressao =
          previousClientsAllSize > 0 &&
          newClientsAllSize > 0 &&
          newClientsAllSize < previousClientsAllSize * SHRINK_THRESHOLD;
        const biaRegressao =
          previousBiaAllSize > 0 &&
          newBiaAllSize > 0 &&
          newBiaAllSize < previousBiaAllSize * SHRINK_THRESHOLD;

        const mainHasData = (newClientsSize > 0 || newClientsAllSize > 0) && !mainRegressao;
        const biaHasData = newBiaAllSize > 0 && !biaRegressao;

        if (mainHasData && mainResult) {
          setAllClients(mainResult.clients);
          setClientsAll(mainResult.clientsAll);
          setClients(filtered);
          lastSizesRef.current.clients = filtered.length;
          lastSizesRef.current.clientsAll = newClientsAllSize;
        } else if (mainRegressao) {
          console.warn(
            `[useMondayClients] fetchMondayClients regrediu (${newClientsAllSize} < ${previousClientsAllSize} * ${SHRINK_THRESHOLD}) — preservando snapshot anterior`,
          );
        } else {
          console.warn('[useMondayClients] fetchMondayClients voltou vazio — preservando estado anterior');
        }

        if (biaHasData && biaData) {
          setBiaActiveIds(biaData.activeIds);
          setBiaAllIds(biaData.allIds);
          setResponsavelByClientId(biaData.responsavelByClientId);
          setResponsavelByName(biaData.responsavelByName);
          setResponsaveis(biaData.responsaveis);
          lastSizesRef.current.biaAllIds = newBiaAllSize;
        } else if (biaRegressao) {
          console.warn(
            `[useMondayClients] fetchBiaSoftData regrediu (${newBiaAllSize} < ${previousBiaAllSize} * ${SHRINK_THRESHOLD}) — preservando snapshot anterior`,
          );
        } else {
          console.warn('[useMondayClients] fetchBiaSoftData voltou vazio — preservando estado anterior');
        }

        // biaTimelineRaw vem indexado por bia_item_id (id do item no board Bia Soft).
        // Reindexa por monday_principal_client_id usando o bridge clientIdsByBiaItemId.
        const timelineByClient = new Map<string, FaseTransition[]>();
        for (const [biaItemId, transitions] of biaTimelineRaw) {
          const linkedIds = biaData?.clientIdsByBiaItemId.get(biaItemId) ?? [];
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
        // Timeline e itens derivados do Bia — so atualiza se biaHasData
        // (senao a derivacao via clientIdsByBiaItemId fica errada).
        if (biaHasData && biaData) {
          setBiaTimelineByClientId(timelineByClient);
          setBiaFaseByClientId(biaData.faseByClientId);
          setNameByClientId(biaData.nameByClientId);
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
        }

        setError(null);
        setLastUpdate(new Date());

        // Cache so persiste dados validos — se voltou vazio, mantem cache antigo
        if (mainHasData && mainResult) {
          writeCache<CachedClients>(CACHE_KEY_CLIENTS, {
            clients: mainResult.clients,
            clientsAll: mainResult.clientsAll,
          });
        }
        if (biaHasData && biaData) {
          writeCache<CachedBia>(CACHE_KEY_BIA, {
            allIds: Array.from(biaData.allIds),
            activeIds: Array.from(biaData.activeIds),
            responsavelByClientId: Array.from(biaData.responsavelByClientId.entries()),
            responsavelByName: Array.from(biaData.responsavelByName.entries()),
            nameByClientId: Array.from(biaData.nameByClientId.entries()),
            responsaveis: biaData.responsaveis,
            csByEmail: Array.from(biaData.csByEmail.entries()),
            gestorByEmail: Array.from(biaData.gestorByEmail.entries()),
            programadorByEmail: Array.from(biaData.programadorByEmail.entries()),
          });
          writeCache<CachedTimeline>(CACHE_KEY_TIMELINE, {
            timeline: Array.from(timelineByClient.entries()),
          });
        }
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
    nameByClientId,
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

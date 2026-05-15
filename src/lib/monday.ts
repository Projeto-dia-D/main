import { config } from '../config';

const MONDAY_URL = 'https://api.monday.com/v2';
const MONDAY_API_VERSION = '2024-01';
const PAGE_LIMIT = 100;

// Títulos de coluna que vamos resolver dinamicamente — Monday não exige IDs
// fixos, então buscamos pelo título (case-insensitive).
const COL_TIPO_CLIENTE_TITLES = ['tipo de cliente', 'tipo cliente'];
const COL_CS_TITLES = ['cs do projeto', 'cs', 'customer success'];
const COL_GESTOR_TITLES = [
  'gestor de tráfego',
  'gestor de trafego',
  'gestor responsável',
  'gestor responsavel',
  'gestor',
];

// Coluna opcional no Monday para vinculação do cliente com a instância
// uazapi/Supabase. Recebe o `token` da instância (UUID).
const COL_UAZAPI_TITLES = [
  'token uazapi',
  'uazapi token',
  'token bia',
  'token da instancia',
  'token instancia',
  'token',
];
// Obs: o vínculo Cliente ↔ Conta Meta é gerenciado dentro do software
// (tabela client_meta_links no Supabase), NÃO em coluna do Monday.

// Status do cliente — usado pra detectar churn ("perdido" ou "churn")
const COL_STATUS_TITLES = [
  'status',
  'status cliente',
  'status do cliente',
  'situacao',
  'situação',
];

// Data opcional em que o cliente virou churn. Se não preenchida, usamos
// o `updated_at` do item Monday como fallback aproximado.
const COL_DATA_CHURN_TITLES = [
  'data churn',
  'data perdido',
  'data de churn',
  'data de saida',
  'data de saída',
  'saiu em',
  'churn date',
];

// Filtros do usuário:
const GROUP_INCLUIR_TITLES = ['clientes ativos - plano à vista', 'clientes ativos - plano a vista'];
const TIPO_CLIENTE_INCLUIR = 'normal + bia soft';

function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

interface ColumnRaw {
  id: string;
  title: string;
  type: string;
}

interface ColumnValueRaw {
  id: string;
  text: string | null;
  type: string;
  value: string | null;
}

interface ItemRaw {
  id: string;
  name: string;
  updated_at: string | null;
  group: { id: string; title: string };
  column_values: ColumnValueRaw[];
}

interface GroupBasic {
  id: string;
  title: string;
}

interface MetaResp {
  data?: {
    boards?: Array<{
      id: string;
      columns: ColumnRaw[];
      groups: GroupBasic[];
    }>;
  };
  errors?: Array<{ message: string }>;
  error_message?: string;
}

interface GroupItemsResp {
  data?: {
    boards?: Array<{
      groups?: Array<{
        items_page: {
          cursor: string | null;
          items: ItemRaw[];
        };
      }>;
    }>;
  };
  errors?: Array<{ message: string }>;
  error_message?: string;
}

interface NextPageResp {
  data?: {
    next_items_page: {
      cursor: string | null;
      items: ItemRaw[];
    };
  };
  errors?: Array<{ message: string }>;
  error_message?: string;
}

export interface MondayClient {
  id: string;
  name: string;
  groupTitle: string;
  tipoCliente: string | null;
  cs: string | null;
  gestor: string | null;
  uazapiToken: string | null;
  status: string | null;
  dataChurn: string | null;   // valor cru da coluna (date column do Monday)
  updatedAt: string | null;   // last item update timestamp
}

async function gql<T extends { errors?: Array<{ message: string }>; error_message?: string }>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(MONDAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: config.MONDAY_TOKEN,
      'API-Version': MONDAY_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data: T = await res.json();
  if (!res.ok || data.errors || data.error_message) {
    const msg = data.error_message || data.errors?.[0]?.message || res.statusText;
    throw new Error(`[Monday] ${msg}`);
  }
  return data;
}

function findColumnId(columns: ColumnRaw[], titles: string[]): string | null {
  for (const c of columns) {
    const t = normalize(c.title);
    if (titles.some((needle) => t === normalize(needle))) return c.id;
  }
  for (const c of columns) {
    const t = normalize(c.title);
    if (titles.some((needle) => t.includes(normalize(needle)))) return c.id;
  }
  return null;
}

function readColText(item: ItemRaw, colId: string | null): string | null {
  if (!colId) return null;
  const cv = item.column_values.find((v) => v.id === colId);
  if (!cv) return null;
  return cv.text?.trim() || null;
}

const META_QUERY = `
  query ($boardId: ID!) {
    boards(ids: [$boardId]) {
      id
      columns { id title type }
      groups { id title }
    }
  }
`;

const GROUP_ITEMS_QUERY = `
  query ($boardId: ID!, $groupId: String!, $colIds: [String!], $limit: Int!) {
    boards(ids: [$boardId]) {
      groups(ids: [$groupId]) {
        items_page(limit: $limit) {
          cursor
          items {
            id
            name
            updated_at
            group { id title }
            column_values(ids: $colIds) { id text type value }
          }
        }
      }
    }
  }
`;

const NEXT_PAGE_QUERY = `
  query ($cursor: String!, $limit: Int!) {
    next_items_page(cursor: $cursor, limit: $limit) {
      cursor
      items {
        id
        name
        updated_at
        group { id title }
        column_values { id text type value }
      }
    }
  }
`;

async function fetchItemsForGroup(
  boardId: string,
  groupId: string,
  colIds: string[]
): Promise<ItemRaw[]> {
  const out: ItemRaw[] = [];

  const first = await gql<GroupItemsResp>(GROUP_ITEMS_QUERY, {
    boardId,
    groupId,
    colIds,
    limit: PAGE_LIMIT,
  });
  const page = first.data?.boards?.[0]?.groups?.[0]?.items_page;
  if (!page) return out;
  out.push(...page.items);

  let cursor = page.cursor;
  while (cursor) {
    const next = await gql<NextPageResp>(NEXT_PAGE_QUERY, { cursor, limit: PAGE_LIMIT });
    const np = next.data?.next_items_page;
    if (!np) break;
    out.push(...np.items);
    cursor = np.cursor;
  }
  return out;
}

export interface FetchClientsResult {
  clients: MondayClient[];
  groupsFound: string[];
  columnsResolved: {
    tipo: string | null;
    cs: string | null;
    gestor: string | null;
    uazapi: string | null;
    status: string | null;
    dataChurn: string | null;
  };
}

// Cliente está churned se status atual contém "perdido" ou "churn".
export function isClientChurned(client: MondayClient): boolean {
  const s = normalize(client.status);
  if (!s) return false;
  return s.includes('perdido') || s.includes('churn');
}

// Data de corte: leads/transferências/mensagens APÓS essa data não contam.
// Prioridade: coluna "Data Churn" → updated_at do item.
// Retorna null se o cliente não está churned ou não tem data válida.
export function getClientChurnCutoff(client: MondayClient): Date | null {
  if (!isClientChurned(client)) return null;
  const candidates = [client.dataChurn, client.updatedAt];
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export async function fetchMondayClients(): Promise<FetchClientsResult> {
  const boardId = config.MONDAY_BOARD_ID;
  if (!boardId || !config.MONDAY_TOKEN) {
    throw new Error('[Monday] Token ou board ID ausentes no .env');
  }

  // 1) Metadata (columns + groups)
  const meta = await gql<MetaResp>(META_QUERY, { boardId });
  const board = meta.data?.boards?.[0];
  if (!board) throw new Error('[Monday] Board não encontrado');

  const colTipo = findColumnId(board.columns, COL_TIPO_CLIENTE_TITLES);
  const colCs = findColumnId(board.columns, COL_CS_TITLES);
  const colGestor = findColumnId(board.columns, COL_GESTOR_TITLES);
  const colUazapi = findColumnId(board.columns, COL_UAZAPI_TITLES);
  const colStatus = findColumnId(board.columns, COL_STATUS_TITLES);
  const colDataChurn = findColumnId(board.columns, COL_DATA_CHURN_TITLES);
  const colIds = [colTipo, colCs, colGestor, colUazapi, colStatus, colDataChurn].filter(
    (x): x is string => Boolean(x)
  );

  // 2) Items por grupo (paralelo), trazendo apenas as 3 colunas resolvidas
  const groupResults = await Promise.all(
    board.groups.map((g) =>
      fetchItemsForGroup(boardId, g.id, colIds).catch((e) => {
        console.warn(`[Monday] grupo "${g.title}" falhou:`, e);
        return [] as ItemRaw[];
      })
    )
  );
  const allItems = groupResults.flat();

  const groupTitles = new Set(board.groups.map((g) => g.title));
  const groupsIncluir = new Set(
    board.groups
      .filter((g) => GROUP_INCLUIR_TITLES.some((n) => normalize(g.title) === normalize(n)))
      .map((g) => g.id)
  );

  const clients: MondayClient[] = [];
  const seen = new Set<string>();
  for (const item of allItems) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    const tipo = readColText(item, colTipo);
    const tipoNorm = normalize(tipo);
    const inGroup = groupsIncluir.has(item.group.id);
    const tipoMatches = tipoNorm === TIPO_CLIENTE_INCLUIR;

    if (!inGroup && !tipoMatches) continue;

    clients.push({
      id: item.id,
      name: item.name.trim(),
      groupTitle: item.group.title,
      tipoCliente: tipo,
      cs: readColText(item, colCs),
      gestor: readColText(item, colGestor),
      uazapiToken: readColText(item, colUazapi),
      status: readColText(item, colStatus),
      dataChurn: readColText(item, colDataChurn),
      updatedAt: item.updated_at ?? null,
    });
  }

  return {
    clients,
    groupsFound: Array.from(groupTitles),
    columnsResolved: {
      tipo: colTipo,
      cs: colCs,
      gestor: colGestor,
      uazapi: colUazapi,
      status: colStatus,
      dataChurn: colDataChurn,
    },
  };
}

// ============================================================================
// Board "📳 Clientes BIA Soft" (id 9887531051)
//
// Só consideramos para Gestor/CS clientes cuja "Fase" está em uma das
// categorias ATIVAS — Bia funcionando ou em fase de testes. Quando o
// cliente sai dessas fases (vira Pausado, Churn, etc.), automaticamente
// para de contar nas métricas no próximo refresh.
// ============================================================================
const BIA_SOFT_BOARD_ID = '9887531051';
const BIA_FASE_COL_ID = 'color_mktr1m3s';        // coluna "Fase" do board Bia Soft
const BIA_RESP_COL_ID = 'person';                 // coluna "Responsável" (people)
const BIA_CLIENT_REL_COL_ID = 'board_relation_mkzc177b'; // coluna "👥 Clientes" — link pro Monday principal

// Fases que CONTAM (case-insensitive, sem acento, match por substring).
const BIA_FASES_ATIVAS = [
  'i.a ativa',  // Bia rodando em produção
  'ia ativa',   // variação sem ponto
  'manutencao', // Manutenção (sem acento por causa do normalize)
];

function isFaseAtiva(fase: string | null | undefined): boolean {
  const n = normalize(fase);
  if (!n) return false;
  return BIA_FASES_ATIVAS.some((f) => n.includes(f));
}

const BIA_LIST_QUERY = `
  query ($boardId: ID!, $limit: Int!, $colIds: [String!]) {
    boards(ids: [$boardId]) {
      items_page(limit: $limit) {
        cursor
        items {
          id
          name
          column_values(ids: $colIds) {
            id
            text
            ... on BoardRelationValue { linked_item_ids }
          }
        }
      }
    }
  }
`;

const BIA_NEXT_PAGE_QUERY = `
  query ($cursor: String!, $limit: Int!) {
    next_items_page(cursor: $cursor, limit: $limit) {
      cursor
      items {
        id
        name
        column_values {
          id
          text
          ... on BoardRelationValue { linked_item_ids }
        }
      }
    }
  }
`;

interface BiaItem {
  id: string;
  name: string;
  column_values: Array<{
    id: string;
    text: string | null;
    linked_item_ids?: string[];
  }>;
}

interface BiaListResp {
  data?: {
    boards?: Array<{
      items_page: { cursor: string | null; items: BiaItem[] };
    }>;
  };
  errors?: Array<{ message: string }>;
  error_message?: string;
}

interface BiaNextResp {
  data?: {
    next_items_page: { cursor: string | null; items: BiaItem[] };
  };
  errors?: Array<{ message: string }>;
  error_message?: string;
}

function extractFase(item: BiaItem): string | null {
  const cv = item.column_values.find((c) => c.id === BIA_FASE_COL_ID);
  return cv?.text?.trim() || null;
}

function extractResponsavel(item: BiaItem): string | null {
  const cv = item.column_values.find((c) => c.id === BIA_RESP_COL_ID);
  return cv?.text?.trim() || null;
}

function extractClientIds(item: BiaItem): string[] {
  const cv = item.column_values.find((c) => c.id === BIA_CLIENT_REL_COL_ID);
  return cv?.linked_item_ids ?? [];
}

export interface BiaSoftData {
  /** Set de nomes (normalizados) — mantido por compat, mas use IDs quando possível. */
  activeNames: Set<string>;
  allNames: Set<string>;
  /** Set de IDs (monday_client_id) com Bia em fase ATIVA — match exato e confiável. */
  activeIds: Set<string>;
  /** Set de IDs de TODOS os clientes vinculados no Bia Soft (qualquer fase). */
  allIds: Set<string>;
  /** Map<monday_client_id, responsável> — responsável pelo cliente. */
  responsavelByClientId: Map<string, string>;
  /** Mantido por compat. */
  responsavelByName: Map<string, string>;
  /** Lista única de responsáveis (Gabriel, Eduardo) com Fase ativa. */
  responsaveis: string[];
}

/**
 * Busca dados do board 📳 Clientes BIA Soft:
 * - Conjunto de nomes com Fase ativa (I.A ativa / Manutenção)
 * - Mapa cliente → responsável (Gabriel Velho / Eduardo Henckemaier)
 */
export async function fetchBiaSoftData(): Promise<BiaSoftData> {
  const activeNames = new Set<string>();
  const allNames = new Set<string>();
  const activeIds = new Set<string>();
  const allIds = new Set<string>();
  const responsavelByName = new Map<string, string>();
  const responsavelByClientId = new Map<string, string>();
  const responsaveisSet = new Set<string>();
  if (!config.MONDAY_TOKEN) {
    return {
      activeNames, allNames, activeIds, allIds,
      responsavelByName, responsavelByClientId,
      responsaveis: [],
    };
  }

  function process(it: BiaItem) {
    const key = normalize(it.name);
    if (!key) return;
    allNames.add(key);
    const isAtivo = isFaseAtiva(extractFase(it));
    if (isAtivo) activeNames.add(key);
    // Coluna 👥 Clientes — IDs do Monday principal vinculados a este item
    const linkedIds = extractClientIds(it);
    for (const cid of linkedIds) {
      allIds.add(cid);
      if (isAtivo) activeIds.add(cid);
    }
    const resp = extractResponsavel(it);
    if (resp) {
      responsavelByName.set(key, resp);
      for (const cid of linkedIds) responsavelByClientId.set(cid, resp);
      if (isAtivo) responsaveisSet.add(resp);
    }
  }

  try {
    const first = await gql<BiaListResp>(BIA_LIST_QUERY, {
      boardId: BIA_SOFT_BOARD_ID,
      limit: PAGE_LIMIT,
      colIds: [BIA_FASE_COL_ID, BIA_RESP_COL_ID, BIA_CLIENT_REL_COL_ID],
    });
    const page = first.data?.boards?.[0]?.items_page;
    if (page) {
      for (const it of page.items) process(it);
      let cursor = page.cursor;
      while (cursor) {
        const next = await gql<BiaNextResp>(BIA_NEXT_PAGE_QUERY, {
          cursor,
          limit: PAGE_LIMIT,
        });
        const np = next.data?.next_items_page;
        if (!np) break;
        for (const it of np.items) process(it);
        cursor = np.cursor;
      }
    }
  } catch (e) {
    console.warn('[Monday] falha ao buscar dados Bia Soft:', e);
  }

  return {
    activeNames,
    allNames,
    activeIds,
    allIds,
    responsavelByName,
    responsavelByClientId,
    responsaveis: Array.from(responsaveisSet).sort(),
  };
}

/**
 * Mantida por compatibilidade — só retorna o Set de nomes ativos.
 * Internamente usa fetchBiaSoftData.
 */
export async function fetchBiaSoftClientNames(): Promise<Set<string>> {
  const d = await fetchBiaSoftData();
  return d.activeNames;
}

// Stopwords usadas no match por palavras (Dra., conectivos, descritores)
const NAME_STOPWORDS = new Set([
  'dr', 'dra', 'drs', 'doutor', 'doutora',
  'e', 'de', 'do', 'da', 'dos', 'das', 'a', 'o',
  'sr', 'sra', 'instituto', 'clinica', 'odontologia', 'odontologica',
  'consultorio', 'consultório',
]);

/** Tokeniza um nome (já normalizado) em palavras-chave relevantes. */
function nameTokens(s: string): Set<string> {
  const cleaned = s
    .replace(/[.,()\-_\/]/g, ' ')   // remove pontuação
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return new Set();
  const words = cleaned.split(' ').filter((w) => w && !NAME_STOPWORDS.has(w));
  return new Set(words);
}

/**
 * Match flexível entre dois nomes (já normalizados). Considera match se
 * existirem pelo menos 2 palavras-chave em comum entre os dois conjuntos.
 *
 * Ex:
 * - "thais e gustavo" vs "instituto jovanelli dra thais e dr gustavo"
 *   → comum {thais, gustavo} = 2 → match ✓
 * - "julio mota daniele mota" vs "clinica coi dr julio dra daniele"
 *   → comum {julio, daniele} = 2 → match ✓
 * - "bianca menezes" vs "bianca panza"
 *   → comum {bianca} = 1 → não match ✓
 */
function namesMatchByWords(a: string, b: string): boolean {
  const wa = nameTokens(a);
  const wb = nameTokens(b);
  if (wa.size < 2 || wb.size < 2) return false;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common >= 2;
}

/** Match cliente Monday × IDs do board Bia Soft (match exato via board_relation). */
export function isClientNoBiaSoftById(
  client: MondayClient,
  biaIds: Set<string>
): boolean {
  if (biaIds.size === 0) return false;
  return biaIds.has(client.id);
}

/** @deprecated Use isClientNoBiaSoftById — match por nome era frágil. */
export function isClientNoBiaSoft(
  client: MondayClient,
  biaNames: Set<string>
): boolean {
  if (biaNames.size === 0) return true;
  const n = normalize(client.name);
  if (biaNames.has(n)) return true;
  for (const bn of biaNames) {
    if (n.includes(bn) || bn.includes(n)) return true;
    if (namesMatchByWords(n, bn)) return true;
  }
  return false;
}

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
const BIA_EMAIL_PROG_COL_ID = 'text_mm1m7x5r';    // coluna "Email programador"
const BIA_EMAIL_CS_COL_ID = 'text_mm1kad0k';      // coluna "Email CS"
const BIA_EMAIL_GESTOR_COL_ID = 'text_mm1k92bf';  // coluna "Email gestor"
const BIA_CS_COL_ID = 'lookup_mkzp69ax';          // coluna "CS" (mirror)
const BIA_GESTOR_COL_ID = 'lookup_mkzphsas';      // coluna "Gestor" (mirror)

// Fases que CONTAM (case-insensitive, sem acento, match por substring).
// Manutenção REMOVIDA — clientes em manutenção não contam mais nas métricas
// nem em CS, nem em Gestor, nem em Programação. Leads históricos ficam
// preservados no banco (visíveis no drill-down do cliente).
const BIA_FASES_ATIVAS = [
  'i.a ativa',  // Bia rodando em produção
  'ia ativa',   // variação sem ponto
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
            ... on MirrorValue { display_value }
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
          ... on MirrorValue { display_value }
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
    display_value?: string | null;
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

function extractColumnText(item: BiaItem, colId: string): string | null {
  const cv = item.column_values.find((c) => c.id === colId);
  // Mirror columns retornam o valor em display_value, não em text.
  return cv?.text?.trim() || cv?.display_value?.trim() || null;
}

/** Casa nome longo (Bia Soft) com versão curta (Monday principal).
 *  Ex: "Paula Adamante Souza" casa com "Paula", "Anne Camargo" casa com "Anne Camargo".
 *  Heurística: o nome `short` é considerado "começo" do nome `full`. */
export function nameMatchesScope(scope: string, candidate: string): boolean {
  const a = scope.trim().toLowerCase();
  const b = candidate.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  // Scope (longo, ex: "Paula Adamante Souza") começa com candidate (curto: "Paula")
  if (a.startsWith(b + ' ')) return true;
  // Ou vice-versa
  if (b.startsWith(a + ' ')) return true;
  return false;
}

/** Transição de Fase: timestamp em que mudou + label antiga + nova. */
export interface FaseTransition {
  ts: string;           // ISO timestamp UTC
  prev: string | null;
  next: string | null;
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
  /** Map<monday_client_id, fase atual>. */
  faseByClientId: Map<string, string>;
  /** Map<bia_item_id, monday_client_id[]> — bridge entre os 2 boards. */
  clientIdsByBiaItemId: Map<string, string[]>;
  /** Mantido por compat. */
  responsavelByName: Map<string, string>;
  /** Lista única de responsáveis (Gabriel, Eduardo) com Fase ativa. */
  responsaveis: string[];
  /** email (lowercase) → nome do CS (do Monday principal via mirror).
   *  Usado para autenticação por email. */
  csByEmail: Map<string, string>;
  /** email (lowercase) → nome do Gestor. */
  gestorByEmail: Map<string, string>;
  /** email (lowercase) → nome do Responsável de programação. */
  programadorByEmail: Map<string, string>;
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
  const faseByClientId = new Map<string, string>();
  const clientIdsByBiaItemId = new Map<string, string[]>();
  const responsaveisSet = new Set<string>();
  const csByEmail = new Map<string, string>();
  const gestorByEmail = new Map<string, string>();
  const programadorByEmail = new Map<string, string>();
  if (!config.MONDAY_TOKEN) {
    return {
      activeNames, allNames, activeIds, allIds,
      responsavelByName, responsavelByClientId,
      faseByClientId, clientIdsByBiaItemId,
      responsaveis: [],
      csByEmail, gestorByEmail, programadorByEmail,
    };
  }

  function processEmails(emailRaw: string | null, name: string | null, map: Map<string, string>) {
    if (!emailRaw || !name) return;
    // Pode conter múltiplos emails separados por vírgula/quebra de linha/espaço
    const parts = emailRaw.split(/[\s,;]+/).filter(Boolean);
    for (const p of parts) {
      const e = p.toLowerCase().trim();
      if (!e.includes('@')) continue;
      if (!map.has(e)) map.set(e, name);
    }
  }

  function process(it: BiaItem) {
    const key = normalize(it.name);
    if (!key) return;
    allNames.add(key);
    const fase = extractFase(it);
    const isAtivo = isFaseAtiva(fase);
    if (isAtivo) activeNames.add(key);
    // Coluna 👥 Clientes — IDs do Monday principal vinculados a este item
    const linkedIds = extractClientIds(it);
    if (linkedIds.length > 0) {
      clientIdsByBiaItemId.set(it.id, linkedIds);
    }
    for (const cid of linkedIds) {
      allIds.add(cid);
      if (isAtivo) activeIds.add(cid);
      if (fase) faseByClientId.set(cid, fase);
    }
    const resp = extractResponsavel(it);
    if (resp) {
      responsavelByName.set(key, resp);
      for (const cid of linkedIds) responsavelByClientId.set(cid, resp);
      if (isAtivo) responsaveisSet.add(resp);
    }
    // === Emails ===
    // CS / Gestor: nomes vêm via mirror, emails como texto.
    const csName = extractColumnText(it, BIA_CS_COL_ID);
    const gestorName = extractColumnText(it, BIA_GESTOR_COL_ID);
    processEmails(extractColumnText(it, BIA_EMAIL_CS_COL_ID), csName, csByEmail);
    processEmails(extractColumnText(it, BIA_EMAIL_GESTOR_COL_ID), gestorName, gestorByEmail);
    // Programador: email mapeado pro NOME do responsável (people column).
    processEmails(extractColumnText(it, BIA_EMAIL_PROG_COL_ID), resp, programadorByEmail);
  }

  try {
    const first = await gql<BiaListResp>(BIA_LIST_QUERY, {
      boardId: BIA_SOFT_BOARD_ID,
      limit: PAGE_LIMIT,
      colIds: [
        BIA_FASE_COL_ID,
        BIA_RESP_COL_ID,
        BIA_CLIENT_REL_COL_ID,
        BIA_EMAIL_PROG_COL_ID,
        BIA_EMAIL_CS_COL_ID,
        BIA_EMAIL_GESTOR_COL_ID,
        BIA_CS_COL_ID,
        BIA_GESTOR_COL_ID,
      ],
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
    faseByClientId,
    clientIdsByBiaItemId,
    responsaveis: Array.from(responsaveisSet).sort(),
    csByEmail,
    gestorByEmail,
    programadorByEmail,
  };
}

// ============================================================================
// Activity Log do Bia Soft — timeline de mudanças de Fase por cliente
// ============================================================================

interface ActivityLogRaw {
  id: string;
  event: string;
  data: string;       // JSON string com pulse_id, previous_value, value
  created_at: string; // Monday usa 100-ns intervals (string numerica)
}

interface ActivityLogsResp {
  data?: {
    boards?: Array<{
      activity_logs: ActivityLogRaw[];
    }>;
  };
  errors?: Array<{ message: string }>;
  error_message?: string;
}

const ACTIVITY_LOGS_QUERY = `
  query ($boardId: ID!, $limit: Int!, $page: Int!, $colId: String!, $from: ISO8601DateTime!) {
    boards(ids: [$boardId]) {
      activity_logs(
        limit: $limit
        page: $page
        column_ids: [$colId]
        from: $from
      ) {
        id
        event
        data
        created_at
      }
    }
  }
`;

/**
 * Converte o created_at do Monday (string numerica em 100-ns intervals)
 * em uma string ISO UTC.
 */
function mondayTsToIso(createdAt: string): string | null {
  // Monday: numero representa 100-nanosecond units desde epoch
  // → divide por 10000 pra obter ms
  const n = Number(createdAt);
  if (!Number.isFinite(n)) return null;
  const ms = Math.floor(n / 10000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

interface ParsedLog {
  pulseId: string;
  prev: string | null;
  next: string | null;
  ts: string;
}

function parseActivityLog(log: ActivityLogRaw): ParsedLog | null {
  try {
    const d = JSON.parse(log.data) as {
      pulse_id?: number | string;
      previous_value?: { label?: { text?: string } } | null;
      value?: { label?: { text?: string } } | null;
    };
    const pulseId = d.pulse_id != null ? String(d.pulse_id) : '';
    if (!pulseId) return null;
    const prev = d.previous_value?.label?.text ?? null;
    const next = d.value?.label?.text ?? null;
    const ts = mondayTsToIso(log.created_at);
    if (!ts) return null;
    return { pulseId, prev, next, ts };
  } catch {
    return null;
  }
}

/**
 * Busca a timeline de mudanças da coluna "Fase" no board Bia Soft.
 * Retorna Map<bia_item_id, FaseTransition[]> ordenado por timestamp asc.
 *
 * @param sinceDays quantos dias atrás buscar (default 90).
 */
export async function fetchBiaFaseTimeline(
  sinceDays: number = 90
): Promise<Map<string, FaseTransition[]>> {
  const out = new Map<string, FaseTransition[]>();
  if (!config.MONDAY_TOKEN) return out;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const fromIso = since.toISOString();

  try {
    let page = 1;
    while (page < 50) {
      const resp = await gql<ActivityLogsResp>(ACTIVITY_LOGS_QUERY, {
        boardId: BIA_SOFT_BOARD_ID,
        limit: 500,
        page,
        colId: BIA_FASE_COL_ID,
        from: fromIso,
      });
      const logs = resp.data?.boards?.[0]?.activity_logs ?? [];
      if (logs.length === 0) break;
      for (const raw of logs) {
        const p = parseActivityLog(raw);
        if (!p) continue;
        const arr = out.get(p.pulseId) ?? [];
        arr.push({ ts: p.ts, prev: p.prev, next: p.next });
        out.set(p.pulseId, arr);
      }
      if (logs.length < 500) break;
      page++;
    }
    // Ordena ascendente por timestamp
    for (const [k, arr] of out) {
      arr.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
      out.set(k, arr);
    }
  } catch (e) {
    console.warn('[Monday] falha ao buscar activity_logs:', e);
  }
  return out;
}

/**
 * Constrói "janelas ativas" para um cliente no período [start, end].
 * Retorna intervalos [s, e] em que o cliente estava em fase ativa.
 *
 * @param timeline transições do board Bia Soft (do mais antigo ao mais recente)
 * @param currentFase fase ATUAL do cliente (a do board, hoje)
 * @param start início do período de análise (Date)
 * @param end fim do período de análise (Date)
 */
export function buildActiveWindows(
  timeline: FaseTransition[],
  currentFase: string | null | undefined,
  start: Date,
  end: Date,
  isFaseAtivaCheck: (s: string | null | undefined) => boolean = isFaseAtiva
): Array<{ start: Date; end: Date }> {
  const windows: Array<{ start: Date; end: Date }> = [];
  if (!timeline || timeline.length === 0) {
    // Sem transições no período → assume fase atual durante todo o intervalo
    if (isFaseAtivaCheck(currentFase)) {
      windows.push({ start, end });
    }
    return windows;
  }
  // Estado inicial = prev do primeiro log
  let state: string | null | undefined = timeline[0].prev ?? currentFase;
  let cursor = new Date(0); // antes de tudo
  for (const tr of timeline) {
    const trTs = new Date(tr.ts);
    if (isFaseAtivaCheck(state)) {
      const ws = cursor.getTime() > start.getTime() ? cursor : start;
      const we = trTs.getTime() < end.getTime() ? trTs : end;
      if (we > ws) windows.push({ start: ws, end: we });
    }
    state = tr.next;
    cursor = trTs;
  }
  // Após a última transição
  if (isFaseAtivaCheck(state)) {
    const ws = cursor.getTime() > start.getTime() ? cursor : start;
    if (end > ws) windows.push({ start: ws, end });
  }
  return windows;
}

/**
 * Fração 0..1 de um dia que o cliente esteve ativo.
 */
export function fracaoAtivaNoDia(
  dateStr: string, // YYYY-MM-DD
  windows: Array<{ start: Date; end: Date }>
): number {
  const d0 = new Date(`${dateStr}T00:00:00.000Z`);
  const d1 = new Date(`${dateStr}T23:59:59.999Z`);
  const total = d1.getTime() - d0.getTime();
  let ativo = 0;
  for (const w of windows) {
    const s = w.start.getTime() > d0.getTime() ? w.start : d0;
    const e = w.end.getTime() < d1.getTime() ? w.end : d1;
    if (e.getTime() > s.getTime()) ativo += e.getTime() - s.getTime();
  }
  return total > 0 ? ativo / total : 0;
}

// ============================================================================
// Fetch enxuto pra autenticação — pega só os emails do Bia Soft.
// Bem mais leve que fetchBiaSoftData (não puxa Fase, board_relation, etc.).
// ============================================================================
export interface AuthEmailsResult {
  csByEmail: Map<string, string>;
  gestorByEmail: Map<string, string>;
  programadorByEmail: Map<string, string>;
}

const AUTH_EMAILS_QUERY = `
  query ($boardId: ID!, $limit: Int!) {
    boards(ids: [$boardId]) {
      items_page(limit: $limit) {
        cursor
        items {
          column_values(ids: [
            "person",
            "text_mm1m7x5r",
            "text_mm1kad0k",
            "text_mm1k92bf",
            "lookup_mkzp69ax",
            "lookup_mkzphsas"
          ]) {
            id
            text
            ... on MirrorValue { display_value }
          }
        }
      }
    }
  }
`;

const AUTH_EMAILS_NEXT_QUERY = `
  query ($cursor: String!, $limit: Int!) {
    next_items_page(cursor: $cursor, limit: $limit) {
      cursor
      items {
        column_values {
          id
          text
          ... on MirrorValue { display_value }
        }
      }
    }
  }
`;

export async function fetchAuthEmails(): Promise<AuthEmailsResult> {
  const csByEmail = new Map<string, string>();
  const gestorByEmail = new Map<string, string>();
  const programadorByEmail = new Map<string, string>();

  if (!config.MONDAY_TOKEN) {
    return { csByEmail, gestorByEmail, programadorByEmail };
  }

  function getValue(cv: { text?: string | null; display_value?: string | null } | undefined) {
    return cv?.text?.trim() || cv?.display_value?.trim() || null;
  }
  function processEmails(emailRaw: string | null, name: string | null, map: Map<string, string>) {
    if (!emailRaw || !name) return;
    const parts = emailRaw.split(/[\s,;]+/).filter(Boolean);
    for (const p of parts) {
      const e = p.toLowerCase().trim();
      if (!e.includes('@')) continue;
      if (!map.has(e)) map.set(e, name);
    }
  }

  interface AuthItem { column_values: Array<{ id: string; text?: string | null; display_value?: string | null }>; }
  interface AuthPage { cursor: string | null; items: AuthItem[] }
  interface AuthResp { data?: { boards?: Array<{ items_page: AuthPage }> }; errors?: Array<{ message: string }>; error_message?: string }
  interface AuthNextResp { data?: { next_items_page: AuthPage }; errors?: Array<{ message: string }>; error_message?: string }

  function processItem(it: AuthItem) {
    const cvMap: Record<string, { text?: string | null; display_value?: string | null }> = {};
    for (const cv of it.column_values) cvMap[cv.id] = cv;
    const resp = getValue(cvMap['person']);
    const csName = getValue(cvMap['lookup_mkzp69ax']);
    const gestorName = getValue(cvMap['lookup_mkzphsas']);
    processEmails(getValue(cvMap['text_mm1kad0k']), csName, csByEmail);
    processEmails(getValue(cvMap['text_mm1k92bf']), gestorName, gestorByEmail);
    processEmails(getValue(cvMap['text_mm1m7x5r']), resp, programadorByEmail);
  }

  try {
    const first = await gql<AuthResp>(AUTH_EMAILS_QUERY, {
      boardId: BIA_SOFT_BOARD_ID,
      limit: PAGE_LIMIT,
    });
    const page = first.data?.boards?.[0]?.items_page;
    if (page) {
      for (const it of page.items) processItem(it);
      let cursor = page.cursor;
      while (cursor) {
        const next = await gql<AuthNextResp>(AUTH_EMAILS_NEXT_QUERY, {
          cursor,
          limit: PAGE_LIMIT,
        });
        const np = next.data?.next_items_page;
        if (!np) break;
        for (const it of np.items) processItem(it);
        cursor = np.cursor;
      }
    }
  } catch (e) {
    console.warn('[Monday] falha ao buscar emails de auth:', e);
  }

  return { csByEmail, gestorByEmail, programadorByEmail };
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

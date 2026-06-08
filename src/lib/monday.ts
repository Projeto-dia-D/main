import { config, getCsOverride, isCsOculto, resolveCsFromPeople } from '../config';
import { supabase } from './supabase';

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

const COL_DATA_ENTRADA_TITLES = [
  'data de entrada',
  'data entrada',
  'entrou em',
  'início do contrato',
  'inicio do contrato',
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
  display_value?: string | null;   // pra FormulaValue / MirrorValue
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

interface BoardItemsResp {
  data?: {
    boards?: Array<{
      items_page: {
        cursor: string | null;
        items: ItemRaw[];
      };
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
  /** Data de entrada do cliente na agência (Monday: coluna formula "Data de
   *  entrada"). Formato cru "DD/MM/YYYY" — use parseDataEntrada() pra Date. */
  dataEntrada: string | null;
  updatedAt: string | null;
}

/** Parseia "01/12/2025" (Data de entrada do Monday) pra Date.
 *  Aceita também "1/12/2025" (sem zero à esquerda) e ISO. */
export function parseDataEntrada(s: string | null | undefined): Date | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // DD/MM/YYYY ou D/M/YYYY (com ou sem zero à esquerda)
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      return new Date(year, mon - 1, day);
    }
  }
  // ISO ou outros formatos
  const iso = new Date(trimmed);
  return isNaN(iso.getTime()) ? null : iso;
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
  // Pra FormulaValue/MirrorValue, .text vem null — usa display_value como fallback
  return cv.text?.trim() || cv.display_value?.trim() || null;
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

const BOARD_ITEMS_QUERY = `
  query ($boardId: ID!, $colIds: [String!], $limit: Int!) {
    boards(ids: [$boardId]) {
      items_page(limit: $limit) {
        cursor
        items {
          id
          name
          updated_at
          group { id title }
          column_values(ids: $colIds) {
            id
            text
            type
            value
            ... on FormulaValue { display_value }
            ... on MirrorValue { display_value }
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
        column_values {
          id
          text
          type
          value
          ... on FormulaValue { display_value }
          ... on MirrorValue { display_value }
        }
      }
    }
  }
`;

/**
 * Pagina TODOS os itens do board de uma vez (board-level), sequencialmente.
 *
 * IMPORTANTE: NÃO buscar grupo a grupo em paralelo. O Monday tem rate limit
 * por campo no `items_page`/`next_items_page` — disparar os ~20 grupos do board
 * simultaneamente (Promise.all) estoura com "Rate limit exceeded for the field"
 * e o load volta parcial (ex: 290 de 753), acionando o guard anti-regressão que
 * descarta tudo. Como cada item já traz `group { id title }`, uma única
 * paginação do board inteiro dá a mesma informação sem o burst. Mesmo padrão de
 * fetchBiaSoftData.
 */
async function fetchAllBoardItems(
  boardId: string,
  colIds: string[]
): Promise<ItemRaw[]> {
  const out: ItemRaw[] = [];

  const first = await gql<BoardItemsResp>(BOARD_ITEMS_QUERY, {
    boardId,
    colIds,
    limit: PAGE_LIMIT,
  });
  const page = first.data?.boards?.[0]?.items_page;
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
  /** Clientes que passam pelo filtro de grupo/tipo (ativos no Plano à vista
   *  ou tipo "Normal + Bia Soft"). Usado pelas abas Gestor/CS/Programação. */
  clients: MondayClient[];
  /** TODOS os clientes do board principal, INCLUINDO churnados, pausados,
   *  perdidos etc. Usado pela aba Saúde do Cliente. */
  clientsAll: MondayClient[];
  groupsFound: string[];
  columnsResolved: {
    tipo: string | null;
    cs: string | null;
    gestor: string | null;
    uazapi: string | null;
    status: string | null;
    dataChurn: string | null;
    dataEntrada: string | null;
  };
}

// Cliente está churned se status atual contém "perdido" ou "churn".
export function isClientChurned(client: MondayClient): boolean {
  const s = normalize(client.status);
  if (!s) return false;
  return s.includes('perdido') || s.includes('churn');
}

/**
 * Cliente está PAUSADO se status atual ou grupo do board contém "pausa".
 * Pausados não rodam campanhas → não precisam de vínculo Meta.
 *
 * NÃO inclui "Aviso prévio 60 dias" — esses clientes AINDA ESTÃO ATIVOS
 * (notificaram que vão sair em 60 dias mas continuam pagando e a Bia segue
 * rodando). Tratá-los como pausados sumia eles de banner/painéis indevidamente.
 */
export function isClientPausado(client: MondayClient): boolean {
  const s = normalize(client.status);
  const g = normalize(client.groupTitle);
  return s.includes('pausa') || g.includes('pausa');
}

/**
 * Cliente está em PROCESSO JURÍDICO se status/grupo contém "juridico".
 * Esses também não rodam campanhas → não precisam de vínculo Meta.
 */
export function isClientJuridico(client: MondayClient): boolean {
  const s = normalize(client.status);
  const g = normalize(client.groupTitle);
  return s.includes('juridico') || g.includes('juridico') || g.includes('inadimpl');
}

/**
 * Cliente ATIVO na Burst — elegível pra vínculo Meta.
 * Critério: NÃO é churn, NÃO é pausa, NÃO é jurídico.
 * Esses são os doutores que rodam tráfego ativamente → todos devem ter
 * conta Meta vinculada.
 */
export function isClientElegivelMeta(client: MondayClient): boolean {
  if (isClientChurned(client)) return false;
  if (isClientPausado(client)) return false;
  if (isClientJuridico(client)) return false;
  return true;
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
  const colDataEntrada = findColumnId(board.columns, COL_DATA_ENTRADA_TITLES);
  // Coluna "CS" (people) — onde o time põe o novo CS quando o antigo sai (a
  // "CS do projeto"/status às vezes fica desatualizada com o CS que saiu).
  // ID fixo: o título "CS" colidiria com a coluna de status no findColumnId.
  const COL_CS_PEOPLE = 'pessoas_2__1';
  const colIds = [colTipo, colCs, colGestor, colUazapi, colStatus, colDataChurn, colDataEntrada, COL_CS_PEOPLE].filter(
    (x): x is string => Boolean(x)
  );

  // 2) Items do board inteiro, paginados sequencialmente (board-level).
  //    NÃO fan-out por grupo — ver fetchAllBoardItems (evita "Rate limit
  //    exceeded for the field" do Monday). Cada item já traz group{id title}
  //    pro filtro de grupo/tipo abaixo.
  const allItems = await fetchAllBoardItems(boardId, colIds);

  const groupTitles = new Set(board.groups.map((g) => g.title));
  const groupsIncluir = new Set(
    board.groups
      .filter((g) => GROUP_INCLUIR_TITLES.some((n) => normalize(g.title) === normalize(n)))
      .map((g) => g.id)
  );

  const clients: MondayClient[] = [];
  const clientsAll: MondayClient[] = [];
  const seen = new Set<string>();
  for (const item of allItems) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    const tipo = readColText(item, colTipo);
    const tipoNorm = normalize(tipo);
    const inGroup = groupsIncluir.has(item.group.id);
    const tipoMatches = tipoNorm === TIPO_CLIENTE_INCLUIR;

    const monClient: MondayClient = {
      id: item.id,
      name: item.name.trim(),
      groupTitle: item.group.title,
      tipoCliente: tipo,
      // CS: override explícito (linkados-ativos com piso) > resolução
      // automática da coluna "CS" people pra quem está como CS oculto (Yasmin)
      // > valor do status. '' quando o CS saiu e não há novo responsável.
      cs: getCsOverride(item.id)
        ?? (isCsOculto(readColText(item, colCs))
          ? (resolveCsFromPeople(readColText(item, COL_CS_PEOPLE)) ?? '')
          : readColText(item, colCs)),
      gestor: readColText(item, colGestor),
      uazapiToken: readColText(item, colUazapi),
      status: readColText(item, colStatus),
      dataChurn: readColText(item, colDataChurn),
      dataEntrada: readColText(item, colDataEntrada),
      updatedAt: item.updated_at ?? null,
    };
    // SEMPRE adiciona em clientsAll (todos os grupos)
    clientsAll.push(monClient);
    // Em `clients` (filtrado) só entra se passar pelo filtro
    if (inGroup || tipoMatches) clients.push(monClient);
  }

  return {
    clients,
    clientsAll,
    groupsFound: Array.from(groupTitles),
    columnsResolved: {
      tipo: colTipo,
      cs: colCs,
      gestor: colGestor,
      uazapi: colUazapi,
      status: colStatus,
      dataChurn: colDataChurn,
      dataEntrada: colDataEntrada,
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

/** Versao publica de isFaseAtiva — exportada pra outros modules (metrics.ts) */
export function isFaseAtivaPublic(fase: string | null | undefined): boolean {
  return isFaseAtiva(fase);
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
 * Threshold de "staleness" do sync — se a ultima atualizacao do
 * Supabase foi ha mais de X minutos, considera que o sync parou
 * (PC desligado, task quebrada, etc.) e retorna vazio pra forcar
 * fallback pro Monday GraphQL.
 *
 * 30 min = 2 ciclos de sync (que roda a cada 15 min). Se passou
 * isso, algo ta errado com o sync.
 */
const SUPABASE_SYNC_STALE_MIN = 30;

/**
 * Verifica se o sync do Supabase ta atualizado o suficiente pra ser
 * usado. Le `monday_sync_meta[key].updated_at` e compara com agora.
 *
 * Retorna `true` se o sync ta "fresco" (< SUPABASE_SYNC_STALE_MIN min).
 * Retorna `false` se:
 *   - O key nao existe (sync nunca rodou)
 *   - O updated_at e mais antigo que o threshold
 *   - Qualquer erro de conexao com Supabase
 *
 * `false` significa "nao confie no Supabase, use Monday direto".
 */
async function isSupabaseSyncFresh(syncKey: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('monday_sync_meta')
      .select('updated_at')
      .eq('key', syncKey)
      .maybeSingle();
    if (error || !data) return false;
    const updatedAt = new Date(String((data as { updated_at: string }).updated_at));
    if (isNaN(updatedAt.getTime())) return false;
    const ageMin = (Date.now() - updatedAt.getTime()) / 60000;
    return ageMin <= SUPABASE_SYNC_STALE_MIN;
  } catch {
    return false;
  }
}

/**
 * Versao Supabase do fetchBiaFaseTimeline — le da tabela
 * `monday_bia_fase_timeline` (espelho mantido pelo script de sync
 * a cada 15 min). Drop-in replacement: mesma assinatura e mesmo shape
 * de retorno, mas em ~1 query rapida ao Supabase ao inves de ate 50
 * paginas de activity_logs do Monday GraphQL.
 *
 * Comportamento de fallback:
 *   - Se o sync ta velho (> 30 min sem rodar) → retorna Map vazio
 *     pra forcar o caller a chamar fetchBiaFaseTimeline (Monday).
 *   - Se a tabela nao existir ou der erro → idem.
 *   - Se o sync ta fresco → usa Supabase (rapido).
 *
 * Garante que o app SEMPRE tem dado atualizado, independente do
 * estado do PC que roda o sync.
 */
export async function fetchBiaFaseTimelineFromSupabase(
  sinceDays: number = 90
): Promise<Map<string, FaseTransition[]>> {
  const out = new Map<string, FaseTransition[]>();

  // Aborta cedo se sync ta velho — caller cai pro Monday GraphQL.
  if (!(await isSupabaseSyncFresh('bia_fase_timeline'))) {
    console.info('[Supabase] sync de bia_fase_timeline stale/ausente → vai cair pro Monday');
    return out;
  }

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    // supabase-js default = 1000 rows max por query. Pagina pra cobrir
    // periodos longos com muito movimento.
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('monday_bia_fase_timeline')
        .select('bia_item_id, prev_label, next_label, ts')
        .gte('ts', since)
        .order('ts', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) break;
      for (const row of rows) {
        const biaId = String((row as { bia_item_id: string | number }).bia_item_id);
        if (!biaId) continue;
        const arr = out.get(biaId) ?? [];
        arr.push({
          ts: String((row as { ts: string }).ts),
          prev: ((row as { prev_label: string | null }).prev_label) ?? null,
          next: ((row as { next_label: string | null }).next_label) ?? null,
        });
        out.set(biaId, arr);
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    // Ja vem ordenado por ts asc pela query — nao precisa re-sortar.
  } catch (e) {
    console.warn('[Supabase] falha ao buscar monday_bia_fase_timeline:', e);
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
  /** Designer → nome. Construído cruzando Central de Design + workspace. */
  designerByEmail: Map<string, string>;
  /** Foto de perfil do Monday por email (lowercased). Vazio se o user não
   *  tem conta no workspace ou se a query falhou. */
  photoByEmail: Map<string, string>;
  /** Map<nomeNormalizado, photoUrl> — útil pra quando só temos o nome
   *  (ex: card de perfil pessoal mostrando outro user). */
  photoByName: Map<string, string>;
  /** Map<primeiroNomeLowercase, photoUrl> — fallback quando só sabemos
   *  o primeiro nome (ex: tab "RICARDO" → matcha Ricardo Paes Fronza). */
  photoByFirstName: Map<string, string>;
  /** workspace Monday: email lowercase → nome completo do user.
   *  Usado pra resolver login quando o email do Bia Soft está desatualizado
   *  (ex: app espera "ricardofronza@" mas Monday tem "ricardo@"). */
  workspaceNameByEmail: Map<string, string>;
}


export interface UserPhotosResult {
  byEmail: Map<string, string>;
  /** name.toLowerCase().trim() → photoUrl. */
  byName: Map<string, string>;
  /** first-name.toLowerCase() → photoUrl. Fallback útil quando o app só
   *  tem o primeiro nome (ex: "RICARDO" → "ricardo paes fronza"). */
  byFirstName: Map<string, string>;
  /** workspace Monday: email lowercased → nome completo. Usado pra
   *  resolver login quando a coluna do board tem email desatualizado. */
  workspaceNameByEmail: Map<string, string>;
}

const CENTRAL_DESIGN_BOARD_ID = '3519879202';
const DESIGN_PERSON_COL_ID = 'person'; // "Designer Responsável"

/**
 * Busca designers únicos do board "Central de Design", cruzando com os users
 * do workspace pra resolver email. Retorna Map<email, nome>.
 */
export async function fetchDesigners(
  workspaceNameByEmail: Map<string, string>
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!config.MONDAY_TOKEN) return map;

  // Inverte workspace: nome lowercase → email
  const emailByName = new Map<string, string>();
  for (const [email, name] of workspaceNameByEmail) {
    emailByName.set(name.trim().toLowerCase(), email);
  }

  interface DesignResp {
    data?: { boards?: Array<{ items_page: { items: Array<{ column_values: Array<{ id: string; text: string | null }> }> } }> };
    errors?: Array<{ message: string }>;
    error_message?: string;
  }

  try {
    const res = await gql<DesignResp>(
      `query ($boardId: ID!) {
        boards(ids: [$boardId]) {
          items_page(limit: 500) {
            items { column_values(ids: ["${DESIGN_PERSON_COL_ID}"]) { id text } }
          }
        }
      }`,
      { boardId: CENTRAL_DESIGN_BOARD_ID }
    );

    const seen = new Set<string>();
    for (const it of res.data?.boards?.[0]?.items_page?.items ?? []) {
      const txt = it.column_values?.[0]?.text?.trim();
      if (!txt) continue;
      // Pode ter múltiplos (separados por vírgula). Pega cada nome.
      for (const nome of txt.split(/\s*,\s*/)) {
        const key = nome.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const email = emailByName.get(key);
        if (email) map.set(email, nome.trim());
      }
    }
  } catch (e) {
    console.warn('[Monday] falha ao buscar designers:', e);
  }
  return map;
}

/** Busca fotos + nomes dos users do Monday workspace. */
export async function fetchUserPhotos(): Promise<UserPhotosResult> {
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  const byFirstName = new Map<string, string>();
  const workspaceNameByEmail = new Map<string, string>();
  if (!config.MONDAY_TOKEN) return { byEmail, byName, byFirstName, workspaceNameByEmail };
  interface UsersResp {
    data?: { users?: Array<{ email: string | null; name: string | null; photo_thumb: string | null }> };
    errors?: Array<{ message: string }>;
    error_message?: string;
  }
  try {
    const res = await gql<UsersResp>(
      `query { users(limit: 500) { name email photo_thumb } }`,
      {}
    );
    for (const u of res.data?.users ?? []) {
      if (u.email && u.name) {
        workspaceNameByEmail.set(u.email.toLowerCase().trim(), u.name);
      }
      if (!u.photo_thumb) continue;
      if (u.email) byEmail.set(u.email.toLowerCase().trim(), u.photo_thumb);
      if (u.name) {
        const full = u.name.trim().toLowerCase();
        if (full) byName.set(full, u.photo_thumb);
        const first = full.split(/\s+/)[0];
        if (first && !byFirstName.has(first)) byFirstName.set(first, u.photo_thumb);
      }
    }
  } catch (e) {
    console.warn('[Monday] falha ao buscar fotos de users:', e);
  }
  return { byEmail, byName, byFirstName, workspaceNameByEmail };
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
  let designerByEmail = new Map<string, string>();
  let photoByEmail = new Map<string, string>();
  let photoByName = new Map<string, string>();
  let photoByFirstName = new Map<string, string>();
  let workspaceNameByEmail = new Map<string, string>();

  const emptyResult = (): AuthEmailsResult => ({
    csByEmail, gestorByEmail, programadorByEmail, designerByEmail,
    photoByEmail, photoByName, photoByFirstName, workspaceNameByEmail,
  });

  if (!config.MONDAY_TOKEN) return emptyResult();

  // Dispara busca de fotos em paralelo (não bloqueia o login se falhar)
  const photosPromise = fetchUserPhotos();

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

  try {
    const photos = await photosPromise;
    photoByEmail = photos.byEmail;
    photoByName = photos.byName;
    photoByFirstName = photos.byFirstName;
    workspaceNameByEmail = photos.workspaceNameByEmail;
  } catch {
    /* já logou warn dentro da função */
  }

  // Designers: query separada, mas precisa do workspaceNameByEmail (já vindo)
  try {
    designerByEmail = await fetchDesigners(workspaceNameByEmail);
  } catch {
    /* já logou warn */
  }

  return {
    csByEmail, gestorByEmail, programadorByEmail, designerByEmail,
    photoByEmail, photoByName, photoByFirstName, workspaceNameByEmail,
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

// ============================================================================
// ACTIVITY LOGS — eventos ricos pra timeline (Status da Tarefa, Status do
// Designer etc). Tudo isso é READ-ONLY (regra crítica do projeto: NUNCA
// escrever no Monday — apenas consumir dados).
// ============================================================================

/**
 * Títulos canônicos das colunas que viram eventos na timeline.
 * Descobrimos os IDs dinamicamente por board via META_QUERY.
 */
export const TIMELINE_COL_TITLES = {
  statusTarefa: ['status da tarefa', 'status tarefa'],
  statusDesigner: ['status do designer', 'status designer'],
  statusPrincipal: ['status principal'],
  statusIndividual: ['status individual'],
};

/**
 * Lista TODOS os boards do workspace (id + name). Usado pra descoberta
 * automática de boards específicos (ex: "Otimização Clientes").
 */
export async function fetchAllBoards(): Promise<Array<{ id: string; name: string }>> {
  if (!config.MONDAY_TOKEN) return [];
  interface BoardsListResp {
    data?: { boards?: Array<{ id: string; name: string }> };
    errors?: Array<{ message: string }>;
    error_message?: string;
  }
  try {
    // Paginação manual (Monday tem ~centenas de boards)
    const out: Array<{ id: string; name: string }> = [];
    let page = 1;
    while (page < 50) {
      const resp = await gql<BoardsListResp>(
        `query ($limit: Int!, $page: Int!) {
          boards(limit: $limit, page: $page, state: active) { id name }
        }`,
        { limit: 100, page }
      );
      const list = resp.data?.boards ?? [];
      if (list.length === 0) break;
      out.push(...list);
      if (list.length < 100) break;
      page++;
    }
    return out;
  } catch (e) {
    console.warn('[Monday] fetchAllBoards falhou:', e);
    return [];
  }
}

/**
 * Acha o boardId cujo nome bate (case+accent-insensitive) com algum dos
 * termos passados. Útil pra descobrir boards específicos sem hardcode.
 */
export async function findBoardIdByName(termos: string[]): Promise<{ id: string; name: string } | null> {
  const boards = await fetchAllBoards();
  const normTermos = termos.map(normalize);
  for (const b of boards) {
    const n = normalize(b.name);
    if (normTermos.some((t) => n === t)) return b;
  }
  // Fallback: substring
  for (const b of boards) {
    const n = normalize(b.name);
    if (normTermos.some((t) => n.includes(t))) return b;
  }
  return null;
}

/**
 * Descobre os IDs das colunas relevantes pra timeline num board.
 * Retorna `{ statusTarefa, statusDesigner, statusPrincipal, statusIndividual }`
 * (cada um pode ser null se a coluna não existir no board).
 */
export async function discoverBoardTimelineCols(
  boardId: string
): Promise<{
  statusTarefa: string | null;
  statusDesigner: string | null;
  statusPrincipal: string | null;
  statusIndividual: string | null;
}> {
  const empty = {
    statusTarefa: null,
    statusDesigner: null,
    statusPrincipal: null,
    statusIndividual: null,
  };
  if (!config.MONDAY_TOKEN) return empty;
  try {
    const meta = await gql<MetaResp>(META_QUERY, { boardId });
    const board = meta.data?.boards?.[0];
    if (!board) return empty;
    return {
      statusTarefa: findColumnId(board.columns, TIMELINE_COL_TITLES.statusTarefa),
      statusDesigner: findColumnId(board.columns, TIMELINE_COL_TITLES.statusDesigner),
      statusPrincipal: findColumnId(board.columns, TIMELINE_COL_TITLES.statusPrincipal),
      statusIndividual: findColumnId(board.columns, TIMELINE_COL_TITLES.statusIndividual),
    };
  } catch (e) {
    console.warn(`[Monday] discoverBoardTimelineCols board ${boardId}:`, e);
    return empty;
  }
}

export interface BoardActivityEvent {
  /** ID do log no Monday (chave única, pra dedupe entre runs). */
  logId: string;
  /** ID do board onde o evento aconteceu. */
  boardId: string;
  /** ID do item (a demanda em si). */
  pulseId: string;
  /** Nome do item (snapshot no momento do evento). */
  pulseName: string;
  /** ID da coluna que mudou. */
  columnId: string;
  /** Label anterior (texto do status antes da mudança). */
  prev: string | null;
  /** Label novo (texto do status após a mudança). */
  next: string | null;
  /** ISO timestamp UTC quando o evento aconteceu. */
  ts: string;
  /** ID do user que disparou a mudança (quando o Monday loga). */
  userId: string | null;
}

interface BoardActivityRaw {
  id: string;
  event: string;
  data: string;
  created_at: string;
  user_id?: string | number | null;
}

interface BoardActivityResp {
  data?: {
    boards?: Array<{
      activity_logs: BoardActivityRaw[];
    }>;
  };
  errors?: Array<{ message: string }>;
  error_message?: string;
}

const BOARD_ACTIVITY_QUERY = `
  query ($boardId: ID!, $limit: Int!, $page: Int!, $colIds: [String!], $from: ISO8601DateTime!) {
    boards(ids: [$boardId]) {
      activity_logs(
        limit: $limit
        page: $page
        column_ids: $colIds
        from: $from
      ) {
        id
        event
        data
        created_at
        user_id
      }
    }
  }
`;

/**
 * Converte o created_at do Monday (string com 100-ns ticks) em ISO UTC.
 */
function mondayActivityTsToIso(createdAt: string): string | null {
  const n = Number(createdAt);
  if (!Number.isFinite(n)) return null;
  // > 1e16 = 100-ns ticks; > 1e13 = microsegundos; > 1e10 = ms; senão segundos
  let ms: number;
  if (n > 1e16) ms = Math.floor(n / 10_000);
  else if (n > 1e13) ms = Math.floor(n / 1_000);
  else if (n > 1e10) ms = n;
  else ms = n * 1000;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

interface ParsedActivityLog {
  pulseId: string;
  pulseName: string;
  columnId: string;
  prev: string | null;
  next: string | null;
}

function parseBoardActivityData(raw: BoardActivityRaw): ParsedActivityLog | null {
  try {
    const d = JSON.parse(raw.data) as {
      pulse_id?: number | string;
      pulse_name?: string;
      column_id?: string;
      previous_value?: { label?: { text?: string } } | null;
      value?: { label?: { text?: string } } | null;
    };
    const pulseId = d.pulse_id != null ? String(d.pulse_id) : '';
    if (!pulseId) return null;
    return {
      pulseId,
      pulseName: d.pulse_name ?? '',
      columnId: d.column_id ?? '',
      prev: d.previous_value?.label?.text ?? null,
      next: d.value?.label?.text ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Busca activity_logs de UM board, filtrando por colunas e período.
 *
 * @param boardId board do Monday
 * @param colIds coluna(s) cujas mudanças interessam (ex: status_da_tarefa, status_designer)
 * @param sinceDays quantos dias atrás (default 180)
 */
export async function fetchBoardActivityLogs(
  boardId: string,
  colIds: string[],
  sinceDays: number = 180
): Promise<BoardActivityEvent[]> {
  const events: BoardActivityEvent[] = [];
  if (!config.MONDAY_TOKEN || colIds.length === 0) return events;

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const fromIso = since.toISOString();

  let page = 1;
  // safety: até 100 páginas × 500 logs = 50k eventos por board
  while (page < 100) {
    try {
      const resp = await gql<BoardActivityResp>(BOARD_ACTIVITY_QUERY, {
        boardId,
        limit: 500,
        page,
        colIds,
        from: fromIso,
      });
      const logs = resp.data?.boards?.[0]?.activity_logs ?? [];
      if (logs.length === 0) break;
      for (const raw of logs) {
        const parsed = parseBoardActivityData(raw);
        if (!parsed) continue;
        const ts = mondayActivityTsToIso(raw.created_at);
        if (!ts) continue;
        events.push({
          logId: raw.id,
          boardId,
          pulseId: parsed.pulseId,
          pulseName: parsed.pulseName,
          columnId: parsed.columnId,
          prev: parsed.prev,
          next: parsed.next,
          ts,
          userId: raw.user_id != null ? String(raw.user_id) : null,
        });
      }
      if (logs.length < 500) break;
      page++;
    } catch (e) {
      console.warn(`[Monday] activity_logs board ${boardId} page ${page}:`, e);
      break;
    }
  }
  return events;
}

/**
 * Busca activity_logs de VÁRIOS boards em paralelo.
 * Recebe Map<boardId, colIds[]> e retorna lista única consolidada.
 */
export async function fetchMultiBoardActivityLogs(
  boards: Array<{ boardId: string; colIds: string[]; label?: string }>,
  sinceDays: number = 180
): Promise<BoardActivityEvent[]> {
  const all = await Promise.all(
    boards.map((b) => fetchBoardActivityLogs(b.boardId, b.colIds, sinceDays))
  );
  return all.flat().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/**
 * Busca a DATA DE CRIAÇÃO de itens em um board. Usado pra mostrar quando uma
 * demanda foi criada na timeline. Retorna Map<pulseId, ISO_created_at>.
 *
 * Limita a `lookbackDays` itens criados nesse período pra não puxar histórico
 * antigo desnecessariamente.
 */
export async function fetchBoardItemsCreatedAt(
  boardId: string,
  lookbackDays: number = 180
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!config.MONDAY_TOKEN) return out;

  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  const QUERY = `
    query ($boardId: ID!, $limit: Int!) {
      boards(ids: [$boardId]) {
        items_page(limit: $limit, query_params: { rules: [
          { column_id: "__creation_log__", compare_value: ["EXACT", "${sinceIso}"], operator: greater_than }
        ] }) {
          cursor
          items { id created_at }
        }
      }
    }
  `;
  // A query acima pode falhar dependendo da versão da API. Vamos fazer
  // simples: paginar items e pegar created_at de cada um, sem filtro.
  const SIMPLE_QUERY = `
    query ($boardId: ID!, $limit: Int!) {
      boards(ids: [$boardId]) {
        items_page(limit: $limit) {
          cursor
          items { id created_at }
        }
      }
    }
  `;
  const NEXT_QUERY = `
    query ($cursor: String!, $limit: Int!) {
      next_items_page(cursor: $cursor, limit: $limit) {
        cursor
        items { id created_at }
      }
    }
  `;

  interface ItemMin { id: string; created_at: string | null }
  interface ListResp { data?: { boards?: Array<{ items_page: { cursor: string | null; items: ItemMin[] } }> }; errors?: Array<{ message: string }>; error_message?: string }
  interface NextResp { data?: { next_items_page: { cursor: string | null; items: ItemMin[] } }; errors?: Array<{ message: string }>; error_message?: string }

  try {
    // Usa simple query (paginate all items, filter por created_at no client)
    const first = await gql<ListResp>(SIMPLE_QUERY, { boardId, limit: PAGE_LIMIT });
    const page = first.data?.boards?.[0]?.items_page;
    if (!page) return out;
    const items: ItemMin[] = [...page.items];
    let cursor = page.cursor;
    while (cursor) {
      const next = await gql<NextResp>(NEXT_QUERY, { cursor, limit: PAGE_LIMIT });
      const np = next.data?.next_items_page;
      if (!np) break;
      items.push(...np.items);
      cursor = np.cursor;
    }
    for (const it of items) {
      if (it.created_at) {
        const d = new Date(it.created_at);
        if (!isNaN(d.getTime()) && d.getTime() >= since.getTime()) {
          out.set(it.id, it.created_at);
        }
      }
    }
  } catch (e) {
    console.warn(`[Monday] fetchBoardItemsCreatedAt board ${boardId}:`, e);
  }
  return out;
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

// ============================================================================
// Design boards — board_relation "👥 Clientes" → monday_client_id[]
//
// Cada item nas boards de Design (Central, Demandas Feitas, Manutenções,
// Atrasos, backups) tem uma coluna "Clientes" (board_relation) que aponta
// pro item correspondente no board principal de clientes. Usamos isso pra
// casar demandas/atrasos com clientes 100% por ID — sem fuzzy match no
// nome.
//
// Retorna Map<monday_item_id (da demanda), monday_client_id[] (no board principal)>.
// ============================================================================

/** IDs das boards do Design que vamos consultar. Cada uma tem a sua própria
 *  coluna board_relation "Clientes" — o ID da coluna não é o mesmo entre
 *  boards, então descobrimos dinamicamente via metadata. */
const DESIGN_BOARDS = [
  '3519879202',   // Central de Design (FEITO ativo via webhook)
  '6900515649',   // Demandas feitas pelo Design (ativas)
  '6791838447',   // Manutenções do Design
  '6713230292',   // ⌚ Atrasos do Design
  '6900586110',   // Backup Demandas feitas (arquivado)
  '18412400257',  // Demandas 2024-2026 (arquivado)
];

const DESIGN_CLIENTES_REL_TITLES = [
  'clientes',
  '👥 clientes',
  'cliente',
  'cliente vinculado',
  'cliente do projeto',
];

const DESIGN_REL_LIST_QUERY = `
  query ($boardId: ID!, $limit: Int!, $colIds: [String!]) {
    boards(ids: [$boardId]) {
      items_page(limit: $limit) {
        cursor
        items {
          id
          column_values(ids: $colIds) {
            id
            ... on BoardRelationValue { linked_item_ids }
          }
        }
      }
    }
  }
`;

const DESIGN_REL_NEXT_QUERY = `
  query ($cursor: String!, $limit: Int!) {
    next_items_page(cursor: $cursor, limit: $limit) {
      cursor
      items {
        id
        column_values {
          id
          ... on BoardRelationValue { linked_item_ids }
        }
      }
    }
  }
`;

interface DesignRelItem {
  id: string;
  column_values: Array<{ id: string; linked_item_ids?: string[] }>;
}

interface DesignRelListResp {
  data?: { boards?: Array<{ items_page: { cursor: string | null; items: DesignRelItem[] } }> };
  errors?: Array<{ message: string }>;
  error_message?: string;
}

interface DesignRelNextResp {
  data?: { next_items_page: { cursor: string | null; items: DesignRelItem[] } };
  errors?: Array<{ message: string }>;
  error_message?: string;
}

/**
 * Resultado da consulta dos board_relations das boards de Design.
 * Map<monday_item_id (da demanda), Set<monday_client_id (do board principal)>>.
 *
 * Usa Set para que o mesmo item aparecendo em múltiplos boards (ex: backup +
 * ativo) só conte cada cliente uma vez. As funções de match no clienteSaude
 * convertem pra array quando precisam iterar.
 */
export type DesignClientLinks = Map<string, Set<string>>;

/**
 * Busca os board_relation "Clientes" de TODAS as boards do Design.
 * Roda 6 queries em paralelo (uma por board) e mescla os resultados.
 *
 * IMPORTANTE: aceita boards que falhem (logam warn e continuam). Boards
 * arquivadas podem retornar erro de permissão — tudo bem, ignoramos.
 *
 * Estratégia de fetch:
 *   1. META_QUERY no board → descobre o ID da coluna board_relation "Clientes"
 *   2. DESIGN_REL_LIST_QUERY no board com essa coluna → pagina via cursor
 *   3. Pra cada item, lê `linked_item_ids` (lista de monday_client_id)
 *   4. Mescla tudo num único Map<monday_item_id, Set<monday_client_id>>
 */
export async function fetchDesignClientLinks(): Promise<DesignClientLinks> {
  const result: DesignClientLinks = new Map();
  if (!config.MONDAY_TOKEN) return result;

  async function fetchBoard(boardId: string): Promise<void> {
    try {
      // 1. Metadata pra achar a coluna board_relation "Clientes"
      const meta = await gql<MetaResp>(META_QUERY, { boardId });
      const board = meta.data?.boards?.[0];
      if (!board) return;
      // Procura coluna do tipo board_relation com título matching "clientes"
      let relColId: string | null = null;
      for (const c of board.columns) {
        const t = normalize(c.title);
        if (c.type !== 'board_relation') continue;
        if (DESIGN_CLIENTES_REL_TITLES.some((needle) => t === normalize(needle))) {
          relColId = c.id;
          break;
        }
      }
      // Fallback: qualquer board_relation cujo título inclua "cliente"
      if (!relColId) {
        for (const c of board.columns) {
          const t = normalize(c.title);
          if (c.type !== 'board_relation') continue;
          if (t.includes('cliente')) {
            relColId = c.id;
            break;
          }
        }
      }
      if (!relColId) {
        console.warn(`[Monday] board ${boardId} não tem coluna board_relation "Clientes"`);
        return;
      }

      // 2. Pagina os items, lendo só essa coluna
      const first = await gql<DesignRelListResp>(DESIGN_REL_LIST_QUERY, {
        boardId,
        limit: PAGE_LIMIT,
        colIds: [relColId],
      });
      const items: DesignRelItem[] = [];
      const page = first.data?.boards?.[0]?.items_page;
      if (page) {
        items.push(...page.items);
        let cursor = page.cursor;
        while (cursor) {
          const next = await gql<DesignRelNextResp>(DESIGN_REL_NEXT_QUERY, {
            cursor,
            limit: PAGE_LIMIT,
          });
          const np = next.data?.next_items_page;
          if (!np) break;
          items.push(...np.items);
          cursor = np.cursor;
        }
      }

      // 3. Indexa
      for (const it of items) {
        const cv = it.column_values.find((c) => c.id === relColId);
        const ids = cv?.linked_item_ids ?? [];
        if (ids.length === 0) continue;
        const set = result.get(it.id) ?? new Set<string>();
        for (const cid of ids) set.add(cid);
        result.set(it.id, set);
      }
    } catch (e) {
      console.warn(`[Monday] falha ao buscar board ${boardId}:`, e);
    }
  }

  await Promise.all(DESIGN_BOARDS.map((b) => fetchBoard(b)));
  return result;
}

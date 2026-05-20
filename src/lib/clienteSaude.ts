import type { MondayClient, FaseTransition, DesignClientLinks, BoardActivityEvent } from './monday';
import { parseDataEntrada } from './monday';
import type { RelatorioBias } from './types';
import type { DesignEvento } from './designMetrics';
import type { DesignAtraso } from '../hooks/useDesignAtrasos';
import { uniqueDemandaKey } from './designMetrics';
import { isTransferido, isInterrompido, isChatIncompleto, isDesclassificado } from './metrics';
import { config } from '../config';

// =============================================================================
// SAÚDE DO CLIENTE — agrega 3 visões: Tráfego, Design e BIA
// =============================================================================

/** Status de cada bloco — usado pra calorir o card visualmente. */
export type SaudeStatus = 'bom' | 'atencao' | 'critico' | 'sem-dados';

// =============================================================================
// TRÁFEGO
// =============================================================================

export interface SerieDia {
  date: string;          // YYYY-MM-DD
  leads: number;
  transferencias: number;
}

export interface TrafegoSaude {
  /** TODOS os leads do cliente (histórico completo no Supabase). */
  totalLeads: number;
  transferencias: number;
  taxaTransferencia: number;        // %
  /** Primeiro lead já recebido (ISO). */
  primeiroLead: string | null;
  /** Data em que o cliente entrou na agência (Monday "Data de entrada").
   *  Quando ausente, cai pro primeiroLead. ISO. */
  dataEntradaCliente: string | null;
  /** Último lead recebido. */
  ultimoLead: string | null;
  /** Última transferência. */
  ultimaTransferencia: string | null;
  diasSemLead: number | null;
  diasSemTransferencia: number | null;
  /** Quantos dias desde o primeiro lead até hoje (período de relacionamento). */
  diasRelacionamento: number | null;
  /** Média de leads por dia desde o primeiro lead. */
  leadsPorDia: number;
  /** Série temporal dos últimos 30 dias (gráfico de evolução recente). */
  serie: SerieDia[];
  status: SaudeStatus;
}

/** Constrói série diária dos últimos N dias preenchendo lacunas com 0. */
function buildSerieTrafego(leads: RelatorioBias[], dias: number = 30): SerieDia[] {
  const hoje = new Date();
  hoje.setHours(23, 59, 59, 999);
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - dias + 1);
  inicio.setHours(0, 0, 0, 0);

  // Agrupa por dia
  const map = new Map<string, { leads: number; transferencias: number }>();
  for (const l of leads) {
    const d = new Date(l.dataCadastro);
    if (d < inicio || d > hoje) continue;
    const key = dateKey(d);
    const e = map.get(key) ?? { leads: 0, transferencias: 0 };
    e.leads++;
    if (isTransferido(l)) e.transferencias++;
    map.set(key, e);
  }

  // Preenche TODOS os dias (com 0 quando vazio) pra linha não pular
  const serie: SerieDia[] = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(inicio);
    d.setDate(d.getDate() + i);
    const key = dateKey(d);
    const e = map.get(key) ?? { leads: 0, transferencias: 0 };
    serie.push({ date: key, leads: e.leads, transferencias: e.transferencias });
  }
  return serie;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Computa saúde de tráfego a partir dos leads JÁ casados pelo cliente.
 *
 * IMPORTANTE: recebe os leads já filtrados (vindos de `computeGestorMetrics`,
 * que usa a mesma lógica do app principal — token uazapi, match por nome E
 * vínculos manuais doutor→cliente da tabela `doutor_client_links`). Isso
 * garante consistência com as outras abas.
 */
export function computeTrafegoSaude(
  client: MondayClient,
  leadsDoCliente: RelatorioBias[]
): TrafegoSaude {
  // Os leads já vêm pré-filtrados, mas ainda removo interrompidos/incompletos/desclassificados
  const leads = leadsDoCliente.filter(
    (l) => !isInterrompido(l) && !isChatIncompleto(l) && !isDesclassificado(l)
  );
  const transf = leads.filter(isTransferido);
  const taxa = leads.length > 0 ? (transf.length / leads.length) * 100 : 0;

  const datasOrdenadas = leads.map((l) => l.dataCadastro).sort();
  const firstLeadDate = datasOrdenadas[0] ?? null;
  const lastLeadDate = datasOrdenadas[datasOrdenadas.length - 1] ?? null;
  const lastTransfDate = transf.length > 0
    ? transf.map((l) => l.dataCadastro).sort().pop() ?? null
    : null;

  const serie = buildSerieTrafego(leads, 30);

  const now = Date.now();
  const diasSemLead = lastLeadDate
    ? Math.floor((now - new Date(lastLeadDate).getTime()) / 86400000)
    : null;
  const diasSemTransferencia = lastTransfDate
    ? Math.floor((now - new Date(lastTransfDate).getTime()) / 86400000)
    : null;

  // Relacionamento = tempo desde que o cliente ENTROU na agência (Monday).
  // Fallback pra data do primeiro lead se não tem data de entrada cadastrada.
  const dataEntradaMonday = parseDataEntrada(client.dataEntrada);
  const inicioRelacionamento = dataEntradaMonday ?? (firstLeadDate ? new Date(firstLeadDate) : null);
  const diasRelacionamento = inicioRelacionamento
    ? Math.max(1, Math.floor((now - inicioRelacionamento.getTime()) / 86400000))
    : null;
  const leadsPorDia = diasRelacionamento && diasRelacionamento > 0
    ? Number((leads.length / diasRelacionamento).toFixed(2))
    : 0;

  // Heurística de status:
  //  critico    → 0 leads, OU >14 dias sem lead, OU 0 transferências com >5 leads
  //  atencao    → 7-14 dias sem lead, OU taxa < 10% com volume relevante
  //  bom        → resto
  //  sem-dados  → cliente sem token + sem match de nome
  let status: SaudeStatus = 'bom';
  if (leads.length === 0) {
    status = 'atencao';
  } else if (diasSemLead !== null && diasSemLead > 14) {
    status = 'atencao';
  } else if (leads.length >= 5 && transf.length === 0) {
    status = 'atencao';
  } else if (diasSemLead !== null && diasSemLead > 7) {
    status = 'atencao';
  } else if (leads.length >= 10 && taxa < 10) {
    status = 'atencao';
  }

  return {
    totalLeads: leads.length,
    transferencias: transf.length,
    taxaTransferencia: Number(taxa.toFixed(1)),
    primeiroLead: firstLeadDate,
    dataEntradaCliente: dataEntradaMonday ? dataEntradaMonday.toISOString() : firstLeadDate,
    ultimoLead: lastLeadDate,
    ultimaTransferencia: lastTransfDate,
    diasSemLead,
    diasSemTransferencia,
    diasRelacionamento,
    leadsPorDia,
    serie,
    status,
  };
}

// =============================================================================
// DESIGN
// =============================================================================

export interface DemandaAtrasada {
  id: string | number;
  nome: string | null;
  link: string | null;              // URL Monday (quando disponível)
  designer: string | null;
  tempoAtrasado: string | null;
  diasAtraso: number | null;
  prioridade: string | null;
  dataCriacao: string | null;
  statusTarefa: string | null;
  /** "atrasado" / "parado" — vem do board de Atrasos */
  statusDesigner?: string | null;
  /** Tipo de atraso categorizado (vem do board): ex "Edição vídeo" */
  tipoAtraso?: string | null;
  cronograma?: { inicio: string | null; fim: string | null };
  /** Fonte do dado: do board "Atrasos" (atrasos_board) ou do "Demandas feitas" (eventos) */
  origem?: 'atrasos_board' | 'eventos';
}

export interface SerieDesignDia {
  date: string;          // YYYY-MM-DD
  feitos: number;
  manutencoes: number;
}

export interface DesignSaude {
  /** Total de entregas (eventos "feito" não-deduplicadas — cada peça conta). */
  totalDemandas: number;
  /** Demandas únicas entregues (deduplicadas por monday_item_id). */
  demandasUnicas: number;
  demandasAtrasadas: DemandaAtrasada[];
  pctNoPrazo: number;
  /** Total bruto de manutenções (cada retorno conta). */
  totalManutencoes: number;
  /** Demandas distintas que voltaram pra manutenção (únicas). */
  manutencoes: number;
  /** % de demandas únicas que voltaram pra manutenção (sobre o total de entregas únicas). */
  pctManutencao: number;
  /** Primeira demanda já feita (ISO). */
  primeiraDemanda: string | null;
  /** Última demanda feita. */
  ultimaDemanda: string | null;
  /** Quantos dias desde que o cliente entrou na agência (ou primeira demanda). */
  diasRelacionamento: number | null;
  /** Data de entrada do cliente (do Monday). Fallback pra primeiraDemanda. */
  dataEntradaCliente: string | null;
  /** Designers únicos que atenderam o cliente. */
  designersAtenderam: string[];
  /** Série temporal dos últimos 30 dias. */
  serie: SerieDesignDia[];
  status: SaudeStatus;
}

/** Parse heurístico de "tempo_atrasado" pra extrair dias. */
function parseDiasAtraso(s: string | null): number | null {
  if (!s) return null;
  const t = s.toLowerCase();
  // "3 dias", "12d", "1 semana", "atrasado há 5 dias"
  const dias = t.match(/(\d+)\s*(?:d|dia)/);
  if (dias) return parseInt(dias[1], 10);
  const semanas = t.match(/(\d+)\s*sem/);
  if (semanas) return parseInt(semanas[1], 10) * 7;
  return null;
}

/**
 * Mapeia origem da demanda → board_id correto no Monday. Necessário porque
 * cada origem vem de um board diferente, e a URL do Monday inclui o board_id.
 * Quando origem é desconhecida, retorna null (vai usar fallback do componente).
 */
function boardIdPorOrigem(origem: string | null | undefined): string | null {
  switch (origem) {
    case 'central':
    case 'central_backfill':
      return '3519879202';
    case 'demandas_atual':
      return '6900515649';
    case 'manutencao_atual':
    case 'backup_manutencao':
      return '6791838447';
    case 'backup_atual':
      return '6900586110';
    case 'backup_2024':
      return '18412400257';
    default:
      return null;
  }
}

/**
 * Extrai a URL do Monday a partir do campo `link_demanda`, que vem no formato:
 *   "Nome da demanda - https://burstmidia.monday.com/boards/XXX/pulses/YYY"
 *
 * Quando não tem link no campo, monta a URL a partir de `monday_item_id` +
 * `origem` (que determina o board_id correto).
 */
export function buildMondayDemandaLink(
  linkDemanda: string | null | undefined,
  mondayItemId: string | null | undefined,
  origem?: string | null
): string | null {
  // 1. Tenta extrair URL embutida em link_demanda (formato "Nome - URL")
  if (linkDemanda) {
    const m = linkDemanda.match(/https?:\/\/[^\s,]+/);
    if (m) return m[0];
  }
  // 2. Monta URL a partir do monday_item_id + board_id da origem
  if (mondayItemId) {
    const boardId = boardIdPorOrigem(origem) ?? '3519879202'; // fallback central
    return `https://burstmidia.monday.com/boards/${boardId}/pulses/${mondayItemId}`;
  }
  return null;
}

/** Extrai tokens significativos do nome (≥3 chars, sem prefixos comuns). */
const PREFIXOS_NOME = new Set([
  'dr', 'dra', 'drs', 'sr', 'sra', 'doutor', 'doutora',
  'clinica', 'instituto', 'consultorio', 'consultório',
  'odontologia', 'odontologica', 'odontologicas',
]);

// Memoização — strings normalizadas e tokens caem aqui na primeira chamada
const _tokensCache = new Map<string, string[]>();

function tokensSignificativos(s: string): string[] {
  const cached = _tokensCache.get(s);
  if (cached) return cached;
  const tokens = normalize(s)
    .split(/[\s\-_(),.]+/)
    .filter((t) => t.length >= 3 && !PREFIXOS_NOME.has(t) && !/^\d+$/.test(t));
  _tokensCache.set(s, tokens);
  return tokens;
}

/**
 * Acha o melhor cliente cujos tokens batem com o nome da demanda.
 *
 * Critério ENDURECIDO (era frouxo demais antes):
 *   1. Nome completo (normalizado) do cliente aparece no nome da demanda → match
 *   2. OU 2+ tokens significativos em comum
 *
 * O critério antigo "1 token com 5+ chars" causava cross-contamination quando
 * 2 clientes compartilhavam um sobrenome comum (ex: "Souza"). Por isso
 * removido — single-token match é proibido agora.
 */
function bestFuzzyMatch(
  demandaNome: string,
  clientTokens: Array<{ id: string; nameNorm: string; tokens: Set<string> }>
): { id: string; score: number } | null {
  const evTokens = tokensSignificativos(demandaNome);
  if (evTokens.length === 0) return null;
  const demandaNorm = normalize(demandaNome);

  let best: { id: string; score: number } | null = null;
  for (const c of clientTokens) {
    if (c.tokens.size === 0) continue;

    // (a) Match por SUBSTRING do nome completo — só vale se o nome do cliente
    //     tem 2+ palavras (evita match falso quando o nome é uma palavra única
    //     curta tipo "Anne" que aparece em qualquer "Anne ...").
    const clientWordCount = c.nameNorm.split(/\s+/).filter(Boolean).length;
    if (clientWordCount >= 2 && demandaNorm.includes(c.nameNorm)) {
      const score = 100 + clientWordCount;
      if (!best || score > best.score) best = { id: c.id, score };
      continue;
    }

    // (b) Match por tokens — exige 2+ tokens em comum
    let common = 0;
    for (const t of evTokens) if (c.tokens.has(t)) common++;
    if (common >= 2 && (!best || common > best.score)) {
      best = { id: c.id, score: common };
    }
  }
  return best;
}

/**
 * Indexa atrasos por cliente.
 *
 * Estratégia:
 *   1. PREFERIDO: match exato via `clientLinks` — Map<monday_item_id, monday_client_ids[]>
 *      vindo do board_relation "Clientes" no Monday. Elimina ambiguidade.
 *   2. FALLBACK: fuzzy match por tokens do nome (quando o item não está nos
 *      links — pode acontecer com items muito antigos ou se o board_relation
 *      não está preenchido pelo time).
 *
 * O atraso vai pra UM cliente quando match exato encontra UM cliente do
 * board principal vinculado. Se encontrar múltiplos (caso raro), copia o
 * atraso pra todos eles.
 */
export function buildAtrasosPorCliente(
  clients: MondayClient[],
  atrasos: DesignAtraso[],
  clientLinks?: DesignClientLinks
): Map<string, DesignAtraso[]> {
  const validClientIds = new Set(clients.map((c) => c.id));
  const clientTokens = clients.map((c) => ({
    id: c.id,
    nameNorm: normalize(c.name),
    tokens: new Set(tokensSignificativos(c.name)),
  }));
  const result = new Map<string, DesignAtraso[]>();
  for (const c of clientTokens) result.set(c.id, []);

  // Tem clientLinks carregado? Se sim, items com link no Monday são fonte
  // da verdade — quando o link existe (mesmo que não case com cliente válido)
  // NÃO caímos pro fuzzy (que historicamente vaza pra cliente errado).
  const hasLinks = !!clientLinks && clientLinks.size > 0;

  for (const a of atrasos) {
    // 1. Match EXATO via board_relation Monday — preferido
    if (clientLinks && a.monday_item_id) {
      const linked = clientLinks.get(String(a.monday_item_id));
      if (linked && linked.size > 0) {
        for (const cid of linked) {
          if (validClientIds.has(cid)) {
            result.get(cid)!.push(a);
          }
        }
        // Mesmo que nenhum cliente válido tenha batido, NÃO cai no fuzzy:
        // o Monday já disse pra quem é esse item. Se não está nos nossos
        // clientes válidos, é pra ignorar — não jogar em alguém aleatório.
        continue;
      }
    }

    // 2. FALLBACK: fuzzy match — só permitido quando os links não foram
    //    carregados AINDA (primeiro load). Quando carregados, items sem
    //    link são "órfãos" → ignoramos (preferir nada a errar).
    if (hasLinks) continue;
    if (!a.nome) continue;
    const best = bestFuzzyMatch(a.nome, clientTokens);
    if (best) result.get(best.id)!.push(a);
  }
  return result;
}

/**
 * Indexa TODOS os eventos de design por cliente uma única vez.
 * Em vez de O(clientes × eventos), faz O(clientes + eventos).
 *
 * Estratégia (em ordem de prioridade):
 *   1. EXATO via `clientLinks` — usa board_relation "Clientes" do Monday
 *      (cada item de Design aponta pro Monday principal). 100% preciso.
 *   2. Fallback: match no campo `clientes` (texto)
 *   3. Fallback: fuzzy match por tokens do nome da demanda
 *
 * O critério #1 elimina os bugs históricos onde Dr. Breno casava com
 * demandas de outros clientes pelo fuzzy match em nomes parecidos.
 *
 * Retorna Map<clientId, DesignEvento[]> — usar antes de chamar
 * computeDesignSaude pra cada cliente.
 */
export function buildEventosPorCliente(
  clients: MondayClient[],
  allEventos: DesignEvento[],
  clientLinks?: DesignClientLinks
): Map<string, DesignEvento[]> {
  const validClientIds = new Set(clients.map((c) => c.id));
  // Pré-computa tokens de cada cliente
  const clientTokens: Array<{ id: string; name: string; tokens: Set<string>; nameNorm: string }> = clients.map((c) => ({
    id: c.id,
    name: c.name,
    nameNorm: normalize(c.name),
    tokens: new Set(tokensSignificativos(c.name)),
  }));

  const result = new Map<string, DesignEvento[]>();
  for (const c of clientTokens) result.set(c.id, []);

  // Quando clientLinks tá carregado, items sem link são órfãos → ignoramos
  // (não cair no fuzzy que historicamente errava clientes parecidos).
  const hasLinks = !!clientLinks && clientLinks.size > 0;

  for (const ev of allEventos) {
    // 1. PREFERIDO: match EXATO via board_relation do Monday
    if (clientLinks && ev.monday_item_id) {
      const linked = clientLinks.get(String(ev.monday_item_id));
      if (linked && linked.size > 0) {
        for (const cid of linked) {
          if (validClientIds.has(cid)) {
            result.get(cid)!.push(ev);
          }
        }
        // Item já decidido pelo Monday. Mesmo que tenha caído em cliente
        // não-válido, NÃO cai no fuzzy (cross-contamination).
        continue;
      }
    }

    // 2. Quando os links já carregaram e este item não tem link, é órfão
    //    → IGNORA. Melhor não mostrar nada do que mostrar errado.
    if (hasLinks) continue;

    // === A partir daqui só roda no primeiro load (sem links ainda) ===

    // 3. Tenta match EXATO no campo `clientes` (vindo do xlsx). Só aceita
    //    igualdade exata depois de normalizar — `includes` (substring) é
    //    perigoso quando 2 clientes compartilham sobrenome.
    let assigned = false;
    if (ev.clientes && ev.clientes.trim()) {
      const lista = ev.clientes.split(/\s*,\s*/).map(normalize).filter(Boolean);
      for (const c of clientTokens) {
        if (lista.includes(c.nameNorm)) {
          result.get(c.id)!.push(ev);
          assigned = true;
          break;
        }
      }
    }
    // 4. Fallback final: fuzzy ENDURECIDO (2+ tokens OU substring de nome completo)
    if (!assigned && ev.nome) {
      const best = bestFuzzyMatch(ev.nome, clientTokens);
      if (best) result.get(best.id)!.push(ev);
    }
  }
  return result;
}

/**
 * Filtra eventos de design do cliente (versão single-client legada).
 * Usa o MESMO critério endurecido do `buildEventosPorCliente`:
 * - igualdade exata no campo `clientes`
 * - OU fuzzy com 2+ tokens em comum / nome completo como substring
 *
 * Critério antigo "1 token de 5+ chars" foi REMOVIDO — vazava entre clientes
 * com sobrenomes comuns (ex: Dr. Breno Souza × Dra. Géssica Souza).
 */
function eventosDoCliente(
  client: MondayClient,
  allEventos: DesignEvento[]
): DesignEvento[] {
  const nomeCli = normalize(client.name);
  if (!nomeCli) return [];
  const clientEntry = {
    id: client.id,
    nameNorm: nomeCli,
    tokens: new Set(tokensSignificativos(client.name)),
  };
  const wordCount = nomeCli.split(/\s+/).filter(Boolean).length;

  return allEventos.filter((e) => {
    // 1. Campo `clientes` — match EXATO (igualdade após normalize)
    if (e.clientes && e.clientes.trim()) {
      const lista = e.clientes.split(/\s*,\s*/).map(normalize).filter(Boolean);
      if (lista.includes(nomeCli)) return true;
      // Permite "nome completo do cliente aparece dentro da string" só
      // quando o nome tem 2+ palavras (evita "Anne" colar em "Anne Camargo").
      if (wordCount >= 2 && lista.some((s) => s.includes(nomeCli))) return true;
    }
    // 2. Fuzzy ENDURECIDO no nome da demanda
    if (e.nome) {
      const best = bestFuzzyMatch(e.nome, [clientEntry]);
      if (best) return true;
    }
    return false;
  });
}

/** Tenta extrair Date de um evento — usa data_feito, log_criacao ou imported_at. */
function eventoDateLocal(e: DesignEvento): Date | null {
  if (e.data_feito) {
    const d = new Date(e.data_feito);
    if (!isNaN(d.getTime())) return d;
  }
  if (e.log_criacao) {
    // log_criacao do Monday vem como "Anne Camargo, Mar 24, 2025 15:32" ou ISO
    const iso = new Date(e.log_criacao);
    if (!isNaN(iso.getTime())) return iso;
    const m = e.log_criacao.match(/([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(\d{4})/);
    if (m) {
      const meses: Record<string, number> = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
        Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
      };
      const mi = meses[m[1]];
      if (mi !== undefined) return new Date(parseInt(m[3], 10), mi, parseInt(m[2], 10));
    }
  }
  if (e.imported_at) {
    const d = new Date(e.imported_at);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function buildSerieDesign(eventos: DesignEvento[], dias: number = 30): SerieDesignDia[] {
  const hoje = new Date();
  hoje.setHours(23, 59, 59, 999);
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - dias + 1);
  inicio.setHours(0, 0, 0, 0);

  const map = new Map<string, { feitos: number; manutencoes: number }>();
  for (const ev of eventos) {
    const d = eventoDateLocal(ev);
    if (!d || d < inicio || d > hoje) continue;
    const key = dateKey(d);
    const e = map.get(key) ?? { feitos: 0, manutencoes: 0 };
    if (ev.tipo_evento === 'feito') e.feitos++;
    else e.manutencoes++;
    map.set(key, e);
  }

  const serie: SerieDesignDia[] = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(inicio);
    d.setDate(d.getDate() + i);
    const key = dateKey(d);
    const e = map.get(key) ?? { feitos: 0, manutencoes: 0 };
    serie.push({ date: key, feitos: e.feitos, manutencoes: e.manutencoes });
  }
  return serie;
}

/**
 * Computa saúde de design.
 *
 * Aceita:
 *  - eventos JÁ filtrados (preferido — via buildEventosPorCliente)
 *  - atrasos JÁ filtrados (via buildAtrasosPorCliente) — populam demandasAtrasadas
 */
export function computeDesignSaude(
  client: MondayClient,
  eventosPreFiltradosOuTodos: DesignEvento[] | { all: DesignEvento[] },
  atrasos: DesignAtraso[] = []
): DesignSaude {
  const eventos = Array.isArray(eventosPreFiltradosOuTodos)
    ? eventosPreFiltradosOuTodos
    : eventosDoCliente(client, eventosPreFiltradosOuTodos.all);
  const feitos = eventos.filter((e) => e.tipo_evento === 'feito');
  const manuts = eventos.filter(
    (e) => e.tipo_evento === 'manutencao' || e.tipo_evento === 'manutencao_c'
  );
  const serie = buildSerieDesign(eventos, 30);

  // Atrasadas: tempo_atrasado preenchido E status NÃO indica conclusão.
  // Conservador: considera "atrasado" qualquer evento com tempo_atrasado não-vazio.
  // === Atrasos ===
  // Fonte primária: board "⌚ Atrasos do Design" (tabela design_atrasos)
  // Fallback: campo tempo_atrasado dos eventos (raramente preenchido)
  const atrasadas: DemandaAtrasada[] = [
    // Do board de atrasos (preferido — info completa)
    ...atrasos.map((a) => ({
      id: a.monday_item_id,
      nome: a.nome,
      // URL correta — burstmidia.monday.com (não burst-team-projeto-dia-d)
      link: `https://burstmidia.monday.com/boards/6713230292/pulses/${a.monday_item_id}`,
      designer: a.designer,
      tempoAtrasado: a.dias_atrasado !== null ? `${a.dias_atrasado} dia(s)` : a.tipo_atraso ?? null,
      diasAtraso: a.dias_atrasado,
      prioridade: a.prioridade,
      dataCriacao: a.log_criacao,
      statusTarefa: a.status_designer,
      statusDesigner: a.status_designer,
      tipoAtraso: a.tipo_atraso,
      cronograma: { inicio: a.cronograma_inicio, fim: a.cronograma_fim },
      origem: 'atrasos_board' as const,
    })),
    // Fallback: eventos com tempo_atrasado preenchido
    ...eventos
      .filter((e) => e.tempo_atrasado && e.tempo_atrasado.trim() !== '')
      .map((e) => ({
        id: e.id,
        nome: e.nome,
        // Extrai URL embutida em link_demanda ("Nome - URL") ou monta pelo board_id da origem
        link: buildMondayDemandaLink(e.link_demanda, e.monday_item_id, e.origem),
        designer: e.designer_responsavel,
        tempoAtrasado: e.tempo_atrasado,
        diasAtraso: parseDiasAtraso(e.tempo_atrasado),
        prioridade: e.prioridade,
        dataCriacao: e.log_criacao,
        statusTarefa: e.status_tarefa,
        origem: 'eventos' as const,
      })),
  ].sort((a, b) => (b.diasAtraso ?? 0) - (a.diasAtraso ?? 0));

  const totalDemandas = feitos.length;
  const pctNoPrazo =
    totalDemandas > 0
      ? Math.max(0, ((totalDemandas - atrasadas.length) / totalDemandas) * 100)
      : 100;

  // Únicas (por demandaKey) — pra não inflar com retrabalhos
  const feitosUnicas = new Set(feitos.map(uniqueDemandaKey)).size;
  const manutsUnicas = new Set(manuts.map(uniqueDemandaKey)).size;
  const pctManutencao = feitosUnicas > 0 ? (manutsUnicas / feitosUnicas) * 100 : 0;

  // Datas extremas (histórico completo)
  const datasFeitos = feitos
    .map((e) => eventoDateLocal(e))
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime())
    .sort((a, b) => a - b);
  const primeiraDemanda = datasFeitos.length > 0
    ? new Date(datasFeitos[0]).toISOString()
    : null;
  const ultimaDemanda = datasFeitos.length > 0
    ? new Date(datasFeitos[datasFeitos.length - 1]).toISOString()
    : null;
  // Relacionamento = tempo desde que o cliente entrou na agência (Monday).
  // Fallback pra primeira demanda quando não tem data de entrada.
  const dataEntradaMonday = parseDataEntrada(client.dataEntrada);
  const inicioRelacionamento = dataEntradaMonday ?? (primeiraDemanda ? new Date(primeiraDemanda) : null);
  const diasRelacionamento = inicioRelacionamento
    ? Math.max(1, Math.floor((Date.now() - inicioRelacionamento.getTime()) / 86400000))
    : null;

  // Designers únicos que atenderam o cliente
  const designersSet = new Set<string>();
  for (const e of feitos) {
    if (e.designer_responsavel) {
      // Pode ter múltiplos separados por vírgula
      for (const d of e.designer_responsavel.split(/\s*,\s*/)) {
        const nome = d.trim();
        if (nome) designersSet.add(nome);
      }
    }
  }

  let status: SaudeStatus = 'bom';
  if (totalDemandas === 0 && atrasadas.length === 0) {
    status = 'sem-dados';
  } else if (atrasadas.length >= 5 || pctNoPrazo < 60) {
    status = 'atencao';
  } else if (atrasadas.length > 0 || pctNoPrazo < 85) {
    status = 'atencao';
  }

  return {
    totalDemandas,
    demandasUnicas: feitosUnicas,
    demandasAtrasadas: atrasadas,
    pctNoPrazo: Number(pctNoPrazo.toFixed(1)),
    totalManutencoes: manuts.length,
    manutencoes: manutsUnicas,
    pctManutencao: Number(pctManutencao.toFixed(1)),
    primeiraDemanda,
    ultimaDemanda,
    diasRelacionamento,
    dataEntradaCliente: dataEntradaMonday ? dataEntradaMonday.toISOString() : primeiraDemanda,
    designersAtenderam: [...designersSet].sort(),
    serie,
    status,
  };
}

// =============================================================================
// BIA — análise da timeline de fase
// =============================================================================

export interface BiaPeriodo {
  inicio: string;        // ISO
  fim: string | null;    // null = aberto (estado atual)
  fase: string;          // ex: "I.A ativa", "Manutenção", "Pausado"
  dias: number;          // dias decorridos
}

export interface BiaSaude {
  /** Fase atual do cliente. */
  faseAtual: string | null;
  /** Lista cronológica de períodos (cada mudança de fase vira um período). */
  periodos: BiaPeriodo[];
  /** Quantas vezes ENTROU em I.A ativa (transições X → I.A ativa). */
  vezesAtivado: number;
  /** Quantas vezes ENTROU em manutenção (transições X → Manutenção). */
  vezesEmManutencao: number;
  /** Dias TOTAIS em I.A ativa (somando todos os períodos ativos). */
  diasAtivoTotal: number;
  /** Dias TOTAIS em manutenção. */
  diasManutencaoTotal: number;
  /** Dias do período atual (na fase corrente). */
  diasFaseAtual: number;
  status: SaudeStatus;
}

function diasEntre(a: string, b: string | Date): number {
  const ms = (typeof b === 'string' ? new Date(b) : b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function isFaseAtivaLocal(s: string | null | undefined): boolean {
  if (!s) return false;
  return normalize(s).includes('i.a ativa') || normalize(s).includes('ia ativa');
}

function isFaseManutencao(s: string | null | undefined): boolean {
  if (!s) return false;
  return normalize(s).includes('manutencao');
}

export function computeBiaSaude(
  timeline: FaseTransition[] | undefined,
  faseAtual: string | null | undefined
): BiaSaude {
  const periodos: BiaPeriodo[] = [];

  if (!timeline || timeline.length === 0) {
    // Sem timeline: só temos a fase atual
    return {
      faseAtual: faseAtual ?? null,
      periodos: [],
      vezesAtivado: isFaseAtivaLocal(faseAtual) ? 1 : 0,
      vezesEmManutencao: isFaseManutencao(faseAtual) ? 1 : 0,
      diasAtivoTotal: 0,
      diasManutencaoTotal: 0,
      diasFaseAtual: 0,
      status: faseAtual ? (isFaseAtivaLocal(faseAtual) ? 'bom' : 'atencao') : 'sem-dados',
    };
  }

  // Constrói períodos: cada par (fase_prev, ts) → bloco
  // O primeiro `prev` da timeline é o estado inicial. Cada `next` vira nova fase.
  const ordered = [...timeline].sort((a, b) => (a.ts < b.ts ? -1 : 1));

  // Estado inicial = primeiro `prev` da primeira transição
  let cursorFase = ordered[0].prev ?? 'Desconhecido';
  let cursorInicio = ordered[0].ts; // assumimos cliente "começou" nesse momento (ou antes)
  // Pra cada transição, fecha o período anterior e abre um novo
  for (const t of ordered) {
    if (t.next === cursorFase) continue; // sem mudança real
    // Fecha período anterior (de cursorInicio até t.ts com fase cursorFase)
    periodos.push({
      inicio: cursorInicio,
      fim: t.ts,
      fase: cursorFase,
      dias: diasEntre(cursorInicio, t.ts),
    });
    cursorFase = t.next ?? 'Desconhecido';
    cursorInicio = t.ts;
  }
  // Período atual (aberto)
  const agora = new Date();
  periodos.push({
    inicio: cursorInicio,
    fim: null,
    fase: faseAtual ?? cursorFase,
    dias: diasEntre(cursorInicio, agora),
  });

  // Conta vezes em I.A ativa e manutenção
  let vezesAtivado = 0;
  let vezesManut = 0;
  for (const p of periodos) {
    if (isFaseAtivaLocal(p.fase)) vezesAtivado++;
    else if (isFaseManutencao(p.fase)) vezesManut++;
  }

  // Soma dias
  let diasAtivoTotal = 0;
  let diasManutencaoTotal = 0;
  for (const p of periodos) {
    if (isFaseAtivaLocal(p.fase)) diasAtivoTotal += p.dias;
    else if (isFaseManutencao(p.fase)) diasManutencaoTotal += p.dias;
  }

  const diasFaseAtual = periodos[periodos.length - 1]?.dias ?? 0;

  // Status
  let status: SaudeStatus = 'bom';
  if (!faseAtual) {
    status = 'sem-dados';
  } else if (isFaseManutencao(faseAtual)) {
    status = 'atencao';
  } else if (vezesManut >= 3) {
    status = 'atencao';
  } else if (!isFaseAtivaLocal(faseAtual)) {
    status = 'atencao';
  }

  return {
    faseAtual: faseAtual ?? null,
    periodos,
    vezesAtivado,
    vezesEmManutencao: vezesManut,
    diasAtivoTotal,
    diasManutencaoTotal,
    diasFaseAtual,
    status,
  };
}

// =============================================================================
// CONSOLIDADO POR CLIENTE
// =============================================================================

export interface ClienteSaude {
  client: MondayClient;
  trafego: TrafegoSaude;
  design: DesignSaude;
  bia: BiaSaude;
  /** Pior status entre os 3 blocos (pra cor do card). */
  statusGeral: SaudeStatus;
}

const STATUS_ORDER: Record<SaudeStatus, number> = {
  bom: 0,
  'sem-dados': 1,
  atencao: 2,
  critico: 3,
};

function piorStatus(...s: SaudeStatus[]): SaudeStatus {
  return s.reduce((a, b) => (STATUS_ORDER[a] >= STATUS_ORDER[b] ? a : b), 'bom');
}

export function computeClienteSaude(opts: {
  client: MondayClient;
  /** Leads JÁ casados pelo cliente (vindos de computeGestorMetrics). */
  leads: RelatorioBias[];
  /** Eventos design JÁ filtrados (vindos de buildEventosPorCliente). */
  designEventos: DesignEvento[];
  /** Atrasos design JÁ filtrados (vindos de buildAtrasosPorCliente). */
  designAtrasos?: DesignAtraso[];
  biaTimelineByClientId: Map<string, FaseTransition[]>;
  biaFaseByClientId: Map<string, string>;
}): ClienteSaude {
  const trafego = computeTrafegoSaude(opts.client, opts.leads);
  const design = computeDesignSaude(opts.client, opts.designEventos, opts.designAtrasos ?? []);
  const bia = computeBiaSaude(
    opts.biaTimelineByClientId.get(opts.client.id),
    opts.biaFaseByClientId.get(opts.client.id)
  );
  return {
    client: opts.client,
    trafego,
    design,
    bia,
    statusGeral: piorStatus(trafego.status, design.status, bia.status),
  };
}

// =============================================================================
// TIMELINE UNIFICADA — junta tudo cronologicamente
// =============================================================================

export type TimelineEventType =
  | 'design-feito'
  | 'design-manutencao'
  | 'design-atrasada'
  | 'design-criada'         // ← NOVO: quando a demanda foi criada (created_at)
  | 'design-aprovada'       // ← NOVO: Status da Tarefa = "Aprovado"/"Em validação"
  | 'design-em-criacao'     // ← NOVO: Status do Designer = "Em criação"
  | 'design-status-tarefa'  // ← NOVO: outras mudanças de "Status da Tarefa"
  | 'design-status-designer' // ← NOVO: outras mudanças de "Status do Designer"
  | 'gestor-otimizacao'     // ← NOVO: gestor fez otimização (board Otimização Clientes)
  | 'bia-ativa'
  | 'bia-manutencao'
  | 'bia-outra'
  | 'lead-primeiro'
  | 'lead-ultima-transf'
  | 'lead-volume-dia'
  | 'meta-campanha-spend';

export interface TimelineEvent {
  /** ISO timestamp do evento. */
  date: string;
  type: TimelineEventType;
  /** Categoria pra UI agrupar (design/bia/meta/trafego). */
  category: 'design' | 'bia' | 'meta' | 'trafego';
  title: string;
  detail?: string;
  /** Link externo (Monday item, conta Meta, etc). */
  link?: string;
  /** Designer/responsável (quando aplicável). */
  responsavel?: string;
  /** Valor quando aplicável (spend, # leads, etc). */
  value?: number | string;
  /** Updates (comentários do Monday) associados a esse item.
   *  Aparecem inline abaixo do título do evento na UI. */
  updates?: Array<{
    text: string;
    creatorName: string | null;
    createdAt: string;
  }>;
}

/**
 * Constrói uma linha do tempo unificada com TODOS os eventos relevantes do cliente:
 * - Demandas de design (feitas + manutenções + atrasadas)
 * - Transições de fase Bia
 * - Primeiro lead e última transferência
 * - Dias com alto volume de leads
 *
 * Retorna em ordem **decrescente** (mais recente primeiro).
 */
/**
 * URL do item do cliente no board principal do Monday.
 * Usado como fallback pra eventos sem link específico (bia, lead, etc).
 */
function buildClientMondayLink(client: MondayClient): string | null {
  const boardId = config.MONDAY_BOARD_ID;
  if (!boardId || !client.id) return null;
  return `https://burstmidia.monday.com/boards/${boardId}/pulses/${client.id}`;
}

/**
 * URL do item do cliente no board Bia Soft (id 9887531051) — pra eventos da Bia.
 * Recebe map `biaItemIdByClientId` calculado uma vez no componente.
 */
function buildBiaItemMondayLink(biaItemId: string | null | undefined): string | null {
  if (!biaItemId) return null;
  return `https://burstmidia.monday.com/boards/9887531051/pulses/${biaItemId}`;
}

/**
 * Classifica um evento de "Status da Tarefa" pela label nova.
 * Aprovação geralmente é "Aprovado", "Aprovada", "Em validação", "Validação OK".
 */
function isStatusTarefaAprovacao(label: string | null | undefined): boolean {
  if (!label) return false;
  const n = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return (
    n.includes('aprovad') ||
    n.includes('validacao ok') ||
    n.includes('em validacao')
  );
}

function isStatusTarefaAtrasado(label: string | null | undefined): boolean {
  if (!label) return false;
  const n = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return n.includes('atrasad') || n.includes('atraso');
}

function isStatusDesignerEmCriacao(label: string | null | undefined): boolean {
  if (!label) return false;
  const n = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return n.includes('em criacao') || n.includes('criando') || n.includes('em producao');
}

/**
 * URL pra abrir um item específico do Monday num board específico.
 */
function buildItemMondayLink(boardId: string, pulseId: string): string {
  return `https://burstmidia.monday.com/boards/${boardId}/pulses/${pulseId}`;
}

export function computeTimelineUnificada(opts: {
  client: MondayClient;
  trafego: TrafegoSaude;
  design: DesignSaude;
  bia: BiaSaude;
  /** Eventos design JÁ filtrados (vindos de buildEventosPorCliente). */
  designEventos: DesignEvento[];
  /** Map<monday_client_id → bia_item_id> — pra montar link da Bia.
   *  Construído invertendo clientIdsByBiaItemId em SaudeCliente.tsx. Opcional. */
  biaItemIdByClientId?: Map<string, string>;
  /** Activity logs de boards do Design (Status da Tarefa/Designer mudanças).
   *  Filtrado pelo SaudeCliente pra incluir só itens deste cliente. */
  designActivityEvents?: BoardActivityEvent[];
  /** Map<pulseId, ISO_created_at> — datas de criação das demandas do Monday.
   *  Filtrado pelo SaudeCliente pra incluir só itens deste cliente. */
  designCreatedAtByItemId?: Map<string, string>;
  /** Eventos do board "Otimização Clientes" filtrados pra este cliente. */
  otimizacaoEvents?: Array<{
    ts: string;
    pulseName: string;
    pulseId: string;
    boardId: string;
    kind: 'criacao' | 'status';
    detail?: string;
  }>;
  /** Map<pulse_id, updates[]> — comentários do Monday agrupados por item.
   *  Quando um evento (design ou otimização) tem updates, aparecem inline. */
  updatesByPulseId?: Map<string, Array<{
    text: string;
    creatorName: string | null;
    createdAt: string;
  }>>;
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const clientLink = buildClientMondayLink(opts.client);
  const biaItemId = opts.biaItemIdByClientId?.get(opts.client.id) ?? null;
  const biaLink = buildBiaItemMondayLink(biaItemId) ?? clientLink;

  // ===== DESIGN — cada evento vira uma entrada (já filtrados) =====
  const eventosCliente = opts.designEventos;
  for (const ev of eventosCliente) {
    const d = eventoDateLocal(ev);
    if (!d) continue;
    const date = d.toISOString();
    // Extrai URL embutida em link_demanda ("Nome - URL") ou monta pelo board_id da origem
    const evLink = buildMondayDemandaLink(ev.link_demanda, ev.monday_item_id, ev.origem);
    if (ev.tipo_evento === 'feito') {
      const atrasada = ev.tempo_atrasado && ev.tempo_atrasado.trim() !== '';
      events.push({
        date,
        type: atrasada ? 'design-atrasada' : 'design-feito',
        category: 'design',
        title: ev.nome ?? `Demanda #${ev.id}`,
        detail: atrasada ? `Atrasada: ${ev.tempo_atrasado}` : ev.padrao_tarefa ?? undefined,
        link: evLink ?? undefined,
        responsavel: ev.designer_responsavel ?? undefined,
      });
    } else if (ev.tipo_evento === 'manutencao' || ev.tipo_evento === 'manutencao_c') {
      events.push({
        date,
        type: 'design-manutencao',
        category: 'design',
        title: ev.nome ?? `Manutenção #${ev.id}`,
        detail: ev.tipo_manutencao ?? (ev.tipo_evento === 'manutencao_c' ? 'Manutenção cliente' : 'Manutenção'),
        link: evLink ?? undefined,
        responsavel: ev.designer_responsavel ?? undefined,
      });
    }
  }

  // ===== DESIGN — datas de criação das demandas =====
  if (opts.designCreatedAtByItemId) {
    // Indexa designEventos por monday_item_id pra achar nome/origem da demanda
    const evByItemId = new Map<string, DesignEvento>();
    for (const ev of eventosCliente) {
      if (ev.monday_item_id) evByItemId.set(String(ev.monday_item_id), ev);
    }
    for (const [pulseId, createdAtIso] of opts.designCreatedAtByItemId) {
      const ev = evByItemId.get(pulseId);
      if (!ev) continue; // só inclui se a demanda pertence a este cliente
      const link = buildMondayDemandaLink(ev.link_demanda, ev.monday_item_id, ev.origem);
      events.push({
        date: createdAtIso,
        type: 'design-criada',
        category: 'design',
        title: ev.nome ?? `Demanda #${ev.id}`,
        detail: 'Demanda criada no Monday',
        link: link ?? undefined,
        responsavel: ev.designer_responsavel ?? undefined,
      });
    }
  }

  // ===== DESIGN — mudanças de Status (Status da Tarefa, Status do Designer) =====
  if (opts.designActivityEvents) {
    // Indexa designEventos por monday_item_id pra achar nome da demanda
    const evByItemId = new Map<string, DesignEvento>();
    for (const ev of eventosCliente) {
      if (ev.monday_item_id) evByItemId.set(String(ev.monday_item_id), ev);
    }
    for (const a of opts.designActivityEvents) {
      const ev = evByItemId.get(a.pulseId);
      if (!ev) continue; // só inclui mudanças de itens deste cliente
      const link = buildItemMondayLink(a.boardId, a.pulseId);
      const tituloDemanda = ev.nome ?? a.pulseName ?? `Demanda #${a.pulseId}`;

      // Categoriza pelo label novo
      if (isStatusTarefaAprovacao(a.next)) {
        events.push({
          date: a.ts,
          type: 'design-aprovada',
          category: 'design',
          title: tituloDemanda,
          detail: `Aprovado pelo gestor (${a.next})`,
          link,
          responsavel: ev.designer_responsavel ?? undefined,
        });
      } else if (isStatusTarefaAtrasado(a.next)) {
        events.push({
          date: a.ts,
          type: 'design-atrasada',
          category: 'design',
          title: tituloDemanda,
          detail: `Marcada como atrasada (${a.next})`,
          link,
          responsavel: ev.designer_responsavel ?? undefined,
        });
      } else if (isStatusDesignerEmCriacao(a.next)) {
        events.push({
          date: a.ts,
          type: 'design-em-criacao',
          category: 'design',
          title: tituloDemanda,
          detail: `Em criação — designer começou a arte`,
          link,
          responsavel: ev.designer_responsavel ?? undefined,
        });
      }
      // Outras transições genéricas — ainda mostram, mas com tipo neutro.
      // (Não duplica os já cobertos por design-feito/manutencao do bloco abaixo)
      else if (a.next && a.next.trim()) {
        // Decide tipo pelo nome da coluna (heurística)
        const colHint = (a.columnId || '').toLowerCase();
        const isDesignerCol = colHint.includes('designer') || colHint.includes('status_designer');
        events.push({
          date: a.ts,
          type: isDesignerCol ? 'design-status-designer' : 'design-status-tarefa',
          category: 'design',
          title: tituloDemanda,
          detail: `${isDesignerCol ? 'Status do Designer' : 'Status da Tarefa'}: ${a.next}`,
          link,
          responsavel: ev.designer_responsavel ?? undefined,
        });
      }
    }
  }

  // ===== BIA — cada transição de fase =====
  for (const p of opts.bia.periodos) {
    events.push({
      date: p.inicio,
      type: p.fase.toLowerCase().includes('ativa')
        ? 'bia-ativa'
        : p.fase.toLowerCase().includes('manut')
        ? 'bia-manutencao'
        : 'bia-outra',
      category: 'bia',
      title: `Bia → ${p.fase}`,
      detail: p.fim
        ? `Durou ${p.dias} dia(s)`
        : `Em andamento (${p.dias} dia(s))`,
      link: biaLink ?? undefined,
    });
  }

  // ===== TRÁFEGO — marcos importantes =====
  if (opts.trafego.primeiroLead) {
    events.push({
      date: opts.trafego.primeiroLead,
      type: 'lead-primeiro',
      category: 'trafego',
      title: 'Primeiro lead recebido',
      detail: `Início do relacionamento com a Bia`,
      link: clientLink ?? undefined,
    });
  }
  if (
    opts.trafego.ultimaTransferencia &&
    opts.trafego.ultimaTransferencia !== opts.trafego.primeiroLead
  ) {
    events.push({
      date: opts.trafego.ultimaTransferencia,
      type: 'lead-ultima-transf',
      category: 'trafego',
      title: 'Última transferência registrada',
      value: opts.trafego.transferencias,
      link: clientLink ?? undefined,
    });
  }
  // Dias com volume alto (>= 5 leads num dia) viram marcos
  for (const p of opts.trafego.serie) {
    if (p.leads >= 5) {
      events.push({
        date: p.date + 'T12:00:00',
        type: 'lead-volume-dia',
        category: 'trafego',
        title: `${p.leads} leads em 1 dia`,
        detail: `${p.transferencias} transferência(s)`,
        value: p.leads,
        link: clientLink ?? undefined,
      });
    }
  }

  // ===== OTIMIZAÇÃO DO GESTOR — board "Otimização Clientes" =====
  if (opts.otimizacaoEvents) {
    for (const o of opts.otimizacaoEvents) {
      const link = buildItemMondayLink(o.boardId, o.pulseId);
      const titulo = o.kind === 'criacao'
        ? `Otimização registrada${o.pulseName ? `: ${o.pulseName}` : ''}`
        : `Otimização — ${o.detail ?? 'status mudou'}${o.pulseName ? ` (${o.pulseName})` : ''}`;
      events.push({
        date: o.ts,
        type: 'gestor-otimizacao',
        category: 'meta',
        title: titulo,
        detail: o.kind === 'criacao' ? 'Novo item no board Otimização Clientes' : `Status: ${o.detail}`,
        link,
      });
    }
  }

  // Anexa updates (comentários do Monday) aos eventos quando o link aponta
  // pra um pulse_id que tem updates conhecidos. Só pega os 3 updates mais
  // recentes pra não inundar a UI.
  if (opts.updatesByPulseId && opts.updatesByPulseId.size > 0) {
    for (const ev of events) {
      // Tenta extrair pulse_id do link
      const link = ev.link;
      if (!link) continue;
      const m = link.match(/\/pulses\/(\d+)/);
      if (!m) continue;
      const pulseId = m[1];
      const ups = opts.updatesByPulseId.get(pulseId);
      if (!ups || ups.length === 0) continue;
      ev.updates = ups.slice(0, 3); // máx 3 updates por evento
    }
  }

  // Ordena DESC (mais recente primeiro)
  return events.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// =============================================================================
// HELPERS
// =============================================================================

function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Formata uma data (string em qualquer formato razoável do Monday/ISO/UTC)
 * pro horário de Brasília. Aceita:
 *  - ISO ("2026-05-12T14:30:00Z")
 *  - Monday "Anne Camargo, Mar 24, 2025 15:32"
 *  - "2026-03-30 21:31:22 UTC"
 *  - Já em "DD/MM..." → retorna como veio
 *
 * Retorna "12/05/2026 11:30" (dd/MM/yyyy HH:mm em horário de Brasília).
 */
export function fmtDataBrasilia(s: string | null | undefined): string {
  if (!s) return '—';
  const txt = s.trim();
  if (!txt) return '—';

  // Tenta ISO direto
  let d = new Date(txt);

  // Se falhou, tenta "Nome, Mon DD, YYYY HH:MM AM/PM"
  if (isNaN(d.getTime())) {
    const m = txt.match(/([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(\d{4})\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/);
    if (m) {
      const meses: Record<string, number> = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
      const mi = meses[m[1]];
      let h = parseInt(m[4], 10);
      const min = parseInt(m[5], 10);
      const ampm = m[6];
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      if (mi !== undefined) {
        // Monday é UTC — então a string com hora bruta vira UTC
        d = new Date(Date.UTC(parseInt(m[3], 10), mi, parseInt(m[2], 10), h, min));
      }
    }
  }

  // Se ainda falhou, tenta "YYYY-MM-DD HH:MM:SS UTC"
  if (isNaN(d.getTime())) {
    const m = txt.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      // assume UTC se string tem "UTC"
      const isUtc = /UTC|Z$/i.test(txt);
      d = isUtc
        ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
        : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
  }

  if (isNaN(d.getTime())) return txt; // retorna como veio se nada bateu

  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function statusColors(status: SaudeStatus): {
  bg: string;
  text: string;
  border: string;
  label: string;
} {
  if (status === 'critico') {
    return {
      bg: 'bg-red-500/15',
      text: 'text-red-400',
      border: 'border-red-500/50',
      label: 'CRÍTICO',
    };
  }
  if (status === 'atencao') {
    return {
      bg: 'bg-burst-warning/15',
      text: 'text-burst-warning',
      border: 'border-burst-warning/50',
      label: 'ATENÇÃO',
    };
  }
  if (status === 'sem-dados') {
    return {
      bg: 'bg-white/5',
      text: 'text-burst-muted',
      border: 'border-burst-border',
      label: 'SEM DADOS',
    };
  }
  return {
    bg: 'bg-green-500/15',
    text: 'text-green-400',
    border: 'border-green-500/50',
    label: 'BOM',
  };
}

import type {
  RelatorioBias,
  DoutorMetrics,
  MetricsSummary,
  SalaryTier,
} from './types';
import type { MondayClient, FaseTransition } from './monday';
import { getClientChurnCutoff, isFaseAtivaPublic, parseDataEntrada } from './monday';
import { getClientCustomCutoff } from '../config';

const TRANSFERENCIA_PATTERNS = [
  'agendar consulta',
  'agendar avaliacao',
  'agendar avalicao',     // typo: falta o "a" em avaliacao
  'agendar avaliacap',    // typo: "p" no lugar do "o"
  'agendamento confirmado',
  'consulta agendada',
  'avaliacao agendada',
  'vou agendar',
  'pode agendar',
  'agendamento',
  'encaminhamento contato',
  // Motivos de "conversão" pra clientes de e-commerce / cursos:
  // (o normalize() troca '_' por ' ', então usar versão com espaço)
  'finalizar compra',
  'matricula curso',
];

const INTERROMPIDO_PATTERNS = [
  'chat interrompido',
  'interrompido',
];

// Motivos que CONTEM "agendamento" mas NAO sao transferencia nova.
// Casam ANTES dos TRANSFERENCIA_PATTERNS — se bater aqui, isTransferido()
// retorna false direto.
//
// Caso classico: "agendamento de manutencao" — paciente JA convertido
// agendando retorno pra manutencao. Nao e venda nova, nao deveria entrar
// no funil de conversao do doutor/gestor/cs.
const TRANSFERENCIA_EXCLUSION_PATTERNS = [
  'manutencao',     // cobre manutenção/manutençao/MANUTENÇÃO (normalize tira acento)
];

// Doutores cujos leads são armazenados mas NÃO contam em transferências/CPT.
// Toda lead presente OU futura com nomeDoutor contendo um destes termos
// (case-insensitive, sem acento) é classificada como "Chat incompleto" e
// aparece em uma seção separada da aba Programação.
const DOUTORES_CHAT_INCOMPLETO = [
  'daiane feduk',
  'sorriso recife',
  'vitaprime',           // VitaPrime Clínica Odontológica
  'vita prime',          // variação com espaço
  'vitta prime',         // grafia antiga com 2 T (mantém compat com dados existentes)
  // 'mayara ventura' — REMOVIDA em 27/05/2026: passa a contar nas métricas
  //   (retroativo + futuro). Antes era excluída como "chat incompleto".
  'clinica artis',       // Clínica Artis (Carolina Moura) — chats incompletos, fora da métrica
];

// Doutores totalmente desconsiderados — leads NÃO aparecem em nenhuma seção
// (nem em Chats Incompletos). Usado para clientes que estão sendo excluídos
// das métricas em TODAS as abas (Programação + Gestor + CS).
const DOUTORES_DESCONSIDERADOS = [
  'cassiano vieira',
  'cassiano veieira',    // grafia alternativa no UAZAPI
  'jadson lucas',
  'simone justo',
  'idgm',                // IDGM - Cursos (Patrick e Gabriel Machado) — desconsiderado em todos os setores
  'luxx sorriso',        // Luxx Sorriso — removido de Gestor/Programação/CS (a pedido)
];

// Doutores escondidos APENAS da aba Programação (continuam em Gestor/CS).
// Usado quando o doutor não faz sentido pro acompanhamento de programadores
// mas ainda gera spend/transferências válidos pra gestor e CS.
const DOUTORES_OCULTOS_PROGRAMACAO: string[] = [
  // (vazio por enquanto)
];

function normalize(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\-]+/g, ' ')
    .toLowerCase();
}

export function isTransferido(lead: RelatorioBias): boolean {
  const haystack = normalize(lead.motivoTransferencia);
  // Exclui motivos de manutenção primeiro — sao agendamentos de retorno,
  // nao conversao nova.
  if (TRANSFERENCIA_EXCLUSION_PATTERNS.some((p) => haystack.includes(p))) return false;
  return TRANSFERENCIA_PATTERNS.some((p) => haystack.includes(p));
}

export function isInterrompido(lead: RelatorioBias): boolean {
  const haystack = normalize(lead.motivoTransferencia);
  return INTERROMPIDO_PATTERNS.some((p) => haystack.includes(p));
}

/** Lead marcado manualmente como "desclassificado" via aba Revisar dúvidas.
 *  Sai de TODAS as métricas (não conta como lead nem transferência). */
export function isDesclassificado(lead: RelatorioBias): boolean {
  const m = (lead.motivoTransferencia ?? '').trim().toLowerCase();
  return m === 'desclassificado';
}

export function isChatIncompleto(lead: RelatorioBias): boolean {
  const n = normalize(lead.nomeDoutor);
  if (!n) return false;
  return DOUTORES_CHAT_INCOMPLETO.some((p) => n.includes(p));
}

/** Lead de doutor totalmente desconsiderado — não aparece em lugar nenhum. */
export function isDesconsiderado(lead: RelatorioBias): boolean {
  const n = normalize(lead.nomeDoutor);
  if (!n) return false;
  return DOUTORES_DESCONSIDERADOS.some((p) => n.includes(p));
}

/** Lead de doutor escondido apenas da aba Programação. */
export function isOcultoProgramacao(lead: RelatorioBias): boolean {
  const n = normalize(lead.nomeDoutor);
  if (!n) return false;
  return DOUTORES_OCULTOS_PROGRAMACAO.some((p) => n.includes(p));
}

/**
 * Checa se um NOME (de cliente Monday, ou de doutor) bate com a lista de
 * "chat incompleto" OU "desconsiderados" — usado pra desqualificar o
 * cliente inteiro nas métricas de Gestor/CS.
 */
export function isNomeChatIncompleto(nome: string | null | undefined): boolean {
  const n = normalize(nome);
  if (!n) return false;
  return (
    DOUTORES_CHAT_INCOMPLETO.some((p) => n.includes(p)) ||
    DOUTORES_DESCONSIDERADOS.some((p) => n.includes(p))
  );
}

/**
 * Resolve o responsável (programador) de um doutor cruzando com o mapa
 * (nomeCliente normalizado → responsavel) vindo do board Bia Soft.
 *
 * Estratégia de match (mesma da gestorMetrics):
 * 1. nome exato
 * 2. doutor contém cliente OU cliente contém doutor (substring nos dois sentidos)
 */
export function getResponsavelForDoutor(
  doutorName: string | null | undefined,
  responsavelByClient: Map<string, string>
): string | null {
  const target = normalize(doutorName);
  if (!target || responsavelByClient.size === 0) return null;

  // IMPORTANTE: as chaves de `responsavelByClient` vêm do board Bia Soft
  // normalizadas com a normalize() de monday.ts, que MANTÉM hífen/underscore.
  // Aqui o `target` usa a normalize() deste arquivo, que troca -/_ por espaço.
  // Sem re-normalizar cada chave com a MESMA função, nomes com hífen (ex.:
  // "Integra Instituto - Dra. Leyrianne e Dra. Ana Paula") NUNCA casam, mesmo
  // sendo idênticos ao nomeDoutor do lead — o doutor sumia da visão do
  // responsável. Re-normalizamos a chave aqui pra alinhar as duas.
  for (const [client, resp] of responsavelByClient) {
    if (!client) continue;
    const c = normalize(client);
    if (!c) continue;
    if (target === c || target.includes(c) || c.includes(target)) return resp;
  }
  return null;
}

// Aceita nomes de instância começando com "Dr.", "Dr ", "Dra." ou "Dra " (case insensitive).
const DR_PREFIX_RE = /^dra?\.?\s+\S/i;

// Overrides explícitos: nome da instância na uazapi (lowercase) → nome do doutor
// a ser exibido. Use para casos onde o nome da instância não segue o padrão
// "Dr./Dra." mas representa um doutor conhecido.
const INSTANCE_DOUTOR_OVERRIDES: Record<string, string> = {
  rodrigorios: 'Dr. Rodrigo Rios',
};

export function resolveNomeDoutor(
  lead: RelatorioBias,
  instanceMap?: Map<string, string>
): string | null {
  const explicit = lead.nomeDoutor?.trim();
  if (explicit) return explicit;
  if (!instanceMap || !lead.token) return null;
  const instName = instanceMap.get(lead.token)?.trim();
  if (!instName) return null;
  const override = INSTANCE_DOUTOR_OVERRIDES[instName.toLowerCase()];
  if (override) return override;
  return DR_PREFIX_RE.test(instName) ? instName : null;
}

// Faixas de taxa de transferência (programação)
//   acima de 24%   → 1 salário
//   20% a 24%      → 0,5 salário
//   abaixo de 20%  → 0 (sem bônus)
// Regra atualizada no Dia D de jul/2026 (antes era 20%/16%).
export function tierForTaxa(taxa: number): SalaryTier {
  if (taxa > 24) return 1;
  if (taxa >= 20) return 0.5;
  return 0;
}

export function tierLabel(tier: SalaryTier): string {
  if (tier === 1) return '1 SALÁRIO';
  if (tier === 0.5) return '0,5 SALÁRIO';
  return 'SEM BÔNUS';
}

export function tierColor(tier: SalaryTier): {
  bg: string;
  text: string;
  border: string;
  glow: string;
} {
  if (tier === 1) {
    return {
      bg: 'bg-green-500/15',
      text: 'text-green-400',
      border: 'border-green-500/50',
      glow: 'shadow-[0_0_24px_rgba(34,197,94,0.35)]',
    };
  }
  if (tier === 0.5) {
    return {
      bg: 'bg-burst-orange/15',
      text: 'text-burst-orange-bright',
      border: 'border-burst-orange/50',
      glow: 'shadow-orange-glow',
    };
  }
  return {
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    border: 'border-red-500/50',
    glow: 'shadow-[0_0_24px_rgba(239,68,68,0.35)]',
  };
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Conta os DIAS em que a Bia esteve ATIVA no intervalo [since, until].
 *
 * Usa a timeline de transicoes de fase do board Bia Soft pra montar
 * "segmentos" de tempo onde a fase era ativa. Soma as duracoes desses
 * segmentos dentro do intervalo.
 *
 * Pra "dias sem transferencia", since = data da ultima transferencia.
 * Se a Bia ficou em manutencao 20 de 30 dias desde a ultima transferencia,
 * o resultado e 10 (e nao 30 — nao penaliza o doutor pelos 20 dias mortos).
 *
 * Edge cases:
 *  - Timeline vazia + faseAtual ativa: assume sempre ativa = retorna calendar days
 *  - Timeline vazia + faseAtual NAO ativa: retorna 0
 *  - until < since: retorna 0
 */
const MS_PER_HORA = 1000 * 60 * 60;
const MS_PER_DIA = 1000 * 60 * 60 * 24;

export function activeMsInRange(
  timeline: FaseTransition[] | undefined,
  faseAtual: string | null | undefined,
  since: Date,
  until: Date
): number {
  if (until.getTime() <= since.getTime()) return 0;

  // Sem timeline: usa so a fase atual (assume manteve por todo o periodo)
  if (!timeline || timeline.length === 0) {
    return isFaseAtivaPublic(faseAtual) ? until.getTime() - since.getTime() : 0;
  }

  // Ordena timeline por ts ascending (paranoia — geralmente ja vem ordenada)
  const sorted = [...timeline].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  // Constroi segmentos [start, end, isActive] cobrindo [since, until].
  // Antes da primeira transicao: usa transitions[0].prev como fase
  // Entre transicao i e i+1: usa transitions[i].next
  // Depois da ultima: usa transitions[last].next (que deveria casar com faseAtual)
  let activeMs = 0;
  const sinceTs = since.getTime();
  const untilTs = until.getTime();

  // Fase antes da primeira transicao
  let currentFase: string | null | undefined = sorted[0].prev;
  let segStart = sinceTs;

  for (const t of sorted) {
    const tTs = new Date(t.ts).getTime();
    if (tTs <= sinceTs) {
      // Transicao acontece antes do nosso intervalo — soh atualiza fase
      currentFase = t.next;
      continue;
    }
    if (tTs >= untilTs) {
      // Transicao acontece depois do nosso intervalo — fecha ultimo segmento
      if (isFaseAtivaPublic(currentFase)) {
        activeMs += untilTs - segStart;
      }
      segStart = untilTs;
      currentFase = t.next;
      break;
    }
    // Transicao DENTRO do intervalo — fecha segmento atual e abre proximo
    if (isFaseAtivaPublic(currentFase)) {
      activeMs += tTs - segStart;
    }
    segStart = tTs;
    currentFase = t.next;
  }

  // Fecha segmento final ate `until` (se nao foi fechado no loop)
  if (segStart < untilTs && isFaseAtivaPublic(currentFase)) {
    activeMs += untilTs - segStart;
  }

  return activeMs;
}

/** Dias (inteiros) com a Bia ATIVA no intervalo. Wrapper de activeMsInRange. */
export function activeDaysInRange(
  timeline: FaseTransition[] | undefined,
  faseAtual: string | null | undefined,
  since: Date,
  until: Date
): number {
  return Math.floor(activeMsInRange(timeline, faseAtual, since, until) / MS_PER_DIA);
}

/** Formata o tempo com a Bia ATIVA: "N dias", ou "N horas" se < 1 dia.
 *  null/undefined/negativo → "—". */
export function formatBiaAtiva(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return '—';
  if (ms < MS_PER_DIA) {
    const h = Math.floor(ms / MS_PER_HORA);
    return `${h} ${h === 1 ? 'hora' : 'horas'}`;
  }
  const d = Math.floor(ms / MS_PER_DIA);
  return `${d} ${d === 1 ? 'dia' : 'dias'}`;
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildEvolucao(
  leads: RelatorioBias[],
  endDate: Date
): { date: string; taxa: number }[] {
  const out: { date: string; taxa: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(endDate);
    day.setDate(endDate.getDate() - i);
    day.setHours(23, 59, 59, 999);
    const cutoff = day.getTime();
    let total = 0;
    let transferidos = 0;
    for (const l of leads) {
      const t = new Date(l.dataCadastro).getTime();
      if (t <= cutoff) {
        total++;
        if (isTransferido(l)) transferidos++;
      }
    }
    const taxa = total > 0 ? (transferidos / total) * 100 : 0;
    out.push({ date: formatDateKey(day), taxa: Number(taxa.toFixed(1)) });
  }
  return out;
}

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export function filterByDateRange(
  leads: RelatorioBias[],
  range: DateRange
): RelatorioBias[] {
  if (!range.start && !range.end) return leads;
  return leads.filter((l) => {
    const t = new Date(l.dataCadastro).getTime();
    if (range.start && t < range.start.getTime()) return false;
    if (range.end && t > range.end.getTime()) return false;
    return true;
  });
}

// Constrói um mapa nomeDoutor (normalizado) → dataCorte
// para os clientes Monday que estão churned.
function buildChurnCutoffMap(
  clients: MondayClient[] | undefined
): Map<string, Date> {
  const map = new Map<string, Date>();
  if (!clients) return map;
  for (const c of clients) {
    // Corte = o MAIS ANTIGO entre churn (status do Monday) e custom (lista
    // CLIENT_CUTOFFS no config). Sem incluir o custom aqui, o corte manual só
    // valia em Gestor/CS — agora também desconsidera na Programação.
    const churn = getClientChurnCutoff(c);
    const custom = getClientCustomCutoff(c.id);
    const cutoff = [churn, custom]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    if (!cutoff) continue;
    // chave: nome do cliente normalizado (que tende a casar com nomeDoutor)
    const key = normalize(c.name);
    if (key) map.set(key, cutoff);
  }
  return map;
}

// Retorna a data de corte para um doutor, casando pelo nome (substring).
function findCutoffForDoutor(
  doutor: string,
  cutoffMap: Map<string, Date>
): Date | null {
  if (cutoffMap.size === 0) return null;
  const target = normalize(doutor);
  if (!target) return null;
  if (cutoffMap.has(target)) return cutoffMap.get(target)!;
  // substring (mesma lógica que findDoutorMatch em gestorMetrics)
  for (const [key, cutoff] of cutoffMap) {
    if (target.includes(key) || key.includes(target)) return cutoff;
  }
  // Fallback "loose": remove parênteses e colapsa espaços, pra casar variações
  // de pontuação — ex: "Elevare Odontologia - Ana Neri" (cliente) vs
  // "Elevare Odontologia (Ana Neri)" (nomeDoutor).
  const loose = (s: string) => s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const lt = loose(target);
  if (lt) {
    for (const [key, cutoff] of cutoffMap) {
      const lk = loose(key);
      if (lk && (lt.includes(lk) || lk.includes(lt))) return cutoff;
    }
  }
  return null;
}

/** Normaliza nome pra comparacao (sem acento, lowercase, trim, sem prefixos). */
function normalizeNomeDoutor(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(dr\.?|dra\.?|drs\.?|dras\.?)\s+/i, '')
    .trim();
}

/** Constroi indice nome normalizado → MondayClient pra match O(1). */
function buildClientIndex(clients: MondayClient[]): Map<string, MondayClient> {
  const m = new Map<string, MondayClient>();
  for (const c of clients) {
    const key = normalizeNomeDoutor(c.name);
    if (key) m.set(key, c);
  }
  return m;
}

/** Acha o MondayClient correspondente ao nome do doutor. Match exato primeiro,
 *  substring fallback. Retorna null se nao achar. */
function findClientForDoutor(
  doutorName: string,
  clientIndex: Map<string, MondayClient>
): MondayClient | null {
  const key = normalizeNomeDoutor(doutorName);
  if (!key) return null;
  if (clientIndex.has(key)) return clientIndex.get(key)!;
  // Substring fallback — pega o primeiro client cujo nome normalizado bate
  for (const [clientKey, client] of clientIndex) {
    if (clientKey.includes(key) || key.includes(clientKey)) return client;
  }
  return null;
}

export function computeMetrics(
  leads: RelatorioBias[],
  range?: DateRange,
  instanceMap?: Map<string, string>,
  clients?: MondayClient[],
  biaTimelineByClientId?: Map<string, FaseTransition[]>,
  biaFaseByClientId?: Map<string, string>
): MetricsSummary {
  const now = new Date();
  const evolucaoEnd = range?.end ?? now;

  // Doutores totalmente desconsiderados são REMOVIDOS do dataset antes de
  // qualquer categorização — não aparecem em nenhuma seção do dashboard.
  // E os "ocultos da Programação" também (só aplicado aqui, pois Gestor/CS
  // usam outras funções de cálculo).
  const leadsVisiveis = leads.filter(
    (l) => !isDesconsiderado(l) && !isOcultoProgramacao(l)
  );

  // Categorias excluídas das métricas (armazenadas mas não contam):
  //   - chats interrompidos (motivo)
  //   - chats incompletos (doutor na lista fixa)
  const chatsInterrompidos = leadsVisiveis.filter(isInterrompido);
  const chatsIncompletos = leadsVisiveis.filter(
    (l) => !isInterrompido(l) && isChatIncompleto(l)
  );
  let activeLeads = leadsVisiveis.filter(
    (l) => !isInterrompido(l) && !isChatIncompleto(l) && !isDesclassificado(l)
  );

  // Aplica corte de churn por doutor.
  // Se o cliente Monday daquele doutor está churned, leads com dataCadastro
  // posterior à data de corte são excluídos das métricas.
  const churnCutoffMap = buildChurnCutoffMap(clients);
  if (churnCutoffMap.size > 0) {
    activeLeads = activeLeads.filter((l) => {
      const doutor = resolveNomeDoutor(l, instanceMap);
      if (!doutor) return true; // sem doutor — não há cliente Monday pra cortar
      const cutoff = findCutoffForDoutor(doutor, churnCutoffMap);
      if (!cutoff) return true;
      return new Date(l.dataCadastro).getTime() <= cutoff.getTime();
    });
  }

  const byDoutor = new Map<string, RelatorioBias[]>();
  const leadsSemDoutor: RelatorioBias[] = [];

  for (const l of activeLeads) {
    const resolved = resolveNomeDoutor(l, instanceMap);
    if (!resolved) {
      leadsSemDoutor.push(l);
      continue;
    }
    const arr = byDoutor.get(resolved) ?? [];
    arr.push(l);
    byDoutor.set(resolved, arr);
  }

  // Indice nome → MondayClient pra resolver timeline da Bia por doutor.
  // Soh constroi se realmente vamos usar (clients fornecidos).
  const clientIndex = clients && clients.length > 0 ? buildClientIndex(clients) : null;

  const doutores: DoutorMetrics[] = [];
  for (const [nome, dleads] of byDoutor) {
    const totalLeads = dleads.length;
    const totalTransferidos = dleads.filter(isTransferido).length;
    const taxa = totalLeads > 0 ? (totalTransferidos / totalLeads) * 100 : 0;

    let ultimoLead: string | null = null;
    let ultimaTransferencia: string | null = null;
    for (const l of dleads) {
      if (!ultimoLead || new Date(l.dataCadastro) > new Date(ultimoLead)) {
        ultimoLead = l.dataCadastro;
      }
      if (l.dataTransferencia) {
        if (
          !ultimaTransferencia ||
          new Date(l.dataTransferencia) > new Date(ultimaTransferencia)
        ) {
          ultimaTransferencia = l.dataTransferencia;
        }
      }
    }

    // === DIAS SEM TRANSFERENCIA ===
    // Em vez de contar DIAS DE CALENDARIO desde a ultima transferencia, conta
    // apenas DIAS COM BIA ATIVA. Se a Bia ficou desligada/em manutencao no
    // periodo, esses dias NAO contam (nao penaliza o doutor por algo que
    // nao depende dele).
    //
    // Fallback: sem timeline/client → comportamento antigo (calendar days).
    let diasSemTransferencia: number;
    if (!ultimaTransferencia) {
      diasSemTransferencia = 9999;
    } else {
      const since = new Date(ultimaTransferencia);
      const client = clientIndex ? findClientForDoutor(nome, clientIndex) : null;
      const timeline = client && biaTimelineByClientId ? biaTimelineByClientId.get(client.id) : undefined;
      const faseAtual = client && biaFaseByClientId ? biaFaseByClientId.get(client.id) : null;
      if (client && (biaTimelineByClientId || biaFaseByClientId)) {
        diasSemTransferencia = activeDaysInRange(timeline, faseAtual, since, now);
      } else {
        // Sem dados de timeline/fase: fallback pro comportamento antigo
        diasSemTransferencia = daysBetween(now, since);
      }
    }

    // === DIAS COM BIA ATIVA (desde a entrada do cliente, exclui manutenção) ===
    // Há quanto tempo o cliente está com a Bia ATIVA. Vai até AGORA (independe
    // do range). Em horas se < 1 dia (cliente recém-ativado).
    let biaAtivaMs: number | null = null;
    const clientBia = clientIndex ? findClientForDoutor(nome, clientIndex) : null;
    if (clientBia) {
      const tlBia = biaTimelineByClientId?.get(clientBia.id);
      const faseBia = biaFaseByClientId?.get(clientBia.id) ?? null;
      const entradaBia = parseDataEntrada(clientBia.dataEntrada);
      const sinceBia = entradaBia ?? (tlBia && tlBia.length > 0 ? new Date(tlBia[0].ts) : null);
      if (sinceBia) biaAtivaMs = activeMsInRange(tlBia, faseBia, sinceBia, now);
    }

    let status: DoutorMetrics['status'] = 'ATIVO';
    if (!ultimaTransferencia || diasSemTransferencia >= 5) {
      status = 'SEM TRANSFERENCIA';
    }

    doutores.push({
      nome,
      totalLeads,
      totalTransferidos,
      taxa: Number(taxa.toFixed(1)),
      tier: tierForTaxa(taxa),
      ultimoLead,
      ultimaTransferencia,
      diasSemTransferencia,
      biaAtivaMs,
      status,
      evolucao: buildEvolucao(dleads, evolucaoEnd),
      leads: dleads,
    });
  }

  doutores.sort((a, b) => b.taxa - a.taxa);

  const totalLeads = activeLeads.length;
  const totalTransferidos = activeLeads.filter(isTransferido).length;
  const taxaGeral = totalLeads > 0 ? (totalTransferidos / totalLeads) * 100 : 0;

  return {
    totalLeads,
    totalTransferidos,
    taxaGeral: Number(taxaGeral.toFixed(1)),
    tier: tierForTaxa(taxaGeral),
    doutores,
    leadsSemDoutor,
    chatsInterrompidos,
    chatsIncompletos,
    activeLeads,
  };
}

export function progressToNextTier(taxa: number): {
  nextLabel: string;
  pctOfBar: number;
  remaining: number;
} {
  if (taxa > 24) {
    return { nextLabel: 'Faixa máxima atingida', pctOfBar: 100, remaining: 0 };
  }
  if (taxa >= 20) {
    const span = 24 - 20;
    const progress = ((taxa - 20) / span) * 100;
    return {
      nextLabel: 'até 1 salário (>24%)',
      pctOfBar: Math.min(100, Math.max(0, progress)),
      remaining: Number(Math.max(0, 24 - taxa).toFixed(1)),
    };
  }
  const progress = (taxa / 20) * 100;
  return {
    nextLabel: 'até 0,5 salário (20%)',
    pctOfBar: Math.min(100, Math.max(0, progress)),
    remaining: Number(Math.max(0, 20 - taxa).toFixed(1)),
  };
}

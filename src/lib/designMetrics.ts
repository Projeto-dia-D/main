import type { DateRange } from './metrics';
import type { SalaryTier } from './types';
import { countWorkingDays } from './holidays';
import { primeiroDesignerAtivo, getDesignerInicio } from '../config';
import { diasUteisAtestados, type Atestado } from './atestados';
import type { DesignAtraso } from '../hooks/useDesignAtrasos';

// A métrica de ATRASO só vale a partir de 01/07/2026 (Dia D de julho). Demandas
// e atrasos anteriores a essa data não entram no cálculo de atraso%.
const ATRASO_INICIO = new Date(2026, 6, 1, 0, 0, 0, 0);

export interface DesignEvento {
  id: number;
  nome: string | null;
  link_demanda: string | null;
  designer_responsavel: string | null;
  padrao_tarefa: string | null;
  tipo_edicao: string | null;
  log_criacao: string | null;
  // Específicos do fluxo Feito
  clientes: string | null;
  prioridade: string | null;
  tempo_atrasado: string | null;
  status_tarefa: string | null;
  status_designer: string | null;
  priority: string | null;
  // Específicos do fluxo Manutenção
  status_principal: string | null;
  status_individual: string | null;
  gestor_responsavel: string | null;
  tipo_manutencao: string | null;
  // Controle
  tipo_evento: 'feito' | 'manutencao' | 'manutencao_c';
  monday_item_id: string | null;
  origem: string;
  imported_at: string;
  // Data REAL de quando virou Feito (pego do Monday Activity Log).
  // Quando presente, tem prioridade sobre log_criacao no agrupamento por período.
  data_feito: string | null;
  // === "Atribuir métricas" (decisão do Renan, por manutenção) ===
  // contabilizar: a manutenção pesa no %? (default true no banco). SÓ o Renan edita.
  // revisado: o Renan já olhou? justificativa: nota do DESIGNER (enquanto !revisado).
  contabilizar?: boolean | null;
  revisado?: boolean | null;
  justificativa?: string | null;
  revisado_por?: string | null;
  revisado_em?: string | null;
  justificativa_por?: string | null;
  justificativa_em?: string | null;
}

export interface DesignerMetrics {
  nome: string;
  // Distintos (cada Monday item conta 1 vez)
  feitasUnicas: number;
  manutencoesUnicas: number;
  // Brutos (cada evento conta — manutenção repetida conta n vezes)
  totalEventosFeito: number;
  totalEventosManutencao: number;
  totalEventosManutencaoC: number;
  pctManutencao: number; // (manutencoesUnicas / feitasUnicas) * 100
  // === ATRASO (métrica pontuada principal a partir de jul/2026) ===
  atrasoPct: number;               // (atrasadasNoPeriodo / feitasNoAtraso) * 100
  atrasadasNoPeriodo: number;      // demandas do designer que atrasaram (board Atrasos), jul/2026+
  feitasNoAtraso: number;          // demandas feitas únicas do designer, jul/2026+ (denominador do atraso)
  tierAtraso: SalaryTier;          // 0 / 0.25 / 0.5 — baseado em atrasoPct
  // Métricas de bônus
  demandasPorDia: number;          // feitasUnicas / diasNoPeriodo (INFORMATIVO — não pontua mais)
  tierDemandas: SalaryTier;        // 0 / 0.5 / 1 — INFORMATIVO (baseado em demandasPorDia)
  tierManutencao: SalaryTier;      // 0 / 0.25 / 0.5 — baseado em pctManutencao (payout reduzido)
  bonusTotal: SalaryTier;          // SOMA de tierAtraso + tierManutencao (até 1 salário)
  // Dias úteis de atestado deste designer DENTRO do período (já subtraídos
  // de diasPorDia). 0 quando não houver atestado no período.
  diasAtestadoNoPeriodo: number;
  // Lista crua de atestados do designer que tocam o período (pra UI).
  atestadosNoPeriodo: Atestado[];
  eventos: DesignEvento[];
}

export interface DesignSummary {
  feitasUnicas: number;
  manutencoesUnicas: number;
  totalEventosFeito: number;
  totalEventosManutencao: number;
  totalEventosManutencaoC: number;
  pctManutencao: number;
  // Atraso agregado do time (jul/2026+): atrasadas / feitas × 100
  pctAtrasoGeral: number;
  atrasadasGeral: number;
  feitasAtrasoGeral: number;
  diasNoPeriodo: number;           // qtd de dias considerados no /dia
  designers: DesignerMetrics[];
  eventosSemDesigner: DesignEvento[];
  // Eventos no período (após filtro de data)
  eventosFiltrados: DesignEvento[];
}

// ============================================================
// Faixas salariais (DISTRIBUIR PROSPERIDADE — Designer)
// ============================================================

// DEMANDAS/DIA (INFORMATIVO a partir de jul/2026 — não pontua mais o bônus):
// 12 ou mais → 1; 8 a <12 → 0,5; abaixo de 8 → 0. Mantido só pra exibição.
export function tierForDemandasDia(perDia: number): SalaryTier {
  if (perDia >= 12) return 1;
  if (perDia >= 8) return 0.5;
  return 0;
}

// MANUTENÇÃO (% manutenção) — payouts REDUZIDOS À METADE no Dia D de jul/2026
// (faixas iguais, só o valor mudou): 15 ou menos → 0,5; >15 a 19 → 0,25; >19 → 0.
export function tierForPctManutencao(pct: number): SalaryTier {
  if (pct <= 15) return 0.5;
  if (pct <= 19) return 0.25;
  return 0;
}

// ATRASO (% atraso = demandas que atrasaram / demandas feitas × 100) — métrica
// nova (jul/2026), substitui "demanda feita" como a métrica pontuada principal:
// 7% ou menos → 0,5; >7 a 10% → 0,25; acima de 10% → 0.
export function tierForAtraso(pct: number): SalaryTier {
  if (pct <= 7) return 0.5;
  if (pct <= 10) return 0.25;
  return 0;
}

export function tierLabel(t: SalaryTier): string {
  if (t === 1) return '1 SALÁRIO';
  if (t === 0.75) return '0,75 SALÁRIO';
  if (t === 0.5) return '0,5 SALÁRIO';
  if (t === 0.25) return '0,25 SALÁRIO';
  return 'SEM BÔNUS';
}

// Verde = bônus cheio (1); laranja = bônus parcial (0,25 / 0,5 / 0,75);
// vermelho = sem bônus (0).
export function tierColor(t: SalaryTier): { bg: string; text: string; border: string; glow: string } {
  if (t >= 1) {
    return {
      bg: 'bg-green-500/15',
      text: 'text-green-400',
      border: 'border-green-500/50',
      glow: 'shadow-[0_0_24px_rgba(34,197,94,0.35)]',
    };
  }
  if (t > 0) {
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

// Cor pela FAIXA (tier) de uma métrica que vale no máximo 0,5 (atraso e
// manutenção): 0,5 = melhor faixa → verde; 0,25 → laranja; 0 → vermelho.
// Colorir pelo tier (e não pelo % arredondado) garante que a cor bata EXATAMENTE
// com o que é pago, mesmo nas bordas (7/10 e 15/19).
export function halfTierColor(t: SalaryTier) {
  if (t >= 0.5) return tierColor(1);   // verde
  if (t >= 0.25) return tierColor(0.5); // laranja
  return tierColor(0);                  // vermelho
}

export function formatBonusTotal(b: number): string {
  if (b === 0) return 'SEM BÔNUS';
  if (b === 0.25) return '0,25 SALÁRIO';
  if (b === 0.5) return '0,5 SALÁRIO';
  if (b === 0.75) return '0,75 SALÁRIO';
  if (b === 1) return '1 SALÁRIO';
  if (b === 1.5) return '1,5 SALÁRIO';
  if (b === 2) return '2 SALÁRIOS';
  return `${b} SALÁRIO`;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Tenta parsear o log_criacao. Suporta múltiplos formatos vistos no Monday:
 *  - "Renan Rafaeli Jun 12, 2024 4:48 PM"          (12h com AM/PM)
 *  - "Renan Rafaeli Jun 12, 2024 16:48"            (24h sem AM/PM)
 *  - "Renan Rafaeli Jun 12, 2024"                  (sem horário)
 *  - "Renan Rafaeli 2024-06-12 16:48"              (ISO date)
 *  - "Renan Rafaeli 2024-06-12"                    (ISO sem hora)
 * Retorna null se nenhum bate.
 */
export function parseLogCriacaoDate(log: string | null | undefined): Date | null {
  if (!log) return null;

  // Formato 1: "Mon DD, YYYY H:MM AM/PM"
  let m = log.match(/\b([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)\b/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month !== undefined) {
      let hour = parseInt(m[4], 10);
      const min = parseInt(m[5], 10);
      const ampm = m[6];
      if (ampm === 'PM' && hour < 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
      return new Date(parseInt(m[3], 10), month, parseInt(m[2], 10), hour, min);
    }
  }

  // Formato 2: "Mon DD, YYYY HH:MM" (24h sem AM/PM)
  m = log.match(/\b([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\b/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month !== undefined) {
      return new Date(
        parseInt(m[3], 10),
        month,
        parseInt(m[2], 10),
        parseInt(m[4], 10),
        parseInt(m[5], 10)
      );
    }
  }

  // Formato 3: "Mon DD, YYYY" (sem horário)
  m = log.match(/\b([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})\b/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month !== undefined) {
      return new Date(parseInt(m[3], 10), month, parseInt(m[2], 10));
    }
  }

  // Formato 4: "YYYY-MM-DD HH:MM" (ISO)
  m = log.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2}))?/);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    const hour = m[4] ? parseInt(m[4], 10) : 0;
    const min = m[5] ? parseInt(m[5], 10) : 0;
    return new Date(year, month, day, hour, min);
  }

  return null;
}

/** Pega o nome do criador do log_criacao (parte antes do "Mon DD,"). */
export function parseLogCriacaoAutor(log: string | null | undefined): string | null {
  if (!log) return null;
  const m = log.match(/^(.*?)\s+[A-Z][a-z]{2}\s+\d{1,2},/);
  return m?.[1]?.trim() ?? null;
}

/**
 * Chave única por demanda:
 *  1º monday_item_id (mais confiável)
 *  2º nome normalizado (mescla xlsx sem ID com webhook com ID)
 *  3º id da linha (fallback final — só pra eventos sem nome E sem ID)
 *
 * Sem o fallback por nome, mesmo evento entrando 2x (uma vez por origem
 * diferente, com/sem monday_item_id) conta como 2 demandas únicas. Com
 * o fallback, conta como 1.
 */
export function uniqueDemandaKey(e: DesignEvento): string {
  if (e.monday_item_id) return `m:${e.monday_item_id}`;
  const normalized = (e.nome || '').trim().toLowerCase();
  if (normalized) return `n:${normalized}`;
  return `r:${e.id}`;
}

/** Data do evento: log_criacao (preferido) > data_feito > imported_at.
 *  log_criacao dos xlsx "Demandas feitas" já é a data correta (board só
 *  recebe items quando viram Feito → "criação no board" = "data de feito").
 *  data_feito (Activity Log) é fallback — pode discordar quando há re-feitos. */
function eventoData(e: DesignEvento): Date {
  const parsed = parseLogCriacaoDate(e.log_criacao);
  if (parsed) return parsed;
  if (e.data_feito) {
    const d = new Date(e.data_feito);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(e.imported_at);
}

/** Chave única de um atraso (uma demanda atrasada conta 1 vez, mesmo se o board
 *  tiver linhas repetidas): monday_item_id > nome normalizado. */
function atrasoKey(a: DesignAtraso): string {
  if (a.monday_item_id) return `m:${a.monday_item_id}`;
  const n = (a.nome || '').trim().toLowerCase();
  return n ? `n:${n}` : `i:${a.monday_item_id ?? Math.random()}`;
}

/** Data de um atraso: log_criacao (quando entrou no board de Atrasos) >
 *  cronograma_fim > cronograma_inicio. null se nada parseável. */
function atrasoData(a: DesignAtraso): Date | null {
  const parsed = parseLogCriacaoDate(a.log_criacao);
  if (parsed) return parsed;
  for (const c of [a.cronograma_fim, a.cronograma_inicio]) {
    if (!c) continue;
    const d = new Date(c);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export function filterEventosByDate(
  eventos: DesignEvento[],
  range: DateRange
): DesignEvento[] {
  if (!range.start && !range.end) return eventos;
  return eventos.filter((e) => {
    const t = eventoData(e).getTime();
    if (range.start && t < range.start.getTime()) return false;
    if (range.end && t > range.end.getTime()) return false;
    return true;
  });
}

// Cores por % de manutenção — por QUALIDADE (faixas 15/19), independente do
// valor do payout (que foi reduzido à metade). Verde ≤15, laranja ≤19, senão
// vermelho — mantém a leitura visual de sempre mesmo com o tier valendo 0,5/0,25.
export function pctManutColors(pct: number) {
  if (pct <= 15) return tierColor(1);
  if (pct <= 19) return tierColor(0.5);
  return tierColor(0);
}

export function pctLabel(pct: number): string {
  if (pct <= 15) return 'EXCELENTE';
  if (pct <= 19) return 'ATENÇÃO';
  return 'CRÍTICO';
}

// Cores por % de atraso — por QUALIDADE (faixas 7/10). Verde ≤7, laranja ≤10,
// senão vermelho.
export function atrasoColors(pct: number) {
  if (pct <= 7) return tierColor(1);
  if (pct <= 10) return tierColor(0.5);
  return tierColor(0);
}

export function atrasoLabel(pct: number): string {
  if (pct <= 7) return 'EM DIA';
  if (pct <= 10) return 'ATENÇÃO';
  return 'CRÍTICO';
}

// Determina o intervalo concreto [start..end] do período de análise.
// Se `range` tem ambas as datas, usa essas. Senão, infere pelo span dos eventos.
function resolveRangeBounds(range: DateRange | undefined, eventos: DesignEvento[]): { start: Date; end: Date } {
  let start: Date | null = range?.start ?? null;
  let end: Date | null = range?.end ?? null;
  if (!start || !end) {
    const allDates = eventos
      .map((e) => {
        const parsed = parseLogCriacaoDate(e.log_criacao);
        if (parsed) return parsed;
        if (e.data_feito) {
          const d = new Date(e.data_feito);
          if (!isNaN(d.getTime())) return d;
        }
        return new Date(e.imported_at);
      })
      .filter((d) => !isNaN(d.getTime()))
      .map((d) => d.getTime());
    if (allDates.length > 0) {
      if (!start) start = new Date(Math.min(...allDates));
      if (!end) end = new Date(Math.max(...allDates));
    } else {
      if (!start) start = new Date();
      if (!end) end = new Date();
    }
  }
  return { start, end };
}

// Calcula quantos DIAS ÚTEIS (seg-sex menos feriados) o período abrange.
// Se range tem ambas as datas, usa essas. Senão, computa pelo span dos eventos.
function diasNoPeriodo(
  range: DateRange | undefined,
  eventos: DesignEvento[],
  holidaySet: Set<string>
): number {
  let start: Date | null = range?.start ?? null;
  let end: Date | null = range?.end ?? null;

  if (!start || !end) {
    const allDates = eventos
      .map((e) => {
        const parsed = parseLogCriacaoDate(e.log_criacao);
        if (parsed) return parsed;
        if (e.data_feito) {
          const d = new Date(e.data_feito);
          if (!isNaN(d.getTime())) return d;
        }
        return new Date(e.imported_at);
      })
      .filter((d) => !isNaN(d.getTime()))
      .map((d) => d.getTime());
    if (allDates.length === 0) return 1;
    if (!start) start = new Date(Math.min(...allDates));
    if (!end) end = new Date(Math.max(...allDates));
  }

  return Math.max(1, countWorkingDays(start, end, holidaySet));
}

export function computeDesignMetrics(
  eventos: DesignEvento[],
  range?: DateRange,
  holidaySet: Set<string> = new Set(),
  atestados: Atestado[] = [],
  atrasos: DesignAtraso[] = []
): DesignSummary {
  // Período de análise = exatamente o range selecionado (inclui o dia em curso).
  // Antes o "Dia D" (ciclo dia-12) descontava o dia atual do "demandas/dia"; com
  // o Dia D mensal e "demandas/dia" agora informativo (a métrica pontuada é o
  // atraso), esse desconto foi removido — senão as demandas de hoje sumiriam da
  // visão mensal inteira.
  const effRange = range;

  // `filtered` é o set COMPLETO do período (inclui inativos) — usado pelos
  // totais globais e modais. Inativos só são removidos do agrupamento por
  // designer abaixo, então não aparecem como cards mas continuam nas estatísticas.
  const filtered = effRange ? filterEventosByDate(eventos, effRange) : eventos;

  const dias = diasNoPeriodo(effRange, filtered, holidaySet);

  // Resolve as datas reais do período (pode ter sido inferido dos eventos)
  const { start: rangeStart, end: rangeEnd } = resolveRangeBounds(effRange, filtered);

  // === ATRASOS (board "⌚ Atrasos do Design") ===
  // Janela do atraso: o período selecionado, mas nunca antes de 01/07/2026 (a
  // métrica começa no Dia D de julho). atrasoInicio = max(rangeStart, jul/2026).
  const atrasoInicio = rangeStart.getTime() > ATRASO_INICIO.getTime() ? rangeStart : ATRASO_INICIO;
  const atrasoInicioMs = atrasoInicio.getTime();
  const atrasoFimMs = rangeEnd.getTime();
  // Atrasos dentro da janela, agrupados pelo PRIMEIRO designer ativo (mesma
  // regra dos eventos — combos "Felipe, Lais" vão pro Felipe).
  const atrasosByDesigner = new Map<string, DesignAtraso[]>();
  const atrasosNoPeriodo: DesignAtraso[] = [];
  for (const a of atrasos) {
    const d = atrasoData(a);
    if (!d) continue;
    const t = d.getTime();
    if (t < atrasoInicioMs || t > atrasoFimMs) continue;
    atrasosNoPeriodo.push(a);
    const label = primeiroDesignerAtivo(a.designer);
    if (!label) continue;
    const arr = atrasosByDesigner.get(label) ?? [];
    arr.push(a);
    atrasosByDesigner.set(label, arr);
  }

  // Agrupa por designer — só os ATIVOS aparecem como cards.
  // Eventos com designer mesclado (ex: "Felipe Moraes, Jean Carlos Tigre")
  // são atribuídos APENAS ao primeiro designer ativo encontrado — nunca
  // aparecem como "combo" na UI.
  const byDesigner = new Map<string, DesignEvento[]>();
  const semDesigner: DesignEvento[] = [];
  for (const e of filtered) {
    const d = e.designer_responsavel?.trim();
    if (!d) {
      semDesigner.push(e);
      continue;
    }
    const ativoLabel = primeiroDesignerAtivo(d);
    if (!ativoLabel) continue; // 100% inativo: não vira card mas conta nos totais
    const arr = byDesigner.get(ativoLabel) ?? [];
    arr.push(e);
    byDesigner.set(ativoLabel, arr);
  }

  const designers: DesignerMetrics[] = [];
  for (const [nome, evsAll] of byDesigner) {
    // Designer com início no meio do período (ex.: Camile, 01/06): conta só A
    // PARTIR da entrada — eventos anteriores não contam e o denominador de dias
    // começa na entrada (o "Dia D" dele fica mais curto). Continua aparecendo no
    // filtro normal, só com o período interno encurtado. `inicio` só vale quando
    // é DEPOIS do início do range (senão não muda nada).
    const inicioRaw = getDesignerInicio(nome);
    const inicio = inicioRaw && inicioRaw.getTime() > rangeStart.getTime() ? inicioRaw : null;
    const evs = inicio
      ? evsAll.filter((e) => eventoData(e).getTime() >= inicio.getTime())
      : evsAll;
    const diasBaseDesigner = inicio
      ? Math.max(1, countWorkingDays(inicio, rangeEnd, holidaySet))
      : dias;

    const feitos = evs.filter((e) => e.tipo_evento === 'feito');
    const manuts = evs.filter((e) => e.tipo_evento === 'manutencao');
    const manutsC = evs.filter((e) => e.tipo_evento === 'manutencao_c');

    const feitasUnicas = new Set(feitos.map(uniqueDemandaKey)).size;
    // Métrica de manutenção (atualizada): considera AMBAS — cliente
    // (`manutencao_c`) E gestor (`manutencao`) — mas SÓ as que o Renan deixou
    // contar (`contabilizar !== false`; default true). Ele desmarca as injustas
    // na tela "Atribuir métricas". Os brutos seguem em `totalEventosManutencao*`.
    const manutsContam = [...manuts, ...manutsC].filter((e) => e.contabilizar !== false);
    const manutencoesUnicas = new Set(manutsContam.map(uniqueDemandaKey)).size;

    // % manutenção: EVENTOS BRUTOS / entregas × 100 (regra de 27/05/2026 mantida),
    // agora somando manutenção cliente + gestor que contam. "Pra cada N 'Feito',
    // M ajustes que contam" — mede retrabalho atribuído.
    const pct = feitos.length > 0 ? (manutsContam.length / feitos.length) * 100 : 0;

    // demandas/dia usa o total de ENTREGAS (cada "Feito" no Monday = 1 entrega).
    // Subtrai dias de atestado do designer dentro do período — pra não penalizar
    // quem teve dia de licença médica.
    const diasAtestado = diasUteisAtestados(nome, atestados, inicio ?? rangeStart, rangeEnd, holidaySet);
    const diasDesigner = Math.max(1, diasBaseDesigner - diasAtestado);
    const perDia = feitos.length / diasDesigner;
    const tDem = tierForDemandasDia(perDia); // INFORMATIVO — não entra no bônus
    // tier de manutenção só faz sentido se há entregas
    const tMan = feitos.length > 0 ? tierForPctManutencao(pct) : 0;

    // === ATRASO (métrica pontuada principal, jul/2026+) ===
    // Denominador = demandas feitas ÚNICAS do designer a partir de 01/07/2026.
    // Numerador = demandas que atrasaram (board de Atrasos) no mesmo recorte.
    // Uma demanda que atrasou E foi feita conta 1 no numerador e 1 no denominador.
    // Piso do designer: se ele entrou no meio (getDesignerInicio), num E denom
    // começam na entrada — o denominador já vem de `evs` (filtrado por inicio);
    // o numerador aplica o mesmo piso aqui.
    const atrasoFloorMs = inicio ? Math.max(atrasoInicioMs, inicio.getTime()) : atrasoInicioMs;
    const feitosAtraso = feitos.filter((e) => eventoData(e).getTime() >= atrasoFloorMs);
    const feitasNoAtraso = new Set(feitosAtraso.map(uniqueDemandaKey)).size;
    const atrasadasNoPeriodo = new Set(
      (atrasosByDesigner.get(nome) ?? [])
        .filter((a) => {
          const d = atrasoData(a);
          return d != null && d.getTime() >= atrasoFloorMs;
        })
        .map(atrasoKey)
    ).size;
    // Clamp em 100%: numerador (board de Atrasos) e denominador (board de Feitas)
    // vêm de boards diferentes (IDs distintos), então em raras divergências de
    // borda a razão poderia passar de 100% — travamos pra não exibir >100%.
    const atrasoPct = feitasNoAtraso > 0
      ? Math.min(100, (atrasadasNoPeriodo / feitasNoAtraso) * 100)
      : 0;
    const tAtraso = feitasNoAtraso > 0 ? tierForAtraso(atrasoPct) : 0;

    // Bônus do designer = SOMA de atraso + manutenção (regra "somadas" do Dia D
    // de jul/2026). Cada uma vale até 0,5 → teto de 1 salário. Demanda/dia virou
    // informativa (não pontua mais).
    const bonusFinal = (Math.min(1, tAtraso + tMan) as SalaryTier);

    // Atestados que tocam o período pra exibir nos cards
    const nomeNorm = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const atestadosNoPeriodo = atestados.filter((a) => {
      const aNorm = (a.designer || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      if (aNorm !== nomeNorm) return false;
      // Interseção com [rangeStart..rangeEnd]
      const ai = new Date(a.data_inicio + 'T00:00:00').getTime();
      const af = new Date(a.data_fim + 'T23:59:59').getTime();
      return af >= rangeStart.getTime() && ai <= rangeEnd.getTime();
    });

    designers.push({
      nome,
      feitasUnicas,
      manutencoesUnicas,
      totalEventosFeito: feitos.length,
      totalEventosManutencao: manuts.length,
      totalEventosManutencaoC: manutsC.length,
      pctManutencao: Number(pct.toFixed(1)),
      atrasoPct: Number(atrasoPct.toFixed(1)),
      atrasadasNoPeriodo,
      feitasNoAtraso,
      tierAtraso: tAtraso,
      demandasPorDia: Number(perDia.toFixed(2)),
      tierDemandas: tDem,
      tierManutencao: tMan,
      bonusTotal: bonusFinal,
      diasAtestadoNoPeriodo: diasAtestado,
      atestadosNoPeriodo,
      eventos: evs,
    });
  }
  // Ordena por mais entregas
  designers.sort((a, b) => b.feitasUnicas - a.feitasUnicas);

  // Métricas gerais (apenas eventos filtrados)
  const allFeitos = filtered.filter((e) => e.tipo_evento === 'feito');
  const allManuts = filtered.filter((e) => e.tipo_evento === 'manutencao');
  const allManutsC = filtered.filter((e) => e.tipo_evento === 'manutencao_c');

  const feitasUnicas = new Set(allFeitos.map(uniqueDemandaKey)).size;
  // % geral (consistente com o por designer): cliente + gestor que CONTAM
  // (`contabilizar !== false`).
  const allManutsContam = [...allManuts, ...allManutsC].filter((e) => e.contabilizar !== false);
  const manutencoesUnicas = new Set(allManutsContam.map(uniqueDemandaKey)).size;
  const pctGeral = allFeitos.length > 0 ? (allManutsContam.length / allFeitos.length) * 100 : 0;

  // === ATRASO GERAL (time inteiro, jul/2026+) ===
  const feitasAtrasoGeral = new Set(
    allFeitos.filter((e) => eventoData(e).getTime() >= atrasoInicioMs).map(uniqueDemandaKey)
  ).size;
  const atrasadasGeral = new Set(atrasosNoPeriodo.map(atrasoKey)).size;
  const pctAtrasoGeral = feitasAtrasoGeral > 0
    ? Math.min(100, (atrasadasGeral / feitasAtrasoGeral) * 100)
    : 0;

  return {
    feitasUnicas,
    manutencoesUnicas,
    totalEventosFeito: allFeitos.length,
    totalEventosManutencao: allManuts.length,
    totalEventosManutencaoC: allManutsC.length,
    pctManutencao: Number(pctGeral.toFixed(1)),
    pctAtrasoGeral: Number(pctAtrasoGeral.toFixed(1)),
    atrasadasGeral,
    feitasAtrasoGeral,
    diasNoPeriodo: dias,
    designers,
    eventosSemDesigner: semDesigner,
    eventosFiltrados: filtered,
  };
}

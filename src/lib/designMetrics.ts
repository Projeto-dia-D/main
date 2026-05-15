import type { DateRange } from './metrics';
import type { SalaryTier } from './types';
import { countWorkingDays } from './holidays';
import { primeiroDesignerAtivo } from '../config';
import { diasUteisAtestados, type Atestado } from './atestados';

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
  // Métricas de bônus
  demandasPorDia: number;          // feitasUnicas / diasNoPeriodo
  tierDemandas: SalaryTier;        // 0 / 0.5 / 1 — baseado em demandasPorDia
  tierManutencao: SalaryTier;      // 0 / 0.5 / 1 — baseado em pctManutencao
  bonusTotal: SalaryTier;          // 0 / 0.5 / 1 — MENOR dos dois tiers (vence o pior)
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
  diasNoPeriodo: number;           // qtd de dias considerados no /dia
  designers: DesignerMetrics[];
  eventosSemDesigner: DesignEvento[];
  // Eventos no período (após filtro de data)
  eventosFiltrados: DesignEvento[];
}

// ============================================================
// Faixas salariais (DISTRIBUIR PROSPERIDADE — Designer)
// ============================================================

// DEMANDAS/DIA: acima de 12 → 1 salário; 8-12 → 0,5; abaixo de 8 → 0
export function tierForDemandasDia(perDia: number): SalaryTier {
  if (perDia > 12) return 1;
  if (perDia >= 8) return 0.5;
  return 0;
}

// TAX APROV (% manutenção): acima de 19 → 0; 15-19 → 0,5; abaixo de 15 → 1
export function tierForPctManutencao(pct: number): SalaryTier {
  if (pct < 15) return 1;
  if (pct <= 19) return 0.5;
  return 0;
}

export function tierLabel(t: SalaryTier): string {
  if (t === 1) return '1 SALÁRIO';
  if (t === 0.5) return '0,5 SALÁRIO';
  return 'SEM BÔNUS';
}

export function tierColor(t: SalaryTier): { bg: string; text: string; border: string; glow: string } {
  if (t === 1) {
    return {
      bg: 'bg-green-500/15',
      text: 'text-green-400',
      border: 'border-green-500/50',
      glow: 'shadow-[0_0_24px_rgba(34,197,94,0.35)]',
    };
  }
  if (t === 0.5) {
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

export function formatBonusTotal(b: number): string {
  if (b === 0) return 'SEM BÔNUS';
  if (b === 0.5) return '0,5 SALÁRIO';
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

// Cores por % de manutenção (delegando pro tier definido pela tabela DISTRIBUIR PROSPERIDADE)
export function pctManutColors(pct: number) {
  return tierColor(tierForPctManutencao(pct));
}

export function pctLabel(pct: number): string {
  if (pct < 15) return 'EXCELENTE';
  if (pct <= 19) return 'ATENÇÃO';
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
  atestados: Atestado[] = []
): DesignSummary {
  // `filtered` é o set COMPLETO do período (inclui inativos) — usado pelos
  // totais globais e modais. Inativos só são removidos do agrupamento por
  // designer abaixo, então não aparecem como cards mas continuam nas estatísticas.
  const filtered = range ? filterEventosByDate(eventos, range) : eventos;

  const dias = diasNoPeriodo(range, filtered, holidaySet);

  // Resolve as datas reais do período (pode ter sido inferido dos eventos)
  const { start: rangeStart, end: rangeEnd } = resolveRangeBounds(range, filtered);

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
  for (const [nome, evs] of byDesigner) {
    const feitos = evs.filter((e) => e.tipo_evento === 'feito');
    const manuts = evs.filter((e) => e.tipo_evento === 'manutencao');
    const manutsC = evs.filter((e) => e.tipo_evento === 'manutencao_c');

    const feitasUnicas = new Set(feitos.map(uniqueDemandaKey)).size;
    const manutsAll = [...manuts, ...manutsC];
    const manutencoesUnicas = new Set(manutsAll.map(uniqueDemandaKey)).size;

    const pct = feitasUnicas > 0 ? (manutencoesUnicas / feitasUnicas) * 100 : 0;
    // demandas/dia usa o total de ENTREGAS (cada "Feito" no Monday = 1 entrega).
    // Subtrai dias de atestado do designer dentro do período — pra não penalizar
    // quem teve dia de licença médica.
    const diasAtestado = diasUteisAtestados(nome, atestados, rangeStart, rangeEnd, holidaySet);
    const diasDesigner = Math.max(1, dias - diasAtestado);
    const perDia = feitos.length / diasDesigner;
    const tDem = tierForDemandasDia(perDia);
    // tier de manutenção só faz sentido se há entregas
    const tMan = feitasUnicas > 0 ? tierForPctManutencao(pct) : 0;

    // Regra do bônus: SEMPRE VENCE O MENOR. Designer só recebe se BATER AS
    // DUAS metas. Se bater 1 salário em demandas mas zerar manutenção, ganha 0.
    // Se bateu 1 + 0.5, ganha 0.5. Se bateu 1 + 1, ganha 1.
    const bonusFinal = (Math.min(tDem, tMan) as SalaryTier);

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
  const manutencoesUnicas = new Set(
    [...allManuts, ...allManutsC].map(uniqueDemandaKey)
  ).size;
  const pctGeral = feitasUnicas > 0 ? (manutencoesUnicas / feitasUnicas) * 100 : 0;

  return {
    feitasUnicas,
    manutencoesUnicas,
    totalEventosFeito: allFeitos.length,
    totalEventosManutencao: allManuts.length,
    totalEventosManutencaoC: allManutsC.length,
    pctManutencao: Number(pctGeral.toFixed(1)),
    diasNoPeriodo: dias,
    designers,
    eventosSemDesigner: semDesigner,
    eventosFiltrados: filtered,
  };
}

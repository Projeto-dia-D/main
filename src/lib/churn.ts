import type { MondayClient } from './monday';
import type { DateRange } from './metrics';

// ============================================================================
// CHURN DO MÊS (empresa toda) — lido dos GRUPOS do board principal do Monday.
// ============================================================================
// Regra (Dia D jul/2026): churn% = churns do mês ÷ clientes que NÃO saíram.
//
//   Denominador ("não churn") = SOMENTE estes 4 grupos:
//     - "Clientes ativos - Plano à vista"
//     - "Clientes ativos - Plano normal"
//     - "Aviso prévio 60 dias"
//     - "Cliente pausado"
//   Numerador = quantidade de itens no grupo de churn do mês
//     ("Churn Julho (01/07/2026 a 31/07/2026)", etc.). No fim do ano os churns
//     são movidos pro grupo "Clientes perdido" e as datas dos grupos mensais
//     mudam — por isso identificamos o mês pela DATA embutida no título.
//
//   Ex.: 12 churns em julho / (85 à vista + 75 normal + 3 aviso + 5 pausado = 168)
//        = 0,0714 = 7,14%.
//
// É um número ÚNICO da empresa (o mesmo pra gestores, CS e programadores).
// Por ora é informativo — NÃO entra no cálculo de bônus de ninguém.
//
// Todos os dados já vêm em `clientsAll` (useMondayClients) — cada item traz seu
// `groupTitle`. Não precisa de fetch extra.

function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Categoria do grupo pra fins de churn. */
type GroupKind =
  | { kind: 'ativoVista' }
  | { kind: 'ativoNormal' }
  | { kind: 'avisoPrevio' }
  | { kind: 'pausado' }
  | { kind: 'churnMes'; year: number; month: number } // month 0-indexado
  | null;

/** Extrai (ano, mês) da 1ª data dd/mm/yyyy embutida no título do grupo de churn. */
function parseChurnGroupYm(title: string): { year: number; month: number } | null {
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const month = parseInt(m[2], 10) - 1; // 0-indexado
  const year = parseInt(m[3], 10);
  if (month < 0 || month > 11 || !Number.isFinite(year)) return null;
  return { year, month };
}

/** Classifica o grupo de um cliente. Só os 4 grupos ativos + os grupos "Churn
 *  <Mês>" importam; qualquer outro (aguardando, inadimplente, perdidos, etc.)
 *  retorna null e é ignorado. */
function classifyGroup(groupTitle: string | null | undefined): GroupKind {
  const g = normalize(groupTitle);
  if (!g) return null;
  // Grupos de churn mensais: "Churn Julho (01/07/2026 a 31/07/2026)"
  if (g.startsWith('churn')) {
    const ym = parseChurnGroupYm(groupTitle ?? '');
    return ym ? { kind: 'churnMes', year: ym.year, month: ym.month } : null;
  }
  // Grupos ativos (não churn)
  if (g.includes('ativos') && g.includes('vista')) return { kind: 'ativoVista' };
  if (g.includes('ativos') && g.includes('normal')) return { kind: 'ativoNormal' };
  if (g.includes('aviso previo')) return { kind: 'avisoPrevio' };
  if (g.includes('pausad')) return { kind: 'pausado' };
  return null;
}

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** Meses (ano, mês) que contam pro churn de um range.
 *  Um mês entra se está INTEIRO dentro do range (seleção que expandiu pro mês
 *  de faturamento) OU se é o mês do FIM do range (o mês "corrente" da visão).
 *  Assim, um atalho curto (ex.: "7 dias" ou "30 dias") que cruza a virada de
 *  mês NÃO soma o mês anterior inteiro — só conta o mês do fim. Já uma seleção
 *  personalizada expandida (junho inteiro + julho inteiro) soma os dois.
 *  Sem range → mês corrente. */
function monthsInRange(range: DateRange): Array<{ year: number; month: number }> {
  const now = new Date();
  const start = range.start ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const end = range.end ?? now;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const endY = end.getFullYear();
  const endM = end.getMonth();
  const out: Array<{ year: number; month: number }> = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  // Guarda de segurança: no máximo 24 meses.
  for (let i = 0; i < 24; i++) {
    const mStart = new Date(y, m, 1).getTime();
    const mEnd = new Date(y, m + 1, 0, 23, 59, 59, 999).getTime();
    const fullyCovered = startMs <= mStart && endMs >= mEnd;
    const isEndMonth = y === endY && m === endM;
    if (fullyCovered || isEndMonth) out.push({ year: y, month: m });
    if (isEndMonth) break;
    if (y > endY || (y === endY && m > endM)) break;
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

export interface ChurnMesBreakdown {
  label: string;   // "Julho/2026"
  year: number;
  month: number;   // 0-indexado
  churns: number;
}

export interface ChurnResult {
  /** churn% (0–100+). null quando não há denominador (nenhum grupo ativo lido). */
  churnPct: number | null;
  /** total de churns somando os meses tocados pelo período. */
  churns: number;
  /** denominador: total de clientes nos 4 grupos ativos (snapshot atual). */
  naoChurn: number;
  breakdown: {
    ativoVista: number;
    ativoNormal: number;
    avisoPrevio: number;
    pausado: number;
  };
  /** churns por mês tocado pelo período. */
  meses: ChurnMesBreakdown[];
  /** true se algum grupo de churn/ativo foi reconhecido (dados carregaram). */
  temDados: boolean;
}

/**
 * Calcula o churn da empresa a partir dos grupos do Monday (clientsAll) e do
 * período selecionado. Ver regra no topo do arquivo.
 */
export function computeChurn(
  clientsAll: MondayClient[],
  range: DateRange
): ChurnResult {
  let ativoVista = 0;
  let ativoNormal = 0;
  let avisoPrevio = 0;
  let pausado = 0;
  // key "ano-mes" → contagem de churns
  const churnByYm = new Map<string, number>();
  let reconheceu = false;

  for (const c of clientsAll) {
    const k = classifyGroup(c.groupTitle);
    if (!k) continue;
    reconheceu = true;
    switch (k.kind) {
      case 'ativoVista': ativoVista++; break;
      case 'ativoNormal': ativoNormal++; break;
      case 'avisoPrevio': avisoPrevio++; break;
      case 'pausado': pausado++; break;
      case 'churnMes': {
        const key = `${k.year}-${k.month}`;
        churnByYm.set(key, (churnByYm.get(key) ?? 0) + 1);
        break;
      }
    }
  }

  const naoChurn = ativoVista + ativoNormal + avisoPrevio + pausado;

  const meses: ChurnMesBreakdown[] = [];
  let churns = 0;
  for (const { year, month } of monthsInRange(range)) {
    const count = churnByYm.get(`${year}-${month}`) ?? 0;
    churns += count;
    meses.push({ label: `${MESES_PT[month]}/${year}`, year, month, churns: count });
  }

  const churnPct = naoChurn > 0 ? (churns / naoChurn) * 100 : null;

  return {
    churnPct: churnPct === null ? null : Number(churnPct.toFixed(2)),
    churns,
    naoChurn,
    breakdown: { ativoVista, ativoNormal, avisoPrevio, pausado },
    meses,
    temDados: reconheceu,
  };
}

/** Faixa de cor do churn (referência — NÃO entra no bônus ainda):
 *  ≤9% verde · 9–13% laranja · >13% vermelho. */
export function churnColors(pct: number | null): { text: string; border: string; bg: string } {
  if (pct === null) return { text: 'text-burst-muted', border: 'border-burst-border', bg: 'bg-black/20' };
  if (pct <= 9) return { text: 'text-green-400', border: 'border-green-500/50', bg: 'bg-green-500/10' };
  if (pct <= 13) return { text: 'text-burst-orange-bright', border: 'border-burst-orange/50', bg: 'bg-burst-orange/10' };
  return { text: 'text-red-400', border: 'border-red-500/50', bg: 'bg-red-500/10' };
}

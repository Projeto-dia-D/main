import type {
  RelatorioBias,
  DoutorMetrics,
  MetricsSummary,
  SalaryTier,
} from './types';
import type { MondayClient } from './monday';
import { getClientChurnCutoff } from './monday';

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
];

const INTERROMPIDO_PATTERNS = [
  'chat interrompido',
  'interrompido',
];

// Doutores cujos leads são armazenados mas NÃO contam em transferências/CPT.
// Toda lead presente OU futura com nomeDoutor contendo um destes termos
// (case-insensitive, sem acento) é classificada como "Chat incompleto".
// Match: substring no nome normalizado.
const DOUTORES_CHAT_INCOMPLETO = [
  'daiane feduk',
  'sorriso recife',
  'vitaprime',           // VitaPrime Clínica Odontológica
  'vita prime',          // variação com espaço
  'vitta prime',         // grafia antiga com 2 T (mantém compat com dados existentes)
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
  return TRANSFERENCIA_PATTERNS.some((p) => haystack.includes(p));
}

export function isInterrompido(lead: RelatorioBias): boolean {
  const haystack = normalize(lead.motivoTransferencia);
  return INTERROMPIDO_PATTERNS.some((p) => haystack.includes(p));
}

export function isChatIncompleto(lead: RelatorioBias): boolean {
  const n = normalize(lead.nomeDoutor);
  if (!n) return false;
  return DOUTORES_CHAT_INCOMPLETO.some((p) => n.includes(p));
}

/**
 * Checa se um NOME (de cliente Monday, ou de doutor) bate com a lista de
 * "chat incompleto" — usado pra desqualificar o cliente inteiro nas métricas
 * de Gestor/CS, não só os leads dele.
 */
export function isNomeChatIncompleto(nome: string | null | undefined): boolean {
  const n = normalize(nome);
  if (!n) return false;
  return DOUTORES_CHAT_INCOMPLETO.some((p) => n.includes(p));
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

  // exato
  if (responsavelByClient.has(target)) return responsavelByClient.get(target)!;

  // substring nos dois sentidos
  for (const [client, resp] of responsavelByClient) {
    if (!client) continue;
    if (target.includes(client) || client.includes(target)) return resp;
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

export function tierForTaxa(taxa: number): SalaryTier {
  if (taxa > 20) return 1;
  if (taxa >= 16) return 0.5;
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
    const cutoff = getClientChurnCutoff(c);
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
  return null;
}

export function computeMetrics(
  leads: RelatorioBias[],
  range?: DateRange,
  instanceMap?: Map<string, string>,
  clients?: MondayClient[]
): MetricsSummary {
  const now = new Date();
  const evolucaoEnd = range?.end ?? now;

  // Categorias excluídas das métricas (armazenadas mas não contam):
  //   - chats interrompidos (motivo)
  //   - chats incompletos (doutor na lista fixa)
  const chatsInterrompidos = leads.filter(isInterrompido);
  const chatsIncompletos = leads.filter(
    (l) => !isInterrompido(l) && isChatIncompleto(l)
  );
  let activeLeads = leads.filter(
    (l) => !isInterrompido(l) && !isChatIncompleto(l)
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

    const diasSemTransferencia = ultimaTransferencia
      ? daysBetween(now, new Date(ultimaTransferencia))
      : 9999;

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
  if (taxa > 20) {
    return { nextLabel: 'Faixa máxima atingida', pctOfBar: 100, remaining: 0 };
  }
  if (taxa >= 16) {
    const span = 20 - 16;
    const progress = ((taxa - 16) / span) * 100;
    return {
      nextLabel: 'até 1 salário (>20%)',
      pctOfBar: Math.min(100, Math.max(0, progress)),
      remaining: Number(Math.max(0, 20.01 - taxa).toFixed(1)),
    };
  }
  const progress = (taxa / 16) * 100;
  return {
    nextLabel: 'até 0,5 salário (16%)',
    pctOfBar: Math.min(100, Math.max(0, progress)),
    remaining: Number(Math.max(0, 16 - taxa).toFixed(1)),
  };
}

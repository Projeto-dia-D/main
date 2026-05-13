export interface RelatorioBias {
  id: string;
  telefone: string;
  dataCadastro: string;
  senderName: string | null;
  mensagemInicial: string | null;
  token: string;
  motivoTransferencia: string | null;
  dataTransferencia: string | null;
  historico: string | null;
  nomeDoutor: string | null;
}

export type SalaryTier = 0 | 0.5 | 1;

export interface DoutorMetrics {
  nome: string;
  totalLeads: number;
  totalTransferidos: number;
  taxa: number;
  tier: SalaryTier;
  ultimoLead: string | null;
  ultimaTransferencia: string | null;
  diasSemTransferencia: number;
  status: 'ATIVO' | 'SEM TRANSFERENCIA';
  evolucao: { date: string; taxa: number }[];
  leads: RelatorioBias[];
}

export interface MetricsSummary {
  totalLeads: number;
  totalTransferidos: number;
  taxaGeral: number;
  tier: SalaryTier;
  doutores: DoutorMetrics[];
  leadsSemDoutor: RelatorioBias[];
  chatsInterrompidos: RelatorioBias[];
  chatsIncompletos: RelatorioBias[];
  // Lista pura dos leads que entram nas métricas (sem interrompidos nem
  // incompletos). Use para qualquer UI que mostre a lista de leads ativos.
  activeLeads: RelatorioBias[];
}

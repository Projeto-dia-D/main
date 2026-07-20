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

// Faixas de bônus (em frações de salário). 0,25 e 0,75 foram adicionados pra
// suportar o Design a partir de jul/2026: manutenção passou a valer 0,5/0,25 e
// atraso 0,5/0,25, e o bônus do designer é a SOMA dos dois (até 1 salário) —
// então pode dar 0,25 / 0,5 / 0,75 / 1. As demais funções (gestor/CS/programação)
// continuam usando só 0 | 0,5 | 1.
export type SalaryTier = 0 | 0.25 | 0.5 | 0.75 | 1;

export interface DoutorMetrics {
  nome: string;
  totalLeads: number;
  totalTransferidos: number;
  taxa: number;
  tier: SalaryTier;
  ultimoLead: string | null;
  ultimaTransferencia: string | null;
  diasSemTransferencia: number;
  /** Tempo (ms) com a Bia ATIVA desde a entrada do cliente (exclui manutenção).
   *  Formate com formatBiaAtiva(). null se não há cliente/entrada resolvidos. */
  biaAtivaMs?: number | null;
  status: 'ATIVO' | 'SEM TRANSFERENCIA';
  evolucao: { date: string; taxa: number }[];
  leads: RelatorioBias[];
  /** true = cliente ATIVO (I.A ativa) do responsável que NÃO teve nenhum lead no
   *  período — card "0 leads / sem movimento". Não é performance ruim, é ausência
   *  de dado. Fica fora de rankings/melhores/piores. */
  semLeads?: boolean;
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

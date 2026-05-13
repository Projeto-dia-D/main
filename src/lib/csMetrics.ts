import type { RelatorioBias, SalaryTier } from './types';
import type { MondayClient } from './monday';
import type { CampaignInsight } from './meta';
import type { ClientMetaLink, DoutorClientLink } from './linkStorage';
import { computeGestorMetrics, type ClientMetrics, tierForCpt } from './gestorMetrics';

export interface CsMetrics {
  cs: string;
  totalSpend: number;
  totalTransferencias: number;
  totalMensagens: number;
  cpt: number | null;
  tier: SalaryTier;
  clients: ClientMetrics[];
}

export interface CsSummary {
  totalSpend: number;
  totalTransferencias: number;
  totalMensagens: number;
  cptGeral: number | null;
  tier: SalaryTier;
  cses: CsMetrics[];
  clientesSemCs: ClientMetrics[];
  // Clientes vinculados (Meta link) considerados nesta visão
  clientesConsiderados: number;
  // Clientes Monday totais (sem filtro de link)
  clientesTotal: number;
}

/**
 * Agrupa por CS responsável do Monday.
 * Filtra a apenas clientes que têm um vínculo Meta salvo no banco.
 * Reusa toda a lógica de cálculo per-cliente do gestorMetrics.
 */
export function computeCsMetrics(opts: {
  clients: MondayClient[];
  insights: CampaignInsight[];
  leads: RelatorioBias[];
  metaLinks: Map<string, ClientMetaLink>; // key: meta_account_id (act_xxx)
  doutorLinks?: Map<string, DoutorClientLink[]>;
}): CsSummary {
  const { clients, insights, leads, metaLinks, doutorLinks } = opts;

  // Set de monday_client_id que têm vínculo Meta salvo
  const linkedMondayClientIds = new Set<string>();
  for (const link of metaLinks.values()) {
    linkedMondayClientIds.add(link.monday_client_id);
  }

  // Roda o computeGestorMetrics no conjunto completo pra reaproveitar lógica
  // de matching de doutor/leads/spend per-cliente.
  const full = computeGestorMetrics({ clients, insights, leads, metaLinks, doutorLinks });

  // Achata os ClientMetrics em uma só lista (de todos gestores + clientsFora)
  // e filtra apenas os com link Meta salvo.
  const allClientMetrics: ClientMetrics[] = [
    ...full.gestores.flatMap((g) => g.clients),
    ...full.clientsFora.map((c) => ({
      client: c,
      doutorMatch: null,
      matchVia: null,
      metaMatchVia: null,
      spend: 0,
      transferencias: 0,
      mensagensIniciadas: 0,
      cpt: null,
      campaigns: [],
      leads: [],
      churned: false,
      churnCutoff: null,
    })),
  ];

  const linkedClientMetrics = allClientMetrics.filter((cm) =>
    linkedMondayClientIds.has(cm.client.id)
  );

  const byCs = new Map<string, ClientMetrics[]>();
  const clientesSemCs: ClientMetrics[] = [];
  for (const cm of linkedClientMetrics) {
    const cs = cm.client.cs?.trim();
    if (!cs) {
      clientesSemCs.push(cm);
      continue;
    }
    const arr = byCs.get(cs) ?? [];
    arr.push(cm);
    byCs.set(cs, arr);
  }

  const cses: CsMetrics[] = [];
  for (const [cs, cms] of byCs) {
    const totalSpend = cms.reduce((s, c) => s + c.spend, 0);
    const totalTransf = cms.reduce((s, c) => s + c.transferencias, 0);
    const totalMensagens = cms.reduce((s, c) => s + c.mensagensIniciadas, 0);
    const cpt = totalTransf > 0 ? totalSpend / totalTransf : null;
    cses.push({
      cs,
      totalSpend: Number(totalSpend.toFixed(2)),
      totalTransferencias: totalTransf,
      totalMensagens,
      cpt: cpt === null ? null : Number(cpt.toFixed(2)),
      tier: tierForCpt(cpt),
      clients: cms.sort((a, b) => b.transferencias - a.transferencias),
    });
  }
  cses.sort((a, b) => {
    if (a.cpt === null) return 1;
    if (b.cpt === null) return -1;
    return a.cpt - b.cpt;
  });

  const totalSpend = cses.reduce((s, g) => s + g.totalSpend, 0);
  const totalTransferencias = cses.reduce((s, g) => s + g.totalTransferencias, 0);
  const totalMensagens = cses.reduce((s, g) => s + g.totalMensagens, 0);
  const cptGeral = totalTransferencias > 0
    ? Number((totalSpend / totalTransferencias).toFixed(2))
    : null;

  return {
    totalSpend: Number(totalSpend.toFixed(2)),
    totalTransferencias,
    totalMensagens,
    cptGeral,
    tier: tierForCpt(cptGeral),
    cses,
    clientesSemCs,
    clientesConsiderados: linkedClientMetrics.length,
    clientesTotal: clients.length,
  };
}

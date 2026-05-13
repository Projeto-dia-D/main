import type { RelatorioBias, SalaryTier } from './types';
import type { MondayClient } from './monday';
import type { CampaignInsight } from './meta';
import type { ClientMetaLink, DoutorClientLink } from './linkStorage';
import { isFimVenda } from './meta';
import {
  isTransferido,
  isInterrompido,
  isChatIncompleto,
  isNomeChatIncompleto,
} from './metrics';
import { isGestorExcluido } from '../config';
import { getClientChurnCutoff, isClientChurned } from './monday';

export interface ClientMetrics {
  client: MondayClient;
  doutorMatch: string | null;          // nomeDoutor casado em relatorio_bias
  matchVia: 'token' | 'nome' | null;   // como o vínculo foi feito
  metaMatchVia: 'account' | 'nome' | null; // como o spend foi atribuído
  spend: number;                        // investimento Meta (Fim/Venda) atribuído
  transferencias: number;               // transferências válidas no período
  mensagensIniciadas: number;           // total de leads (chats iniciados) do cliente
  cpt: number | null;                   // null se não há transferências
  campaigns: CampaignInsight[];         // campanhas Fim/Venda casadas
  leads: RelatorioBias[];               // leads atribuídos a esse cliente (já com churn aplicado)
  churned: boolean;                     // status atual contém "perdido"/"churn"
  churnCutoff: Date | null;             // data de corte aplicada (se churned)
}

export interface GestorMetrics {
  gestor: string;
  totalSpend: number;
  totalTransferencias: number;
  totalMensagens: number;               // soma das mensagensIniciadas dos clientes
  cpt: number | null;
  tier: SalaryTier;
  clients: ClientMetrics[];
}

export interface OrfaoTransferencia {
  doutor: string;
  totalLeads: number;
  transferencias: number;
  ultimoLead: string | null;
  ultimaTransferencia: string | null;
}

export interface GestorSummary {
  totalSpend: number;
  totalTransferencias: number;
  cptGeral: number | null;
  tier: SalaryTier;
  gestores: GestorMetrics[];
  clientsFora: MondayClient[]; // clientes sem gestor mapeado
  campaignsOrfas: CampaignInsight[]; // campanhas Fim/Venda sem cliente casado
  // Doutores que aparecem no Supabase com transferências mas nenhum cliente
  // do Monday casou com eles (nem por token uazapi nem por nome).
  // Estes leads NÃO entram no totalTransferencias do Gestor.
  orfaos: OrfaoTransferencia[];
  totalOrfaosTransferencias: number;
}

// Faixas de custo por transferência (gestor)
//   acima de 170 → 0 salário
//   120 a 170    → 0,5 salário
//   abaixo de 120 → 1 salário
export function tierForCpt(cpt: number | null): SalaryTier {
  if (cpt === null) return 0;
  if (cpt < 120) return 1;
  if (cpt <= 170) return 0.5;
  return 0;
}

export function tierLabelCpt(tier: SalaryTier): string {
  if (tier === 1) return '1 SALÁRIO';
  if (tier === 0.5) return '0,5 SALÁRIO';
  return 'SEM BÔNUS';
}

export function tierColorCpt(tier: SalaryTier): {
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

export function progressToNextTierCpt(cpt: number | null): {
  nextLabel: string;
  pctOfBar: number;
  remaining: number;
} {
  if (cpt === null) {
    return { nextLabel: 'sem dados ainda', pctOfBar: 0, remaining: 0 };
  }
  // Quanto menor, melhor. Faixas: <120 (1s), 120-170 (0,5s), >170 (0s)
  if (cpt < 120) {
    return { nextLabel: 'Faixa máxima atingida', pctOfBar: 100, remaining: 0 };
  }
  if (cpt <= 170) {
    // de 170 (limite inferior do tier laranja) até 120 (limite tier verde)
    // pct = quão perto estamos de 120
    const span = 170 - 120;
    const progress = ((170 - cpt) / span) * 100;
    return {
      nextLabel: 'até 1 salário (<R$120)',
      pctOfBar: Math.min(100, Math.max(0, progress)),
      remaining: Number(Math.max(0, cpt - 119.99).toFixed(2)),
    };
  }
  // acima de 170 — precisa baixar pra 170 pra entrar no laranja
  // arbitrariamente assumo "topo" da escala em 300
  const max = 300;
  const progress = ((max - Math.min(cpt, max)) / (max - 170)) * 100;
  return {
    nextLabel: 'até 0,5 salário (≤R$170)',
    pctOfBar: Math.min(100, Math.max(0, progress)),
    remaining: Number(Math.max(0, cpt - 170).toFixed(2)),
  };
}

function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Tenta achar o nomeDoutor em relatorio_bias que casa com o nome do cliente
// (Monday item name). Match: exact ou substring de um no outro (normalizado).
function findDoutorMatch(clientName: string, doutoresUniq: string[]): string | null {
  const target = normalize(clientName);
  if (!target) return null;
  // exato
  for (const d of doutoresUniq) {
    if (normalize(d) === target) return d;
  }
  // substring (cliente contém doutor OU doutor contém cliente)
  for (const d of doutoresUniq) {
    const dn = normalize(d);
    if (!dn) continue;
    if (target.includes(dn) || dn.includes(target)) return d;
  }
  return null;
}

// Tenta achar o cliente cujo nome aparece no nome da campanha
function findClientForCampaign(
  campaignName: string,
  clientsNorm: { name: string; norm: string }[]
): string | null {
  const cn = normalize(campaignName);
  // ordena por nome mais longo primeiro (evita "Dr. João" pegar antes de "Dr. João Silva")
  const sorted = [...clientsNorm].sort((a, b) => b.norm.length - a.norm.length);
  for (const c of sorted) {
    if (c.norm && cn.includes(c.norm)) return c.name;
  }
  return null;
}

export function computeGestorMetrics(opts: {
  clients: MondayClient[];
  insights: CampaignInsight[];
  leads: RelatorioBias[];
  metaLinks?: Map<string, ClientMetaLink>;       // key: meta_account_id (act_xxx)
  doutorLinks?: Map<string, DoutorClientLink[]>; // key: monday_client_id → links manuais
}): GestorSummary {
  const { insights, leads, metaLinks, doutorLinks } = opts;

  // 0) Remove da lista de clientes os que estão na lista de "chat incompleto"
  // (Daiane Feduk, Sorriso Recife, VitaPrime, etc.). Eles foram desqualificados
  // do dashboard de Programação e também não devem aparecer pro Gestor/CS.
  const clients = opts.clients.filter((c) => !isNomeChatIncompleto(c.name));

  // 1) Leads ativos (ignora chats interrompidos e chats incompletos)
  const activeLeads = leads.filter(
    (l) => !isInterrompido(l) && !isChatIncompleto(l)
  );
  const doutoresUniqSet = new Set<string>();
  for (const l of activeLeads) {
    if (l.nomeDoutor?.trim()) doutoresUniqSet.add(l.nomeDoutor.trim());
  }
  const doutoresUniq = Array.from(doutoresUniqSet);

  // 2) Index de Meta account → cliente (vínculo salvo no banco do software)
  const clientById = new Map<string, MondayClient>();
  for (const c of clients) clientById.set(c.id, c);
  const clientByAccountId = new Map<string, MondayClient>();
  if (metaLinks) {
    for (const [accountId, link] of metaLinks) {
      const cli = clientById.get(link.monday_client_id);
      if (cli) clientByAccountId.set(accountId, cli);
    }
  }

  // 3) Campanhas Fim/Venda
  const fimVenda = insights.filter((i) => isFimVenda(i.campaign_name));

  // 4) Atribui cada campanha Fim/Venda a um cliente.
  //    Prioridade: link explícito por Ad Account ID > match por substring no nome.
  const clientsNorm: { name: string; norm: string }[] = clients.map((c) => ({
    name: c.name,
    norm: normalize(c.name),
  }));
  const campaignsByClient = new Map<string, CampaignInsight[]>();
  const metaMatchByClient = new Map<string, 'account' | 'nome'>();
  const campaignsOrfas: CampaignInsight[] = [];

  for (const camp of fimVenda) {
    // Tenta link explícito primeiro
    const explicitOwner = clientByAccountId.get(camp.accountId);
    if (explicitOwner) {
      const arr = campaignsByClient.get(explicitOwner.name) ?? [];
      arr.push(camp);
      campaignsByClient.set(explicitOwner.name, arr);
      metaMatchByClient.set(explicitOwner.name, 'account');
      continue;
    }
    // Fallback: substring no nome da campanha
    const owner = findClientForCampaign(camp.campaign_name, clientsNorm);
    if (owner) {
      const arr = campaignsByClient.get(owner) ?? [];
      arr.push(camp);
      campaignsByClient.set(owner, arr);
      if (!metaMatchByClient.has(owner)) metaMatchByClient.set(owner, 'nome');
    } else {
      campaignsOrfas.push(camp);
    }
  }

  // 5) Constrói ClientMetrics — vínculo Supabase: token uazapi > nome
  const clientMetrics: ClientMetrics[] = clients.map((cl) => {
    let matchVia: ClientMetrics['matchVia'] = null;
    let leadsDoCliente: RelatorioBias[] = [];
    let doutorMatch: string | null = null;

    if (cl.uazapiToken) {
      const token = cl.uazapiToken.trim();
      leadsDoCliente = activeLeads.filter((l) => l.token === token);
      // doutorMatch para exibição: pega o nome mais frequente desses leads
      const counts = new Map<string, number>();
      for (const l of leadsDoCliente) {
        const n = l.nomeDoutor?.trim();
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
      const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
      doutorMatch = top?.[0] ?? cl.name; // se nenhum lead tem nomeDoutor, usa o nome do cliente
      matchVia = 'token';
    } else {
      const nm = findDoutorMatch(cl.name, doutoresUniq);
      if (nm) {
        doutorMatch = nm;
        leadsDoCliente = activeLeads.filter((l) => l.nomeDoutor?.trim() === nm);
        matchVia = 'nome';
      }
    }

    // Vínculos manuais: doutores adicionados ao cliente via painel de órfãos.
    // Adiciona leads desses doutores (dedupe por id no fim).
    const manualLinks = doutorLinks?.get(cl.id) ?? [];
    if (manualLinks.length > 0) {
      const seen = new Set(leadsDoCliente.map((l) => l.id));
      for (const link of manualLinks) {
        const dname = link.doutor_name.trim();
        const extras = activeLeads.filter(
          (l) => l.nomeDoutor?.trim() === dname && !seen.has(l.id)
        );
        for (const e of extras) seen.add(e.id);
        leadsDoCliente.push(...extras);
      }
      // se ainda não temos doutorMatch (cliente sem token e sem name-match),
      // assume o primeiro doutor vinculado manualmente
      if (!doutorMatch && manualLinks[0]) {
        doutorMatch = manualLinks[0].doutor_name;
        matchVia = matchVia ?? 'nome';
      }
    }

    // Aplica corte de churn: leads APÓS a data de corte não contam.
    const churnCutoff = getClientChurnCutoff(cl);
    const churned = isClientChurned(cl);
    if (churnCutoff) {
      const cutoffMs = churnCutoff.getTime();
      leadsDoCliente = leadsDoCliente.filter(
        (l) => new Date(l.dataCadastro).getTime() <= cutoffMs
      );
    }

    const transferencias = leadsDoCliente.filter(isTransferido).length;
    const mensagensIniciadas = leadsDoCliente.length;
    const campaigns = campaignsByClient.get(cl.name) ?? [];
    const spend = campaigns.reduce((s, c) => s + c.spend, 0);
    const cpt = transferencias > 0 ? spend / transferencias : null;
    const metaMatchVia = campaigns.length > 0
      ? (metaMatchByClient.get(cl.name) ?? null)
      : null;

    return {
      client: cl,
      doutorMatch,
      matchVia,
      metaMatchVia,
      spend,
      transferencias,
      mensagensIniciadas,
      cpt,
      campaigns,
      leads: leadsDoCliente,
      churned,
      churnCutoff,
    };
  });

  // 5) Agrupa por gestor (campo `gestor` do Monday)
  //    Gestores excluídos (André, Roberta — saíram da empresa) viram "sem gestor"
  const byGestor = new Map<string, ClientMetrics[]>();
  const clientsFora: MondayClient[] = [];
  for (const cm of clientMetrics) {
    const g = cm.client.gestor?.trim();
    if (!g || isGestorExcluido(g)) {
      clientsFora.push(cm.client);
      continue;
    }
    const arr = byGestor.get(g) ?? [];
    arr.push(cm);
    byGestor.set(g, arr);
  }

  const gestores: GestorMetrics[] = [];
  for (const [gestor, cms] of byGestor) {
    const totalSpend = cms.reduce((s, c) => s + c.spend, 0);
    const totalTransf = cms.reduce((s, c) => s + c.transferencias, 0);
    const totalMensagens = cms.reduce((s, c) => s + c.mensagensIniciadas, 0);
    const cpt = totalTransf > 0 ? totalSpend / totalTransf : null;
    gestores.push({
      gestor,
      totalSpend: Number(totalSpend.toFixed(2)),
      totalTransferencias: totalTransf,
      totalMensagens,
      cpt: cpt === null ? null : Number(cpt.toFixed(2)),
      tier: tierForCpt(cpt),
      clients: cms.sort((a, b) => (b.transferencias - a.transferencias)),
    });
  }
  gestores.sort((a, b) => {
    if (a.cpt === null) return 1;
    if (b.cpt === null) return -1;
    return a.cpt - b.cpt;
  });

  const totalSpend = gestores.reduce((s, g) => s + g.totalSpend, 0);
  const totalTransferencias = gestores.reduce(
    (s, g) => s + g.totalTransferencias,
    0
  );
  const cptGeral =
    totalTransferencias > 0 ? Number((totalSpend / totalTransferencias).toFixed(2)) : null;

  // === Diagnóstico de órfãos ===
  // Doutores no Supabase cujas leads NÃO foram atribuídas a nenhum cliente
  // Monday. Útil pra explicar a diferença entre o total de transferências
  // da aba Programação (todos) e da aba Gestor (só os mapeados).
  const matchedTokens = new Set<string>();
  const matchedDoutores = new Set<string>();
  for (const cm of clientMetrics) {
    if (cm.client.uazapiToken) matchedTokens.add(cm.client.uazapiToken.trim());
    if (cm.doutorMatch) matchedDoutores.add(cm.doutorMatch);
  }
  // Doutores explicitamente vinculados manualmente também não são órfãos
  const manualLinkedDoutores = new Set<string>();
  if (doutorLinks) {
    for (const arr of doutorLinks.values()) {
      for (const link of arr) manualLinkedDoutores.add(link.doutor_name.trim());
    }
  }

  const orfaosMap = new Map<string, OrfaoTransferencia>();
  for (const l of activeLeads) {
    const d = l.nomeDoutor?.trim();
    if (!d) continue;
    // Se o token bate em algum cliente OU o nome bate em algum doutor mapeado, NÃO é órfão
    if (l.token && matchedTokens.has(l.token)) continue;
    if (matchedDoutores.has(d)) continue;
    if (manualLinkedDoutores.has(d)) continue;

    const entry =
      orfaosMap.get(d) ?? {
        doutor: d,
        totalLeads: 0,
        transferencias: 0,
        ultimoLead: null as string | null,
        ultimaTransferencia: null as string | null,
      };
    entry.totalLeads++;
    if (isTransferido(l)) {
      entry.transferencias++;
      if (
        !entry.ultimaTransferencia ||
        new Date(l.dataCadastro).getTime() >
          new Date(entry.ultimaTransferencia).getTime()
      ) {
        entry.ultimaTransferencia = l.dataCadastro;
      }
    }
    if (
      !entry.ultimoLead ||
      new Date(l.dataCadastro).getTime() > new Date(entry.ultimoLead).getTime()
    ) {
      entry.ultimoLead = l.dataCadastro;
    }
    orfaosMap.set(d, entry);
  }

  const orfaos = Array.from(orfaosMap.values())
    .filter((o) => o.transferencias > 0 || o.totalLeads > 0)
    .sort((a, b) => b.transferencias - a.transferencias || b.totalLeads - a.totalLeads);
  const totalOrfaosTransferencias = orfaos.reduce((s, o) => s + o.transferencias, 0);

  return {
    totalSpend: Number(totalSpend.toFixed(2)),
    totalTransferencias,
    cptGeral,
    tier: tierForCpt(cptGeral),
    gestores,
    clientsFora,
    campaignsOrfas,
    orfaos,
    totalOrfaosTransferencias,
  };
}

export function brl(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

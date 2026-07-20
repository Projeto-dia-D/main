import type { RelatorioBias, SalaryTier } from './types';
import type { MondayClient, FaseTransition } from './monday';
import type { CampaignInsight } from './meta';
import type { ClientMetaLink, DoutorClientLink } from './linkStorage';
import { isFimVenda } from './meta';
import {
  isTransferido,
  isInterrompido,
  isChatIncompleto,
  isNomeChatIncompleto,
  isDesclassificado,
  activeMsInRange,
} from './metrics';
import { isGestorExcluido, getClientCustomCutoff, isCampaignExcluida, getClientSpendFloor, getGoogleAdsLink } from '../config';
import {
  getClientChurnCutoff,
  isClientChurned,
  buildActiveWindows,
  fracaoAtivaNoDia,
  parseDataEntrada,
} from './monday';

export interface ClientMetrics {
  client: MondayClient;
  doutorMatch: string | null;          // nomeDoutor casado em relatorio_bias
  matchVia: 'token' | 'nome' | null;   // como o vínculo foi feito
  metaMatchVia: 'account' | 'nome' | null; // como o spend foi atribuído
  spend: number;                        // investimento TOTAL (Meta + Google) atribuído, já ajustado
  /** Parcela do `spend` vinda do Meta Ads (mesmos ajustes/cortes). */
  spendMeta: number;
  /** Parcela do `spend` vinda do Google Ads (mesmos ajustes/cortes). */
  spendGoogle: number;
  transferencias: number;               // transferências válidas no período
  mensagensIniciadas: number;           // total de leads ATIVOS (excluindo interrompidos/incompletos/desclassificados)
  chatsInterrompidos: number;           // leads com motivo "chat interrompido" = CRC do cliente pegou o atendimento manualmente. Nao conta nas metricas mas e util pra mostrar volume de atendimento manual.
  cpt: number | null;                   // null se não há transferências
  campaigns: CampaignInsight[];         // campanhas Fim/Venda casadas
  leads: RelatorioBias[];               // leads ATIVOS (excluindo chat interrompido/incompleto/desclassificado) — usado nas métricas
  /** TODOS os leads do cliente, incluindo chat interrompido, incompleto e
   *  desclassificado. Usado na tabela de mensagens em Gestor/CS — pra
   *  visibilidade total. Métricas (transferências, CPT) continuam usando `leads`. */
  allLeads: RelatorioBias[];
  churned: boolean;                     // status atual contém "perdido"/"churn"
  churnCutoff: Date | null;             // data de corte aplicada (se churned)
  /** Cliente está no board Bia Soft mas em fase NÃO ativa (Pausado, Churn, etc.).
   *  Campanhas e leads continuam visíveis, mas spend NÃO entra nos totais do gestor/CS. */
  inactive: boolean;
  /** Spend REAL antes do ajuste por timeline de Manutenção (transparência). */
  spendBruto: number;
  /** Total REAL investido no range, antes de QUALQUER corte (piso de spend,
   *  manutenção, CRC). = o valor "total" pra exibir ao lado do "contando".
   *  Igual a spendBruto quando não há piso de spend. */
  spendBrutoTotal?: number;
  /** Spend EXCLUÍDO porque caiu em períodos de Manutenção. */
  spendExcluido: number;
  /** Spend EXCLUIDO porque o lead foi interceptado pela CRC do cliente.
   *  Calculado como `spend × (chatsInterrompidos / leadsTotais)`. Aplicado
   *  universalmente — todo gestor/CS recebe o ajuste. */
  spendExcluidoCrc: number;
  /** Períodos em que a Bia esteve fora de I.A ativa dentro do range (debug/UI). */
  periodosManutencao: Array<{ inicio: string; fim: string; status: string | null }>;
  /** Tempo (ms) com a Bia ATIVA desde a entrada do cliente (exclui manutenção).
   *  Formate com formatBiaAtiva(). null se não há entrada/timeline. */
  biaAtivaMs?: number | null;
}

export interface GestorMetrics {
  gestor: string;
  totalSpend: number;
  /** Breakdown do totalSpend por origem (Meta Ads vs Google Ads). */
  totalSpendMeta: number;
  totalSpendGoogle: number;
  totalTransferencias: number;
  totalMensagens: number;               // soma das mensagensIniciadas dos clientes
  cpt: number | null;
  tier: SalaryTier;
  clients: ClientMetrics[];
}

/** Linha de gasto diário do Google Ads (vinda da tabela google_ads_spend). */
export interface GoogleSpendRow {
  accountId: string;
  accountName: string;
  /** YYYY-MM-DD */
  date?: string;
  spend: number;
}

/** Conta Google Ads com gasto que não casou com nenhum cliente Monday. */
export interface GoogleOrfao {
  accountId: string;
  accountName: string;
  spend: number;
}

/**
 * Acha o "cliente destaque" de um gestor/CS — o que tem o MENOR CPT
 * (custo por transferência), exigindo um volume mínimo de transferências
 * pra qualificar.
 *
 * Critérios:
 *  - cliente ativo
 *  - transferências > 10 (filtra ruído de baixa amostra)
 *  - CPT calculável
 *
 * Ordenação: CPT crescente (menor custo ganha).
 * Retorna null se nenhum cliente qualificar.
 */
export function findDestaqueClient(clients: ClientMetrics[]): ClientMetrics | null {
  const candidatos = clients.filter(
    (c) => !c.inactive && c.transferencias > 10 && c.cpt !== null
  );
  if (candidatos.length === 0) return null;
  return [...candidatos].sort((a, b) => (a.cpt ?? Infinity) - (b.cpt ?? Infinity))[0];
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
  /** Breakdown do totalSpend por origem (Meta Ads vs Google Ads). */
  totalSpendMeta: number;
  totalSpendGoogle: number;
  totalTransferencias: number;
  cptGeral: number | null;
  tier: SalaryTier;
  gestores: GestorMetrics[];
  /** Contas Google Ads com gasto no período que não casaram com cliente. */
  googleOrfaos: GoogleOrfao[];
  clientsFora: MondayClient[]; // clientes sem gestor mapeado
  campaignsOrfas: CampaignInsight[]; // campanhas Fim/Venda sem cliente casado
  // Doutores que aparecem no Supabase com transferências mas nenhum cliente
  // do Monday casou com eles (nem por token uazapi nem por nome).
  // Estes leads NÃO entram no totalTransferencias do Gestor.
  orfaos: OrfaoTransferencia[];
  totalOrfaosTransferencias: number;
}

// Faixas de custo por transferência (gestor E CS — compartilham esta função)
//   até R$70      → 1 salário
//   R$70 a R$100  → 0,5 salário
//   acima de R$100 → 0 (sem bônus)
// Regra atualizada no Dia D de jul/2026 (antes era 120/170).
export function tierForCpt(cpt: number | null): SalaryTier {
  if (cpt === null) return 0;
  if (cpt <= 70) return 1;
  if (cpt <= 100) return 0.5;
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
  // Quanto menor, melhor. Faixas: <=70 (1s), 70-100 (0,5s), >100 (0s)
  if (cpt <= 70) {
    return { nextLabel: 'Faixa máxima atingida', pctOfBar: 100, remaining: 0 };
  }
  if (cpt <= 100) {
    // de 100 (limite superior do tier laranja) até 70 (limite tier verde)
    // pct = quão perto estamos de 70
    const span = 100 - 70;
    const progress = ((100 - cpt) / span) * 100;
    return {
      nextLabel: 'até 1 salário (≤R$70)',
      pctOfBar: Math.min(100, Math.max(0, progress)),
      remaining: Number(Math.max(0, cpt - 70).toFixed(2)),
    };
  }
  // acima de 100 — precisa baixar pra 100 pra entrar no laranja
  // arbitrariamente assumo "topo" da escala em 200
  const max = 200;
  const progress = ((max - Math.min(cpt, max)) / (max - 100)) * 100;
  return {
    nextLabel: 'até 0,5 salário (≤R$100)',
    pctOfBar: Math.min(100, Math.max(0, progress)),
    remaining: Number(Math.max(0, cpt - 100).toFixed(2)),
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
/**
 * Casa o NOME de uma conta Google Ads com um cliente Monday.
 * Mais permissivo que findClientForCampaign: limpa prefixos de conta
 * ("CA-01", colchetes), testa contains nos DOIS sentidos e também a versão
 * sem espaços (ex: "VITA PRIME" ↔ "VitaPrime Clínica Odontológica").
 * Exige que o lado mais curto tenha ≥5 chars pra evitar falso positivo.
 */
function matchGoogleAccountToClient(
  accountName: string,
  clientsNorm: { name: string; norm: string }[]
): string | null {
  const cleaned = accountName
    .replace(/\[[^\]]*\]/g, ' ')          // [Clinisales] etc.
    .replace(/\bca[\s-]*0*\d+\b/gi, ' ')  // CA-01, CA 02…
    .replace(/\bmcc\b/gi, ' ');
  // Remove pontuação ("Dra." ≠ "Dra" quebrava o match por token)
  const depunct = (s: string) => s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = depunct(normalize(cleaned));
  if (!norm) return null;
  const flat = norm.replace(/\s+/g, '');

  // Palavras genéricas que não identificam o cliente (não contam como token).
  const STOP = new Set([
    'dr', 'dra', 'doutor', 'doutora', 'clinica', 'odontologia', 'odonto',
    'odontologica', 'odontologico', 'estetica', 'dental', 'consultorio',
    'sorriso', 'implantes', 'lentes', 'facetas', 'resina', 'ceramica', 'em', 'de', 'do', 'da', 'e',
  ]);
  const tokensOf = (s: string) => s.split(' ').filter((t) => t.length > 1 && !STOP.has(t));
  const accTokens = tokensOf(norm);

  let best: { name: string; score: number } | null = null;
  for (const c of clientsNorm) {
    const cNorm = depunct(c.norm);
    const cFlat = cNorm.replace(/\s+/g, '');
    // Estratégia 1: contains nos dois sentidos (com e sem espaços)
    const hitContains =
      norm.includes(cNorm) || cNorm.includes(norm) ||
      flat.includes(cFlat) || cFlat.includes(flat);
    // Estratégia 2: subset de tokens significativos — TODOS os tokens do lado
    // mais curto presentes no mais longo (ex: "dr marcelo wayama" ⊂
    // "dr marcelo odontologia wayama").
    let hitTokens = false;
    if (!hitContains) {
      const cliTokens = tokensOf(cNorm);
      const [menor, maior] = accTokens.length <= cliTokens.length
        ? [accTokens, cliTokens]
        : [cliTokens, accTokens];
      hitTokens = menor.length >= 1 && menor.every((t) => maior.includes(t));
    }
    if (!hitContains && !hitTokens) continue;
    const score = Math.min(cFlat.length, flat.length);
    if (score >= 5 && (!best || score > best.score)) {
      best = { name: c.name, score };
    }
  }
  return best?.name ?? null;
}

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
  /** Set de IDs (monday_client_id) de clientes com Bia em fase ATIVA. */
  biaActiveIds?: Set<string>;
  /** Map<monday_client_id, timeline de transições de Fase>. Usado pra excluir
   *  spend de períodos em que a Bia estava em Manutenção/Desativado. */
  biaTimelineByClientId?: Map<string, FaseTransition[]>;
  /** Map<monday_client_id, fase atual>. Necessário pra completar a timeline
   *  (estado após a última transição). */
  biaFaseByClientId?: Map<string, string>;
  /** Range de datas em análise. Se omitido, não há cutoff por timeline. */
  dateRange?: { start: Date | null; end: Date | null };
  /** Piso por cliente pra reatribuição de CS (CS que saiu). Quando retorna uma
   *  data pro mondayClientId, leads/spend ANTES dela não contam. Passado SÓ na
   *  visão de CS (computeCsMetrics) — o gestor mantém o histórico completo. */
  csReassignFloor?: (mondayClientId: string) => Date | null;
  /** Gasto diário do Google Ads por conta (tabela google_ads_spend, já filtrado
   *  pelo range). Injetado como pseudo-campanha do cliente casado — herda
   *  TODOS os ajustes do spend Meta (pisos, cortes, Manutenção, CRC). */
  googleSpend?: GoogleSpendRow[];
}): GestorSummary {
  const {
    insights,
    leads,
    metaLinks,
    doutorLinks,
    biaActiveIds,
    biaTimelineByClientId,
    biaFaseByClientId,
    dateRange,
  } = opts;

  // Helper: cliente está ativo na Bia? Match exato por monday_client_id.
  // Também checa CLIENT_CUTOFFS (config.ts) — se há cutoff manual e a data
  // já passou, cliente vira inativo mesmo se a Bia ainda mostrar "ativa".
  function isClienteAtivo(cl: MondayClient): boolean {
    const customCutoff = getClientCustomCutoff(cl.id);
    if (customCutoff && customCutoff.getTime() <= Date.now()) return false;
    if (!biaActiveIds || biaActiveIds.size === 0) return true;
    return biaActiveIds.has(cl.id);
  }

  // Janela do range. Se range não foi passado, usa janela ampla (90 dias atrás → agora)
  const periodStart = dateRange?.start
    ? new Date(dateRange.start)
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const periodEnd = dateRange?.end ? new Date(dateRange.end) : new Date();

  // Pré-computa janelas ativas por cliente.
  function getActiveWindowsForClient(clientId: string): Array<{ start: Date; end: Date }> | null {
    if (!biaTimelineByClientId) return null;
    const tl = biaTimelineByClientId.get(clientId);
    const fase = biaFaseByClientId?.get(clientId);
    if (!tl && !fase) return null;
    return buildActiveWindows(tl ?? [], fase, periodStart, periodEnd);
  }

  // 0) Remove SEMPRE da lista de clientes os que estão em "chat incompleto"
  // (Daiane Feduk, Sorriso Recife, VitaPrime, Mayara Ventura). Eles não contam
  // no Gestor/CS mesmo que tenham vínculo Meta salvo — se o usuário quer
  // contar, precisa remover o nome da lista DOUTORES_CHAT_INCOMPLETO no código.
  const clients = opts.clients.filter((c) => !isNomeChatIncompleto(c.name));

  // 1) Leads ativos (ignora chats interrompidos, incompletos e desclassificados)
  const activeLeads = leads.filter(
    (l) => !isInterrompido(l) && !isChatIncompleto(l) && !isDesclassificado(l)
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

  // 3) Campanhas Fim/Venda — filtra Fim/Venda E remove exclusões manuais
  //    (CAMPAIGN_EXCLUSIONS em config.ts). Campanha excluída continua no Meta,
  //    só não conta no spend/CPT/conversão do cliente.
  const fimVenda = insights
    .filter((i) => isFimVenda(i.campaign_name))
    .filter((i) => !isCampaignExcluida(i.accountId, i.campaign_name));

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

  // 4b) GOOGLE ADS — injeta o gasto diário por conta como pseudo-campanha do
  // cliente casado. Entra DEPOIS do filtro Fim/Venda (Google não usa essa
  // nomenclatura) e ANTES de toda a matemática per-cliente — assim herda
  // AUTOMATICAMENTE pisos de spend, cortes (churn/custom), reatribuição de
  // CS, exclusão por Manutenção e o ajuste de CRC, igual ao spend Meta.
  //
  // REGRA: Google só conta pra cliente COM BIA (presente no board Bia Soft) —
  // igual ao Meta. A timeline de Fase zera automaticamente os períodos em que
  // a Bia não estava em I.A ativa (mesma fração diária do Meta). Conta de
  // cliente SEM Bia (ex: DenteMar) vira órfã — aparece no diagnóstico, não
  // soma pra nenhum gestor/CS.
  // Identificação: accountId prefixado com 'google:' (usado na partição
  // spendMeta × spendGoogle lá embaixo).
  const clientByName = new Map<string, MondayClient>();
  for (const c of clients) clientByName.set(c.name, c);
  const temBia = (id: string) =>
    (biaActiveIds?.has(id) ?? false) ||
    (biaFaseByClientId?.has(id) ?? false) ||
    (biaTimelineByClientId?.has(id) ?? false);
  const googleOrfaosMap = new Map<string, GoogleOrfao>();
  if (opts.googleSpend && opts.googleSpend.length > 0) {
    // Universo de match: SÓ clientes com Bia.
    const clientsNormBia = clientsNorm.filter((c) => {
      const cli = clientByName.get(c.name);
      return cli ? temBia(cli.id) : false;
    });
    for (const g of opts.googleSpend) {
      if (!g.spend) continue;
      // 1º: vínculo manual (config GOOGLE_ADS_LINKS) > 2º: match por nome.
      // Vínculo manual também respeita a regra da Bia.
      const linkedId = getGoogleAdsLink(g.accountId);
      const linkedClient = linkedId ? clientById.get(linkedId) ?? null : null;
      const ownerName = linkedClient && temBia(linkedClient.id)
        ? linkedClient.name
        : matchGoogleAccountToClient(g.accountName, clientsNormBia);
      if (!ownerName) {
        const prev = googleOrfaosMap.get(g.accountId);
        if (prev) prev.spend += g.spend;
        else googleOrfaosMap.set(g.accountId, { accountId: g.accountId, accountName: g.accountName, spend: g.spend });
        continue;
      }
      const arr = campaignsByClient.get(ownerName) ?? [];
      arr.push({
        campaign_id: `gads:${g.accountId}`,
        campaign_name: `[Google Ads] ${g.accountName}`,
        spend: g.spend,
        gestor: (clientByName.get(ownerName)?.gestor ?? 'Google') as CampaignInsight['gestor'],
        accountId: `google:${g.accountId}`,
        accountName: g.accountName,
        date: g.date,
      });
      campaignsByClient.set(ownerName, arr);
    }
  }
  const isGoogleCamp = (c: CampaignInsight) => c.accountId.startsWith('google:');

  // 5) Constrói ClientMetrics — vínculo Supabase: token uazapi > nome
  const clientMetrics: ClientMetrics[] = clients.map((cl) => {
    let matchVia: ClientMetrics['matchVia'] = null;
    // allLeadsDoCliente = TODOS os leads (incluindo interrompidos, incompletos
    // e desclassificados) — usado na tabela de mensagens do drill pra dar
    // visibilidade total.
    // leadsDoCliente = ATIVOS apenas — usado nas métricas (transferências, CPT).
    let allLeadsDoCliente: RelatorioBias[] = [];
    let doutorMatch: string | null = null;

    if (cl.uazapiToken) {
      const token = cl.uazapiToken.trim();
      // Usa `leads` (não filtrado) — depois aplica filtro pros ativos
      allLeadsDoCliente = leads.filter((l) => l.token === token);
      // doutorMatch para exibição: pega o nome mais frequente desses leads
      const counts = new Map<string, number>();
      for (const l of allLeadsDoCliente) {
        const n = l.nomeDoutor?.trim();
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
      const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
      doutorMatch = top?.[0] ?? cl.name;
      matchVia = 'token';
    } else {
      const nm = findDoutorMatch(cl.name, doutoresUniq);
      if (nm) {
        doutorMatch = nm;
        allLeadsDoCliente = leads.filter((l) => l.nomeDoutor?.trim() === nm);
        matchVia = 'nome';
      }
    }

    // Vínculos manuais: doutores adicionados ao cliente via painel de órfãos.
    // Adiciona leads desses doutores (dedupe por id no fim).
    const manualLinks = doutorLinks?.get(cl.id) ?? [];
    if (manualLinks.length > 0) {
      const seen = new Set(allLeadsDoCliente.map((l) => l.id));
      for (const link of manualLinks) {
        const dname = link.doutor_name.trim();
        const extras = leads.filter(
          (l) => l.nomeDoutor?.trim() === dname && !seen.has(l.id)
        );
        for (const e of extras) seen.add(e.id);
        allLeadsDoCliente.push(...extras);
      }
      if (!doutorMatch && manualLinks[0]) {
        doutorMatch = manualLinks[0].doutor_name;
        matchVia = matchVia ?? 'nome';
      }
    }

    // Aplica corte: leads APÓS a data de corte não contam.
    // O cutoff EFETIVO é o MAIS ANTIGO entre:
    //   - churnCutoff (vem do status "Churn" no Monday)
    //   - customCutoff (lista CLIENT_CUTOFFS em config.ts — pra encerrar
    //     cliente sem precisar churnar no Monday)
    const churnCutoff = getClientChurnCutoff(cl);
    const customCutoff = getClientCustomCutoff(cl.id);
    const churned = isClientChurned(cl);
    const effectiveCutoff: Date | null = [churnCutoff, customCutoff]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    if (effectiveCutoff) {
      const cutoffMs = effectiveCutoff.getTime();
      allLeadsDoCliente = allLeadsDoCliente.filter(
        (l) => new Date(l.dataCadastro).getTime() <= cutoffMs
      );
    }

    // === REATRIBUIÇÃO DE CS (piso por data) ===
    // Pros clientes reatribuídos de um CS que saiu (ex: Yasmin), as métricas de
    // CS só contam A PARTIR do corte — leads/spend anteriores NÃO entram (não
    // são jogados no novo CS). Só aplica quando csReassignFloor é passado (visão
    // de CS); o gestor desses clientes mantém o histórico completo.
    const reassignFloor = opts.csReassignFloor?.(cl.id) ?? null;
    if (reassignFloor) {
      const floorMs = reassignFloor.getTime();
      allLeadsDoCliente = allLeadsDoCliente.filter(
        (l) => new Date(l.dataCadastro).getTime() >= floorMs
      );
    }

    // Deriva leads ATIVOS (filtra interrompido/incompleto/desclassificado) pra
    // usar nas métricas — transferências, CPT, etc.
    const leadsDoCliente = allLeadsDoCliente.filter(
      (l) => !isInterrompido(l) && !isChatIncompleto(l) && !isDesclassificado(l)
    );

    const transferencias = leadsDoCliente.filter(isTransferido).length;
    const mensagensIniciadas = leadsDoCliente.length;
    // Conta interrompidos pra dar visibilidade. "Chat interrompido" = a CRC
    // do cliente pegou o atendimento manualmente (a Bia foi interrompida).
    // Esses chats NAO contam em mensagensIniciadas/transferencias/CPT — so
    // sinalizam volume de atendimento manual.
    const chatsInterrompidos = allLeadsDoCliente.filter(isInterrompido).length;
    let campaigns = campaignsByClient.get(cl.name) ?? [];
    // Total REAL investido no range, ANTES de qualquer piso de spend — usado
    // pra mostrar "total vs contando" na tela (transparência).
    const spendBrutoTotal = campaigns.reduce((s, c) => s + c.spend, 0);
    if (reassignFloor) {
      // Spend diário (time_increment=1): mantém só os dias A PARTIR do corte.
      // Linha sem `date` (modo agregado) é descartada quando há piso, pra não
      // vazar gasto pré-corte pro novo CS.
      const f = reassignFloor;
      const floorStr = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
      campaigns = campaigns.filter((c) => !!c.date && c.date >= floorStr);
    }
    // Spend "zerado até a data" por cliente (CLIENT_SPEND_FLOORS): descarta o
    // gasto diário ANTES do corte (ex: Melissa Chacon — conta a partir de 01/06).
    // Aplicado SEMPRE (Gestor + CS + Apresentação). Não mexe em leads/transferências.
    const spendFloor = getClientSpendFloor(cl.id);
    if (spendFloor) {
      const fs = spendFloor;
      const floorStrSpend = `${fs.getFullYear()}-${String(fs.getMonth() + 1).padStart(2, '0')}-${String(fs.getDate()).padStart(2, '0')}`;
      campaigns = campaigns.filter((c) => !!c.date && c.date >= floorStrSpend);
    }
    // TETO por corte (churn ou CLIENT_CUTOFFS): o SPEND também não conta a partir
    // do corte — dropa o gasto diário dos dias >= cutoff, pra o cliente sumir do
    // investido/CPT (e não só dos leads). spendBrutoTotal (acima) mantém o valor
    // cheio pra "total vs contando". ceStr em UTC pra casar datas '...Z' e '...-03:00'.
    if (effectiveCutoff) {
      const ce = effectiveCutoff;
      const ceStr = `${ce.getUTCFullYear()}-${String(ce.getUTCMonth() + 1).padStart(2, '0')}-${String(ce.getUTCDate()).padStart(2, '0')}`;
      campaigns = campaigns.filter((c) => !c.date || c.date < ceStr);
    }
    const spendBruto = campaigns.reduce((s, c) => s + c.spend, 0);

    // === AJUSTE POR TIMELINE DE MANUTENÇÃO ===
    // Se temos timeline + insights diários (date), excluímos a fração de
    // cada dia em que a Bia estava fora de I.A ativa.
    // `spendGooglePart` acompanha cada etapa do ajuste — é a fatia do spend
    // final que veio do Google Ads (pseudo-campanhas 'google:').
    const windows = getActiveWindowsForClient(cl.id);
    let spend = spendBruto;
    let spendGooglePart = campaigns.filter(isGoogleCamp).reduce((s, c) => s + c.spend, 0);
    let spendExcluido = 0;
    const periodosManutencao: Array<{ inicio: string; fim: string; status: string | null }> = [];
    if (windows && windows.length >= 0) {
      // Reagrupa campanhas por dia
      let ajustado = 0;
      let ajustadoGoogle = 0;
      const dailyHasDate = campaigns.some((c) => c.date);
      if (dailyHasDate) {
        for (const c of campaigns) {
          let parcela: number;
          if (c.date) {
            const frac = fracaoAtivaNoDia(c.date, windows);
            parcela = c.spend * frac;
          } else {
            // sem date (modo agregado) — mantém spend cheio (fallback)
            parcela = c.spend;
          }
          ajustado += parcela;
          if (isGoogleCamp(c)) ajustadoGoogle += parcela;
        }
        spend = Number(ajustado.toFixed(2));
        spendGooglePart = ajustadoGoogle;
        spendExcluido = Number((spendBruto - spend).toFixed(2));
      } else {
        // Sem data nos insights — não há como aplicar cutoff por dia.
        spend = spendBruto;
      }

      // Lista os "buracos" entre janelas (períodos de Manutenção/Desativado
      // dentro do range) — pra exibir no relatório de aprovação.
      let cursor = periodStart;
      const sortedWindows = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
      for (const w of sortedWindows) {
        if (w.start.getTime() > cursor.getTime()) {
          periodosManutencao.push({
            inicio: cursor.toISOString(),
            fim: w.start.toISOString(),
            status: null, // pode preencher se quiser olhar a transição exata
          });
        }
        cursor = w.end > cursor ? w.end : cursor;
      }
      if (cursor.getTime() < periodEnd.getTime()) {
        periodosManutencao.push({
          inicio: cursor.toISOString(),
          fim: periodEnd.toISOString(),
          status: null,
        });
      }
    }

    // === AJUSTE POR CRC INTERCEPTADO (regra de 3) ===
    // Aplicado UNIVERSAL — todo gestor + CS recebe o ajuste.
    //
    // Quando a CRC do cliente intercepta o atendimento manualmente, a Bia
    // não tem chance de qualificar ou transferir o lead. Cobrar o spend
    // inteiro em cima das poucas transferências que sobraram pra Bia eh
    // injusto — quem causou a interrupção foi a CRC, não o gestor/CS.
    //
    // Fórmula: spend × (leadsAvaliaveis / leadsTotais)
    //   onde leadsTotais = avaliaveis + interrompidos
    //
    // Exemplo: 50 leads, 48 interrompidos pela CRC, 2 avaliaveis (1 transf).
    //   proporcao = 2 / 50 = 0.04
    //   spend = 500 × 0.04 = 20
    //   CPT = 20 / 1 = 20 (em vez de 500)
    let spendExcluidoCrc = 0;
    const leadsTotais = mensagensIniciadas + chatsInterrompidos;
    if (leadsTotais > 0 && chatsInterrompidos > 0) {
      const proporcao = mensagensIniciadas / leadsTotais;
      const spendAjustado = spend * proporcao;
      spendExcluidoCrc = Number((spend - spendAjustado).toFixed(2));
      spend = Number(spendAjustado.toFixed(2));
      // A fatia Google recebe o MESMO fator (regra de 3 aplica proporcional)
      spendGooglePart = spendGooglePart * proporcao;
    }

    // Partição final Meta × Google (soma sempre = spend)
    const spendGoogle = Number(Math.min(spendGooglePart, spend).toFixed(2));
    const spendMeta = Number((spend - spendGoogle).toFixed(2));

    const cpt = transferencias > 0 ? spend / transferencias : null;
    const metaMatchVia = campaigns.length > 0
      ? (metaMatchByClient.get(cl.name) ?? null)
      : null;

    // === DIAS COM BIA ATIVA (desde a entrada do cliente, exclui manutenção) ===
    // Até AGORA (independe do range). Em horas se < 1 dia.
    let biaAtivaMs: number | null = null;
    {
      const tlBia = opts.biaTimelineByClientId?.get(cl.id);
      const faseBia = opts.biaFaseByClientId?.get(cl.id) ?? null;
      const entradaBia = parseDataEntrada(cl.dataEntrada);
      const sinceBia = entradaBia ?? (tlBia && tlBia.length > 0 ? new Date(tlBia[0].ts) : null);
      if (sinceBia) biaAtivaMs = activeMsInRange(tlBia, faseBia, sinceBia, new Date());
    }

    return {
      client: cl,
      doutorMatch,
      matchVia,
      metaMatchVia,
      spend,
      spendMeta,
      spendGoogle,
      transferencias,
      mensagensIniciadas,
      chatsInterrompidos,
      cpt,
      campaigns,
      leads: leadsDoCliente,
      allLeads: allLeadsDoCliente,
      churned,
      churnCutoff: effectiveCutoff,
      inactive: !isClienteAtivo(cl),
      spendBruto: Number(spendBruto.toFixed(2)),
      spendBrutoTotal: Number(spendBrutoTotal.toFixed(2)),
      spendExcluido,
      spendExcluidoCrc,
      periodosManutencao,
      biaAtivaMs,
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
    // Totais usam o `spend` JÁ AJUSTADO por timeline de Manutenção.
    // - Cliente nunca ativo no período → spend = 0 → contribuição 0
    // - Cliente parcialmente ativo → spend = fração ativa × spend bruto
    // - Cliente totalmente ativo → spend = spend bruto
    //
    // O flag `inactive` (= não está em I.A ativa AGORA) é só pra UI.
    // Não filtramos por ele aqui, porque um cliente atualmente em Manutenção
    // pode ter sido ativo parte do período e essa parte deve contar.
    const totalSpend = cms.reduce((s, c) => s + c.spend, 0);
    const totalSpendMeta = cms.reduce((s, c) => s + c.spendMeta, 0);
    const totalSpendGoogle = cms.reduce((s, c) => s + c.spendGoogle, 0);
    const totalTransf = cms.reduce((s, c) => s + c.transferencias, 0);
    const totalMensagens = cms.reduce((s, c) => s + c.mensagensIniciadas, 0);
    const cpt = totalTransf > 0 ? totalSpend / totalTransf : null;
    gestores.push({
      gestor,
      totalSpend: Number(totalSpend.toFixed(2)),
      totalSpendMeta: Number(totalSpendMeta.toFixed(2)),
      totalSpendGoogle: Number(totalSpendGoogle.toFixed(2)),
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

  const totalSpendMeta = gestores.reduce((s, g) => s + g.totalSpendMeta, 0);
  const totalSpendGoogle = gestores.reduce((s, g) => s + g.totalSpendGoogle, 0);
  const googleOrfaos = Array.from(googleOrfaosMap.values())
    .map((o) => ({ ...o, spend: Number(o.spend.toFixed(2)) }))
    .sort((a, b) => b.spend - a.spend);
  if (googleOrfaos.length > 0) {
    console.warn(
      `[gestorMetrics] ${googleOrfaos.length} conta(s) Google Ads com gasto sem cliente casado:`,
      googleOrfaos.map((o) => `${o.accountName} (${o.accountId}): R$ ${o.spend.toFixed(2)}`).join(' | ')
    );
  }

  return {
    totalSpend: Number(totalSpend.toFixed(2)),
    totalSpendMeta: Number(totalSpendMeta.toFixed(2)),
    totalSpendGoogle: Number(totalSpendGoogle.toFixed(2)),
    totalTransferencias,
    cptGeral,
    tier: tierForCpt(cptGeral),
    gestores,
    clientsFora,
    campaignsOrfas,
    googleOrfaos,
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

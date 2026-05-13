import { config, type MetaAccount } from '../config';
import { errorMessage } from './errors';

const GRAPH_VERSION = 'v23.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type GestorName = MetaAccount['gestor'];

export interface AdAccountInfo {
  id: string;        // ex: "act_1234567890"
  account_id: string; // ex: "1234567890"
  name: string;
  gestor: GestorName;
}

export interface CampaignInsight {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  gestor: GestorName;
  accountId: string;
  accountName: string;
}

interface RawInsightRow {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
}

interface InsightsResponse {
  data?: RawInsightRow[];
  paging?: { next?: string };
  error?: { message?: string };
}

interface AdAccountsResponse {
  data?: Array<{ id?: string; account_id?: string; name?: string }>;
  paging?: { next?: string };
  error?: { message?: string };
}

const FIM_VENDA_RE = /\b(fim|fins|venda|vendas)\b/i;

export function isFimVenda(campaignName: string): boolean {
  return FIM_VENDA_RE.test(campaignName);
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface MetaFetchRange {
  start: Date | null;
  end: Date | null;
}

function getGestorConfig(gestor: string): MetaAccount {
  const acc = config.META_ACCOUNTS.find(
    (a) => a.gestor.toLowerCase() === gestor.toLowerCase()
  );
  if (!acc) throw new Error(`Gestor "${gestor}" não está configurado no .env`);
  if (!acc.token) throw new Error(`Token do gestor "${gestor}" vazio no .env`);
  return acc;
}

/**
 * Lista todas as contas de anúncios acessíveis pelo token de UM gestor.
 * Cache externo (no hook) — esta função sempre busca.
 */
export async function fetchAdAccountsByGestor(
  gestor: GestorName
): Promise<AdAccountInfo[]> {
  const acc = getGestorConfig(gestor);

  // Se o usuário fixou um accountId específico no .env, retorna apenas ele
  if (acc.accountId) {
    try {
      const url = `${GRAPH_BASE}/${acc.accountId}?fields=name,account_id&access_token=${encodeURIComponent(
        acc.token
      )}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.error) {
        return [
          {
            id: acc.accountId,
            account_id: acc.accountId.replace(/^act_/, ''),
            name: acc.accountId,
            gestor: acc.gestor,
          },
        ];
      }
      return [
        {
          id: acc.accountId,
          account_id: data.account_id ?? acc.accountId.replace(/^act_/, ''),
          name: data.name ?? acc.accountId,
          gestor: acc.gestor,
        },
      ];
    } catch {
      return [
        {
          id: acc.accountId,
          account_id: acc.accountId.replace(/^act_/, ''),
          name: acc.accountId,
          gestor: acc.gestor,
        },
      ];
    }
  }

  const out: AdAccountInfo[] = [];
  let url: string | null = `${GRAPH_BASE}/me/adaccounts?fields=name,account_id&limit=200&access_token=${encodeURIComponent(
    acc.token
  )}`;

  for (let i = 0; i < 10 && url; i++) {
    const res = await fetch(url);
    const data: AdAccountsResponse = await res.json();
    if (!res.ok || data.error) {
      throw new Error(`[Meta ${acc.gestor}] ${data.error?.message ?? res.statusText}`);
    }
    for (const a of data.data ?? []) {
      if (!a.id) continue;
      out.push({
        id: a.id,
        account_id: a.account_id ?? a.id.replace(/^act_/, ''),
        name: a.name ?? a.id,
        gestor: acc.gestor,
      });
    }
    url = data.paging?.next ?? null;
  }

  return out;
}

function buildInsightsUrl(
  acc: MetaAccount,
  adAccountId: string,
  range: MetaFetchRange
): string {
  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend',
    limit: '500',
    access_token: acc.token,
  });

  if (range.start && range.end) {
    params.set(
      'time_range',
      JSON.stringify({ since: fmtDate(range.start), until: fmtDate(range.end) })
    );
  } else {
    params.set('date_preset', 'maximum');
  }

  return `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`;
}

async function fetchInsightsForAdAccount(
  acc: MetaAccount,
  adAccount: { id: string; name: string },
  range: MetaFetchRange
): Promise<CampaignInsight[]> {
  const out: CampaignInsight[] = [];
  let url: string | null = buildInsightsUrl(acc, adAccount.id, range);

  for (let i = 0; i < 20 && url; i++) {
    const res = await fetch(url);
    const data: InsightsResponse = await res.json();
    if (!res.ok || data.error) {
      throw new Error(
        `[Meta ${acc.gestor} / ${adAccount.name}] ${data.error?.message ?? res.statusText}`
      );
    }
    for (const row of data.data ?? []) {
      const spend = parseFloat(row.spend ?? '0') || 0;
      out.push({
        campaign_id: row.campaign_id ?? '',
        campaign_name: row.campaign_name ?? '',
        spend,
        gestor: acc.gestor,
        accountId: adAccount.id,
        accountName: adAccount.name,
      });
    }
    url = data.paging?.next ?? null;
  }

  return out;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface LinkForInsights {
  meta_account_id: string;
  meta_account_name: string | null;
  gestor: string | null;
}

export interface FetchInsightsResult {
  insights: CampaignInsight[];
  errors: string[];
}

/**
 * Busca insights APENAS das contas listadas em `links`. Sem discovery.
 * Usa direto o account_id + gestor do link pra resolver token.
 */
export async function fetchInsightsForLinks(
  range: MetaFetchRange,
  links: LinkForInsights[]
): Promise<FetchInsightsResult> {
  const errors: string[] = [];
  const allInsights: CampaignInsight[] = [];

  // Agrupa por gestor pra controlar concorrência por token (rate limit por app)
  const byGestor = new Map<string, LinkForInsights[]>();
  for (const l of links) {
    if (!l.gestor || !l.meta_account_id) continue;
    const arr = byGestor.get(l.gestor) ?? [];
    arr.push(l);
    byGestor.set(l.gestor, arr);
  }

  await Promise.all(
    Array.from(byGestor.entries()).map(async ([gestor, gestorLinks]) => {
      let acc: MetaAccount;
      try {
        acc = getGestorConfig(gestor);
      } catch (e) {
        errors.push(errorMessage(e));
        return;
      }

      const targets = gestorLinks.map((l) => ({
        id: l.meta_account_id,
        name: l.meta_account_name ?? l.meta_account_id,
      }));

      const results = await mapWithConcurrency(targets, 5, (ad) =>
        fetchInsightsForAdAccount(acc, ad, range).catch((e) => {
          errors.push(errorMessage(e));
          return [] as CampaignInsight[];
        })
      );
      for (const rows of results) allInsights.push(...rows);
    })
  );

  return { insights: allInsights, errors };
}

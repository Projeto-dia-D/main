import { useEffect, useState } from 'react';
import { getAllConfiguredAccounts, getGestorConfig } from '../lib/meta';
import { readCache, writeCache } from '../lib/cache';
import type { MetaAccount } from '../config';

export interface ClientSpendAllTime {
  totalSpend: number;          // BRL, somatório de todos os dias
  dailySpend: { date: string; spend: number }[]; // série diária histórica
  firstDay: string | null;     // primeira data com spend
  lastDay: string | null;
  diasComSpend: number;
  loading: boolean;
  error: string | null;
  /** Gestor cujo token efetivamente funcionou pra puxar o spend (pode ser
   *  diferente do `gestor` vinculado quando caímos no fallback). */
  tokenUsado?: string | null;
}

const CACHE_PREFIX = 'spend:alltime:v2:';
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 horas — histórico não muda muito

interface CachedRow {
  totalSpend: number;
  dailySpend: { date: string; spend: number }[];
  firstDay: string | null;
  lastDay: string | null;
  fetchedAt: number;
  tokenUsado?: string;
}

interface MetaInsightsResp {
  data?: Array<{
    spend?: string;
    date_start?: string;
    campaign_name?: string;
  }>;
  paging?: { next?: string };
  error?: { message: string; code?: number };
}

const FIM_VENDA_RE = /\b(fim|fins|venda|vendas)\b/i;
const LEADS_TAG_RE = /\[\s*leads?\s*\]/i;
function isFimVenda(name: string): boolean {
  return FIM_VENDA_RE.test(name) || LEADS_TAG_RE.test(name);
}

/**
 * Tenta puxar insights com UM token específico.
 * Retorna { rows, errorCode }. errorCode 200 = sem permissão (account não acessível),
 * outros códigos = erro geral. Quando o token não tem permissão pra essa conta,
 * a Meta retorna error code 100 ("Unsupported get request" ou similar).
 */
/** Garante que o accountId tenha o prefixo `act_` (Meta API exige). */
function normalizeAccountId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
}

/** Data ISO (YYYY-MM-DD) de N meses atrás a partir de hoje. */
function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

async function fetchInsightsWithToken(
  accountId: string,
  token: string
): Promise<{ rows: Array<{ spend: string; date_start: string; campaign_name: string }>; error: string | null }> {
  const acct = normalizeAccountId(accountId);
  const until = new Date().toISOString().slice(0, 10);
  // A Meta limita insights a no máximo 37 meses atrás:
  //   "(#3018) The start date of the time range cannot be beyond 37 months
  //    from the current date"
  // Antes era '2020-01-01' fixo, que passou a estourar #3018 (HTTP 400) assim
  // que a janela de 37 meses ultrapassou jan/2020 (~2023). Usamos 36 meses de
  // margem — é o "all-time" possível dentro do limite da API.
  const since = monthsAgoIso(36);
  const range = encodeURIComponent(JSON.stringify({ since, until }));

  const allRows: Array<{ spend: string; date_start: string; campaign_name: string }> = [];
  let nextUrl: string | null =
    `https://graph.facebook.com/v23.0/${acct}/insights` +
    `?fields=spend,date_start,campaign_name` +
    `&time_range=${range}` +
    `&level=campaign` +
    `&time_increment=1` +
    `&limit=500` +
    `&access_token=${encodeURIComponent(token)}`;

  let safety = 0;
  while (nextUrl && safety++ < 100) {
    const res: MetaInsightsResp = await fetch(nextUrl).then((r) => r.json());
    if (res.error) {
      return { rows: [], error: res.error.message };
    }
    for (const r of res.data ?? []) {
      if (!r.spend || !r.date_start || !r.campaign_name) continue;
      if (!isFimVenda(r.campaign_name)) continue;
      allRows.push({
        spend: r.spend,
        date_start: r.date_start,
        campaign_name: r.campaign_name,
      });
    }
    nextUrl = res.paging?.next ?? null;
  }
  return { rows: allRows, error: null };
}

/**
 * Puxa spend histórico (all-time) de UMA conta Meta especificamente.
 *
 * ESTRATÉGIA com FALLBACK:
 *   1. Se o gestor vinculado tem token configurado → tenta primeiro com ele
 *   2. Se falhar (token expirado, sem permissão), tenta cada outro token
 *      disponível (Renan/Weslei/André) — um deles geralmente tem acesso
 *   3. Persiste no cache qual token funcionou pra acelerar próxima chamada
 *
 * - Filtra só campanhas que geram lead (mesma regra de isFimVenda)
 * - Pega dia a dia (time_increment=1) pra montar série temporal
 * - Cache localStorage 6h por conta (TTL razoável — spend antigo não muda)
 */
export function useClientSpendAllTime(
  accountId: string | null | undefined,
  gestor: string | null | undefined
): ClientSpendAllTime {
  const cacheKey = accountId ? `${CACHE_PREFIX}${accountId}` : null;
  const initialCache = cacheKey ? readCache<CachedRow>(cacheKey) : null;
  const cacheValid =
    initialCache && Date.now() - initialCache.fetchedAt < CACHE_TTL_MS;

  const [totalSpend, setTotalSpend] = useState<number>(initialCache?.totalSpend ?? 0);
  const [dailySpend, setDailySpend] = useState(initialCache?.dailySpend ?? []);
  const [firstDay, setFirstDay] = useState<string | null>(initialCache?.firstDay ?? null);
  const [lastDay, setLastDay] = useState<string | null>(initialCache?.lastDay ?? null);
  const [tokenUsado, setTokenUsado] = useState<string | null>(initialCache?.tokenUsado ?? null);
  const [loading, setLoading] = useState(!cacheValid && !!accountId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) {
      setTotalSpend(0);
      setDailySpend([]);
      setLoading(false);
      return;
    }
    if (cacheValid) {
      setLoading(false);
      return;
    }

    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Monta lista de tokens a tentar:
        //   1º o do gestor vinculado (se existe + tem token)
        //   2º os demais tokens configurados (fallback)
        const allAccounts = getAllConfiguredAccounts();
        const tried: MetaAccount[] = [];
        if (gestor) {
          try {
            const primaryAcc = getGestorConfig(gestor);
            tried.push(primaryAcc);
          } catch {
            /* sem token do gestor vinculado → vai direto pro fallback */
          }
        }
        for (const acc of allAccounts) {
          if (!tried.find((t) => t.gestor === acc.gestor)) tried.push(acc);
        }
        if (tried.length === 0) {
          throw new Error('Nenhum token Meta configurado no .env');
        }

        let success: {
          rows: Array<{ spend: string; date_start: string; campaign_name: string }>;
          gestor: string;
        } | null = null;
        const errors: string[] = [];

        for (const acc of tried) {
          const { rows, error: e } = await fetchInsightsWithToken(accountId, acc.token);
          if (!e) {
            success = { rows, gestor: acc.gestor };
            break;
          }
          errors.push(`${acc.gestor}: ${e}`);
        }

        if (!active) return;

        if (!success) {
          // Nenhum token funcionou — mostra erro consolidado
          throw new Error(
            `Conta não acessível por nenhum gestor (${errors.length} tentativa(s)): ${errors[0]}`
          );
        }

        // Agrupa por dia
        const byDay = new Map<string, number>();
        for (const r of success.rows) {
          byDay.set(r.date_start, (byDay.get(r.date_start) ?? 0) + parseFloat(r.spend));
        }
        const daily = [...byDay.entries()]
          .sort()
          .map(([date, spend]) => ({ date, spend: Number(spend.toFixed(2)) }));
        const total = daily.reduce((s, d) => s + d.spend, 0);
        const first = daily[0]?.date ?? null;
        const last = daily[daily.length - 1]?.date ?? null;

        setTotalSpend(Number(total.toFixed(2)));
        setDailySpend(daily);
        setFirstDay(first);
        setLastDay(last);
        setTokenUsado(success.gestor);

        if (cacheKey) {
          writeCache<CachedRow>(cacheKey, {
            totalSpend: Number(total.toFixed(2)),
            dailySpend: daily,
            firstDay: first,
            lastDay: last,
            fetchedAt: Date.now(),
            tokenUsado: success.gestor,
          });
        }
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [accountId, gestor, cacheKey, cacheValid]);

  return {
    totalSpend,
    dailySpend,
    firstDay,
    lastDay,
    diasComSpend: dailySpend.length,
    loading,
    error,
    tokenUsado,
  };
}

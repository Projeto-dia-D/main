import { useEffect, useState } from 'react';
import { fetchInsightsForLinks, type CampaignInsight, type LinkForInsights } from '../lib/meta';
import type { DateRange } from '../lib/metrics';
import { errorMessage } from '../lib/errors';
import { readCacheWithMeta, writeCache } from '../lib/cache';

export interface UseMetaSpendResult {
  insights: CampaignInsight[];
  loading: boolean;
  errors: string[];
  lastUpdate: Date | null;
}

const REFRESH_MS = 1000 * 60 * 3; // 3 min — equilibrio entre frescor e rate limit do Meta
const CACHE_PREFIX = 'meta:insights:v1:';

interface CachedInsights {
  insights: CampaignInsight[];
}

/**
 * Busca insights APENAS dos vínculos já salvos.
 * NÃO faz discovery — usa account_id + gestor direto do link.
 * Mantém cache em localStorage por chave de range+links para tela aparecer
 * instantaneamente em cargas subsequentes.
 */
export function useMetaSpend(
  range: DateRange,
  links: LinkForInsights[]
): UseMetaSpendResult {
  // Chave reativa: muda quando o range ou o conjunto de links muda
  const linksKey = links
    .map((l) => `${l.gestor}:${l.meta_account_id}`)
    .sort()
    .join('|');
  const key = `${range.start?.getTime() ?? 'null'}-${range.end?.getTime() ?? 'null'}|${linksKey}`;
  const cacheKey = CACHE_PREFIX + key;

  // Lê cache na inicialização do hook (instantâneo)
  const cached = readCacheWithMeta<CachedInsights>(cacheKey);
  const initialInsights = cached?.value.insights ?? [];
  const initialUpdate = cached ? new Date(cached.savedAt) : null;

  const [insights, setInsights] = useState<CampaignInsight[]>(initialInsights);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(initialUpdate);

  useEffect(() => {
    let active = true;

    if (links.length === 0) {
      setInsights([]);
      setErrors([]);
      setLoading(false);
      return;
    }

    // Lê cache da nova chave (se range/links mudaram) e mostra imediatamente
    const c = readCacheWithMeta<CachedInsights>(cacheKey);
    if (c) {
      setInsights(c.value.insights);
      setLastUpdate(new Date(c.savedAt));
    }

    async function load() {
      // Só mostra "loading" se não temos cache pra exibir
      if (!c) setLoading(true);
      try {
        const { insights: rows, errors: errs } = await fetchInsightsForLinks(range, links);
        if (!active) return;
        setInsights(rows);
        setErrors(errs);
        setLastUpdate(new Date());
        writeCache<CachedInsights>(cacheKey, { insights: rows });
      } catch (e) {
        if (!active) return;
        setErrors([errorMessage(e)]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { insights, loading, errors, lastUpdate };
}

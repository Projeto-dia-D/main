import { useEffect, useState } from 'react';
import { fetchInsightsForLinks, type CampaignInsight, type LinkForInsights } from '../lib/meta';
import type { DateRange } from '../lib/metrics';
import { errorMessage } from '../lib/errors';

export interface UseMetaSpendResult {
  insights: CampaignInsight[];
  loading: boolean;
  errors: string[];
  lastUpdate: Date | null;
}

const REFRESH_MS = 1000 * 60 * 10; // 10 min

/**
 * Busca insights APENAS dos vínculos já salvos.
 * NÃO faz discovery — usa account_id + gestor direto do link.
 */
export function useMetaSpend(
  range: DateRange,
  links: LinkForInsights[]
): UseMetaSpendResult {
  const [insights, setInsights] = useState<CampaignInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Chave reativa: muda quando o range ou o conjunto de links muda
  const linksKey = links
    .map((l) => `${l.gestor}:${l.meta_account_id}`)
    .sort()
    .join('|');
  const key = `${range.start?.getTime() ?? 'null'}-${range.end?.getTime() ?? 'null'}|${linksKey}`;

  useEffect(() => {
    let active = true;

    if (links.length === 0) {
      setInsights([]);
      setErrors([]);
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      try {
        const { insights: rows, errors: errs } = await fetchInsightsForLinks(range, links);
        if (!active) return;
        setInsights(rows);
        setErrors(errs);
        setLastUpdate(new Date());
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

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { GoogleSpendRow } from '../lib/gestorMetrics';
import type { DateRange } from '../lib/metrics';

/**
 * Gasto diário do Google Ads no período — lido da tabela `google_ads_spend`
 * (Supabase), que é alimentada pelo sync agendado
 * (scripts/sync_google_ads_spend.mjs, Task Scheduler "GoogleAdsSync").
 *
 * Sem segredo no navegador: o frontend só lê o espelho no Supabase.
 * Cache em módulo (5 min por range) pra não martelar o Supabase — o hook é
 * usado em Gestor, CS e Apresentação ao mesmo tempo.
 */

const memo = new Map<string, { rows: GoogleSpendRow[]; at: number }>();
const inflight = new Map<string, Promise<GoogleSpendRow[]>>();
const TTL_MS = 5 * 60 * 1000;

function dayStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchRows(startStr: string, endStr: string): Promise<GoogleSpendRow[]> {
  const { data, error } = await supabase
    .from('google_ads_spend')
    .select('account_id, account_name, date, spend')
    .gte('date', startStr)
    .lte('date', endStr)
    .limit(20000);
  if (error) {
    // Tabela ainda não criada / Supabase fora: degrada pra "sem Google" sem
    // quebrar as telas (spend Google fica 0, Meta continua normal).
    console.warn('[useGoogleAdsSpend] leitura falhou:', error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    accountId: String(r.account_id),
    accountName: (r.account_name as string) ?? '',
    date: String(r.date),
    spend: Number(r.spend) || 0,
  }));
}

export function useGoogleAdsSpend(range: DateRange): {
  googleSpend: GoogleSpendRow[];
  loading: boolean;
} {
  const startStr = range.start ? dayStr(range.start) : dayStr(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
  const endStr = range.end ? dayStr(range.end) : dayStr(new Date());
  const key = `${startStr}|${endStr}`;

  const cached = memo.get(key);
  const fresh = cached && Date.now() - cached.at < TTL_MS;
  const [rows, setRows] = useState<GoogleSpendRow[]>(fresh ? cached.rows : []);
  const [loading, setLoading] = useState(!fresh);

  useEffect(() => {
    let active = true;
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
      setRows(hit.rows);
      setLoading(false);
      return;
    }
    setLoading(true);
    let p = inflight.get(key);
    if (!p) {
      p = fetchRows(startStr, endStr).then((r) => {
        memo.set(key, { rows: r, at: Date.now() });
        inflight.delete(key);
        return r;
      });
      inflight.set(key, p);
    }
    p.then((r) => {
      if (!active) return;
      setRows(r);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [key, startStr, endStr]);

  return { googleSpend: rows, loading };
}

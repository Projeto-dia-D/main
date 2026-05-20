import { useEffect, useState } from 'react';
import { config } from '../config';
import { readCache, writeCache } from '../lib/cache';

export interface MetaAccountRef {
  accountId: string;     // "act_XXX"
  accountName: string;
  gestor: string;        // "Weslei" | "André" | ...
}

export interface MetaAccountIndex {
  /** Map<nome_normalizado, MetaAccountRef[]> — pode ter múltiplos matches */
  byName: Map<string, MetaAccountRef[]>;
  all: MetaAccountRef[];
  loading: boolean;
  error: string | null;
  /** Procura uma conta cujo nome contenha `clientName` ou vice-versa.
   *  Retorna o primeiro match (ou null). */
  lookup: (clientName: string) => MetaAccountRef | null;
}

const CACHE_KEY = 'meta:accountIndex:v1';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h

interface CachedRow {
  all: MetaAccountRef[];
  fetchedAt: number;
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')   // tira pontuação
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match fuzzy: aceita exato, substring (qualquer direção) ou intersection forte. */
function lookupAccount(byName: Map<string, MetaAccountRef[]>, clientName: string): MetaAccountRef | null {
  const target = normalize(clientName);
  if (!target) return null;

  // 1. Match exato
  const exact = byName.get(target);
  if (exact && exact.length > 0) return exact[0];

  // 2. Substring (qualquer direção) — itera pelos nomes indexados
  for (const [name, refs] of byName) {
    if (name === target) continue;
    if (name.includes(target) || target.includes(name)) {
      // Match relevante: pelo menos 6 chars em comum
      const shorter = name.length < target.length ? name : target;
      if (shorter.length >= 6) return refs[0];
    }
  }

  // 3. Match por palavra (interseção de tokens significativos)
  const targetTokens = new Set(target.split(/\s+/).filter((t) => t.length >= 4));
  if (targetTokens.size === 0) return null;
  let best: { ref: MetaAccountRef; score: number } | null = null;
  for (const [name, refs] of byName) {
    const tokens = name.split(/\s+/).filter((t) => t.length >= 4);
    let score = 0;
    for (const t of tokens) if (targetTokens.has(t)) score++;
    if (score >= 2 && (!best || score > best.score)) {
      best = { ref: refs[0], score };
    }
  }
  return best?.ref ?? null;
}

/**
 * Indexa TODAS as contas Meta dos gestores configurados (Weslei + André),
 * permitindo descobrir a conta de um cliente pelo nome — mesmo sem
 * `client_meta_links` salvo no Supabase.
 *
 * Cache 24h no localStorage — contas Meta não mudam de nome com frequência.
 */
/**
 * @param enabled Quando false (default), só lê do cache — não dispara fetch.
 *                Use enabled=true só quando o user abrir o perfil de um
 *                cliente (lazy load). Isso evita uma chamada cara de ~632
 *                contas Meta quando a app sobe.
 */
export function useMetaAccountIndex(enabled: boolean = false): MetaAccountIndex {
  const cached = readCache<CachedRow>(CACHE_KEY);
  const cacheValid = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;

  const [all, setAll] = useState<MetaAccountRef[]>(cached?.all ?? []);
  const [loading, setLoading] = useState(enabled && !cacheValid);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
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
        const gestores = config.META_ACCOUNTS.filter((a) => a.token);
        const allAccounts: MetaAccountRef[] = [];

        for (const acc of gestores) {
          let url: string | null =
            `https://graph.facebook.com/v23.0/me/adaccounts` +
            `?fields=name,account_id&limit=500&access_token=${encodeURIComponent(acc.token)}`;
          let safety = 0;
          while (url && safety++ < 50) {
            const res: { data?: Array<{ id: string; name: string; account_id: string }>; paging?: { next?: string }; error?: { message: string } } =
              await fetch(url).then((r) => r.json());
            if (res.error) throw new Error(`${acc.gestor}: ${res.error.message}`);
            for (const a of res.data ?? []) {
              allAccounts.push({
                accountId: a.id,
                accountName: a.name,
                gestor: acc.gestor,
              });
            }
            url = res.paging?.next ?? null;
          }
        }

        if (!active) return;
        setAll(allAccounts);
        writeCache<CachedRow>(CACHE_KEY, { all: allAccounts, fetchedAt: Date.now() });
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
  }, [cacheValid, enabled]);

  // Indexa por nome normalizado (pode ter múltiplas contas com nome similar)
  const byName = new Map<string, MetaAccountRef[]>();
  for (const ref of all) {
    const key = normalize(ref.accountName);
    if (!key) continue;
    const arr = byName.get(key) ?? [];
    arr.push(ref);
    byName.set(key, arr);
  }

  return {
    byName,
    all,
    loading,
    error,
    lookup: (clientName) => lookupAccount(byName, clientName),
  };
}

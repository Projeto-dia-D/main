import { useEffect, useState, useRef, useMemo } from 'react';
import { fetchFirstAdImage } from '../lib/meta';
import type { MondayClient } from '../lib/monday';
import type { ClientMetaLink } from '../lib/linkStorage';
import { readCacheWithMeta, writeCache } from '../lib/cache';

/**
 * Hook que pega a primeira imagem de anuncio Meta pra cada doutor da lista.
 *
 * Fluxo:
 *  1. Pra cada nome de doutor, acha o MondayClient correspondente (match
 *     normalizado por nome + fallback substring)
 *  2. Pra esse cliente, acha o link Meta (client_meta_links)
 *  3. Chama fetchFirstAdImage com o meta_account_id + gestor pra obter URL
 *  4. Cache persistente em localStorage por 24h (URLs Meta sao CDN com
 *     query string assinada — expira em horas/dias)
 *
 * Retorna Map<nomeDoutor, URL | null>. null = nao achou (vai mostrar
 * iniciais ou ficar vazio no card).
 *
 * Limita a 1 req simultanea por doutor pra nao estourar rate limit do Meta.
 */
const CACHE_PREFIX = 'doutorAdPhoto:v1:';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(dr\.?|dra\.?|drs\.?|dras\.?)\s+/i, '')
    .trim();
}

/** Tenta achar o MondayClient correspondente ao nome do doutor. */
function findClient(doutorName: string, clients: MondayClient[]): MondayClient | null {
  const key = normalize(doutorName);
  if (!key) return null;
  // Exato primeiro
  for (const c of clients) {
    if (normalize(c.name) === key) return c;
  }
  // Substring
  for (const c of clients) {
    const cKey = normalize(c.name);
    if (cKey.includes(key) || key.includes(cKey)) return c;
  }
  return null;
}

export function useDoutorAdPhotos(
  doutorNames: string[],
  clients: MondayClient[],
  linksByClient: Map<string, ClientMetaLink>,
): Map<string, string | null> {
  // Estado: nome → URL ou null (null = ja buscou e nao achou)
  const [photos, setPhotos] = useState<Map<string, string | null>>(() => {
    // Restaura cache inicial pra mostrar instantaneo
    const initial = new Map<string, string | null>();
    for (const name of doutorNames) {
      const cached = readCacheWithMeta<string | null>(CACHE_PREFIX + name);
      if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
        initial.set(name, cached.value);
      }
    }
    return initial;
  });
  const inFlight = useRef(new Set<string>());

  // Estabiliza a lista (string sorted) pra evitar re-runs por re-render
  const stableNames = useMemo(
    () => [...new Set(doutorNames.filter(Boolean))].sort(),
    [doutorNames],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadOne(name: string) {
      if (inFlight.current.has(name)) return;
      // Confere cache primeiro
      const cached = readCacheWithMeta<string | null>(CACHE_PREFIX + name);
      if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
        if (!cancelled) {
          setPhotos((prev) => {
            if (prev.get(name) === cached.value) return prev;
            const next = new Map(prev);
            next.set(name, cached.value);
            return next;
          });
        }
        return;
      }

      inFlight.current.add(name);
      try {
        const client = findClient(name, clients);
        if (!client) {
          if (!cancelled) {
            writeCache(CACHE_PREFIX + name, null);
            setPhotos((prev) => new Map(prev).set(name, null));
          }
          return;
        }
        const link = linksByClient.get(client.id);
        if (!link) {
          if (!cancelled) {
            writeCache(CACHE_PREFIX + name, null);
            setPhotos((prev) => new Map(prev).set(name, null));
          }
          return;
        }
        const url = await fetchFirstAdImage(link.meta_account_id, link.gestor);
        if (cancelled) return;
        writeCache(CACHE_PREFIX + name, url);
        setPhotos((prev) => new Map(prev).set(name, url));
      } catch {
        if (!cancelled) {
          writeCache(CACHE_PREFIX + name, null);
          setPhotos((prev) => new Map(prev).set(name, null));
        }
      } finally {
        inFlight.current.delete(name);
      }
    }

    for (const name of stableNames) {
      if (photos.has(name)) continue;
      loadOne(name);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableNames, clients, linksByClient]);

  return photos;
}

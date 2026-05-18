import { useEffect, useState } from 'react';
import { fetchAuthEmails } from '../lib/monday';
import { readCache, writeCache } from '../lib/cache';

// v2: adicionado byFirstName fallback
const CACHE_KEY = 'monday:userPhotos:v2';
const REFRESH_MS = 1000 * 60 * 60; // 1 hora

interface CachedPhotos {
  byName: [string, string][];
  byEmail: [string, string][];
  byFirstName?: [string, string][];
}

export interface UseUserPhotosResult {
  /** nome normalizado (lowercased) → URL da foto */
  byName: Map<string, string>;
  /** email lowercased → URL da foto */
  byEmail: Map<string, string>;
  /** primeiro nome lowercased → URL da foto */
  byFirstName: Map<string, string>;
  /** Helper: procura foto por nome (faz normalize internamente).
   *  Tenta exact match → first-name match → null. */
  lookup: (name: string | null | undefined) => string | null;
}

function lookupFactory(
  byName: Map<string, string>,
  byFirstName: Map<string, string>
) {
  return (name: string | null | undefined): string | null => {
    if (!name) return null;
    const key = name.trim().toLowerCase();
    if (!key) return null;
    const hit = byName.get(key);
    if (hit) return hit;
    // Fallback por primeiro nome
    const first = key.split(/\s+/)[0];
    return byFirstName.get(first) ?? null;
  };
}

/**
 * Hook que busca fotos de usuários do Monday e cacheia em localStorage.
 * Usa stale-while-revalidate: retorna cache imediato, atualiza em background.
 */
export function useUserPhotos(): UseUserPhotosResult {
  const cached = readCache<CachedPhotos>(CACHE_KEY);
  const [byName, setByName] = useState<Map<string, string>>(
    () => new Map(cached?.byName ?? [])
  );
  const [byEmail, setByEmail] = useState<Map<string, string>>(
    () => new Map(cached?.byEmail ?? [])
  );
  const [byFirstName, setByFirstName] = useState<Map<string, string>>(
    () => new Map(cached?.byFirstName ?? [])
  );

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetchAuthEmails();
        if (!active) return;
        setByName(new Map(res.photoByName));
        setByEmail(new Map(res.photoByEmail));
        setByFirstName(new Map(res.photoByFirstName));
        writeCache<CachedPhotos>(CACHE_KEY, {
          byName: Array.from(res.photoByName.entries()),
          byEmail: Array.from(res.photoByEmail.entries()),
          byFirstName: Array.from(res.photoByFirstName.entries()),
        });
      } catch {
        /* mantém cache */
      }
    }

    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  return { byName, byEmail, byFirstName, lookup: lookupFactory(byName, byFirstName) };
}

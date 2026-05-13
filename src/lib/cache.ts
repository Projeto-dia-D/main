// Cache simples em localStorage com TTL e revalidação stale-while-revalidate.
//
// Padrão: tenta retornar o valor cacheado imediatamente (mesmo expirado),
// e dispara revalidação em background. Usado pra evitar tela em branco
// enquanto APIs externas (Monday, Meta) carregam.

interface CacheEntry<T> {
  value: T;
  savedAt: number;
}

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    return entry.value ?? null;
  } catch {
    return null;
  }
}

export function readCacheWithMeta<T>(
  key: string
): { value: T; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.value === undefined || entry.value === null) return null;
    return { value: entry.value, savedAt: entry.savedAt };
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  try {
    const entry: CacheEntry<T> = { value, savedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Se localStorage estiver cheio ou desativado, silenciosamente ignora.
  }
}

export function isCacheFresh(savedAt: number, ttlMs: number): boolean {
  return Date.now() - savedAt < ttlMs;
}

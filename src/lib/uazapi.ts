import { config } from '../config';

interface UazapiInstance {
  token: string;
  name: string;
  status: string;
}

let cachedMap: Map<string, string> | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 1000 * 45; // 45s — alinhado com o refresh de 1min do hook
let inflightPromise: Promise<Map<string, string>> | null = null;

/**
 * Busca todas as instâncias UAZAPI usando o token admin e retorna
 * um Map de token-UUID → nome da instância.
 */
export async function fetchAllInstances(): Promise<Map<string, string>> {
  // Cache válido
  if (cachedMap && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedMap;
  }

  // Já buscando
  if (inflightPromise) return inflightPromise;

  inflightPromise = (async () => {
    try {
      const res = await fetch(`${config.UAZAPI_URL}/instance/all`, {
        method: 'GET',
        headers: {
          admintoken: config.UAZAPI_TOKEN,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        console.warn('[uazapi] /instance/all retornou', res.status);
        return cachedMap ?? new Map<string, string>();
      }

      const data: UazapiInstance[] = await res.json();
      const map = new Map<string, string>();
      for (const inst of data) {
        if (inst.token) map.set(inst.token, inst.name);
      }
      cachedMap = map;
      cacheTime = Date.now();
      return map;
    } catch (err) {
      console.warn('[uazapi] falha ao buscar instâncias:', err);
      return cachedMap ?? new Map<string, string>();
    } finally {
      inflightPromise = null;
    }
  })();

  return inflightPromise;
}

/** Retorna o nome da instância para um token, ou null se não encontrado. */
export function getInstanceName(map: Map<string, string>, token: string): string | null {
  return map.get(token) ?? null;
}

import { useEffect, useState } from 'react';
import { fetchAllInstances } from '../lib/uazapi';

// Re-fetch a lista de instâncias uazapi periodicamente.
// O cache interno de 30min em uazapi.ts evita requests desnecessários,
// mas este intervalo garante que novas instâncias apareçam sem reload.
const REFRESH_MS = 1000 * 60 * 5; // 5 min

export function useInstanceMap(): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const m = await fetchAllInstances();
        if (active) setMap(m);
      } catch (e) {
        console.warn('[useInstanceMap] falha:', e);
      }
    }

    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  return map;
}

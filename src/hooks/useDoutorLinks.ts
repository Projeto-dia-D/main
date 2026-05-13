import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  DOUTOR_LINKS_TABLE,
  fetchAllDoutorLinks,
  upsertDoutorLink as upsertRow,
  deleteDoutorLink as deleteRow,
  type DoutorClientLink,
} from '../lib/linkStorage';
import { errorMessage, isMissingTableError } from '../lib/errors';
import { readCache, writeCache } from '../lib/cache';

const CACHE_KEY = 'doutorLinks:v1';

export interface UseDoutorLinksResult {
  links: DoutorClientLink[];
  byDoutor: Map<string, DoutorClientLink>;          // nomeDoutor → link
  byClient: Map<string, DoutorClientLink[]>;        // monday_client_id → [links]
  loading: boolean;
  error: string | null;
  missingTable: boolean;
  setLink: (link: Omit<DoutorClientLink, 'updated_at'>) => Promise<void>;
  removeLink: (doutorName: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useDoutorLinks(): UseDoutorLinksResult {
  const cachedLinks = readCache<DoutorClientLink[]>(CACHE_KEY) ?? [];
  const [links, setLinks] = useState<DoutorClientLink[]>(cachedLinks);
  const [loading, setLoading] = useState(cachedLinks.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [missingTable, setMissingTable] = useState(false);
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const rows = await fetchAllDoutorLinks();
      if (!activeRef.current) return;
      setLinks(rows);
      writeCache(CACHE_KEY, rows);
      setError(null);
      setMissingTable(false);
    } catch (e) {
      if (!activeRef.current) return;
      if (isMissingTableError(e)) {
        setMissingTable(true);
        setError(null);
      } else {
        setError(errorMessage(e));
        setMissingTable(false);
      }
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    refresh().finally(() => {
      if (activeRef.current) setLoading(false);
    });

    const channel = supabase
      .channel(`doutor_links_rt_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: DOUTOR_LINKS_TABLE },
        () => {
          if (activeRef.current) refresh();
        }
      )
      .subscribe();

    return () => {
      activeRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const setLink = useCallback(
    async (link: Omit<DoutorClientLink, 'updated_at'>) => {
      await upsertRow(link);
      setLinks((prev) => {
        const filtered = prev.filter((l) => l.doutor_name !== link.doutor_name);
        return [
          ...filtered,
          { ...link, updated_at: new Date().toISOString() },
        ];
      });
    },
    []
  );

  const removeLink = useCallback(async (doutorName: string) => {
    await deleteRow(doutorName);
    setLinks((prev) => prev.filter((l) => l.doutor_name !== doutorName));
  }, []);

  const byDoutor = useMemo(() => {
    const m = new Map<string, DoutorClientLink>();
    for (const l of links) m.set(l.doutor_name, l);
    return m;
  }, [links]);

  const byClient = useMemo(() => {
    const m = new Map<string, DoutorClientLink[]>();
    for (const l of links) {
      const arr = m.get(l.monday_client_id) ?? [];
      arr.push(l);
      m.set(l.monday_client_id, arr);
    }
    return m;
  }, [links]);

  return {
    links,
    byDoutor,
    byClient,
    loading,
    error,
    missingTable,
    setLink,
    removeLink,
    refresh,
  };
}

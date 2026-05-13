import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  LINKS_TABLE,
  fetchAllLinks,
  upsertLink as upsertLinkRow,
  deleteLink as deleteLinkRow,
  type ClientMetaLink,
} from '../lib/linkStorage';
import { errorMessage, isMissingTableError } from '../lib/errors';

export interface UseMetaLinksResult {
  links: ClientMetaLink[];
  byClient: Map<string, ClientMetaLink>;
  byAccount: Map<string, ClientMetaLink>;
  loading: boolean;
  error: string | null;
  missingTable: boolean;
  setLink: (link: Omit<ClientMetaLink, 'updated_at'>) => Promise<void>;
  removeLink: (mondayClientId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMetaLinks(): UseMetaLinksResult {
  const [links, setLinks] = useState<ClientMetaLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingTable, setMissingTable] = useState(false);
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const rows = await fetchAllLinks();
      if (!activeRef.current) return;
      setLinks(rows);
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
      .channel(`links_rt_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: LINKS_TABLE },
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
    async (link: Omit<ClientMetaLink, 'updated_at'>) => {
      await upsertLinkRow(link);
      // optimistic: realtime trigger vai atualizar; mas atualiza já pro UX
      setLinks((prev) => {
        const filtered = prev.filter(
          (l) => l.monday_client_id !== link.monday_client_id
        );
        return [
          ...filtered,
          { ...link, updated_at: new Date().toISOString() },
        ];
      });
    },
    []
  );

  const removeLink = useCallback(async (id: string) => {
    await deleteLinkRow(id);
    setLinks((prev) => prev.filter((l) => l.monday_client_id !== id));
  }, []);

  const byClient = useMemo(() => {
    const m = new Map<string, ClientMetaLink>();
    for (const l of links) m.set(l.monday_client_id, l);
    return m;
  }, [links]);

  const byAccount = useMemo(() => {
    const m = new Map<string, ClientMetaLink>();
    for (const l of links) m.set(l.meta_account_id, l);
    return m;
  }, [links]);

  return { links, byClient, byAccount, loading, error, missingTable, setLink, removeLink, refresh };
}

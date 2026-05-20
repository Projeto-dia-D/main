import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { useUser } from './userContext';

export type NotificationLevel = 'error' | 'warning' | 'info';

export interface Notification {
  /** ID estável — quando o mesmo problema reaparece, NÃO duplica. */
  id: string;
  level: NotificationLevel;
  source: string;
  message: string;
  detail?: string;
  /** Quando começou (primeira vez que apareceu). */
  firstSeen: number;
  /** Última atualização. */
  lastSeen: number;
  /** Lista de emails de admins que dispensaram. */
  dismissedBy: string[];
  /** Quando o erro foi auto-resolvido (sumiu por algumas chamadas seguidas). */
  resolvedAt: number | null;
}

interface NotificationsCtx {
  notifications: Notification[];
  /** Reporta. Se id já existe, atualiza lastSeen + message; senão cria. */
  report: (n: Omit<Notification, 'firstSeen' | 'lastSeen' | 'dismissedBy' | 'resolvedAt'>) => void;
  /** Marca como resolvido (não-destrutivo — fica no histórico). */
  resolve: (id: string) => void;
  /** Dispensa pra ESTE usuário (adiciona email ao array dismissed_by). */
  dismiss: (id: string) => void;
  /** Limpa as visíveis (dispensa todas). */
  clear: () => void;
}

interface RowDB {
  id: string;
  level: NotificationLevel;
  source: string;
  message: string;
  detail: string | null;
  first_seen: string;
  last_seen: string;
  dismissed_by: string[] | null;
  resolved_at: string | null;
}

function rowToNotification(r: RowDB): Notification {
  return {
    id: r.id,
    level: r.level,
    source: r.source,
    message: r.message,
    detail: r.detail ?? undefined,
    firstSeen: new Date(r.first_seen).getTime(),
    lastSeen: new Date(r.last_seen).getTime(),
    dismissedBy: r.dismissed_by ?? [],
    resolvedAt: r.resolved_at ? new Date(r.resolved_at).getTime() : null,
  };
}

const Ctx = createContext<NotificationsCtx | null>(null);

/**
 * Provider que sincroniza notificações com Supabase (tabela `notifications`).
 * - Faz upsert em report() — mesma id atualiza last_seen + message
 * - dismiss() adiciona o email do user logado em dismissed_by[]
 * - Realtime atualiza a lista quando outro admin reporta/dispensa
 * - Cada user vê apenas as notifications que NÃO dispensou
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const user = useUser();
  const [rows, setRows] = useState<Notification[]>([]);
  // Cache local pra dedupe — evita upsert idêntico se o erro reaparece
  // com a MESMA mensagem (loop de useEffect).
  const lastReportRef = useRef<Map<string, string>>(new Map());

  // Carga inicial + realtime
  useEffect(() => {
    let active = true;

    async function load() {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .is('resolved_at', null)
        .order('last_seen', { ascending: false });
      if (!active) return;
      if (error) {
        console.warn('[notifications] load error:', error.message);
        return;
      }
      setRows((data ?? []).map(rowToNotification));
    }

    load();

    const channel = supabase
      .channel('notifications_rt_' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, (payload) => {
        if (!active) return;
        const row = (payload.new ?? payload.old) as RowDB | undefined;
        if (!row) return;
        if (payload.eventType === 'DELETE') {
          setRows((prev) => prev.filter((p) => p.id !== row.id));
          return;
        }
        setRows((prev) => {
          const idx = prev.findIndex((p) => p.id === row.id);
          const converted = rowToNotification(row);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = converted;
            return copy;
          }
          return [converted, ...prev];
        });
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const report = useCallback(
    async (n: Omit<Notification, 'firstSeen' | 'lastSeen' | 'dismissedBy' | 'resolvedAt'>) => {
      // Dedup: se já reportei com a mesma message neste session, não faz nada
      const lastMessage = lastReportRef.current.get(n.id);
      if (lastMessage === n.message) return;
      lastReportRef.current.set(n.id, n.message);

      // Upsert: insert OR update last_seen + message
      const { error } = await supabase
        .from('notifications')
        .upsert(
          {
            id: n.id,
            level: n.level,
            source: n.source,
            message: n.message,
            detail: n.detail ?? null,
            last_seen: new Date().toISOString(),
            // Quando o erro reaparece, limpa o resolved_at automaticamente
            resolved_at: null,
          },
          { onConflict: 'id', ignoreDuplicates: false }
        );
      if (error) console.warn('[notifications] report error:', error.message);
    },
    []
  );

  const resolve = useCallback(async (id: string) => {
    lastReportRef.current.delete(id);
    const { error } = await supabase
      .from('notifications')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', id);
    if (error) console.warn('[notifications] resolve error:', error.message);
  }, []);

  const dismiss = useCallback(
    async (id: string) => {
      // Adiciona email do user atual no array dismissed_by
      const row = rows.find((r) => r.id === id);
      const current = row?.dismissedBy ?? [];
      if (current.includes(user.email)) return;
      const next = [...current, user.email];
      const { error } = await supabase
        .from('notifications')
        .update({ dismissed_by: next })
        .eq('id', id);
      if (error) console.warn('[notifications] dismiss error:', error.message);
    },
    [rows, user.email]
  );

  const clear = useCallback(async () => {
    // Adiciona email do user em TODAS as visíveis
    const visible = rows.filter((r) => !r.dismissedBy.includes(user.email));
    for (const r of visible) {
      const next = [...r.dismissedBy, user.email];
      await supabase.from('notifications').update({ dismissed_by: next }).eq('id', r.id);
    }
  }, [rows, user.email]);

  // Filtra: só mostra notificações que o user atual NÃO dispensou
  const visibleNotifications = useMemo(
    () => rows.filter((r) => !r.dismissedBy.includes(user.email) && r.resolvedAt === null),
    [rows, user.email]
  );

  const value = useMemo(
    () => ({ notifications: visibleNotifications, report, resolve, dismiss, clear }),
    [visibleNotifications, report, resolve, dismiss, clear]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications(): NotificationsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      notifications: [],
      report: () => {},
      resolve: () => {},
      dismiss: () => {},
      clear: () => {},
    };
  }
  return ctx;
}

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type NotificationLevel = 'error' | 'warning' | 'info';

export interface Notification {
  /** ID estável — quando o mesmo problema reaparece, NÃO duplica. */
  id: string;
  level: NotificationLevel;
  /** Origem (ex: "Meta Ads", "Monday", "Supabase", "Vínculos"). */
  source: string;
  /** Texto curto. */
  message: string;
  /** Quando começou (primeira vez que apareceu nesta sessão). */
  firstSeen: number;
  /** Última atualização. */
  lastSeen: number;
  /** Detalhes extras opcionais (ex: stack, URL). */
  detail?: string;
}

interface NotificationsCtx {
  notifications: Notification[];
  /** Reporta. Se id já existe, atualiza lastSeen + message; senão cria. */
  report: (n: Omit<Notification, 'firstSeen' | 'lastSeen'>) => void;
  /** Remove uma notificação específica. */
  dismiss: (id: string) => void;
  /** Limpa tudo. */
  clear: () => void;
}

const Ctx = createContext<NotificationsCtx | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // Cache local pra não rerender quando o mesmo erro chega
  const lastReportRef = useRef<Map<string, string>>(new Map());

  const report = useCallback((n: Omit<Notification, 'firstSeen' | 'lastSeen'>) => {
    const now = Date.now();
    // Dedup: se o message é o mesmo da última vez, não atualiza (evita loop)
    const lastMessage = lastReportRef.current.get(n.id);
    if (lastMessage === n.message) return;
    lastReportRef.current.set(n.id, n.message);

    setNotifications((prev) => {
      const idx = prev.findIndex((p) => p.id === n.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...n, lastSeen: now };
        return copy;
      }
      return [...prev, { ...n, firstSeen: now, lastSeen: now }];
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((p) => p.id !== id));
    lastReportRef.current.delete(id);
  }, []);

  const clear = useCallback(() => {
    setNotifications([]);
    lastReportRef.current.clear();
  }, []);

  const value = useMemo(
    () => ({ notifications, report, dismiss, clear }),
    [notifications, report, dismiss, clear]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications(): NotificationsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback no-op quando fora do provider (ex: testes)
    return {
      notifications: [],
      report: () => {},
      dismiss: () => {},
      clear: () => {},
    };
  }
  return ctx;
}

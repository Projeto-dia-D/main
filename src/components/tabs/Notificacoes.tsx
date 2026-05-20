import { AlertCircle, AlertTriangle, Info, BellOff, X, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useNotifications, type Notification, type NotificationLevel } from '../../lib/notificationsContext';
import { useUser, hasFullAccess } from '../../lib/userContext';
import { SupabaseUsagePanel } from '../SupabaseUsagePanel';

function levelStyle(level: NotificationLevel) {
  if (level === 'error') {
    return {
      icon: AlertCircle,
      border: 'border-red-500/40',
      bg: 'bg-red-500/5',
      iconCls: 'text-red-400',
      badge: 'bg-red-500/15 text-red-400 border-red-500/40',
      label: 'Crítico',
    };
  }
  if (level === 'warning') {
    return {
      icon: AlertTriangle,
      border: 'border-burst-warning/40',
      bg: 'bg-burst-warning/5',
      iconCls: 'text-burst-warning',
      badge: 'bg-burst-warning/15 text-burst-warning border-burst-warning/40',
      label: 'Pendência',
    };
  }
  return {
    icon: Info,
    border: 'border-burst-orange/40',
    bg: 'bg-burst-orange/5',
    iconCls: 'text-burst-orange-bright',
    badge: 'bg-burst-orange/15 text-burst-orange-bright border-burst-orange/40',
    label: 'Info',
  };
}

function fmtTime(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return `há ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `há ${hr}h`;
  return new Date(ms).toLocaleString('pt-BR');
}

interface SectionMeta {
  key: NotificationLevel;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: string;
  bg: string;
}

const SECTIONS: SectionMeta[] = [
  {
    key: 'error',
    title: 'Erros Críticos',
    description: 'Integrações com falha que impedem o funcionamento normal.',
    icon: AlertCircle,
    accent: 'text-red-400',
    bg: 'border-red-500/30 bg-red-500/[0.03]',
  },
  {
    key: 'warning',
    title: 'Pendências',
    description: 'Itens que precisam de ação — não param o app, mas afetam métricas.',
    icon: AlertTriangle,
    accent: 'text-burst-warning',
    bg: 'border-burst-warning/30 bg-burst-warning/[0.03]',
  },
  {
    key: 'info',
    title: 'Informativos',
    description: 'Avisos gerais sobre o sistema.',
    icon: Info,
    accent: 'text-burst-orange-bright',
    bg: 'border-burst-orange/30 bg-burst-orange/[0.03]',
  },
];

export function Notificacoes() {
  const { notifications, dismiss, clear } = useNotifications();
  const user = useUser();
  const isAdmin = hasFullAccess(user);

  // Agrupa por level — cada grupo vira uma seção visualmente separada.
  const grouped = useMemo(() => {
    const sorted = [...notifications].sort((a, b) => b.lastSeen - a.lastSeen);
    return {
      error: sorted.filter((n) => n.level === 'error'),
      warning: sorted.filter((n) => n.level === 'warning'),
      info: sorted.filter((n) => n.level === 'info'),
    };
  }, [notifications]);

  const totalAtivas = notifications.length;
  const counts = {
    error: grouped.error.length,
    warning: grouped.warning.length,
    info: grouped.info.length,
  };

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1100px] mx-auto">
      {/* Painel de uso do Supabase — apenas pra admins */}
      {isAdmin && <SupabaseUsagePanel />}

      {/* Header com contagens agregadas + ação de limpar tudo */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap text-xs text-burst-muted">
          <span className="text-white font-semibold">{totalAtivas}</span>
          notificação(ões) ativa(s)
          {counts.error > 0 && (
            <span className="px-2 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-400 font-semibold">
              {counts.error} crítico(s)
            </span>
          )}
          {counts.warning > 0 && (
            <span className="px-2 py-0.5 rounded border border-burst-warning/40 bg-burst-warning/10 text-burst-warning font-semibold">
              {counts.warning} pendência(s)
            </span>
          )}
          {counts.info > 0 && (
            <span className="px-2 py-0.5 rounded border border-burst-orange/40 bg-burst-orange/10 text-burst-orange-bright font-semibold">
              {counts.info} info
            </span>
          )}
        </div>
        {totalAtivas > 0 && (
          <button
            onClick={clear}
            className="text-xs px-3 py-1.5 rounded-md border border-burst-border text-burst-muted hover:bg-white/5 hover:text-white transition-colors"
          >
            Limpar tudo
          </button>
        )}
      </div>

      {totalAtivas === 0 ? (
        <div className="rounded-2xl border border-burst-border bg-burst-card p-12 text-center">
          <BellOff size={32} className="text-burst-muted mx-auto mb-3" />
          <div className="text-white font-display text-xl mb-1">Tudo certo</div>
          <p className="text-sm text-burst-muted">
            Nenhuma notificação ativa. Erros de integração e pendências de vínculo aparecem aqui automaticamente.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {SECTIONS.map((section) => {
            const items = grouped[section.key];
            if (items.length === 0) return null;
            return (
              <NotificationSection
                key={section.key}
                meta={section}
                items={items}
                onDismiss={dismiss}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotificationSection({
  meta,
  items,
  onDismiss,
}: {
  meta: SectionMeta;
  items: Notification[];
  onDismiss: (id: string) => void;
}) {
  const SectionIcon = meta.icon;
  return (
    <section className={`rounded-2xl border ${meta.bg} p-4 lg:p-5 flex flex-col gap-3`}>
      <header className="flex items-center gap-3 pb-2 border-b border-burst-border/60">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${meta.accent} bg-white/[0.04]`}>
          <SectionIcon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className={`font-display text-lg tracking-wide ${meta.accent}`}>{meta.title}</h2>
            <span className="text-[11px] text-burst-muted font-mono">
              {items.length} {items.length === 1 ? 'item' : 'itens'}
            </span>
          </div>
          <p className="text-[11px] text-burst-muted leading-snug mt-0.5">{meta.description}</p>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        {items.map((n) => (
          <NotificationCard key={n.id} notif={n} onDismiss={onDismiss} />
        ))}
      </div>
    </section>
  );
}

function NotificationCard({
  notif,
  onDismiss,
}: {
  notif: Notification;
  onDismiss: (id: string) => void;
}) {
  const s = levelStyle(notif.level);
  const Icon = s.icon;
  return (
    <div
      className={`rounded-xl border ${s.border} ${s.bg} p-4 flex items-start gap-3 animate-slide-up`}
    >
      <Icon size={20} className={`${s.iconCls} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span
            className={`text-[10px] uppercase tracking-widest font-bold border rounded px-1.5 py-0.5 ${s.badge}`}
          >
            {s.label}
          </span>
          <span className="text-[11px] uppercase tracking-wider text-burst-muted">{notif.source}</span>
          <span className="text-[10px] text-burst-muted ml-auto">
            {fmtTime(notif.lastSeen)}
            {notif.firstSeen !== notif.lastSeen && (
              <span className="text-burst-muted/70"> · 1ª vez {fmtTime(notif.firstSeen)}</span>
            )}
          </span>
        </div>
        <div className="text-sm text-white/90 break-words">{notif.message}</div>
        {notif.detail && (
          <div className="text-xs text-burst-muted mt-1 break-words">{notif.detail}</div>
        )}
      </div>
      <button
        onClick={() => onDismiss(notif.id)}
        title="Dispensar"
        className="shrink-0 p-1 rounded text-burst-muted hover:bg-white/5 hover:text-white transition-colors"
      >
        <X size={15} />
      </button>
    </div>
  );
}

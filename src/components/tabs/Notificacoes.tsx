import { AlertCircle, AlertTriangle, Info, BellOff, X } from 'lucide-react';
import { useNotifications, type NotificationLevel } from '../../lib/notificationsContext';

function levelStyle(level: NotificationLevel) {
  if (level === 'error') {
    return {
      icon: AlertCircle,
      border: 'border-red-500/40',
      bg: 'bg-red-500/5',
      iconCls: 'text-red-400',
      badge: 'bg-red-500/15 text-red-400 border-red-500/40',
      label: 'Erro',
    };
  }
  if (level === 'warning') {
    return {
      icon: AlertTriangle,
      border: 'border-burst-warning/40',
      bg: 'bg-burst-warning/5',
      iconCls: 'text-burst-warning',
      badge: 'bg-burst-warning/15 text-burst-warning border-burst-warning/40',
      label: 'Aviso',
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

export function Notificacoes() {
  const { notifications, dismiss, clear } = useNotifications();

  // Ordena por mais recente primeiro
  const sorted = [...notifications].sort((a, b) => b.lastSeen - a.lastSeen);
  const counts = {
    error: notifications.filter((n) => n.level === 'error').length,
    warning: notifications.filter((n) => n.level === 'warning').length,
    info: notifications.filter((n) => n.level === 'info').length,
  };

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-xs text-burst-muted">
          <span className="text-white font-semibold">{notifications.length}</span> notificação(ões){' '}
          {counts.error > 0 && (
            <span className="text-red-400">• {counts.error} erro(s)</span>
          )}
          {counts.warning > 0 && (
            <span className="text-burst-warning ml-1">• {counts.warning} aviso(s)</span>
          )}
        </div>
        {notifications.length > 0 && (
          <button
            onClick={clear}
            className="text-xs px-3 py-1.5 rounded-md border border-burst-border text-burst-muted hover:bg-white/5 hover:text-white transition-colors"
          >
            Limpar tudo
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-burst-border bg-burst-card p-12 text-center">
          <BellOff size={32} className="text-burst-muted mx-auto mb-3" />
          <div className="text-white font-display text-xl mb-1">Tudo certo</div>
          <p className="text-sm text-burst-muted">
            Nenhuma notificação ativa. Erros de integração (Monday, Meta Ads, Supabase) aparecem aqui automaticamente.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((n) => {
            const s = levelStyle(n.level);
            const Icon = s.icon;
            return (
              <div
                key={n.id}
                className={`rounded-xl border ${s.border} ${s.bg} p-4 flex items-start gap-3 animate-slide-up`}
              >
                <Icon size={20} className={`${s.iconCls} shrink-0 mt-0.5`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-[10px] uppercase tracking-widest font-bold border rounded px-1.5 py-0.5 ${s.badge}`}>
                      {s.label}
                    </span>
                    <span className="text-[11px] uppercase tracking-wider text-burst-muted">
                      {n.source}
                    </span>
                    <span className="text-[10px] text-burst-muted ml-auto">
                      {fmtTime(n.lastSeen)}
                      {n.firstSeen !== n.lastSeen && (
                        <span className="text-burst-muted/70"> · 1ª vez {fmtTime(n.firstSeen)}</span>
                      )}
                    </span>
                  </div>
                  <div className="text-sm text-white/90 break-words">{n.message}</div>
                  {n.detail && (
                    <div className="text-xs text-burst-muted mt-1 font-mono break-all">{n.detail}</div>
                  )}
                </div>
                <button
                  onClick={() => dismiss(n.id)}
                  title="Dispensar"
                  className="shrink-0 p-1 rounded text-burst-muted hover:bg-white/5 hover:text-white transition-colors"
                >
                  <X size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

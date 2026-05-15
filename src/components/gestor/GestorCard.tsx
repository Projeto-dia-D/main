import { MessageCircle, DollarSign, ArrowDownRight, Circle } from 'lucide-react';
import type { GestorMetrics } from '../../lib/gestorMetrics';
import { tierColorCpt, brl } from '../../lib/gestorMetrics';
import { AnimatedNumber } from '../AnimatedNumber';

interface Props {
  gestor: GestorMetrics;
  onClick?: () => void;
  onClickMensagens?: () => void;
  onClickTransferencias?: () => void;
  onClickSpend?: () => void;
}

export function GestorCard({
  gestor,
  onClick,
  onClickMensagens,
  onClickTransferencias,
  onClickSpend,
}: Props) {
  const colors = tierColorCpt(gestor.tier);
  const status = gestor.totalTransferencias > 0
    ? { label: 'ATIVO', cls: 'bg-green-500/15 text-green-400 border-green-500/40', dot: 'bg-green-400' }
    : { label: 'SEM TRANSF.', cls: 'bg-burst-warning/15 text-burst-warning border-burst-warning/40', dot: 'bg-burst-warning' };

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={[
        'rounded-2xl bg-burst-card border p-5 flex flex-col gap-4 animate-slide-up transition-all',
        onClick
          ? 'cursor-pointer hover:translate-y-[-2px] hover:border-burst-orange focus:outline-none focus:ring-2 focus:ring-burst-orange/50'
          : 'hover:translate-y-[-2px]',
        colors.border,
        colors.glow,
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-display text-xl text-white tracking-wide truncate">
            {gestor.gestor}
          </h4>
          <div
            className={`inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold border ${status.cls}`}
          >
            <Circle size={6} className={`fill-current ${status.dot}`} />
            {status.label}
          </div>
        </div>
      </div>

      <div className="flex items-baseline gap-2">
        <span className={`font-display text-4xl leading-none ${colors.text}`}>
          {gestor.cpt === null ? '—' : brl(gestor.cpt)}
        </span>
        <span className="text-xs text-burst-muted">CPT</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <StatBox
          icon={<MessageCircle size={11} />}
          label="Mensagens"
          onClick={onClickMensagens}
        >
          <AnimatedNumber value={gestor.totalMensagens} className="font-display text-xl text-white" />
        </StatBox>
        <StatBox
          icon={<ArrowDownRight size={11} />}
          label="Transf."
          onClick={onClickTransferencias}
        >
          <AnimatedNumber
            value={gestor.totalTransferencias}
            className="font-display text-xl text-burst-orange-bright"
          />
        </StatBox>
        <StatBox
          icon={<DollarSign size={11} />}
          label="Spend"
          onClick={onClickSpend}
        >
          <span className="font-display text-lg text-white truncate">
            {brl(gestor.totalSpend)}
          </span>
        </StatBox>
      </div>

      <div className="border-t border-burst-border pt-3" onClick={(e) => e.stopPropagation()}>
        <div className="text-[11px] uppercase tracking-widest text-burst-muted mb-2">
          Clientes do gestor
        </div>
        {gestor.clients.length === 0 ? (
          <div className="text-burst-muted text-xs">Nenhum cliente atribuído.</div>
        ) : (
          <ul className="flex flex-col gap-1 max-h-44 overflow-y-auto scrollbar-thin pr-1">
            {gestor.clients.slice(0, 12).map((cm) => (
              <li
                key={cm.client.id}
                className={[
                  'flex items-center gap-2 text-xs px-2 py-1 rounded bg-black/20',
                  cm.inactive ? 'opacity-50' : '',
                ].join(' ')}
                title={cm.inactive ? 'Sem Bia ativa — não conta no total' : undefined}
              >
                <span className="flex-1 truncate text-white/85">{cm.client.name}</span>
                {cm.inactive && (
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-burst-warning/15 text-burst-warning border border-burst-warning/30">
                    inativo
                  </span>
                )}
                <span className="text-burst-orange-bright font-mono">
                  {cm.transferencias}
                </span>
                <span className="text-burst-muted text-[10px] font-mono">
                  {brl(cm.spend)}
                </span>
              </li>
            ))}
            {gestor.clients.length > 12 && (
              <li className="text-xs text-burst-muted text-center py-1">
                +{gestor.clients.length - 12} cliente(s)
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatBox({
  icon,
  label,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }
      }}
      className={[
        'rounded-lg bg-black/30 border border-burst-border px-3 py-2 flex flex-col transition-colors',
        onClick
          ? 'cursor-pointer hover:bg-black/50 hover:border-burst-orange/60 focus:outline-none focus:ring-1 focus:ring-burst-orange/50'
          : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-1 text-burst-muted text-[10px] uppercase tracking-wider">
        {icon} {label}
      </div>
      {children}
    </div>
  );
}

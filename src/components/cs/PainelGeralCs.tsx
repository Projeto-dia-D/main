import { TrendingDown, Headphones, DollarSign, ArrowDownRight, Clock, ChevronRight, MessageCircle, type LucideIcon } from 'lucide-react';
import { AnimatedNumber } from '../AnimatedNumber';
import { tierColorCpt, tierLabelCpt, progressToNextTierCpt, brl } from '../../lib/gestorMetrics';
import type { CsSummary } from '../../lib/csMetrics';

interface Props {
  summary: CsSummary;
  lastUpdate: Date | null;
  onOpenClientes: () => void;
  onOpenCses: () => void;
}

function formatRelative(d: Date | null): string {
  if (!d) return '—';
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 5) return 'agora mesmo';
  if (sec < 60) return `há ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const hr = Math.floor(min / 60);
  return `há ${hr}h`;
}

export function PainelGeralCs({ summary, lastUpdate, onOpenClientes, onOpenCses }: Props) {
  const colors = tierColorCpt(summary.tier);
  const prog = progressToNextTierCpt(summary.cptGeral);

  return (
    <section
      className={[
        'rounded-2xl border bg-burst-card p-8 relative overflow-hidden animate-slide-up',
        colors.border,
        colors.glow,
      ].join(' ')}
    >
      <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-burst-orange/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-burst-orange/5 blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between mb-6 relative">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-burst-muted">Painel Geral</div>
          <h2 className="font-display text-4xl text-white tracking-wider flex items-center gap-3">
            CS — CUSTO POR TRANSFERÊNCIA <Headphones className="text-burst-orange" />
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-burst-muted">
          <Clock size={14} />
          <span>Atualizado {formatRelative(lastUpdate)}</span>
          <span className="w-2 h-2 rounded-full bg-burst-orange animate-pulse" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative">
        <div className="lg:col-span-2 flex flex-col items-start justify-center">
          <div className="flex items-baseline gap-4 flex-wrap">
            {summary.cptGeral === null ? (
              <span className="font-display text-[5rem] leading-none text-burst-muted">—</span>
            ) : (
              <span className={`font-display text-[5rem] leading-none ${colors.text} drop-shadow-[0_0_30px_rgba(255,107,0,0.4)]`}>
                {brl(summary.cptGeral)}
              </span>
            )}
            <div className={`px-4 py-2 rounded-lg border ${colors.border} ${colors.bg}`}>
              <div className={`font-display text-2xl tracking-wider ${colors.text}`}>
                {tierLabelCpt(summary.tier)}
                {summary.tier === 1 && ' 🔥'}
              </div>
            </div>
          </div>

          <div className="w-full mt-6">
            <div className="flex justify-between items-center text-xs text-burst-muted mb-2">
              <span>Progresso {prog.nextLabel}</span>
              <span>
                {prog.remaining > 0
                  ? `${brl(prog.remaining)} para baixar`
                  : summary.cptGeral === null ? '—' : 'meta atingida'}
              </span>
            </div>
            <div className="h-3 w-full bg-black/40 rounded-full overflow-hidden border border-burst-border">
              <div
                className="h-full bg-gradient-to-r from-burst-orange to-burst-orange-bright transition-all duration-700 ease-out"
                style={{ width: `${prog.pctOfBar}%` }}
              />
            </div>
            <div className="text-[11px] text-burst-muted mt-2">
              Considerando <span className="text-white font-semibold">{summary.clientesConsiderados}</span> cliente(s) vinculados a contas Meta de{' '}
              <span className="text-white font-semibold">{summary.clientesTotal}</span> totais.
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <StatCardCurrency icon={DollarSign} label="Investido (Fim/Venda)" value={summary.totalSpend} accent />
          <StatCardNum icon={ArrowDownRight} label="Transferências" value={summary.totalTransferencias} accent onClick={onOpenClientes} />
          <StatCardNum icon={MessageCircle} label="Mensagens" value={summary.totalMensagens} />
          <StatCardNum icon={Headphones} label="CSs ativos" value={summary.cses.length} onClick={onOpenCses} />
        </div>
      </div>
    </section>
  );
}

function StatCardNum({
  icon: Icon,
  label,
  value,
  accent,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  accent?: boolean;
  onClick?: () => void;
}) {
  const interactive = !!onClick;
  return (
    <button
      onClick={onClick}
      disabled={!interactive}
      className={[
        'group rounded-xl bg-black/30 border border-burst-border p-3 flex items-center gap-3 text-left transition-all',
        interactive ? 'hover:border-burst-orange/50 hover:bg-black/50 hover:shadow-orange-glow-sm cursor-pointer' : 'cursor-default',
      ].join(' ')}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent ? 'bg-burst-orange/20 text-burst-orange-bright' : 'bg-white/5 text-burst-muted'}`}>
        <Icon size={16} />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-burst-muted">{label}</span>
        <AnimatedNumber value={value} className="font-display text-2xl text-white" />
      </div>
      {interactive && (
        <ChevronRight size={16} className="text-burst-muted group-hover:text-burst-orange-bright transition-colors" />
      )}
    </button>
  );
}

function StatCardCurrency({ icon: Icon, label, value, accent }: { icon: LucideIcon; label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-black/30 border border-burst-border p-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent ? 'bg-burst-orange/20 text-burst-orange-bright' : 'bg-white/5 text-burst-muted'}`}>
        <Icon size={16} />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-burst-muted">{label}</span>
        <span className="font-display text-xl text-white truncate">{brl(value)}</span>
      </div>
    </div>
  );
}

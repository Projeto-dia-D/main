import { TrendingDown, DollarSign, ArrowDownRight, MessageCircle } from 'lucide-react';
import { AnimatedNumber } from '../AnimatedNumber';
import { tierColorCpt, tierLabelCpt, progressToNextTierCpt, brl } from '../../lib/gestorMetrics';
import type { CsMetrics } from '../../lib/csMetrics';

interface Props {
  cs: CsMetrics;
}

export function PainelMiniCs({ cs }: Props) {
  const colors = tierColorCpt(cs.tier);
  const prog = progressToNextTierCpt(cs.cpt);

  return (
    <section
      className={[
        'rounded-2xl border bg-burst-card p-5 relative overflow-hidden animate-slide-up transition-all hover:translate-y-[-2px]',
        colors.border,
        colors.glow,
      ].join(' ')}
    >
      <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-burst-orange/5 blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between mb-3 relative">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-burst-muted">CS</div>
          <h3 className="font-display text-2xl text-white tracking-wide truncate flex items-center gap-2">
            {cs.cs}
            <TrendingDown size={16} className={colors.text} />
          </h3>
        </div>
        <div className={`px-2 py-1 rounded-md border text-[10px] uppercase tracking-wider font-bold ${colors.border} ${colors.bg} ${colors.text}`}>
          {tierLabelCpt(cs.tier)}
        </div>
      </div>

      <div className="flex items-baseline gap-2 mb-3 relative">
        {cs.cpt === null ? (
          <span className="font-display text-4xl leading-none text-burst-muted">—</span>
        ) : (
          <span className={`font-display text-4xl leading-none ${colors.text}`}>{brl(cs.cpt)}</span>
        )}
        <span className="text-xs text-burst-muted">CPT</span>
      </div>

      <div className="w-full mb-3">
        <div className="flex justify-between items-center text-[10px] text-burst-muted mb-1">
          <span className="truncate">{prog.nextLabel}</span>
          <span className="shrink-0">
            {prog.remaining > 0 && cs.cpt !== null
              ? `${brl(prog.remaining)} ↓`
              : cs.cpt === null
              ? ''
              : '✓'}
          </span>
        </div>
        <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden border border-burst-border">
          <div
            className="h-full bg-gradient-to-r from-burst-orange to-burst-orange-bright transition-all duration-700"
            style={{ width: `${prog.pctOfBar}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MiniStat icon={<DollarSign size={11} />} label="Investido" value={brl(cs.totalSpend)} accent />
        <MiniStatNum icon={<ArrowDownRight size={11} />} label="Transf." value={cs.totalTransferencias} accent />
        <MiniStatNum icon={<MessageCircle size={11} />} label="Mensagens" value={cs.totalMensagens} />
      </div>
    </section>
  );
}

function MiniStat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-black/30 border border-burst-border px-2 py-1.5 flex flex-col">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
        {icon} {label}
      </div>
      <span className={`font-display text-base truncate ${accent ? 'text-burst-orange-bright' : 'text-white'}`}>{value}</span>
    </div>
  );
}

function MiniStatNum({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-black/30 border border-burst-border px-2 py-1.5 flex flex-col">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
        {icon} {label}
      </div>
      <AnimatedNumber value={value} className={`font-display text-base ${accent ? 'text-burst-orange-bright' : 'text-white'}`} />
    </div>
  );
}

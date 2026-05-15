import { Palette, CheckCircle2, RefreshCw, Users, Clock, ChevronRight, type LucideIcon } from 'lucide-react';
import { AnimatedNumber } from '../AnimatedNumber';
import { pctManutColors, pctLabel } from '../../lib/designMetrics';
import type { DesignSummary } from '../../lib/designMetrics';

interface Props {
  summary: DesignSummary;
  lastUpdate: Date | null;
  onOpenFeitos: () => void;
  onOpenManutencoes: () => void;
  onOpenDesigners: () => void;
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

export function PainelGeralDesign({ summary, lastUpdate, onOpenFeitos, onOpenManutencoes, onOpenDesigners }: Props) {
  const colors = pctManutColors(summary.pctManutencao);

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
            DESIGN — % MANUTENÇÃO <Palette className="text-burst-orange" />
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
            <AnimatedNumber
              value={summary.pctManutencao}
              decimals={1}
              suffix="%"
              className={`font-display text-[7rem] leading-none ${colors.text} drop-shadow-[0_0_30px_rgba(255,107,0,0.35)]`}
            />
            <div className={`px-4 py-2 rounded-lg border ${colors.border} ${colors.bg}`}>
              <div className={`font-display text-2xl tracking-wider ${colors.text}`}>
                {pctLabel(summary.pctManutencao)}
              </div>
            </div>
          </div>
          <div className="mt-3 text-xs text-burst-muted space-y-1">
            <div>
              <span className="text-white font-semibold">{summary.manutencoesUnicas}</span> demanda(s) tiveram manutenção entre{' '}
              <span className="text-white font-semibold">{summary.feitasUnicas}</span> demanda(s) única(s) em{' '}
              <span className="text-white font-semibold">{summary.diasNoPeriodo}</span> dia(s) •{' '}
              <span className="text-burst-orange-bright font-semibold">
                {(summary.totalEventosFeito / summary.diasNoPeriodo).toFixed(1)} entregas/dia
              </span>{' '}
              (equipe inteira)
            </div>
            <div className="text-burst-muted/70">
              <span className="text-white/80">{summary.totalEventosFeito}</span> entregas totais
              {summary.totalEventosFeito !== summary.feitasUnicas && (
                <span className="text-burst-muted/60"> (incluindo {summary.totalEventosFeito - summary.feitasUnicas} re-marcações pós-manutenção)</span>
              )}
              {' • '}
              <span className="text-white/80">{summary.totalEventosManutencao + summary.totalEventosManutencaoC}</span> eventos de manutenção
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <StatCard
            icon={CheckCircle2}
            label="Entregas (eventos Feito)"
            value={summary.totalEventosFeito}
            sublabel={`${summary.feitasUnicas} demandas únicas`}
            accent
            onClick={onOpenFeitos}
          />
          <StatCard
            icon={RefreshCw}
            label="Manutenções (eventos)"
            value={summary.totalEventosManutencao + summary.totalEventosManutencaoC}
            sublabel={`${summary.manutencoesUnicas} demandas únicas afetadas`}
            onClick={onOpenManutencoes}
          />
          <StatCard
            icon={Users}
            label="Designers ativos"
            value={summary.designers.length}
            onClick={onOpenDesigners}
          />
        </div>
      </div>
    </section>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
  accent,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  sublabel?: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group rounded-xl bg-black/30 border border-burst-border p-4 flex items-center gap-3 text-left transition-all hover:border-burst-orange/50 hover:bg-black/50 hover:shadow-orange-glow-sm cursor-pointer"
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accent ? 'bg-burst-orange/20 text-burst-orange-bright' : 'bg-white/5 text-burst-muted'}`}>
        <Icon size={18} />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-[11px] uppercase tracking-wider text-burst-muted">{label}</span>
        <AnimatedNumber value={value} className="font-display text-3xl text-white" />
        {sublabel && (
          <span className="text-[10px] text-burst-muted/70">{sublabel}</span>
        )}
      </div>
      <ChevronRight size={18} className="text-burst-muted group-hover:text-burst-orange-bright transition-colors" />
    </button>
  );
}

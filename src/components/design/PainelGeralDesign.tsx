import { Palette, CheckCircle2, RefreshCw, Users, Clock, ChevronRight, Zap, Trophy, type LucideIcon } from 'lucide-react';
import { AnimatedNumber } from '../AnimatedNumber';
import {
  pctManutColors,
  pctLabel,
  tierColor,
  tierForDemandasDia,
  tierForPctManutencao,
  tierLabel,
  formatBonusTotal,
} from '../../lib/designMetrics';
import type { DesignSummary } from '../../lib/designMetrics';
import type { SalaryTier } from '../../lib/types';

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
  const colorsManut = pctManutColors(summary.pctManutencao);

  // Entregas por dia POR DESIGNER (média) — mesma escala usada nos cards
  // individuais, pra que o tier (0 / 0,5 / 1) corresponda ao do designer.
  // Fórmula: total / dias úteis / qtd designers ativos
  const designersCount = summary.designers.length;
  const entregasDiaEquipe = summary.diasNoPeriodo > 0
    ? summary.totalEventosFeito / summary.diasNoPeriodo
    : 0;
  const entregasDiaPorDesigner = designersCount > 0
    ? entregasDiaEquipe / designersCount
    : 0;

  const tierDem = tierForDemandasDia(entregasDiaPorDesigner);
  const colorsDem = tierColor(tierDem);
  // tier de manutenção igual ao card do designer: só conta se há entregas
  const tierMan: SalaryTier = summary.feitasUnicas > 0
    ? tierForPctManutencao(summary.pctManutencao)
    : 0;

  // BÔNUS DO PERÍODO — regra "vence o menor" (igual cada designer).
  const tierGeral = (Math.min(tierDem, tierMan) as SalaryTier);
  const colorsGeral = tierColor(tierGeral);

  return (
    <section
      className={[
        'rounded-2xl border bg-burst-card p-8 relative overflow-hidden animate-slide-up',
        colorsGeral.border,
        colorsGeral.glow,
      ].join(' ')}
    >
      <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-burst-orange/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-burst-orange/5 blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between mb-6 relative">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-burst-muted">Painel Geral</div>
          <h2 className="font-display text-4xl text-white tracking-wider flex items-center gap-3">
            DESIGN — DESEMPENHO <Palette className="text-burst-orange" />
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-burst-muted">
          <Clock size={14} />
          <span>Atualizado {formatRelative(lastUpdate)}</span>
          <span className="w-2 h-2 rounded-full bg-burst-orange animate-pulse" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative">
        <div className="lg:col-span-2 flex flex-col gap-4 justify-center">
          {/* BANNER DO BÔNUS DO PERÍODO — destaque grande, vence o menor tier */}
          <div
            className={`rounded-xl border-2 ${colorsGeral.border} ${colorsGeral.bg} ${colorsGeral.glow} px-5 py-3 flex items-center justify-between gap-4 flex-wrap`}
          >
            <div className="flex items-center gap-3">
              <Trophy size={28} className={colorsGeral.text} />
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-burst-muted">
                  Bônus do período (regra: vence o menor)
                </div>
                <div className={`font-display text-3xl tracking-wider ${colorsGeral.text}`}>
                  {formatBonusTotal(tierGeral)}
                </div>
              </div>
            </div>
            <div className="text-[11px] text-burst-muted text-right">
              <div>
                Demandas/dia: <span className={`font-bold ${colorsDem.text}`}>{tierLabel(tierDem)}</span>
              </div>
              <div>
                % Manutenção: <span className={`font-bold ${colorsManut.text}`}>{tierLabel(tierMan)}</span>
              </div>
            </div>
          </div>

          {/* DUAS métricas lado a lado: ENTREGAS/DIA (destaque maior) + % MANUTENÇÃO */}
          <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr] gap-4">
            {/* ENTREGAS/DIA POR DESIGNER — PRINCIPAL (peso maior) */}
            <div className={`rounded-xl border-2 ${colorsDem.border} ${colorsDem.bg} p-5 flex flex-col`}>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-burst-muted">
                <Zap size={12} className={colorsDem.text} /> Demandas/dia (média/designer)
              </div>
              <div className="flex items-baseline gap-3 flex-wrap mt-1">
                <AnimatedNumber
                  value={entregasDiaPorDesigner}
                  decimals={1}
                  className={`font-display text-[7rem] leading-none ${colorsDem.text} drop-shadow-[0_0_30px_rgba(34,197,94,0.25)]`}
                />
                <div className={`px-3 py-1 rounded-md border ${colorsDem.border} ${colorsDem.bg}`}>
                  <div className={`font-display text-xl tracking-wider ${colorsDem.text}`}>
                    {tierLabel(tierDem)}
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-burst-muted mt-2">
                <span className="text-white font-semibold">{summary.totalEventosFeito}</span> entregas
                {' ÷ '}
                <span className="text-white font-semibold">{summary.diasNoPeriodo}</span> dia(s) úteis
                {' ÷ '}
                <span className="text-white font-semibold">{designersCount}</span> designer(s) ativo(s)
                {' • equipe inteira: '}
                <span className="text-white/85">{entregasDiaEquipe.toFixed(1)}/dia</span>
              </div>
            </div>

            {/* % MANUTENÇÃO — SECUNDÁRIO (peso menor) */}
            <div className={`rounded-xl border ${colorsManut.border} ${colorsManut.bg} p-4 flex flex-col`}>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-burst-muted">
                <RefreshCw size={11} className={colorsManut.text} /> % Manutenção
              </div>
              <AnimatedNumber
                value={summary.pctManutencao}
                decimals={1}
                suffix="%"
                className={`font-display text-[4rem] leading-none ${colorsManut.text} mt-1`}
              />
              <div className={`inline-flex self-start mt-1 px-2 py-0.5 rounded border ${colorsManut.border} ${colorsManut.bg}`}>
                <span className={`text-[11px] uppercase tracking-wider font-bold ${colorsManut.text}`}>
                  {pctLabel(summary.pctManutencao)}
                </span>
              </div>
              <div className="text-[11px] text-burst-muted mt-2">
                <span className="text-white font-semibold">{summary.manutencoesUnicas}</span> demanda(s) afetada(s)
                {' / '}
                <span className="text-white font-semibold">{summary.feitasUnicas}</span> únicas
              </div>
            </div>
          </div>

          <div className="text-[11px] text-burst-muted/70">
            <span className="text-white/80">{summary.totalEventosManutencao + summary.totalEventosManutencaoC}</span> eventos
            de manutenção no período
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

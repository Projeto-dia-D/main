import { useMemo } from 'react';
import {
  Trophy,
  TrendingUp,
  AlertTriangle,
  Users,
  CheckCircle2,
  Activity,
  Award,
  Sparkles,
  Calendar,
} from 'lucide-react';
import {
  tierColor,
  tierLabel,
  progressToNextTier,
} from '../../lib/metrics';
import type { MetricsSummary, DoutorMetrics } from '../../lib/types';
import { AnimatedNumber } from '../AnimatedNumber';

interface Props {
  /** Nome do programador (scope do user). */
  nomeProgramador: string;
  /** Summary FILTRADO pelos doutores do programador. */
  summary: MetricsSummary;
  /** Summary COMPLETO (todos doutores) — pra calcular ranking entre programadores. */
  fullSummary: MetricsSummary;
}

/**
 * Dashboard PERSONALIZADO de um programador.
 * O scope do programador é "todos os doutores cujo cliente Monday tem ele
 * como Programador" — e quem filtra os leads é o `useMemo` da Programacao
 * antes de chamar `computeMetrics`. Logo, o summary que chega aqui já vem
 * com `doutores`/`activeLeads` filtrado.
 *
 * Mostra:
 *  - hero card com taxa, total leads, total transf., comparação vs média geral
 *  - melhores doutores (top por taxa, mínimo 5 leads)
 *  - piores doutores (taxa baixa com volume relevante)
 */
export function PerfilPessoalProgramador({
  nomeProgramador,
  summary,
  fullSummary,
}: Props) {
  const colors = tierColor(summary.tier);
  const prog = progressToNextTier(summary.taxaGeral);

  // Comparação: minha taxa vs taxa geral da agência
  const sectorTaxa = fullSummary.taxaGeral;
  const taxaDelta = useMemo(() => {
    return summary.taxaGeral - sectorTaxa;
  }, [summary.taxaGeral, sectorTaxa]);

  const { melhores, piores } = useMemo(() => {
    const elegiveis = summary.doutores.filter((d) => d.totalLeads >= 5);

    const melhores = [...elegiveis]
      .sort((a, b) => b.taxa - a.taxa || b.totalTransferidos - a.totalTransferidos)
      .slice(0, 5);

    const piores = [...elegiveis]
      .sort((a, b) => a.taxa - b.taxa || b.totalLeads - a.totalLeads)
      .filter((d) => d.taxa < 16) // abaixo de 0,5 salário
      .slice(0, 5);

    return { melhores, piores };
  }, [summary.doutores]);

  return (
    <div className="flex flex-col gap-5">
      {/* === HERO === */}
      <section
        className={[
          'rounded-2xl border bg-burst-card p-7 relative overflow-hidden animate-slide-up',
          colors.border,
          colors.glow,
        ].join(' ')}
      >
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-burst-orange/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-burst-orange/5 blur-3xl pointer-events-none" />

        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={14} className="text-burst-orange-bright" />
              <span className="text-[10px] uppercase tracking-[0.3em] text-burst-muted">
                Seu painel
              </span>
            </div>
            <h2 className="font-display text-4xl text-white tracking-wide truncate">
              {nomeProgramador}
            </h2>
            <div className="text-xs text-burst-muted mt-1">
              {summary.doutores.length} doutor(es) sob sua programação
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div
              className={`px-3 py-1.5 rounded-md border text-xs uppercase tracking-wider font-bold ${colors.border} ${colors.bg} ${colors.text}`}
            >
              {tierLabel(summary.tier)}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-burst-muted">
              <Award size={13} className="text-burst-orange-bright" />
              <span>
                {summary.totalLeads} lead(s) no período
              </span>
            </div>
          </div>
        </div>

        {/* Taxa gigante */}
        <div className="relative mt-6 flex items-end gap-3">
          <AnimatedNumber
            value={summary.taxaGeral}
            decimals={1}
            suffix="%"
            className={`font-display text-6xl leading-none ${colors.text}`}
          />
          <div className="pb-1.5">
            <div className="text-xs uppercase tracking-wider text-burst-muted">
              Taxa de transferência
            </div>
            <div
              className={[
                'text-xs flex items-center gap-1 mt-0.5',
                taxaDelta >= 0 ? 'text-green-400' : 'text-red-400',
              ].join(' ')}
            >
              {taxaDelta >= 0 ? (
                <TrendingUp size={12} />
              ) : (
                <TrendingUp size={12} className="rotate-180" />
              )}
              {Math.abs(taxaDelta).toFixed(1)}% {taxaDelta >= 0 ? 'acima' : 'abaixo'} da média geral (
              {sectorTaxa.toFixed(1)}%)
            </div>
          </div>
        </div>

        {/* Progresso pro próximo tier */}
        <div className="relative w-full mt-5">
          <div className="flex justify-between items-center text-[10px] text-burst-muted mb-1.5">
            <span className="truncate">Progresso {prog.nextLabel}</span>
            <span className="shrink-0">
              {prog.remaining > 0
                ? `faltam ${prog.remaining.toFixed(1)}%`
                : '✓ meta atingida'}
            </span>
          </div>
          <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-burst-border">
            <div
              className="h-full bg-gradient-to-r from-burst-orange to-burst-orange-bright transition-all duration-700"
              style={{ width: `${prog.pctOfBar}%` }}
            />
          </div>
        </div>

        {/* Stats grid */}
        <div className="relative grid grid-cols-2 md:grid-cols-3 gap-3 mt-6">
          <BigStat
            icon={<Users size={14} />}
            label="Leads cadastrados"
            value={summary.totalLeads}
            tone="white"
          />
          <BigStat
            icon={<CheckCircle2 size={14} />}
            label="Transferidos"
            value={summary.totalTransferidos}
            tone="orange"
          />
          <BigStat
            icon={<Activity size={14} />}
            label="Doutores ativos"
            value={summary.doutores.length}
            tone="white"
          />
        </div>
      </section>

      {/* === MELHORES / PIORES === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <DoutoresPanel
          title="Melhores doutores"
          subtitle="Maior taxa de transferência (mín. 5 leads)"
          icon={<Trophy size={18} className="text-green-400" />}
          tone="success"
          doutores={melhores}
          emptyMsg="Ainda sem doutor com volume suficiente para ranqueamento."
        />
        <DoutoresPanel
          title="Doutores em alerta"
          subtitle="Taxa abaixo de 16% — atenção redobrada"
          icon={<AlertTriangle size={18} className="text-red-400" />}
          tone="danger"
          doutores={piores}
          emptyMsg="Todos seus doutores estão acima de 16% 🎉"
        />
      </div>
    </div>
  );
}

function BigStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'orange' | 'white';
}) {
  return (
    <div className="rounded-xl bg-black/30 border border-burst-border px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-burst-muted mb-1">
        {icon} {label}
      </div>
      <AnimatedNumber
        value={value}
        className={`font-display text-2xl ${
          tone === 'orange' ? 'text-burst-orange-bright' : 'text-white'
        }`}
      />
    </div>
  );
}

function DoutoresPanel({
  title,
  subtitle,
  icon,
  tone,
  doutores,
  emptyMsg,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  tone: 'success' | 'danger';
  doutores: DoutorMetrics[];
  emptyMsg: string;
}) {
  const borderCls =
    tone === 'success' ? 'border-green-500/40' : 'border-red-500/40';

  return (
    <section
      className={`rounded-2xl bg-burst-card border ${borderCls} p-5 animate-slide-up`}
    >
      <div className="flex items-start gap-3 mb-4">
        {icon}
        <div className="min-w-0">
          <h3 className="font-display text-xl text-white tracking-wide">{title}</h3>
          <p className="text-xs text-burst-muted mt-0.5">{subtitle}</p>
        </div>
      </div>

      {doutores.length === 0 ? (
        <div className="text-burst-muted text-sm py-4 text-center">{emptyMsg}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {doutores.map((d, idx) => (
            <DoutorRow key={d.nome} d={d} rank={idx + 1} tone={tone} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DoutorRow({
  d,
  rank,
  tone,
}: {
  d: DoutorMetrics;
  rank: number;
  tone: 'success' | 'danger';
}) {
  const rankBg =
    tone === 'success'
      ? 'bg-green-500/15 text-green-400 border-green-500/30'
      : 'bg-red-500/15 text-red-400 border-red-500/30';

  return (
    <li className="flex items-center gap-3 rounded-lg bg-black/30 border border-burst-border px-3 py-2.5 hover:bg-black/40 transition-colors">
      <span
        className={`flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold border ${rankBg}`}
      >
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate font-medium">{d.nome}</div>
        <div className="text-[11px] text-burst-muted flex items-center gap-2">
          <span>{d.totalLeads} leads</span>
          <span>•</span>
          <span>{d.totalTransferidos} transf.</span>
          {d.ultimaTransferencia && (
            <>
              <span>•</span>
              <span className="inline-flex items-center gap-0.5">
                <Calendar size={9} />
                {new Date(d.ultimaTransferencia).toLocaleDateString('pt-BR')}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div
          className={[
            'font-display text-lg',
            tone === 'success' ? 'text-green-400' : 'text-red-400',
          ].join(' ')}
        >
          {d.taxa.toFixed(1)}%
        </div>
        <div className="text-[10px] uppercase tracking-wider text-burst-muted">
          taxa
        </div>
      </div>
    </li>
  );
}

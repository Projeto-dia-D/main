import { Palette, CheckCircle2, RefreshCw, Zap, Stethoscope } from 'lucide-react';
import { AnimatedNumber } from '../AnimatedNumber';
import {
  pctManutColors,
  tierColor,
  formatBonusTotal,
} from '../../lib/designMetrics';
import type { DesignerMetrics } from '../../lib/designMetrics';

interface Props {
  designer: DesignerMetrics;
  onClick?: () => void;
}

export function PainelMiniDesigner({ designer, onClick }: Props) {
  const colorsManut = pctManutColors(designer.pctManutencao);
  const colorsDem = tierColor(designer.tierDemandas);
  // bonusTotal agora é 0 | 0.5 | 1 (Math.min dos tiers) — vence o menor.
  const colorsBonus = tierColor(designer.bonusTotal);

  return (
    <section
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={[
        'rounded-2xl border bg-burst-card p-5 relative overflow-hidden animate-slide-up transition-all',
        onClick ? 'cursor-pointer hover:translate-y-[-2px] hover:border-burst-orange' : '',
        colorsBonus.border,
        colorsBonus.glow,
      ].join(' ')}
    >
      <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-burst-orange/5 blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between mb-3 relative">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-burst-muted">Designer</div>
          <h3 className="font-display text-2xl text-white tracking-wide truncate flex items-center gap-2">
            {designer.nome}
            <Palette size={16} className={colorsBonus.text} />
          </h3>
        </div>
        <div
          className={`px-2 py-1 rounded-md border text-[10px] uppercase tracking-wider font-bold ${colorsBonus.border} ${colorsBonus.bg} ${colorsBonus.text}`}
        >
          {formatBonusTotal(designer.bonusTotal)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3 relative">
        {/* DEMANDAS/DIA */}
        <div className={`rounded-lg border ${colorsDem.border} ${colorsDem.bg} px-3 py-2`}>
          <div className="text-[9px] uppercase tracking-wider text-burst-muted flex items-center gap-1">
            <Zap size={10} /> Demandas/dia
          </div>
          <div className={`font-display text-2xl ${colorsDem.text}`}>
            {designer.demandasPorDia.toFixed(1)}
          </div>
        </div>
        {/* TAX APROV (% manutenção) */}
        <div className={`rounded-lg border ${colorsManut.border} ${colorsManut.bg} px-3 py-2`}>
          <div className="text-[9px] uppercase tracking-wider text-burst-muted flex items-center gap-1">
            <RefreshCw size={10} /> % Manutenção
          </div>
          <div className={`font-display text-2xl ${colorsManut.text}`}>
            {designer.pctManutencao.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-black/30 border border-burst-border px-2 py-1.5 flex flex-col">
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
            <CheckCircle2 size={11} /> Entregas
          </div>
          <AnimatedNumber
            value={designer.totalEventosFeito}
            className="font-display text-base text-burst-orange-bright"
          />
          <span className="text-[9px] text-burst-muted">{designer.feitasUnicas} únicas</span>
        </div>
        <div className="rounded-lg bg-black/30 border border-burst-border px-2 py-1.5 flex flex-col">
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
            <RefreshCw size={11} /> Manutenções
          </div>
          <AnimatedNumber
            value={designer.totalEventosManutencao + designer.totalEventosManutencaoC}
            className="font-display text-base text-white"
          />
          <span className="text-[9px] text-burst-muted">{designer.manutencoesUnicas} únicas</span>
        </div>
      </div>

      {designer.atestadosNoPeriodo.length > 0 && (
        <div className="mt-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-1 flex items-center gap-1.5 text-[10px]">
          <Stethoscope size={11} className="text-blue-300" />
          <span className="text-blue-300 font-bold uppercase tracking-wider">
            Atestado: -{designer.diasAtestadoNoPeriodo} dia(s)
          </span>
          <span className="text-burst-muted/70 truncate">
            ({designer.atestadosNoPeriodo.length} reg.)
          </span>
        </div>
      )}
    </section>
  );
}

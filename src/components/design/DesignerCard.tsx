import { CheckCircle2, RefreshCw, Circle, Zap, Stethoscope } from 'lucide-react';
import {
  pctManutColors,
  tierColor,
  tierLabel,
  formatBonusTotal,
} from '../../lib/designMetrics';
import type { DesignerMetrics } from '../../lib/designMetrics';
import { AnimatedNumber } from '../AnimatedNumber';

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

interface Props {
  designer: DesignerMetrics;
  onClickFeitas?: () => void;
  onClickManutencoes?: () => void;
}

export function DesignerCard({ designer, onClickFeitas, onClickManutencoes }: Props) {
  const colorsManut = pctManutColors(designer.pctManutencao);
  const colorsDem = tierColor(designer.tierDemandas);
  // bonusTotal agora é 0 | 0.5 | 1 (Math.min dos dois tiers) — vence o menor.
  const colorsBonus = tierColor(designer.bonusTotal);

  const status =
    designer.feitasUnicas > 0
      ? { label: 'ATIVO', cls: 'bg-green-500/15 text-green-400 border-green-500/40', dot: 'bg-green-400' }
      : { label: 'SEM ENTREGAS', cls: 'bg-burst-warning/15 text-burst-warning border-burst-warning/40', dot: 'bg-burst-warning' };

  return (
    <div
      className={[
        'rounded-2xl bg-burst-card border p-5 flex flex-col gap-4 animate-slide-up hover:translate-y-[-2px] transition-all',
        colorsBonus.border,
        colorsBonus.glow,
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-display text-xl text-white tracking-wide truncate">{designer.nome}</h4>
          <div className={`inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold border ${status.cls}`}>
            <Circle size={6} className={`fill-current ${status.dot}`} />
            {status.label}
          </div>
        </div>
        <div className={`text-right`}>
          <div className={`px-2.5 py-1 rounded-md border text-[10px] uppercase tracking-wider font-bold ${colorsBonus.border} ${colorsBonus.bg} ${colorsBonus.text}`}>
            BÔNUS: {formatBonusTotal(designer.bonusTotal)}
          </div>
        </div>
      </div>

      {/* Os 2 tiers */}
      <div className="grid grid-cols-2 gap-2">
        <div className={`rounded-lg border ${colorsDem.border} ${colorsDem.bg} p-3`}>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-burst-muted">
            <Zap size={11} /> Demandas/dia
          </div>
          <div className={`font-display text-2xl ${colorsDem.text}`}>
            {designer.demandasPorDia.toFixed(1)}
          </div>
          <div className={`text-[10px] uppercase tracking-wider font-bold ${colorsDem.text} mt-0.5`}>
            {tierLabel(designer.tierDemandas)}
          </div>
        </div>
        <div className={`rounded-lg border ${colorsManut.border} ${colorsManut.bg} p-3`}>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-burst-muted">
            <RefreshCw size={11} /> % Manutenção
          </div>
          <div className={`font-display text-2xl ${colorsManut.text}`}>
            {designer.pctManutencao.toFixed(1)}%
          </div>
          <div className={`text-[10px] uppercase tracking-wider font-bold ${colorsManut.text} mt-0.5`}>
            {tierLabel(designer.tierManutencao)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <button
          onClick={onClickFeitas}
          className="rounded-lg bg-black/30 border border-burst-border px-3 py-2 flex flex-col text-left hover:border-burst-orange/60 hover:bg-black/50 transition-colors"
        >
          <div className="flex items-center gap-1 text-burst-muted text-[10px] uppercase tracking-wider">
            <CheckCircle2 size={11} /> Entregas
          </div>
          <AnimatedNumber value={designer.totalEventosFeito} className="font-display text-xl text-burst-orange-bright" />
          <span className="text-[10px] text-burst-muted">{designer.feitasUnicas} demandas únicas</span>
        </button>
        <button
          onClick={onClickManutencoes}
          className="rounded-lg bg-black/30 border border-burst-border px-3 py-2 flex flex-col text-left hover:border-burst-orange/60 hover:bg-black/50 transition-colors"
        >
          <div className="flex items-center gap-1 text-burst-muted text-[10px] uppercase tracking-wider">
            <RefreshCw size={11} /> Manutenções
          </div>
          <AnimatedNumber
            value={designer.totalEventosManutencao + designer.totalEventosManutencaoC}
            className="font-display text-xl text-white"
          />
          <span className="text-[10px] text-burst-muted">{designer.manutencoesUnicas} demandas únicas</span>
        </button>
      </div>

      {/* Aviso de atestado(s) no período */}
      {designer.atestadosNoPeriodo.length > 0 && (
        <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-blue-300 font-bold">
              <Stethoscope size={12} /> Atestado no período
            </div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-blue-300">
              -{designer.diasAtestadoNoPeriodo} dia(s) úteis
            </div>
          </div>
          <ul className="flex flex-col gap-0.5 text-[10px] text-burst-muted">
            {designer.atestadosNoPeriodo.slice(0, 3).map((a) => (
              <li key={a.id} className="flex items-center gap-1">
                <span className="text-white/80">
                  {formatDateBR(a.data_inicio)}
                  {a.data_inicio !== a.data_fim && ` → ${formatDateBR(a.data_fim)}`}
                </span>
                {a.motivo && <span className="text-burst-muted/80">• {a.motivo}</span>}
              </li>
            ))}
            {designer.atestadosNoPeriodo.length > 3 && (
              <li className="text-burst-muted/60">+{designer.atestadosNoPeriodo.length - 3} mais...</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

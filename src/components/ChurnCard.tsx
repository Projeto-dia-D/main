import { UserMinus, Info } from 'lucide-react';
import { useMemo } from 'react';
import type { MondayClient } from '../lib/monday';
import type { DateRange } from '../lib/metrics';
import { computeChurn, churnColors } from '../lib/churn';

interface Props {
  clientsAll: MondayClient[];
  range: DateRange;
}

/**
 * Card do CHURN da empresa (número único, o mesmo pra gestor/CS/programação).
 * Lido dos grupos do Monday. INFORMATIVO — não entra no bônus por enquanto.
 */
export function ChurnCard({ clientsAll, range }: Props) {
  const churn = useMemo(() => computeChurn(clientsAll, range), [clientsAll, range]);
  const cores = churnColors(churn.churnPct);

  const periodoLabel =
    churn.meses.length === 0
      ? '—'
      : churn.meses.length === 1
        ? churn.meses[0].label
        : `${churn.meses[0].label} → ${churn.meses[churn.meses.length - 1].label}`;

  return (
    <section
      className={`rounded-2xl border ${cores.border} ${cores.bg} p-5 relative overflow-hidden`}
    >
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <UserMinus size={18} className={cores.text} />
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-burst-muted">
              Churn da empresa
            </div>
            <div className="text-xs text-white/70">{periodoLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-burst-muted bg-black/30 border border-burst-border rounded px-2 py-1">
          <Info size={11} /> informativo — não entra no bônus (ainda)
        </div>
      </div>

      {!churn.temDados ? (
        <div className="text-sm text-burst-muted py-2">Carregando grupos do Monday…</div>
      ) : (
        <div className="flex items-end gap-5 flex-wrap">
          <div className="flex items-baseline gap-2">
            <span className={`font-display text-[3.5rem] leading-none ${cores.text}`}>
              {churn.churnPct === null ? '—' : churn.churnPct.toFixed(2)}
            </span>
            <span className={`font-display text-2xl ${cores.text}`}>%</span>
          </div>

          <div className="text-xs text-burst-muted flex flex-col gap-0.5 pb-1">
            <div>
              <span className="text-white font-semibold">{churn.churns}</span> churn(s)
              {' ÷ '}
              <span className="text-white font-semibold">{churn.naoChurn}</span> ativos
            </div>
            <div className="text-burst-muted/70">
              à vista {churn.breakdown.ativoVista} · normal {churn.breakdown.ativoNormal} ·
              {' '}aviso {churn.breakdown.avisoPrevio} · pausados {churn.breakdown.pausado}
            </div>
            <div className="text-[10px] text-burst-muted/50">
              faixa de referência: ≤9% ótimo · 9–13% atenção · &gt;13% crítico
            </div>
          </div>

          {churn.meses.length > 1 && (
            <div className="text-[10px] text-burst-muted/70 flex flex-col gap-0.5 pb-1">
              {churn.meses.map((m) => (
                <div key={m.label}>
                  {m.label}: <span className="text-white/80">{m.churns}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

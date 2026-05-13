import { Trophy, AlertTriangle } from 'lucide-react';
import type { DoutorMetrics } from '../../lib/types';
import { tierColor } from '../../lib/metrics';

interface Props {
  doutores: DoutorMetrics[];
}

export function RankingDoutores({ doutores }: Props) {
  if (doutores.length === 0) return null;

  const totalTransferidos = doutores.reduce((acc, d) => acc + d.totalTransferidos, 0);
  if (totalTransferidos === 0) return null;

  const sorted = [...doutores].sort((a, b) => b.taxa - a.taxa);
  const top = sorted.filter((d) => d.totalTransferidos > 0).slice(0, 5);
  const bottom = sorted
    .filter((d) => d.totalTransferidos > 0 || d.totalLeads >= 10)
    .slice(-5)
    .reverse();

  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Column
        title="Top Melhores Taxas"
        icon={<Trophy className="text-burst-orange-bright" size={20} />}
        items={top}
        variant="top"
        empty="Sem doutores ainda."
      />
      <Column
        title="Piores Taxas"
        icon={<AlertTriangle className="text-red-400" size={20} />}
        items={bottom.filter((d) => !top.includes(d))}
        variant="bottom"
        empty="—"
      />
    </section>
  );
}

function Column({
  title,
  icon,
  items,
  variant,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  items: DoutorMetrics[];
  variant: 'top' | 'bottom';
  empty: string;
}) {
  return (
    <div className="rounded-2xl bg-burst-card border border-burst-border p-6">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="font-display text-xl tracking-wider text-white">{title}</h3>
      </div>
      {items.length === 0 ? (
        <div className="text-burst-muted text-sm py-8 text-center">{empty}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((d, i) => (
            <RankingRow key={d.nome} rank={i + 1} doutor={d} variant={variant} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RankingRow({
  rank,
  doutor,
  variant,
}: {
  rank: number;
  doutor: DoutorMetrics;
  variant: 'top' | 'bottom';
}) {
  const colors = tierColor(doutor.tier);
  return (
    <li
      className={[
        'flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-black/30',
        variant === 'top' ? 'border-burst-orange/30' : 'border-red-500/20',
      ].join(' ')}
    >
      <div
        className={[
          'w-8 h-8 rounded-md flex items-center justify-center font-display text-lg',
          variant === 'top'
            ? 'bg-burst-orange/15 text-burst-orange-bright'
            : 'bg-red-500/15 text-red-400',
        ].join(' ')}
      >
        #{rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white font-semibold truncate">{doutor.nome}</div>
        <div className="text-xs text-burst-muted">
          {doutor.totalTransferidos}/{doutor.totalLeads} leads transferidos
        </div>
      </div>
      <div className="text-right">
        <div className={`font-display text-2xl ${colors.text}`}>
          {doutor.taxa.toFixed(1)}%
        </div>
        <div className="text-[10px] uppercase tracking-wider text-burst-muted">
          taxa
        </div>
      </div>
    </li>
  );
}

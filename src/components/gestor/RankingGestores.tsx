import { Trophy } from 'lucide-react';
import type { GestorMetrics } from '../../lib/gestorMetrics';
import { tierColorCpt, brl } from '../../lib/gestorMetrics';

interface Props {
  gestores: GestorMetrics[];
}

export function RankingGestores({ gestores }: Props) {
  if (gestores.length === 0) return null;

  const withData = gestores.filter((g) => g.cpt !== null);
  if (withData.length === 0) return null;

  const top = [...withData].sort((a, b) => (a.cpt as number) - (b.cpt as number)).slice(0, 5);

  return (
    <section className="rounded-2xl bg-burst-card border border-burst-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="text-burst-orange-bright" size={20} />
        <h3 className="font-display text-xl tracking-wider text-white">Top Melhores CPT</h3>
        <span className="text-xs text-burst-muted">(menor custo)</span>
      </div>

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {top.map((g, i) => (
          <RankingRow key={g.gestor} rank={i + 1} gestor={g} />
        ))}
      </ul>
    </section>
  );
}

function RankingRow({ rank, gestor }: { rank: number; gestor: GestorMetrics }) {
  const colors = tierColorCpt(gestor.tier);
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-burst-orange/30 bg-black/30">
      <div className="w-8 h-8 rounded-md flex items-center justify-center font-display text-lg bg-burst-orange/15 text-burst-orange-bright">
        #{rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white font-semibold truncate">{gestor.gestor}</div>
        <div className="text-xs text-burst-muted">
          {brl(gestor.totalSpend)} • {gestor.totalTransferencias} transf. • {gestor.clients.length} clientes
        </div>
      </div>
      <div className="text-right">
        <div className={`font-display text-2xl ${colors.text}`}>
          {gestor.cpt === null ? '—' : brl(gestor.cpt)}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-burst-muted">CPT</div>
      </div>
    </li>
  );
}

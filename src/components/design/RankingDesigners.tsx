import { Trophy, Zap, Award } from 'lucide-react';
import { pctManutColors, tierColor, tierForDemandasDia } from '../../lib/designMetrics';
import type { DesignerMetrics } from '../../lib/designMetrics';

interface Props {
  designers: DesignerMetrics[];
}

export function RankingDesigners({ designers }: Props) {
  if (designers.length === 0) return null;

  const withFeitas = designers.filter((d) => d.feitasUnicas > 0);
  if (withFeitas.length === 0) return null;

  // Qualidade: menor % manutenção — só os 3 designers ativos (Felipe, Paulo, Lais)
  const topQualidade = [...withFeitas].sort((a, b) => a.pctManutencao - b.pctManutencao).slice(0, 3);
  // Produtividade: maior demandas/dia — só os 3 ativos
  const topProdutividade = [...withFeitas].sort((a, b) => b.demandasPorDia - a.demandasPorDia).slice(0, 3);

  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Column
        title="Top Produtividade"
        subtitle="(mais demandas/dia)"
        icon={<Zap className="text-burst-orange-bright" size={20} />}
        items={topProdutividade}
        mode="produtividade"
      />
      <Column
        title="Top Qualidade"
        subtitle="(menor % manutenção)"
        icon={<Award className="text-burst-orange-bright" size={20} />}
        items={topQualidade}
        mode="qualidade"
      />
    </section>
  );
}

function Column({
  title,
  subtitle,
  icon,
  items,
  mode,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: DesignerMetrics[];
  mode: 'produtividade' | 'qualidade';
}) {
  return (
    <div className="rounded-2xl bg-burst-card border border-burst-border p-6">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="font-display text-xl tracking-wider text-white">{title}</h3>
        <span className="text-xs text-burst-muted">{subtitle}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((d, i) => (
          <RankingRow key={d.nome} rank={i + 1} designer={d} mode={mode} />
        ))}
      </ul>
    </div>
  );
}

function RankingRow({
  rank,
  designer,
  mode,
}: {
  rank: number;
  designer: DesignerMetrics;
  mode: 'produtividade' | 'qualidade';
}) {
  const colors =
    mode === 'qualidade'
      ? pctManutColors(designer.pctManutencao)
      : tierColor(tierForDemandasDia(designer.demandasPorDia));

  const mainValue =
    mode === 'qualidade'
      ? `${designer.pctManutencao.toFixed(1)}%`
      : designer.demandasPorDia.toFixed(1);
  const mainLabel = mode === 'qualidade' ? 'manut.' : '/dia';

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-burst-orange/30 bg-black/30">
      <div className="w-8 h-8 rounded-md flex items-center justify-center font-display text-lg bg-burst-orange/15 text-burst-orange-bright">
        #{rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white font-semibold truncate flex items-center gap-2">
          {designer.nome}
          {rank === 1 && <Trophy size={12} className="text-burst-orange-bright" />}
        </div>
        <div className="text-xs text-burst-muted">
          {designer.totalEventosFeito} entrega(s) •{' '}
          {designer.totalEventosManutencao + designer.totalEventosManutencaoC} manutenção(ões) •{' '}
          {designer.manutencoesUnicas} demanda(s) afetada(s)
        </div>
      </div>
      <div className="text-right">
        <div className={`font-display text-2xl ${colors.text}`}>{mainValue}</div>
        <div className="text-[10px] uppercase tracking-wider text-burst-muted">{mainLabel}</div>
      </div>
    </li>
  );
}

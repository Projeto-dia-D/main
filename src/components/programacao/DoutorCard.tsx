import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { Activity, Calendar, ArrowRightLeft, Circle, type LucideIcon } from 'lucide-react';
import type { DoutorMetrics } from '../../lib/types';
import { tierColor } from '../../lib/metrics';
import { AnimatedNumber } from '../AnimatedNumber';

interface Props {
  doutor: DoutorMetrics;
}

function fmt(iso: string | null): string {
  if (!iso) return 'nenhuma';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function statusBadge(d: DoutorMetrics) {
  if (d.status === 'ATIVO')
    return {
      label: 'ATIVO',
      cls: 'bg-green-500/15 text-green-400 border-green-500/40',
      dot: 'bg-green-400',
    };
  const semNenhuma = !d.ultimaTransferencia;
  return {
    label: semNenhuma
      ? 'SEM TRANSF.'
      : `SEM TRANSF. (${d.diasSemTransferencia}d)`,
    cls: 'bg-burst-warning/15 text-burst-warning border-burst-warning/40',
    dot: 'bg-burst-warning',
  };
}

export function DoutorCard({ doutor }: Props) {
  const colors = tierColor(doutor.tier);
  const badge = statusBadge(doutor);
  const lineColor =
    doutor.tier === 1 ? '#22C55E' : doutor.tier === 0.5 ? '#FF8C00' : '#EF4444';

  return (
    <div
      className={[
        'rounded-2xl bg-burst-card border p-5 flex flex-col gap-4 transition-all animate-slide-up hover:translate-y-[-2px]',
        colors.border,
        colors.glow,
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-display text-xl text-white tracking-wide truncate">
            {doutor.nome}
          </h4>
          <div
            className={`inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold border ${badge.cls}`}
          >
            <Circle size={6} className={`fill-current ${badge.dot}`} />
            {badge.label}
          </div>
        </div>
      </div>

      <div className="flex items-baseline gap-2">
        <AnimatedNumber
          value={doutor.taxa}
          decimals={1}
          suffix="%"
          className={`font-display text-5xl leading-none ${colors.text}`}
        />
        <span className="text-xs text-burst-muted">taxa de transferência</span>
      </div>

      <div className="h-20 -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={doutor.evolucao}>
            <YAxis hide domain={[0, 'dataMax + 5']} />
            <Tooltip
              contentStyle={{
                background: '#111',
                border: '1px solid #1f1f1f',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: '#9CA3AF' }}
              formatter={(v: number) => [`${v}%`, 'taxa']}
            />
            <Line
              type="monotone"
              dataKey="taxa"
              stroke={lineColor}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Leads" value={doutor.totalLeads} icon={Activity} />
        <Stat label="Transferidos" value={doutor.totalTransferidos} icon={Activity} accent />
      </div>

      <div className="border-t border-burst-border pt-3 space-y-1.5 text-xs text-burst-muted">
        <div className="flex items-center gap-1.5">
          <Calendar size={12} /> Último lead: <span className="text-white/80 ml-auto">{fmt(doutor.ultimoLead)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowRightLeft size={12} /> Última transf.: <span className="text-white/80 ml-auto">{fmt(doutor.ultimaTransferencia)}</span>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg bg-black/30 border border-burst-border px-3 py-2 flex items-center gap-2">
      <Icon size={14} className={accent ? 'text-burst-orange-bright' : 'text-burst-muted'} />
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-burst-muted">
          {label}
        </span>
        <AnimatedNumber
          value={value}
          className={`font-display text-xl ${accent ? 'text-burst-orange-bright' : 'text-white'}`}
        />
      </div>
    </div>
  );
}

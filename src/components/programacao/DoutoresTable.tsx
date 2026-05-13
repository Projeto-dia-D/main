import { useMemo, useState } from 'react';
import { Search, Circle } from 'lucide-react';
import type { DoutorMetrics } from '../../lib/types';
import { tierColor } from '../../lib/metrics';

interface Props {
  doutores: DoutorMetrics[];
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function statusBadge(d: DoutorMetrics) {
  if (d.status === 'ATIVO')
    return { label: 'ATIVO', cls: 'bg-green-500/15 text-green-400', dot: 'text-green-400' };
  const semNenhuma = !d.ultimaTransferencia;
  return {
    label: semNenhuma ? 'SEM TRANSF.' : `SEM TRANSF. (${d.diasSemTransferencia}d)`,
    cls: 'bg-burst-warning/15 text-burst-warning',
    dot: 'text-burst-warning',
  };
}

export function DoutoresTable({ doutores }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return doutores;
    const q = query.toLowerCase();
    return doutores.filter((d) => d.nome.toLowerCase().includes(q));
  }, [doutores, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2">
        <Search size={14} className="text-burst-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar doutor..."
          className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
        />
        <span className="text-xs text-burst-muted">
          {filtered.length} / {doutores.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-burst-border">
        <table className="w-full text-sm">
          <thead className="bg-black/40 text-[10px] uppercase tracking-widest text-burst-muted">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Status</th>
              <th className="text-left px-3 py-2 font-semibold">Doutor</th>
              <th className="text-right px-3 py-2 font-semibold">Taxa</th>
              <th className="text-right px-3 py-2 font-semibold">Leads</th>
              <th className="text-right px-3 py-2 font-semibold">Transferidos</th>
              <th className="text-left px-3 py-2 font-semibold">Último Lead</th>
              <th className="text-left px-3 py-2 font-semibold">Última Transf.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const colors = tierColor(d.tier);
              const badge = statusBadge(d);
              return (
                <tr key={d.nome} className="border-t border-burst-border hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${badge.cls}`}
                    >
                      <Circle size={6} className={`fill-current ${badge.dot}`} />
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-white font-semibold">{d.nome}</td>
                  <td className={`px-3 py-2 text-right font-display text-lg ${colors.text}`}>
                    {d.taxa.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right text-white/90 font-mono">
                    {d.totalLeads}
                  </td>
                  <td className="px-3 py-2 text-right text-green-400 font-mono font-semibold">
                    {d.totalTransferidos}
                  </td>
                  <td className="px-3 py-2 text-burst-muted text-xs whitespace-nowrap">
                    {fmt(d.ultimoLead)}
                  </td>
                  <td className="px-3 py-2 text-burst-muted text-xs whitespace-nowrap">
                    {fmt(d.ultimaTransferencia)}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-burst-muted text-sm">
                  Nenhum doutor encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { tierColorCpt, brl } from '../../lib/gestorMetrics';
import type { CsMetrics } from '../../lib/csMetrics';

interface Props {
  cses: CsMetrics[];
}

export function CsesTable({ cses }: Props) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    if (!query.trim()) return cses;
    const q = query.toLowerCase();
    return cses.filter((c) => c.cs.toLowerCase().includes(q));
  }, [cses, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2">
        <Search size={14} className="text-burst-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar CS..."
          className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
        />
        <span className="text-xs text-burst-muted">{filtered.length} / {cses.length}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-burst-border">
        <table className="w-full text-sm">
          <thead className="bg-black/40 text-[10px] uppercase tracking-widest text-burst-muted">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">CS</th>
              <th className="text-right px-3 py-2 font-semibold">Clientes</th>
              <th className="text-right px-3 py-2 font-semibold">Mensagens</th>
              <th className="text-right px-3 py-2 font-semibold">Transf.</th>
              <th className="text-right px-3 py-2 font-semibold">Spend</th>
              <th className="text-right px-3 py-2 font-semibold">CPT</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const colors = tierColorCpt(c.tier);
              return (
                <tr key={c.cs} className="border-t border-burst-border hover:bg-white/[0.02]">
                  <td className="px-3 py-2 text-white font-semibold">{c.cs}</td>
                  <td className="px-3 py-2 text-right text-white/90 font-mono">{c.clients.length}</td>
                  <td className="px-3 py-2 text-right text-white/90 font-mono">{c.totalMensagens}</td>
                  <td className="px-3 py-2 text-right text-burst-orange-bright font-mono font-semibold">{c.totalTransferencias}</td>
                  <td className="px-3 py-2 text-right text-white/90 font-mono whitespace-nowrap">{brl(c.totalSpend)}</td>
                  <td className={`px-3 py-2 text-right font-display ${colors.text}`}>
                    {c.cpt === null ? '—' : brl(c.cpt)}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-burst-muted text-sm">
                  Nenhum CS encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

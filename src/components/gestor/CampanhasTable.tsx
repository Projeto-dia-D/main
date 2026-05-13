import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CampaignInsight } from '../../lib/meta';
import { isFimVenda } from '../../lib/meta';
import { brl } from '../../lib/gestorMetrics';

interface Props {
  insights: CampaignInsight[];
}

export function CampanhasTable({ insights }: Props) {
  const [query, setQuery] = useState('');
  const [onlyFimVenda, setOnlyFimVenda] = useState(true);

  const filtered = useMemo(() => {
    let list = insights;
    if (onlyFimVenda) list = list.filter((c) => isFimVenda(c.campaign_name));
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (c) =>
          c.campaign_name.toLowerCase().includes(q) ||
          c.gestor.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => b.spend - a.spend);
  }, [insights, query, onlyFimVenda]);

  const total = filtered.reduce((s, c) => s + c.spend, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[280px] flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2">
          <Search size={14} className="text-burst-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar campanha ou gestor..."
            className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
          />
          <span className="text-xs text-burst-muted">
            {filtered.length} / {insights.length}
          </span>
        </div>
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-burst-border bg-black/30 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyFimVenda}
            onChange={(e) => setOnlyFimVenda(e.target.checked)}
            className="accent-burst-orange"
          />
          <span className="text-xs text-white">Só Fim/Venda</span>
        </label>
        <div className="px-3 py-2 rounded-lg border border-burst-orange/30 bg-burst-orange/10">
          <div className="text-[10px] uppercase tracking-wider text-burst-muted">Total filtrado</div>
          <div className="font-display text-lg text-burst-orange-bright">{brl(total)}</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-burst-border">
        <table className="w-full text-sm">
          <thead className="bg-black/40 text-[10px] uppercase tracking-widest text-burst-muted">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Campanha</th>
              <th className="text-left px-3 py-2 font-semibold">Token</th>
              <th className="text-left px-3 py-2 font-semibold">Conta Meta</th>
              <th className="text-right px-3 py-2 font-semibold">Spend</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={`${c.accountId}-${c.campaign_id}`}
                className="border-t border-burst-border hover:bg-white/[0.02]"
              >
                <td className="px-3 py-2 text-white">
                  <span className="font-medium">{c.campaign_name}</span>
                  {isFimVenda(c.campaign_name) && (
                    <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-green-500/15 text-green-400 uppercase tracking-wider">
                      fim/venda
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-white/85">{c.gestor}</td>
                <td className="px-3 py-2 text-white/75 text-xs max-w-[220px] truncate">
                  {c.accountName}
                </td>
                <td className="px-3 py-2 text-right text-white/90 font-mono whitespace-nowrap">
                  {brl(c.spend)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-burst-muted text-sm">
                  Nenhuma campanha encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

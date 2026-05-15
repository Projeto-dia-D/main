import { useMemo, useState } from 'react';
import { Search, Link2, Type, UserX } from 'lucide-react';
import type { ClientMetrics } from '../../lib/gestorMetrics';
import { brl, tierColorCpt, tierForCpt } from '../../lib/gestorMetrics';

interface Props {
  clients: ClientMetrics[];
}

export function ClientesTable({ clients }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return clients;
    const q = query.toLowerCase();
    return clients.filter(
      (c) =>
        c.client.name.toLowerCase().includes(q) ||
        (c.client.cs ?? '').toLowerCase().includes(q) ||
        (c.client.gestor ?? '').toLowerCase().includes(q) ||
        (c.doutorMatch ?? '').toLowerCase().includes(q)
    );
  }, [clients, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2">
        <Search size={14} className="text-burst-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar cliente, CS, gestor ou doutor..."
          className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
        />
        <span className="text-xs text-burst-muted">
          {filtered.length} / {clients.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-burst-border">
        <table className="w-full text-sm">
          <thead className="bg-black/40 text-[10px] uppercase tracking-widest text-burst-muted">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Cliente</th>
              <th className="text-left px-3 py-2 font-semibold">Grupo</th>
              <th className="text-left px-3 py-2 font-semibold">Gestor</th>
              <th className="text-left px-3 py-2 font-semibold">CS</th>
              <th className="text-left px-3 py-2 font-semibold">Doutor (DB)</th>
              <th className="text-center px-3 py-2 font-semibold">Vínculo</th>
              <th className="text-right px-3 py-2 font-semibold">Spend</th>
              <th className="text-right px-3 py-2 font-semibold">Transf.</th>
              <th className="text-right px-3 py-2 font-semibold">CPT</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((cm) => {
              const cptTier = tierForCpt(cm.cpt);
              const colors = tierColorCpt(cptTier);
              return (
                <tr
                  key={cm.client.id}
                  className={[
                    'border-t border-burst-border hover:bg-white/[0.02]',
                    cm.inactive ? 'opacity-60' : '',
                  ].join(' ')}
                  title={cm.inactive ? 'Sem Bia ativa — não conta no total do gestor/CS' : undefined}
                >
                  <td className="px-3 py-2 text-white font-semibold">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>{cm.client.name}</span>
                      {cm.inactive && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-burst-warning/15 text-burst-warning border border-burst-warning/30">
                          inativo
                        </span>
                      )}
                      {cm.churned && (
                        <span
                          title={
                            cm.churnCutoff
                              ? `Churn (corte: ${cm.churnCutoff.toLocaleDateString('pt-BR')})`
                              : 'Churn'
                          }
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400"
                        >
                          <UserX size={9} /> churn
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-burst-muted max-w-[180px] truncate">
                    {cm.client.groupTitle}
                  </td>
                  <td className="px-3 py-2 text-white/85">
                    {cm.client.gestor ?? <span className="text-red-400/80 italic text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2 text-white/85">
                    {cm.client.cs ?? <span className="text-burst-muted/60 italic text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2 text-white/75 text-xs">
                    {cm.doutorMatch ?? (
                      <span className="text-burst-muted/60 italic">sem match</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1.5">
                      <LinkBadge kind="supabase" via={cm.matchVia} />
                      <LinkBadge kind="meta" via={cm.metaMatchVia} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-white/90 font-mono whitespace-nowrap">
                    {brl(cm.spend)}
                  </td>
                  <td className="px-3 py-2 text-right text-burst-orange-bright font-mono font-semibold">
                    {cm.transferencias}
                  </td>
                  <td className={`px-3 py-2 text-right font-display ${colors.text}`}>
                    {cm.cpt === null ? '—' : brl(cm.cpt)}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-burst-muted text-sm">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinkBadge({
  kind,
  via,
}: {
  kind: 'supabase' | 'meta';
  via: 'token' | 'account' | 'nome' | null;
}) {
  if (!via) {
    return (
      <span
        title={kind === 'supabase' ? 'Sem vínculo com Supabase' : 'Sem vínculo Meta'}
        className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold uppercase bg-burst-muted/10 text-burst-muted/60"
      >
        {kind === 'supabase' ? 'SB' : 'MT'}
      </span>
    );
  }
  const isExplicit = via === 'token' || via === 'account';
  const Icon = isExplicit ? Link2 : Type;
  const label = isExplicit ? 'vínculo explícito (coluna Monday)' : 'match por nome (frágil)';
  const tip = `${kind === 'supabase' ? 'Supabase' : 'Meta'}: ${label}`;
  const cls = isExplicit
    ? 'bg-green-500/15 text-green-400'
    : 'bg-burst-warning/15 text-burst-warning';
  return (
    <span
      title={tip}
      className={`w-5 h-5 rounded flex items-center justify-center ${cls}`}
    >
      <Icon size={11} />
    </span>
  );
}

import { useMemo, useState } from 'react';
import { Search, CheckCircle2, XCircle } from 'lucide-react';
import type { RelatorioBias } from '../../lib/types';
import { isTransferido } from '../../lib/metrics';

interface Props {
  leads: RelatorioBias[];
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

function formatPhone(t: string): string {
  return t.replace('@s.whatsapp.net', '');
}

export function LeadsTable({ leads }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return leads;
    const q = query.toLowerCase();
    return leads.filter(
      (l) =>
        (l.telefone ?? '').toLowerCase().includes(q) ||
        (l.senderName ?? '').toLowerCase().includes(q) ||
        (l.nomeDoutor ?? '').toLowerCase().includes(q) ||
        (l.motivoTransferencia ?? '').toLowerCase().includes(q)
    );
  }, [leads, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2">
        <Search size={14} className="text-burst-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por telefone, nome, doutor ou motivo..."
          className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
        />
        <span className="text-xs text-burst-muted">
          {filtered.length} / {leads.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-burst-border">
        <table className="w-full text-sm">
          <thead className="bg-black/40 text-[10px] uppercase tracking-widest text-burst-muted">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Transf.</th>
              <th className="text-left px-3 py-2 font-semibold">Telefone</th>
              <th className="text-left px-3 py-2 font-semibold">Nome</th>
              <th className="text-left px-3 py-2 font-semibold">Cadastro</th>
              <th className="text-left px-3 py-2 font-semibold">Doutor</th>
              <th className="text-left px-3 py-2 font-semibold">Motivo</th>
              <th className="text-left px-3 py-2 font-semibold">Data Transf.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => {
              const ok = isTransferido(l);
              return (
                <tr
                  key={l.id}
                  className="border-t border-burst-border hover:bg-white/[0.02]"
                >
                  <td className="px-3 py-2">
                    {ok ? (
                      <CheckCircle2 size={16} className="text-green-400" />
                    ) : (
                      <XCircle size={16} className="text-burst-muted/60" />
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-white/90">
                    {formatPhone(l.telefone)}
                  </td>
                  <td className="px-3 py-2 text-white/80 max-w-[160px] truncate">
                    {l.senderName || '—'}
                  </td>
                  <td className="px-3 py-2 text-burst-muted text-xs whitespace-nowrap">
                    {fmt(l.dataCadastro)}
                  </td>
                  <td className="px-3 py-2 text-white/80 max-w-[180px] truncate">
                    {l.nomeDoutor || (
                      <span className="text-red-400/80 italic text-xs">sem doutor</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {l.motivoTransferencia ? (
                      <span
                        className={[
                          'inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider',
                          ok
                            ? 'bg-green-500/15 text-green-400'
                            : 'bg-burst-muted/15 text-burst-muted',
                        ].join(' ')}
                      >
                        {l.motivoTransferencia}
                      </span>
                    ) : (
                      <span className="text-burst-muted/60 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-burst-muted text-xs whitespace-nowrap">
                    {fmt(l.dataTransferencia)}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-burst-muted text-sm">
                  Nenhum lead encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

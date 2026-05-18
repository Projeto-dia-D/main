import { useMemo, useState } from 'react';
import { Search, ExternalLink } from 'lucide-react';
import type { DesignEvento } from '../../lib/designMetrics';
import { parseLogCriacaoDate, parseLogCriacaoAutor } from '../../lib/designMetrics';

interface Props {
  eventos: DesignEvento[];
}

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function extractLink(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/https?:\/\/\S+/);
  return m?.[0] ?? null;
}

const TIPO_BADGE: Record<string, { label: string; cls: string }> = {
  feito: { label: 'FEITO', cls: 'bg-green-500/15 text-green-400' },
  manutencao: { label: 'MANUT.', cls: 'bg-burst-warning/15 text-burst-warning' },
  manutencao_c: { label: 'MANUT. C', cls: 'bg-red-500/15 text-red-400' },
};

export function EventosTable({ eventos }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return eventos;
    const q = query.toLowerCase();
    return eventos.filter(
      (e) =>
        (e.nome ?? '').toLowerCase().includes(q) ||
        (e.designer_responsavel ?? '').toLowerCase().includes(q) ||
        (e.gestor_responsavel ?? '').toLowerCase().includes(q) ||
        (e.padrao_tarefa ?? '').toLowerCase().includes(q) ||
        (e.tipo_edicao ?? '').toLowerCase().includes(q)
    );
  }, [eventos, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2">
        <Search size={14} className="text-burst-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar nome, designer, gestor, padrão..."
          className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
        />
        <span className="text-xs text-burst-muted">{filtered.length} / {eventos.length}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-burst-border max-h-[60vh] overflow-y-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="bg-black/40 text-[10px] uppercase tracking-widest text-burst-muted sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Tipo</th>
              <th className="text-left px-3 py-2 font-semibold">Demanda</th>
              <th className="text-left px-3 py-2 font-semibold">Designer</th>
              <th className="text-left px-3 py-2 font-semibold">Padrão</th>
              <th className="text-left px-3 py-2 font-semibold">Tipo Edição</th>
              <th className="text-left px-3 py-2 font-semibold">Quando</th>
              <th className="text-center px-3 py-2 font-semibold">Link</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const badge = TIPO_BADGE[e.tipo_evento] ?? TIPO_BADGE.feito;
              const link = extractLink(e.link_demanda);
              const dt = parseLogCriacaoDate(e.log_criacao);
              const autor = parseLogCriacaoAutor(e.log_criacao);
              return (
                <tr key={e.id} className="border-t border-burst-border hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-white max-w-[280px] truncate">{e.nome ?? '—'}</td>
                  <td className="px-3 py-2 text-white/85">{e.designer_responsavel ?? <span className="text-burst-muted/60 italic">—</span>}</td>
                  <td className="px-3 py-2 text-white/75 text-xs">{e.padrao_tarefa ?? '—'}</td>
                  <td className="px-3 py-2 text-white/75 text-xs">{e.tipo_edicao ?? '—'}</td>
                  <td className="px-3 py-2 text-burst-muted text-xs whitespace-nowrap">
                    {fmtDate(dt)}
                    {autor && <div className="text-[10px] text-burst-muted/60">{autor}</div>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer" className="text-burst-orange-bright hover:text-burst-orange-glow inline-flex items-center">
                        <ExternalLink size={13} />
                      </a>
                    ) : (
                      <span className="text-burst-muted/40">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-burst-muted text-sm">Nenhum evento encontrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

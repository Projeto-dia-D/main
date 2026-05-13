import { useMemo, useState } from 'react';
import { Search, Zap, Turtle, Clock } from 'lucide-react';
import type { RelatorioBias } from '../../lib/types';

interface Props {
  leads: RelatorioBias[];
}

interface LeadComTempo extends RelatorioBias {
  tempoMs: number;       // null-safe: -1 se não calculável
  tempoLabel: string;
  velocidade: 'rapida' | 'media' | 'lenta';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function calcTempo(lead: RelatorioBias): number {
  if (!lead.dataCadastro || !lead.dataTransferencia) return -1;
  const ms = new Date(lead.dataTransferencia).getTime() - new Date(lead.dataCadastro).getTime();
  return ms < 0 ? -1 : ms;
}

function formatTempo(ms: number): string {
  if (ms < 0) return '—';
  const totalSeg = Math.floor(ms / 1000);
  if (totalSeg < 60) return `${totalSeg}s`;
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  if (min < 60) return seg > 0 ? `${min}m ${seg}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const minRest = min % 60;
  return minRest > 0 ? `${hr}h ${minRest}m` : `${hr}h`;
}

function velocidade(ms: number): LeadComTempo['velocidade'] {
  if (ms < 0) return 'media';
  if (ms <= 5 * 60 * 1000) return 'rapida';       // ≤ 5 min
  if (ms <= 30 * 60 * 1000) return 'media';        // ≤ 30 min
  return 'lenta';                                   // > 30 min
}

const VEL_STYLE = {
  rapida: {
    badge: 'bg-green-500/15 text-green-400 border border-green-500/30',
    row: '',
  },
  media: {
    badge: 'bg-burst-orange/15 text-burst-orange-bright border border-burst-orange/30',
    row: '',
  },
  lenta: {
    badge: 'bg-red-500/15 text-red-400 border border-red-500/30',
    row: '',
  },
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function formatPhone(t: string): string {
  return t.replace('@s.whatsapp.net', '');
}

// ─── Sub-componente: card de ranking ────────────────────────────────────────

function RankingCard({
  title, icon: Icon, leads, color, emptyMsg,
}: {
  title: string;
  icon: typeof Zap;
  leads: LeadComTempo[];
  color: string;
  emptyMsg: string;
}) {
  return (
    <div className="flex-1 rounded-xl bg-black/30 border border-burst-border p-4">
      <div className={`flex items-center gap-2 mb-3 text-xs uppercase tracking-widest font-bold ${color}`}>
        <Icon size={14} />
        {title}
      </div>
      {leads.length === 0 ? (
        <p className="text-burst-muted text-xs">{emptyMsg}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {leads.map((l, i) => (
            <li key={l.id} className="flex items-center gap-3">
              <span className={`font-display text-lg w-5 text-center shrink-0 ${color}`}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-white/90 text-sm truncate">
                  {l.senderName || formatPhone(l.telefone)}
                </div>
                <div className="text-burst-muted text-[11px] truncate">
                  {l.nomeDoutor || '—'}
                </div>
              </div>
              <span className={`font-display text-base shrink-0 ${color}`}>
                {l.tempoLabel}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export function TransferidosTable({ leads }: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'tempo_asc' | 'tempo_desc' | 'data'>('data');

  const leadsComTempo = useMemo<LeadComTempo[]>(() => {
    return leads.map((l) => {
      const ms = calcTempo(l);
      return {
        ...l,
        tempoMs: ms,
        tempoLabel: formatTempo(ms),
        velocidade: velocidade(ms),
      };
    });
  }, [leads]);

  // Ranking: top 5 mais rápidas e top 5 mais lentas (somente com tempo calculável)
  const comTempo = useMemo(
    () => leadsComTempo.filter((l) => l.tempoMs >= 0),
    [leadsComTempo]
  );

  const maisRapidas = useMemo(
    () => [...comTempo].sort((a, b) => a.tempoMs - b.tempoMs).slice(0, 5),
    [comTempo]
  );

  const maisLentas = useMemo(
    () => [...comTempo].sort((a, b) => b.tempoMs - a.tempoMs).slice(0, 5),
    [comTempo]
  );

  // Tabela principal — busca + ordenação
  const filtered = useMemo(() => {
    let rows = leadsComTempo;
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter(
        (l) =>
          (l.telefone ?? '').toLowerCase().includes(q) ||
          (l.senderName ?? '').toLowerCase().includes(q) ||
          (l.nomeDoutor ?? '').toLowerCase().includes(q)
      );
    }
    if (sort === 'tempo_asc') rows = [...rows].sort((a, b) => a.tempoMs - b.tempoMs);
    else if (sort === 'tempo_desc') rows = [...rows].sort((a, b) => b.tempoMs - a.tempoMs);
    else rows = [...rows].sort(
      (a, b) => new Date(b.dataCadastro).getTime() - new Date(a.dataCadastro).getTime()
    );
    return rows;
  }, [leadsComTempo, query, sort]);

  // Médias
  const mediaMs = comTempo.length > 0
    ? comTempo.reduce((acc, l) => acc + l.tempoMs, 0) / comTempo.length
    : -1;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Ranking ── */}
      {comTempo.length > 0 && (
        <>
          {/* Média geral */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-black/30 border border-burst-border">
            <Clock size={16} className="text-burst-muted" />
            <span className="text-burst-muted text-sm">Tempo médio de transferência</span>
            <span className="ml-auto font-display text-2xl text-white">
              {formatTempo(mediaMs)}
            </span>
          </div>

          {/* Top rápidas / lentas */}
          <div className="flex gap-4 flex-wrap">
            <RankingCard
              title="Mais rápidas"
              icon={Zap}
              leads={maisRapidas}
              color="text-green-400"
              emptyMsg="Nenhuma com tempo calculável"
            />
            <RankingCard
              title="Mais lentas"
              icon={Turtle}
              leads={maisLentas}
              color="text-red-400"
              emptyMsg="Nenhuma com tempo calculável"
            />
          </div>
        </>
      )}

      {/* ── Tabela completa ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2 flex-1 min-w-[200px]">
          <Search size={14} className="text-burst-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, telefone ou doutor..."
            className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
          />
          <span className="text-xs text-burst-muted">{filtered.length}/{leadsComTempo.length}</span>
        </div>

        {/* Ordenação */}
        <div className="flex gap-1">
          {(['data', 'tempo_asc', 'tempo_desc'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={[
                'px-3 py-1.5 rounded-lg text-xs uppercase tracking-wider font-semibold transition-all',
                sort === s
                  ? 'bg-burst-orange text-white'
                  : 'bg-black/30 border border-burst-border text-burst-muted hover:text-white',
              ].join(' ')}
            >
              {s === 'data' ? 'Data' : s === 'tempo_asc' ? '↑ Tempo' : '↓ Tempo'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-burst-border">
        <table className="w-full text-sm">
          <thead className="bg-black/40 text-[10px] uppercase tracking-widest text-burst-muted">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Telefone</th>
              <th className="text-left px-3 py-2 font-semibold">Nome</th>
              <th className="text-left px-3 py-2 font-semibold">Doutor</th>
              <th className="text-left px-3 py-2 font-semibold">Cadastro</th>
              <th className="text-left px-3 py-2 font-semibold">Transferido</th>
              <th className="text-center px-3 py-2 font-semibold">Tempo</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => {
              const style = VEL_STYLE[l.velocidade];
              return (
                <tr key={l.id} className={`border-t border-burst-border hover:bg-white/[0.02] ${style.row}`}>
                  <td className="px-3 py-2 font-mono text-xs text-white/90 whitespace-nowrap">
                    {formatPhone(l.telefone)}
                  </td>
                  <td className="px-3 py-2 text-white/80 max-w-[150px] truncate">
                    {l.senderName || '—'}
                  </td>
                  <td className="px-3 py-2 text-white/70 max-w-[170px] truncate">
                    {l.nomeDoutor || <span className="text-red-400/70 italic text-xs">sem doutor</span>}
                  </td>
                  <td className="px-3 py-2 text-burst-muted text-xs whitespace-nowrap">
                    {fmt(l.dataCadastro)}
                  </td>
                  <td className="px-3 py-2 text-burst-muted text-xs whitespace-nowrap">
                    {fmt(l.dataTransferencia)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap ${style.badge}`}>
                      {l.tempoLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-burst-muted text-sm">
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

import { useMemo, useState } from 'react';
import { CalendarRange, Plus, Trash2, Database, Search, X, Loader2 } from 'lucide-react';
import { useHolidays } from '../../hooks/useHolidays';
import type { Holiday } from '../../lib/holidays';
import { AtestadosManager } from '../AtestadosManager';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map((v) => parseInt(v, 10));
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function yearOf(iso: string): number {
  return parseInt(iso.slice(0, 4), 10);
}

export function Calendario() {
  const { holidays, loading, error, missingTable, add, remove } = useHolidays();
  const [query, setQuery] = useState('');
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingDate, setRemovingDate] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const years = useMemo(() => {
    const ys = new Set(holidays.map((h) => yearOf(h.date)));
    return Array.from(ys).sort();
  }, [holidays]);

  const filtered = useMemo(() => {
    let list = holidays;
    if (yearFilter !== 'all') list = list.filter((h) => yearOf(h.date) === yearFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((h) => h.name.toLowerCase().includes(q) || h.date.includes(q));
    }
    return list;
  }, [holidays, yearFilter, query]);

  const grouped = useMemo(() => {
    const map = new Map<number, Holiday[]>();
    for (const h of filtered) {
      const y = yearOf(h.date);
      const arr = map.get(y) ?? [];
      arr.push(h);
      map.set(y, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newDate || !newName.trim()) return;
    setAdding(true);
    setFeedback(null);
    try {
      await add(newDate, newName.trim());
      setNewDate('');
      setNewName('');
      setFeedback('Feriado adicionado.');
      setTimeout(() => setFeedback(null), 2000);
    } catch (e) {
      setFeedback(`Erro: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(date: string) {
    if (!confirm('Remover esse feriado? A contagem de dias úteis vai considerar essa data como dia útil.')) return;
    setRemovingDate(date);
    try {
      await remove(date);
    } catch (e) {
      setFeedback(`Erro ao remover: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRemovingDate(null);
    }
  }

  if (missingTable) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-burst-orange/40 bg-burst-card p-8 max-w-3xl">
          <div className="flex items-center gap-2 mb-4">
            <Database className="text-burst-orange-bright" />
            <h2 className="font-display text-2xl text-white tracking-wider">
              Tabela <code className="text-burst-orange-bright">holidays</code> não existe
            </h2>
          </div>
          <p className="text-sm text-burst-muted mb-3">
            Cole o SQL abaixo em <span className="text-white">Supabase Dashboard → SQL Editor → Run</span>.
            Isso cria a tabela e já popula com os feriados nacionais de 2026-2028.
          </p>
          <pre className="text-[11px] bg-black/40 border border-burst-border rounded p-3 overflow-x-auto text-white/85 font-mono max-h-96 overflow-y-auto">
{`CREATE TABLE IF NOT EXISTS public.holidays (
  date       DATE PRIMARY KEY,
  name       TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'custom' CHECK (source IN ('nacional','custom')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER PUBLICATION supabase_realtime ADD TABLE public.holidays;
ALTER TABLE public.holidays DISABLE ROW LEVEL SECURITY;

-- Use db/holidays.sql do projeto pra o seed completo dos feriados 2026-2028.`}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1200px] mx-auto">
      <div className="flex items-center gap-3">
        <CalendarRange className="text-burst-orange-bright" size={24} />
        <div>
          <h2 className="font-display text-3xl text-white tracking-wider">Calendário de Feriados</h2>
          <p className="text-xs text-burst-muted">
            Dias úteis = segunda a sexta menos os feriados desta lista. Usado nas métricas (Demandas/dia, etc).
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Formulário de adicionar */}
      <form
        onSubmit={handleAdd}
        className="rounded-xl border border-burst-border bg-burst-card p-4 flex flex-wrap items-end gap-3"
      >
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-burst-muted">Data</label>
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="bg-black/40 border border-burst-border rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-burst-orange"
            required
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label className="text-[10px] uppercase tracking-wider text-burst-muted">Nome</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ex: Feriado local, Recesso, etc."
            className="bg-black/40 border border-burst-border rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-burst-orange placeholder:text-burst-muted"
            required
          />
        </div>
        <button
          type="submit"
          disabled={adding || !newDate || !newName.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-md border border-burst-orange/50 bg-burst-orange/15 hover:bg-burst-orange/25 text-burst-orange-bright text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Adicionar
        </button>
        {feedback && (
          <span className={`text-xs ${feedback.startsWith('Erro') ? 'text-red-400' : 'text-green-400'}`}>
            {feedback}
          </span>
        )}
      </form>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[260px] flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2">
          <Search size={14} className="text-burst-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar nome ou data..."
            className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-burst-muted hover:text-white" type="button">
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setYearFilter('all')}
            className={[
              'px-3 py-1.5 rounded-md text-xs transition-colors',
              yearFilter === 'all'
                ? 'bg-burst-orange/20 border border-burst-orange text-burst-orange-bright'
                : 'border border-burst-border text-burst-muted hover:text-white',
            ].join(' ')}
          >
            Todos
          </button>
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setYearFilter(y)}
              className={[
                'px-3 py-1.5 rounded-md text-xs transition-colors',
                yearFilter === y
                  ? 'bg-burst-orange/20 border border-burst-orange text-burst-orange-bright'
                  : 'border border-burst-border text-burst-muted hover:text-white',
              ].join(' ')}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {loading && holidays.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-10 h-10 rounded-full border-2 border-burst-orange border-t-transparent animate-spin" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-burst-muted text-center py-16 text-sm">
          Nenhum feriado encontrado.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map(([year, items]) => (
            <section key={year}>
              <h3 className="font-display text-xl text-white tracking-wider mb-3">{year}</h3>
              <div className="rounded-xl border border-burst-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-black/40 text-[10px] uppercase tracking-widest text-burst-muted">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold">Data</th>
                      <th className="text-left px-4 py-2 font-semibold">Dia da semana</th>
                      <th className="text-left px-4 py-2 font-semibold">Mês</th>
                      <th className="text-left px-4 py-2 font-semibold">Nome</th>
                      <th className="text-center px-4 py-2 font-semibold">Tipo</th>
                      <th className="text-right px-4 py-2 font-semibold w-24">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((h) => {
                      const [, m] = h.date.split('-').map((v) => parseInt(v, 10));
                      const wd = weekdayOf(h.date);
                      const isWeekend = wd === 'Sáb' || wd === 'Dom';
                      return (
                        <tr key={h.date} className="border-t border-burst-border hover:bg-white/[0.02]">
                          <td className="px-4 py-2 font-mono text-white">{formatDateBR(h.date)}</td>
                          <td className={`px-4 py-2 ${isWeekend ? 'text-burst-muted/60' : 'text-white/85'}`}>
                            {wd}
                            {isWeekend && <span className="ml-2 text-[10px] text-burst-muted/60">(já é fds)</span>}
                          </td>
                          <td className="px-4 py-2 text-burst-muted text-xs">{MONTHS_PT[m - 1]}</td>
                          <td className="px-4 py-2 text-white">{h.name}</td>
                          <td className="px-4 py-2 text-center">
                            <span
                              className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${
                                h.source === 'nacional'
                                  ? 'bg-burst-orange/15 text-burst-orange-bright'
                                  : 'bg-white/5 text-white/70'
                              }`}
                            >
                              {h.source}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              onClick={() => handleRemove(h.date)}
                              disabled={removingDate === h.date}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] uppercase tracking-wider text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                              title="Remover"
                            >
                              {removingDate === h.date ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Trash2 size={12} />
                              )}
                              Remover
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Divisor */}
      <div className="h-px bg-burst-border my-4" />

      {/* Atestados de designers */}
      <AtestadosManager />
    </div>
  );
}

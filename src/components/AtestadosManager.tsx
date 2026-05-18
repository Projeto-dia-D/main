import { useState, useMemo } from 'react';
import { Stethoscope, Plus, Trash2, Loader2, Database } from 'lucide-react';
import { useAtestados } from '../hooks/useAtestados';
import { DESIGNERS_ATIVOS, DESIGNER_LABELS } from '../config';

const OPCOES_DESIGNERS = DESIGNERS_ATIVOS.map((k) => DESIGNER_LABELS[k]).filter(Boolean);

function formatBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function diasEntre(inicio: string, fim: string): number {
  const a = new Date(inicio).getTime();
  const b = new Date(fim).getTime();
  return Math.round((b - a) / 86400000) + 1;
}

export function AtestadosManager() {
  const { atestados, loading, error, missingTable, add, remove } = useAtestados();
  const [designer, setDesigner] = useState(OPCOES_DESIGNERS[0] ?? '');
  const [outroNome, setOutroNome] = useState('');
  const [usaOutro, setUsaOutro] = useState(false);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [motivo, setMotivo] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const ordenados = useMemo(() => {
    return [...atestados].sort((a, b) => b.data_inicio.localeCompare(a.data_inicio));
  }, [atestados]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const nomeFinal = usaOutro ? outroNome.trim() : designer;
    if (!nomeFinal || !inicio || !fim) return;
    if (fim < inicio) {
      setFeedback('Erro: data fim antes da data início');
      return;
    }
    setAdding(true);
    setFeedback(null);
    try {
      await add(nomeFinal, inicio, fim, motivo.trim() || null);
      setInicio('');
      setFim('');
      setMotivo('');
      setOutroNome('');
      setFeedback('Atestado adicionado.');
      setTimeout(() => setFeedback(null), 2000);
    } catch (e) {
      setFeedback(`Erro: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: number) {
    if (!confirm('Remover esse atestado? Os dias voltam a contar pro designer.')) return;
    setRemovingId(id);
    try {
      await remove(id);
    } catch (e) {
      setFeedback(`Erro ao remover: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRemovingId(null);
    }
  }

  if (missingTable) {
    return (
      <div className="rounded-2xl border border-burst-orange/40 bg-burst-card p-6">
        <div className="flex items-center gap-2 mb-3">
          <Database className="text-burst-orange-bright" size={18} />
          <h3 className="font-display text-xl text-white tracking-wider">
            Tabela <code className="text-burst-orange-bright">designer_atestados</code> não existe
          </h3>
        </div>
        <p className="text-sm text-burst-muted mb-3">
          Rode o SQL em <code className="text-burst-orange-bright">db/migrations/006_designer_atestados.sql</code> no
          Supabase Dashboard → SQL Editor.
        </p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Stethoscope className="text-burst-orange-bright" size={20} />
        <div>
          <h3 className="font-display text-2xl text-white tracking-wider">Atestados de Designers</h3>
          <p className="text-xs text-burst-muted">
            Dias marcados aqui NÃO contam pro cálculo de "demandas/dia" do designer.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-400">{error}</div>
      )}

      {/* Formulário */}
      <form
        onSubmit={handleAdd}
        className="rounded-xl border border-burst-border bg-burst-card p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end"
      >
        <div className="sm:col-span-2 lg:col-span-3 flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-burst-muted">Designer</label>
          {usaOutro ? (
            <div className="flex gap-1">
              <input
                type="text"
                value={outroNome}
                onChange={(e) => setOutroNome(e.target.value)}
                placeholder="Nome do designer"
                className="flex-1 bg-black/40 border border-burst-border rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-burst-orange"
              />
              <button
                type="button"
                onClick={() => setUsaOutro(false)}
                className="px-2 text-burst-muted hover:text-white text-xs"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex gap-1">
              <select
                value={designer}
                onChange={(e) => setDesigner(e.target.value)}
                className="flex-1 bg-black/40 border border-burst-border rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-burst-orange"
              >
                {OPCOES_DESIGNERS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setUsaOutro(true)}
                className="px-2 text-[10px] uppercase tracking-wider text-burst-muted hover:text-white"
                title="Digitar outro nome"
              >
                Outro...
              </button>
            </div>
          )}
        </div>

        <div className="sm:col-span-1 lg:col-span-2 flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-burst-muted">Início</label>
          <input
            type="date"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
            className="bg-black/40 border border-burst-border rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:border-burst-orange w-full"
            required
          />
        </div>

        <div className="sm:col-span-1 lg:col-span-2 flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-burst-muted">Fim</label>
          <input
            type="date"
            value={fim}
            onChange={(e) => setFim(e.target.value)}
            className="bg-black/40 border border-burst-border rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:border-burst-orange w-full"
            required
          />
        </div>

        <div className="sm:col-span-2 lg:col-span-3 flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-burst-muted">Motivo (opcional)</label>
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex: cirurgia, viagem..."
            className="bg-black/40 border border-burst-border rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-burst-orange placeholder:text-burst-muted/60 w-full"
          />
        </div>

        <div className="sm:col-span-2 lg:col-span-2 flex flex-col">
          <button
            type="submit"
            disabled={adding || !inicio || !fim || (usaOutro ? !outroNome.trim() : !designer)}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-md border border-burst-orange/50 bg-burst-orange/15 hover:bg-burst-orange/25 text-burst-orange-bright text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Adicionar
          </button>
        </div>

        {feedback && (
          <div className="sm:col-span-2 lg:col-span-12 text-xs">
            <span className={feedback.startsWith('Erro') ? 'text-red-400' : 'text-green-400'}>{feedback}</span>
          </div>
        )}
      </form>

      {/* Lista */}
      {loading && atestados.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-burst-orange-bright" size={20} />
        </div>
      ) : ordenados.length === 0 ? (
        <div className="text-center py-8 text-sm text-burst-muted">
          Nenhum atestado registrado.
        </div>
      ) : (
        <div className="rounded-xl border border-burst-border overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-black/40 text-[10px] uppercase tracking-widest text-burst-muted">
              <tr>
                <th className="text-left px-4 py-2">Designer</th>
                <th className="text-left px-4 py-2">Início</th>
                <th className="text-left px-4 py-2">Fim</th>
                <th className="text-center px-4 py-2">Dias</th>
                <th className="text-left px-4 py-2">Motivo</th>
                <th className="text-right px-4 py-2 w-24">Ação</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((a) => (
                <tr key={a.id} className="border-t border-burst-border hover:bg-white/[0.02]">
                  <td className="px-4 py-2 text-white font-semibold">{a.designer}</td>
                  <td className="px-4 py-2 font-mono text-white">{formatBR(a.data_inicio)}</td>
                  <td className="px-4 py-2 font-mono text-white">{formatBR(a.data_fim)}</td>
                  <td className="px-4 py-2 text-center text-burst-orange-bright">
                    {diasEntre(a.data_inicio, a.data_fim)}
                  </td>
                  <td className="px-4 py-2 text-burst-muted">{a.motivo || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleRemove(a.id)}
                      disabled={removingId === a.id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] uppercase tracking-wider text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    >
                      {removingId === a.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

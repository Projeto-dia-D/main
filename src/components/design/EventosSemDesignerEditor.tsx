import { useState } from 'react';
import { Trash2, UserCheck, Loader2, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/errors';
import type { DesignEvento } from '../../lib/designMetrics';
import { parseLogCriacaoDate } from '../../lib/designMetrics';
import { DESIGNERS_ATIVOS, DESIGNER_LABELS } from '../../config';

interface Props {
  eventos: DesignEvento[];
}

const OPCOES_ATIVOS = DESIGNERS_ATIVOS.map((k) => DESIGNER_LABELS[k]).filter(Boolean);

function eventoDataLabel(e: DesignEvento): string {
  if (e.data_feito) {
    const d = new Date(e.data_feito);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
  }
  const parsed = parseLogCriacaoDate(e.log_criacao);
  if (parsed) return parsed.toLocaleDateString('pt-BR');
  return new Date(e.imported_at).toLocaleDateString('pt-BR');
}

function tipoLabel(t: DesignEvento['tipo_evento']): { label: string; cls: string } {
  if (t === 'feito') return { label: 'Feito', cls: 'bg-green-500/15 text-green-400 border-green-500/40' };
  if (t === 'manutencao_c') return { label: 'Manut. C', cls: 'bg-red-500/15 text-red-400 border-red-500/40' };
  return { label: 'Manut.', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/40' };
}

export function EventosSemDesignerEditor({ eventos }: Props) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [success, setSuccess] = useState<number | null>(null);

  async function setDesigner(id: number, designer: string) {
    setBusyId(id);
    setErro(null);
    try {
      const value = designer.trim();
      const { error } = await supabase
        .from('design_demandas')
        .update({ designer_responsavel: value || null })
        .eq('id', id);
      if (error) throw error;
      setSuccess(id);
      setTimeout(() => setSuccess(null), 1500);
    } catch (e) {
      setErro(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function apagar(id: number) {
    if (!confirm('Apagar este evento? Essa ação não pode ser desfeita.')) return;
    setBusyId(id);
    setErro(null);
    try {
      const { error } = await supabase.from('design_demandas').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      setErro(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  // Ordena por data desc (mais recentes primeiro)
  const sorted = [...eventos].sort((a, b) => {
    const da = parseLogCriacaoDate(a.log_criacao)?.getTime() ?? 0;
    const db = parseLogCriacaoDate(b.log_criacao)?.getTime() ?? 0;
    return db - da;
  });

  if (sorted.length === 0) {
    return (
      <div className="p-8 text-center text-burst-muted">
        ✅ Todos os eventos têm designer atribuído.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-burst-muted">
        Atribua um designer ou apague o evento. As mudanças são salvas direto no banco e refletem
        em tempo real no dashboard.
      </div>

      {erro && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 px-3 py-2 text-sm">
          Erro: {erro}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-burst-border">
        <table className="w-full text-sm">
          <thead className="bg-black/40">
            <tr className="text-[10px] uppercase tracking-wider text-burst-muted">
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Demanda</th>
              <th className="px-3 py-2 text-left">Data</th>
              <th className="px-3 py-2 text-left">Origem</th>
              <th className="px-3 py-2 text-left">Atribuir designer</th>
              <th className="px-3 py-2 text-center">Ações</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => {
              const tipo = tipoLabel(e.tipo_evento);
              const isBusy = busyId === e.id;
              const wasSuccess = success === e.id;
              return (
                <tr key={e.id} className="border-t border-burst-border hover:bg-black/20">
                  <td className="px-3 py-2">
                    <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded border ${tipo.cls}`}>
                      {tipo.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-white">{e.nome || '(sem nome)'}</td>
                  <td className="px-3 py-2 text-burst-muted whitespace-nowrap">{eventoDataLabel(e)}</td>
                  <td className="px-3 py-2 text-burst-muted/70 text-xs">{e.origem}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {OPCOES_ATIVOS.map((d) => (
                        <button
                          key={d}
                          onClick={() => setDesigner(e.id, d)}
                          disabled={isBusy}
                          className="text-[10px] px-2 py-1 rounded border border-burst-border hover:border-burst-orange hover:bg-burst-orange/10 text-white disabled:opacity-50"
                        >
                          {d.split(' ')[0]}
                        </button>
                      ))}
                      <OutroInput onSubmit={(name) => setDesigner(e.id, name)} disabled={isBusy} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {wasSuccess && <Check size={16} className="text-green-400" />}
                      {isBusy && <Loader2 size={14} className="animate-spin text-burst-orange-bright" />}
                      <button
                        onClick={() => apagar(e.id)}
                        disabled={isBusy}
                        className="w-7 h-7 rounded hover:bg-red-500/20 text-burst-muted hover:text-red-400 flex items-center justify-center disabled:opacity-50"
                        title="Apagar evento"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] text-burst-muted">
        💡 Clique em um nome (Felipe, Paulo, Lais) pra atribuir rapidamente. Pra outro designer, use
        "Outro..."
      </div>
    </div>
  );
}

function OutroInput({ onSubmit, disabled }: { onSubmit: (name: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="text-[10px] px-2 py-1 rounded border border-burst-border hover:border-burst-orange hover:bg-burst-orange/10 text-burst-muted hover:text-white disabled:opacity-50 flex items-center gap-1"
      >
        <UserCheck size={11} /> Outro...
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && val.trim()) {
            onSubmit(val.trim());
            setOpen(false);
            setVal('');
          }
          if (e.key === 'Escape') {
            setOpen(false);
            setVal('');
          }
        }}
        onBlur={() => {
          if (!val.trim()) setOpen(false);
        }}
        placeholder="Nome do designer"
        className="text-[10px] px-2 py-1 rounded bg-black/40 border border-burst-orange/50 text-white focus:outline-none focus:border-burst-orange w-32"
      />
    </div>
  );
}

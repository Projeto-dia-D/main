import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Check, X, Clock, MessageSquare, RotateCcw, Lock, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useUser } from '../../lib/userContext';
import { parseLogCriacaoDate, type DesignEvento } from '../../lib/designMetrics';

// Quem pode DECIDIR se a manutenção conta (atribuir/desatribuir).
// Renan + Gabriel Velho (super programador).
const EDITORES = new Set(['renan@burstmidia.com', 'gabrielvelho@burstmidia.com']);
// Backlog a revisar: manutenções desde 12/05/2026 (mês 4 = maio).
const CUTOFF = new Date(2026, 4, 12, 0, 0, 0, 0);

type Filtro = 'todas' | 'aguardando' | 'conta' | 'nao_conta';

function dataEvento(e: DesignEvento): Date {
  const p = parseLogCriacaoDate(e.log_criacao);
  if (p) return p;
  if (e.data_feito) {
    const d = new Date(e.data_feito);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(e.imported_at);
}

function fmtData(d: Date): string {
  try {
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}

function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

/** Extrai a primeira URL do campo (link_demanda vem "Nome - https://...monday.com/..."). */
function extractUrl(s: string | null | undefined): string | null {
  const m = (s || '').match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

/**
 * Tela "Atribuir métricas" (sub-aba de Design). Lista as manutenções desde
 * 12/05 e deixa o RENAN decidir, por manutenção, se ela conta no % do designer
 * (`contabilizar`). Conta por padrão — ele desmarca as injustas.
 *
 * - Renan: edita Contabilizar (grava revisado=true).
 * - Designer: só visualiza; pode escrever Justificativa ENQUANTO não revisado.
 * - Outros admins: somente visualização.
 *
 * Recebe `eventos` já com escopo aplicado (designer = só os dele; admin = todos).
 */
export function AtribuirMetricas({ eventos }: { eventos: DesignEvento[] }) {
  const user = useUser();
  const isEditor = EDITORES.has((user.email || '').trim().toLowerCase());
  const isDesigner = user.role === 'designer';

  const [filtro, setFiltro] = useState<Filtro>('todas');
  // Edição otimista: id -> campos sobrescritos até o realtime trazer o canônico.
  const [overrides, setOverrides] = useState<Map<number, Partial<DesignEvento>>>(new Map());
  const [saving, setSaving] = useState<Set<number>>(new Set());
  // Rascunho da justificativa do designer (antes de salvar).
  const [drafts, setDrafts] = useState<Map<number, string>>(new Map());

  const rowOf = (e: DesignEvento): DesignEvento => {
    const ov = overrides.get(e.id);
    return ov ? { ...e, ...ov } : e;
  };

  // Limpa overrides cujo valor o realtime já trouxe (evita mascarar mudanças futuras).
  useEffect(() => {
    setOverrides((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      let changed = false;
      for (const e of eventos) {
        const ov = next.get(e.id);
        if (ov && Object.entries(ov).every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === v)) {
          next.delete(e.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [eventos]);

  const manutencoes = useMemo(() => {
    const lista = eventos.filter(
      (e) =>
        (e.tipo_evento === 'manutencao' || e.tipo_evento === 'manutencao_c') &&
        dataEvento(e).getTime() >= CUTOFF.getTime()
    );
    return lista.sort((a, b) => {
      // não revisadas primeiro, depois mais recentes
      const ra = rowOf(a).revisado ? 1 : 0;
      const rb = rowOf(b).revisado ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return dataEvento(b).getTime() - dataEvento(a).getTime();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventos, overrides]);

  const stats = useMemo(() => {
    let aguardando = 0, conta = 0, naoConta = 0;
    for (const e of manutencoes) {
      const r = rowOf(e);
      if (!r.revisado) aguardando++;
      else if (r.contabilizar === false) naoConta++;
      else conta++;
    }
    return { total: manutencoes.length, aguardando, conta, naoConta };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manutencoes, overrides]);

  const filtradas = useMemo(() => {
    return manutencoes.filter((e) => {
      const r = rowOf(e);
      if (filtro === 'aguardando') return !r.revisado;
      if (filtro === 'conta') return r.revisado && r.contabilizar !== false;
      if (filtro === 'nao_conta') return r.revisado && r.contabilizar === false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manutencoes, filtro, overrides]);

  async function decidir(e: DesignEvento, value: boolean) {
    if (!isEditor) return;
    const patch = {
      contabilizar: value,
      revisado: true,
      revisado_por: user.email,
      revisado_em: new Date().toISOString(),
    };
    setOverrides((m) => new Map(m).set(e.id, { ...(m.get(e.id) || {}), ...patch }));
    setSaving((s) => new Set(s).add(e.id));
    const { error } = await supabase.from('design_demandas').update(patch).eq('id', e.id);
    setSaving((s) => { const n = new Set(s); n.delete(e.id); return n; });
    if (error) {
      setOverrides((m) => { const n = new Map(m); n.delete(e.id); return n; });
      alert('Erro ao salvar: ' + error.message);
    }
  }

  async function salvarJustificativa(e: DesignEvento) {
    if (!isDesigner) return;
    const txt = (drafts.get(e.id) ?? rowOf(e).justificativa ?? '').trim();
    const patch = {
      justificativa: txt || null,
      justificativa_por: user.email,
      justificativa_em: new Date().toISOString(),
    };
    setSaving((s) => new Set(s).add(e.id));
    const { error } = await supabase.from('design_demandas').update(patch).eq('id', e.id);
    setSaving((s) => { const n = new Set(s); n.delete(e.id); return n; });
    if (error) {
      alert('Erro ao salvar justificativa: ' + error.message);
    } else {
      setOverrides((m) => new Map(m).set(e.id, { ...(m.get(e.id) || {}), ...patch }));
      setDrafts((d) => { const n = new Map(d); n.delete(e.id); return n; });
    }
  }

  const chips: { key: Filtro; label: string; count: number }[] = [
    { key: 'todas', label: 'Todas', count: stats.total },
    { key: 'aguardando', label: 'Aguardando', count: stats.aguardando },
    { key: 'conta', label: 'Contam', count: stats.conta },
    { key: 'nao_conta', label: 'Não contam', count: stats.naoConta },
  ];

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl bg-burst-card border border-burst-border p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h3 className="font-display text-xl tracking-wider text-white flex items-center gap-2">
              <ClipboardCheck className="text-burst-orange-bright" size={20} />
              Atribuir métricas
            </h3>
            <p className="text-xs text-burst-muted mt-1 max-w-2xl">
              Manutenções (cliente <strong className="text-white/80">MANUT. C</strong> e gestor{' '}
              <strong className="text-white/80">MANUT.</strong>) desde <strong>12/05</strong>. Contam por padrão —{' '}
              {isEditor
                ? 'desmarque as que NÃO devem pesar no % do designer.'
                : isDesigner
                ? 'enquanto o Renan não revisa, você pode justificar.'
                : 'somente quem pode atribuir edita.'}
            </p>
          </div>
          {!isEditor && (
            <span className="flex items-center gap-1.5 text-[11px] text-burst-muted border border-burst-border rounded-md px-2.5 py-1">
              <Lock size={12} /> {isDesigner ? 'Visualização + justificativa' : 'Somente visualização'}
            </span>
          )}
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-1.5 bg-black/30 border border-burst-border rounded-lg p-1 mb-4 flex-wrap">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFiltro(c.key)}
              className={[
                'flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors',
                filtro === c.key
                  ? 'bg-burst-orange/20 text-burst-orange-bright'
                  : 'text-burst-muted hover:bg-white/5 hover:text-white',
              ].join(' ')}
            >
              <span>{c.label}</span>
              <span className="text-[10px] text-burst-muted/80">{c.count}</span>
            </button>
          ))}
        </div>

        {filtradas.length === 0 ? (
          <div className="text-center py-12 text-burst-muted text-sm flex flex-col items-center gap-2">
            <Check size={24} className="text-green-400" />
            <span>Nada por aqui.</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {filtradas.map((e) => {
              const r = rowOf(e);
              const isSaving = saving.has(e.id);
              const conta = r.contabilizar !== false;
              const ehCliente = e.tipo_evento === 'manutencao_c';
              const linkUrl = extractUrl(e.link_demanda);
              // TODOS os campos preenchidos da demanda (pra dar contexto total na revisão).
              const rawDetalhes: Array<[string, string | null | undefined]> = [
                ['Tipo de manutenção', e.tipo_manutencao],
                ['Padrão da tarefa', e.padrao_tarefa],
                ['Tipo de edição', e.tipo_edicao],
                ['Cliente(s)', e.clientes],
                ['Gestor responsável', e.gestor_responsavel],
                ['Prioridade', e.prioridade || e.priority],
                ['Tempo atrasado', e.tempo_atrasado],
                ['Status principal', e.status_principal],
                ['Status individual', e.status_individual],
                ['Status da tarefa', e.status_tarefa],
                ['Status do designer', e.status_designer],
                ['Criação (log)', e.log_criacao],
                ['Data feito', e.data_feito ? fmtDataHora(e.data_feito) : null],
                ['Origem', e.origem],
                ['Item Monday', e.monday_item_id],
                ['Importado em', fmtDataHora(e.imported_at)],
              ];
              if (r.revisado) {
                rawDetalhes.push(['Revisado por', r.revisado_por]);
                rawDetalhes.push(['Revisado em', r.revisado_em ? fmtDataHora(r.revisado_em) : null]);
              }
              if (r.justificativa_por) {
                rawDetalhes.push(['Justificativa por', r.justificativa_por]);
                rawDetalhes.push(['Justificativa em', r.justificativa_em ? fmtDataHora(r.justificativa_em) : null]);
              }
              const detalhes = rawDetalhes.filter(
                (kv) => kv[1] != null && String(kv[1]).trim() !== ''
              ) as Array<[string, string]>;
              return (
                <li key={e.id} className="rounded-xl bg-black/30 border border-burst-border p-4 flex flex-col gap-3 animate-fade-in">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display text-base text-white truncate max-w-[420px]">
                          {e.nome || '(sem nome)'}
                        </span>
                        <span className={[
                          'px-1.5 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold border',
                          ehCliente
                            ? 'bg-burst-orange/15 text-burst-orange-bright border-burst-orange/30'
                            : 'bg-blue-500/15 text-blue-300 border-blue-500/30',
                        ].join(' ')}>
                          {ehCliente ? 'MANUT. C (cliente)' : 'MANUT. (gestor)'}
                        </span>
                      </div>
                      <div className="text-[11px] text-burst-muted mt-0.5">
                        {e.designer_responsavel || '(sem designer)'} · {fmtData(dataEvento(e))}
                        {e.clientes && <span> · {e.clientes}</span>}
                        {!ehCliente && e.gestor_responsavel && <span> · gestor: {e.gestor_responsavel}</span>}
                      </div>
                    </div>

                    {/* Status badge */}
                    {!r.revisado ? (
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold rounded-md px-2.5 py-1 border border-burst-border text-burst-muted whitespace-nowrap">
                        <Clock size={12} /> Aguardando revisão
                      </span>
                    ) : conta ? (
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold rounded-md px-2.5 py-1 border border-red-500/40 bg-red-500/10 text-red-400 whitespace-nowrap">
                        Atribuída — manutenção ruim
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold rounded-md px-2.5 py-1 border border-green-500/40 bg-green-500/10 text-green-400 whitespace-nowrap">
                        Não atribuída
                      </span>
                    )}
                  </div>

                  {/* Tudo sobre a demanda */}
                  <div className="border-t border-burst-border pt-3 flex flex-col gap-2">
                    {linkUrl && (
                      <a
                        href={linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="self-start flex items-center gap-1.5 text-xs font-semibold text-blue-300 hover:text-blue-200"
                      >
                        <ExternalLink size={12} /> Abrir no Monday
                      </a>
                    )}
                    {detalhes.length > 0 && (
                      <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
                        {detalhes.map(([label, value]) => (
                          <div key={label} className="min-w-0">
                            <dt className="text-burst-muted uppercase tracking-wider text-[9px]">{label}</dt>
                            <dd className="text-white/85 text-[11px] break-words whitespace-pre-wrap">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>

                  {/* Controles do editor (Renan / Gabriel) */}
                  {isEditor && (
                    <div className="flex items-center gap-2 flex-wrap border-t border-burst-border pt-3">
                      <button
                        onClick={() => decidir(e, true)}
                        disabled={isSaving}
                        className={[
                          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors disabled:opacity-50',
                          r.revisado && conta
                            ? 'border-red-500/60 bg-red-500/20 text-red-300'
                            : 'border-burst-border text-burst-muted hover:bg-white/5 hover:text-white',
                        ].join(' ')}
                      >
                        {isSaving ? <RotateCcw size={12} className="animate-spin" /> : <Check size={12} />} Contabilizar
                      </button>
                      <button
                        onClick={() => decidir(e, false)}
                        disabled={isSaving}
                        className={[
                          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors disabled:opacity-50',
                          r.revisado && !conta
                            ? 'border-green-500/60 bg-green-500/20 text-green-300'
                            : 'border-burst-border text-burst-muted hover:bg-white/5 hover:text-white',
                        ].join(' ')}
                      >
                        <X size={12} /> Não contabilizar
                      </button>
                      {r.justificativa && (
                        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-burst-muted italic max-w-[420px] truncate" title={r.justificativa}>
                          <MessageSquare size={12} /> {r.justificativa}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Designer: justificativa (só enquanto não revisado) */}
                  {!isEditor && isDesigner && (
                    <div className="border-t border-burst-border pt-3">
                      {!r.revisado ? (
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] uppercase tracking-wider text-burst-muted flex items-center gap-1.5">
                            <MessageSquare size={12} /> Justificativa (pro Renan avaliar)
                          </label>
                          <textarea
                            value={drafts.get(e.id) ?? r.justificativa ?? ''}
                            onChange={(ev) => setDrafts((d) => new Map(d).set(e.id, ev.target.value))}
                            rows={2}
                            placeholder="Ex: o cliente pediu mudança fora do briefing original…"
                            className="w-full text-xs bg-black/40 border border-burst-border rounded-md px-3 py-2 text-white/90 focus:border-burst-orange/50 outline-none resize-y"
                          />
                          <button
                            onClick={() => salvarJustificativa(e)}
                            disabled={isSaving}
                            className="self-start flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-burst-orange/50 bg-burst-orange/15 text-burst-orange-bright hover:bg-burst-orange/25 transition-colors disabled:opacity-50"
                          >
                            {isSaving ? <RotateCcw size={12} className="animate-spin" /> : <Check size={12} />} Salvar justificativa
                          </button>
                        </div>
                      ) : r.justificativa ? (
                        <div className="text-xs text-burst-muted italic flex items-start gap-1.5">
                          <MessageSquare size={12} className="mt-0.5 shrink-0" /> Sua justificativa: "{r.justificativa}"
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Outros admins: só mostra a justificativa do designer, se houver */}
                  {!isEditor && !isDesigner && r.justificativa && (
                    <div className="border-t border-burst-border pt-3 text-xs text-burst-muted italic flex items-start gap-1.5">
                      <MessageSquare size={12} className="mt-0.5 shrink-0" /> Justificativa do designer: "{r.justificativa}"
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

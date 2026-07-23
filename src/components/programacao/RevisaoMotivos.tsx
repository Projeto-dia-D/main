import { useEffect, useState, useMemo } from 'react';
import { Check, EyeOff, RotateCcw, Ban, HelpCircle } from 'lucide-react';
import { supabase, TABLE_NAME } from '../../lib/supabase';
import { isTransferido, isInterrompido, getResponsavelForDoutor } from '../../lib/metrics';
import type { RelatorioBias } from '../../lib/types';
import { useUser, hasFullAccess } from '../../lib/userContext';
import { useMondayClients } from '../../hooks/useMondayClients';
import { nameMatchesScope } from '../../lib/monday';

/** Valor especial do filtro de responsável pra "doutores sem responsável". */
const SEM_RESP = '__sem__';

/** Tabela Supabase que persiste o "Manter como está". Inclui realtime — todos
 *  os admins veem o mesmo estado e sincronizam quando alguém oculta um lead. */
const OCULTOS_TABLE = 'revisao_ocultos';

interface LeadRevisao {
  id: string;
  dataCadastro: string;
  nomeDoutor: string | null;
  motivoTransferencia: string;
  senderName: string | null;
  mensagemInicial: string | null;
  historico: string | null;
}

/** Aba de curadoria semanal: lista TODOS os leads com motivo diferente de
 *  agendar_avaliacao (excluindo já desclassificados) e permite reclassificar. */
export function RevisaoMotivos() {
  const user = useUser();
  const [leads, setLeads] = useState<LeadRevisao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<string>('todos');
  // Filtro por DEV responsável pelo doutor ('todos' | SEM_RESP | nome do resp)
  const [filtroResp, setFiltroResp] = useState<string>('todos');
  const { responsavelByName, responsaveis } = useMondayClients();

  // Programador não-admin: fica FIXO no próprio scope (não escolhe outro dev),
  // mesma regra da aba de métricas. Admin escolhe pelos chips.
  const enforcedResp = useMemo<string | null>(() => {
    if (hasFullAccess(user)) return null;
    if (user.role === 'programador' && user.scope) {
      for (const r of responsaveis) {
        if (nameMatchesScope(user.scope, r)) return r;
      }
      return user.scope;
    }
    return null;
  }, [user, responsaveis]);
  const respAtivo = enforcedResp ?? filtroResp;

  // Ações ainda em andamento (otimistic UI)
  const [emAcao, setEmAcao] = useState<Map<string, 'mudar' | 'desclassificar' | null>>(new Map());
  // IDs ocultos via "Manter como está" — persiste em Supabase (tabela
  // revisao_ocultos) pra todos os admins compartilharem o mesmo estado.
  // Realtime mantém o set atualizado quando outro admin oculta/restaura.
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());

  // Carrega ocultos do Supabase no mount + subscribe realtime
  useEffect(() => {
    let active = true;

    async function carregarOcultos() {
      const { data, error: err } = await supabase
        .from(OCULTOS_TABLE)
        .select('lead_id');
      if (!active) return;
      if (err) {
        console.warn('[RevisaoMotivos] erro carregando ocultos:', err.message);
        return;
      }
      setOcultos(new Set((data ?? []).map((r) => r.lead_id as string)));
    }
    carregarOcultos();

    const channel = supabase
      .channel('revisao_ocultos_rt_' + Date.now())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: OCULTOS_TABLE },
        (payload) => {
          if (!active) return;
          if (payload.eventType === 'INSERT') {
            const id = (payload.new as { lead_id: string })?.lead_id;
            if (id) setOcultos((prev) => new Set(prev).add(id));
          } else if (payload.eventType === 'DELETE') {
            const id = (payload.old as { lead_id: string })?.lead_id;
            if (id) setOcultos((prev) => { const n = new Set(prev); n.delete(id); return n; });
          }
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  async function carregar() {
    setLoading(true);
    setError(null);
    // Puxa TODOS leads que TÊM motivo preenchido (não null) e que NÃO sejam
    // já desclassificados. Filtragem de "transferência" acontece no client
    // porque o regex de isTransferido é complexo (várias variantes).
    const { data, error: err } = await supabase
      .from(TABLE_NAME)
      .select('id, dataCadastro, nomeDoutor, motivoTransferencia, senderName, mensagemInicial, historico')
      .not('motivoTransferencia', 'is', null)
      .neq('motivoTransferencia', 'desclassificado')
      .order('dataCadastro', { ascending: false })
      .limit(1000);
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setLeads((data ?? []) as LeadRevisao[]);
    setLoading(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  // Filtra os leads que são transferência (já classificados como agendar etc.)
  // ou chat interrompido (não tem o que revisar — lead simplesmente parou de
  // responder, não é dúvida que vira agendamento). Sobram dúvidas reais,
  // sem_interesse, e outros motivos ambíguos.
  const naoTransferencia = useMemo(() => {
    return leads.filter((l) => {
      const lead = l as unknown as RelatorioBias;
      return !isTransferido(lead) && !isInterrompido(lead);
    });
  }, [leads]);

  // DEV responsável de cada lead, resolvido pelo nome do doutor (mesma regra
  // da aba de métricas: nomeDoutor × cliente do board Bia Soft).
  const respDoLead = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const l of naoTransferencia) {
      m.set(l.id, getResponsavelForDoutor(l.nomeDoutor, responsavelByName));
    }
    return m;
  }, [naoTransferencia, responsavelByName]);

  // Base visível: não-transferência e não ocultos ("Manter como está").
  const visiveis = useMemo(
    () => naoTransferencia.filter((l) => !ocultos.has(l.id)),
    [naoTransferencia, ocultos]
  );

  const matchResp = (id: string): boolean => {
    if (respAtivo === 'todos') return true;
    const r = respDoLead.get(id) ?? null;
    if (respAtivo === SEM_RESP) return r === null;
    return r === respAtivo;
  };

  // Chips de MOTIVO: contam dentro do responsável selecionado. Motivos zerados
  // somem dos chips — sem ruído visual.
  const motivosUnicos = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of visiveis) {
      if (!matchResp(l.id)) continue;
      const m = l.motivoTransferencia.trim();
      map.set(m, (map.get(m) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]); // mais frequente primeiro
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiveis, respAtivo, respDoLead]);

  // Chips de RESPONSÁVEL: contam dentro do motivo selecionado.
  const respUnicos = useMemo(() => {
    const map = new Map<string, number>();
    let sem = 0;
    for (const l of visiveis) {
      if (filtro !== 'todos' && l.motivoTransferencia !== filtro) continue;
      const r = respDoLead.get(l.id) ?? null;
      if (r) map.set(r, (map.get(r) ?? 0) + 1);
      else sem++;
    }
    return { lista: [...map.entries()].sort((a, b) => b[1] - a[1]), sem };
  }, [visiveis, filtro, respDoLead]);

  // Se o filtro selecionado desapareceu (zerou após ocultar), volta pra "todos"
  // automaticamente — evita a tela "Nada pra revisar" com outros chips visíveis.
  useEffect(() => {
    if (filtro === 'todos') return;
    const aindaTemMotivo = motivosUnicos.some(([m]) => m === filtro);
    if (!aindaTemMotivo) setFiltro('todos');
  }, [motivosUnicos, filtro]);

  const filtrados = useMemo(() => {
    return visiveis.filter((l) => {
      if (filtro !== 'todos' && l.motivoTransferencia !== filtro) return false;
      return matchResp(l.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiveis, filtro, respAtivo, respDoLead]);

  // Total do chip "Todos" (motivos) — já dentro do responsável selecionado.
  const totalVisivel = useMemo(
    () => visiveis.filter((l) => matchResp(l.id)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visiveis, respAtivo, respDoLead]
  );

  async function mudarParaAgendar(lead: LeadRevisao) {
    setEmAcao((m) => new Map(m).set(lead.id, 'mudar'));
    const { error: err } = await supabase
      .from(TABLE_NAME)
      .update({ motivoTransferencia: 'agendar_avaliacao' })
      .eq('id', lead.id);
    if (err) {
      alert('Erro ao atualizar: ' + err.message);
      setEmAcao((m) => { const n = new Map(m); n.set(lead.id, null); return n; });
      return;
    }
    // Remove da lista
    setLeads((prev) => prev.filter((l) => l.id !== lead.id));
  }

  async function desclassificar(lead: LeadRevisao) {
    setEmAcao((m) => new Map(m).set(lead.id, 'desclassificar'));
    const { error: err } = await supabase
      .from(TABLE_NAME)
      .update({ motivoTransferencia: 'desclassificado' })
      .eq('id', lead.id);
    if (err) {
      alert('Erro ao desclassificar: ' + err.message);
      setEmAcao((m) => { const n = new Map(m); n.set(lead.id, null); return n; });
      return;
    }
    // Some da lista (e o lead some das métricas via isDesclassificado)
    setLeads((prev) => prev.filter((l) => l.id !== lead.id));
  }

  /** Manter como está: persiste em revisao_ocultos (Supabase) pra todos os
   *  admins verem o mesmo estado. Não mexe no motivoTransferencia do lead. */
  async function manter(lead: LeadRevisao) {
    // Optimistic UI: adiciona ao set local imediatamente
    setOcultos((prev) => new Set(prev).add(lead.id));
    // Persiste no banco — realtime confirma pros outros admins
    const { error: err } = await supabase
      .from(OCULTOS_TABLE)
      .upsert(
        { lead_id: lead.id, ocultado_por: user.email, ocultado_at: new Date().toISOString() },
        { onConflict: 'lead_id' },
      );
    if (err) {
      console.warn('[RevisaoMotivos] erro persistindo oculto:', err.message);
      // Reverte optimistic em caso de erro
      setOcultos((prev) => { const n = new Set(prev); n.delete(lead.id); return n; });
      alert('Erro ao salvar — tente novamente. ' + err.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl bg-burst-card border border-burst-border p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h3 className="font-display text-xl tracking-wider text-white flex items-center gap-2">
              <HelpCircle className="text-burst-orange-bright" size={20} />
              Revisão de motivos ambíguos
            </h3>
            <p className="text-xs text-burst-muted mt-1">
              Curadoria manual: leads marcados como dúvida que podem na verdade ser agendamentos.
              Mudar pra <strong className="text-burst-orange-bright">agendar_avaliacao</strong> ou deletar (spam/vendedor).
            </p>
          </div>
          <button
            onClick={carregar}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-burst-border text-burst-muted hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50"
            title="Recarregar lista"
          >
            <RotateCcw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'carregando' : 'atualizar'}
          </button>
        </div>

        {/* === SEPARAÇÃO POR DEV RESPONSÁVEL PELO DOUTOR === */}
        {enforcedResp ? (
          <div className="text-[11px] text-burst-muted mb-3">
            Mostrando só os doutores sob sua programação:{' '}
            <span className="text-burst-orange-bright font-semibold">{nomeCurto(enforcedResp)}</span>
          </div>
        ) : (
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-widest text-burst-muted mb-1.5">
              Dev responsável pelo doutor
            </div>
            <div className="flex items-center gap-1.5 bg-black/30 border border-burst-border rounded-lg p-1 flex-wrap">
              <button
                onClick={() => setFiltroResp('todos')}
                className={[
                  'flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors',
                  filtroResp === 'todos'
                    ? 'bg-burst-orange/20 text-burst-orange-bright'
                    : 'text-burst-muted hover:bg-white/5 hover:text-white',
                ].join(' ')}
              >
                <span>Todos</span>
                <span className="text-[10px] text-burst-muted/80">
                  {respUnicos.lista.reduce((s, [, n]) => s + n, 0) + respUnicos.sem}
                </span>
              </button>
              {respUnicos.lista.map(([r, n]) => (
                <button
                  key={r}
                  onClick={() => setFiltroResp(r)}
                  title={r}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors',
                    filtroResp === r
                      ? 'bg-burst-orange/20 text-burst-orange-bright'
                      : 'text-burst-muted hover:bg-white/5 hover:text-white',
                  ].join(' ')}
                >
                  <span className="truncate max-w-[200px]">{nomeCurto(r)}</span>
                  <span className="text-[10px] text-burst-muted/80 shrink-0">{n}</span>
                </button>
              ))}
              {respUnicos.sem > 0 && (
                <button
                  onClick={() => setFiltroResp(SEM_RESP)}
                  title="Doutores sem responsável mapeado no board Bia Soft"
                  className={[
                    'flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors',
                    filtroResp === SEM_RESP
                      ? 'bg-burst-orange/20 text-burst-orange-bright'
                      : 'text-burst-muted hover:bg-white/5 hover:text-white',
                  ].join(' ')}
                >
                  <span>Sem responsável</span>
                  <span className="text-[10px] text-burst-muted/80 shrink-0">{respUnicos.sem}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Filtros dinâmicos por motivo */}
        <div className="flex items-center gap-1.5 bg-black/30 border border-burst-border rounded-lg p-1 mb-4 flex-wrap">
          <button
            onClick={() => setFiltro('todos')}
            className={[
              'flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors',
              filtro === 'todos'
                ? 'bg-burst-orange/20 text-burst-orange-bright'
                : 'text-burst-muted hover:bg-white/5 hover:text-white',
            ].join(' ')}
          >
            <span>Todos</span>
            <span className="text-[10px] text-burst-muted/80">{totalVisivel}</span>
          </button>
          {motivosUnicos.map(([motivo, count]) => (
            <button
              key={motivo}
              onClick={() => setFiltro(motivo)}
              title={motivo}
              className={[
                'flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors',
                filtro === motivo
                  ? 'bg-burst-orange/20 text-burst-orange-bright'
                  : 'text-burst-muted hover:bg-white/5 hover:text-white',
              ].join(' ')}
            >
              <span className="truncate max-w-[220px]">{labelMotivo(motivo)}</span>
              <span className="text-[10px] text-burst-muted/80 shrink-0">{count}</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 mb-3 text-sm text-red-400">
            Erro: {error}
          </div>
        )}

        {loading && leads.length === 0 ? (
          <div className="text-center py-12 text-burst-muted text-sm">
            Carregando dúvidas...
          </div>
        ) : filtrados.length === 0 ? (
          <div className="text-center py-12 text-burst-muted text-sm flex flex-col items-center gap-2">
            <Check size={24} className="text-green-400" />
            <span>Nada pra revisar agora! 🎉</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {filtrados.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                responsavel={respDoLead.get(lead.id) ?? null}
                emAcao={emAcao.get(lead.id) ?? null}
                onMudar={() => mudarParaAgendar(lead)}
                onManter={() => manter(lead)}
                onDesclassificar={() => desclassificar(lead)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LeadCard({
  lead,
  responsavel,
  emAcao,
  onMudar,
  onManter,
  onDesclassificar,
}: {
  lead: LeadRevisao;
  responsavel: string | null;
  emAcao: 'mudar' | 'desclassificar' | null;
  onMudar: () => void;
  onManter: () => void;
  onDesclassificar: () => void;
}) {
  // Categoriza o motivo pra escolher cor do badge
  const m = lead.motivoTransferencia.toLowerCase();
  let motivoCls = 'bg-burst-muted/15 text-burst-muted border-burst-border';
  if (m.includes('financ') || m.includes('preco') || m.includes('boleto')) {
    motivoCls = 'bg-burst-warning/15 text-burst-warning border-burst-warning/30';
  } else if (m.includes('tecnic') || m.includes('duvida')) {
    motivoCls = 'bg-burst-orange/15 text-burst-orange-bright border-burst-orange/30';
  } else if (m.includes('interromp') || m.includes('interesse') || m.includes('sem_')) {
    motivoCls = 'bg-red-500/15 text-red-400 border-red-500/30';
  }

  const resumo = parseResumo(lead.historico);

  function fmt(d: string): string {
    try {
      return new Date(d).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return d;
    }
  }

  return (
    <li className="rounded-xl bg-black/30 border border-burst-border p-4 flex flex-col gap-3 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display text-base text-white">{lead.nomeDoutor ?? '(sem doutor)'}</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold border ${motivoCls}`}
              title={lead.motivoTransferencia}
            >
              {labelMotivo(lead.motivoTransferencia)}
            </span>
            {/* DEV responsável pelo doutor */}
            <span
              className={[
                'px-1.5 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold border',
                responsavel
                  ? 'border-burst-border bg-black/40 text-white/70'
                  : 'border-burst-warning/40 bg-burst-warning/10 text-burst-warning',
              ].join(' ')}
              title={responsavel ? `Dev responsável: ${responsavel}` : 'Doutor sem responsável mapeado no board Bia Soft'}
            >
              {responsavel ? nomeCurto(responsavel) : 'sem dev'}
            </span>
          </div>
          <div className="text-[11px] text-burst-muted mt-0.5">
            {fmt(lead.dataCadastro)}
            {lead.senderName && <span> · sender: <span className="text-white/80">{lead.senderName}</span></span>}
          </div>
        </div>
      </div>

      <div className="text-xs">
        <div className="text-burst-muted mb-0.5">
          <strong className="uppercase tracking-wider text-[10px]">Msg inicial:</strong>
        </div>
        <div className="text-white/80 italic">"{lead.mensagemInicial?.slice(0, 250) || '(vazia)'}"</div>
      </div>

      <div className="text-xs">
        <div className="text-burst-muted mb-0.5">
          <strong className="uppercase tracking-wider text-[10px]">Resumo da conversa:</strong>
        </div>
        <div className="text-white/85 leading-relaxed">{resumo}</div>
      </div>

      <div className="flex items-center gap-2 flex-wrap border-t border-burst-border pt-3">
        {/* Mudar pra agendar_avaliacao — vira transferência nas métricas */}
        <button
          onClick={onMudar}
          disabled={emAcao !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-burst-orange/50 bg-burst-orange/15 text-burst-orange-bright hover:bg-burst-orange/25 hover:border-burst-orange transition-colors disabled:opacity-50"
          title="Reclassificar como agendar_avaliacao — vira transferência"
        >
          {emAcao === 'mudar' ? (
            <><RotateCcw size={12} className="animate-spin" /> atualizando</>
          ) : (
            <><Check size={12} /> Ir pra agendar_avaliacao</>
          )}
        </button>

        {/* Manter como está — só esconde da revisão, NÃO mexe no banco */}
        <button
          onClick={onManter}
          disabled={emAcao !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-burst-border bg-burst-card text-white hover:bg-white/5 hover:border-burst-orange/40 transition-colors disabled:opacity-50"
          title="Mantém o motivo como está e some da revisão (não muda nada no banco)"
        >
          <EyeOff size={12} /> Manter como está
        </button>

        {/* Desclassificar — soft delete, lead sai das métricas mas fica salvo */}
        <button
          onClick={onDesclassificar}
          disabled={emAcao !== null}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10 hover:border-red-500 transition-colors disabled:opacity-50"
          title="Desclassificar — lead sai de TODAS as métricas (sem deletar do banco)"
        >
          {emAcao === 'desclassificar' ? (
            <><RotateCcw size={12} className="animate-spin" /> desclassificando</>
          ) : (
            <><Ban size={12} /> Desclassificar lead</>
          )}
        </button>
      </div>
    </li>
  );
}

/** Encurta o nome do dev pra caber no chip/badge:
 *  "Gabriel Velho dos Santos" → "Gabriel Velho". */
function nomeCurto(s: string): string {
  const parts = s.trim().split(/\s+/);
  return parts.slice(0, 2).join(' ') || s;
}

/** Formata o motivo bruto pra label mais amigável: "duvida_tecnica" → "Dúvida técnica". */
function labelMotivo(m: string): string {
  if (!m) return '(sem motivo)';
  return m
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseResumo(h: string | null): string {
  if (!h) return '(sem histórico)';
  try {
    const j = JSON.parse(h);
    if (j.resumo) return j.resumo;
  } catch { /* ignora */ }
  return h.length > 600 ? h.slice(0, 600) + '…' : h;
}

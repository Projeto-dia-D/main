import { useState } from 'react';
import {
  MessageSquare, Users, Clock, AlertTriangle, ThumbsUp, ThumbsDown,
  CheckCircle2, HelpCircle, AlertCircle, Search, X, Smile, ExternalLink,
} from 'lucide-react';
import { useWhatsappGroup, type WhatsappEvent } from '../../hooks/useWhatsappGroup';

interface Props {
  clientName: string;
  clientId: string;
}

const EVENT_ICON: Record<string, React.ElementType> = {
  reclamacao: ThumbsDown,
  atraso: AlertTriangle,
  erro_escrita: AlertCircle,
  elogio: ThumbsUp,
  duvida: HelpCircle,
  aprovacao: CheckCircle2,
  demora_resposta: Clock,
};

const EVENT_COLOR: Record<string, { bg: string; text: string; border: string; label: string }> = {
  reclamacao: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', label: 'Reclamação' },
  atraso: { bg: 'bg-burst-warning/10', text: 'text-burst-warning', border: 'border-burst-warning/30', label: 'Atraso reportado' },
  erro_escrita: { bg: 'bg-burst-warning/10', text: 'text-burst-warning', border: 'border-burst-warning/30', label: 'Erro de escrita' },
  elogio: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/30', label: 'Elogio' },
  duvida: { bg: 'bg-white/5', text: 'text-burst-muted', border: 'border-burst-border', label: 'Dúvida' },
  aprovacao: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/30', label: 'Aprovação' },
  demora_resposta: { bg: 'bg-burst-warning/10', text: 'text-burst-warning', border: 'border-burst-warning/30', label: 'Demora pra responder' },
};

/** Cor por papel/área — bate com as cores da TimelineCliente:
 *  Design=roxo, Gestor/Tráfego=azul, CS=teal, Cliente=cinza. */
const ROLE_COLOR: Record<string, string> = {
  cs: 'text-teal-400',
  gestor: 'text-blue-400',
  designer: 'text-purple-400',
  programador: 'text-green-400',
  admin: 'text-white',
  cliente: 'text-burst-muted',
  unknown: 'text-burst-muted/60',
};
const ROLE_BAR: Record<string, string> = {
  cs: 'bg-teal-400',
  gestor: 'bg-blue-400',
  designer: 'bg-purple-400',
  programador: 'bg-green-400',
  admin: 'bg-white',
  cliente: 'bg-burst-muted',
  unknown: 'bg-burst-muted/60',
};
const ROLE_BG_BADGE: Record<string, string> = {
  cs: 'bg-teal-500/15 border-teal-500/40',
  gestor: 'bg-blue-500/15 border-blue-500/40',
  designer: 'bg-purple-500/15 border-purple-500/40',
  programador: 'bg-green-500/15 border-green-500/40',
  admin: 'bg-white/10 border-white/30',
  cliente: 'bg-burst-muted/15 border-burst-muted/40',
  unknown: 'bg-burst-muted/10 border-burst-border',
};

function fmtMin(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (n < 1) return '< 1 min';
  if (n < 60) return `${n.toFixed(0)} min`;
  if (n < 60 * 24) return `${(n / 60).toFixed(1)} h`;
  return `${(n / 60 / 24).toFixed(1)} dias`;
}

function fmtTs(ts: string): string {
  try {
    return new Date(ts).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

export function BlocoWhatsappGrupo({ clientName, clientId }: Props) {
  const { group, members, events, latestScore, loading } = useWhatsappGroup(clientName, clientId);
  const [busca, setBusca] = useState('');
  const [filtroEvento, setFiltroEvento] = useState<string>('todos');

  if (loading && !group) {
    return (
      <section className="rounded-2xl bg-burst-card border border-burst-border p-6">
        <div className="text-burst-muted text-sm text-center">Buscando grupo WhatsApp...</div>
      </section>
    );
  }

  if (!group) {
    return (
      <section className="rounded-2xl bg-burst-card border border-burst-border p-6">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="text-burst-muted" size={20} />
          <h3 className="font-display text-xl text-white tracking-wide">Grupo WhatsApp</h3>
        </div>
        <div className="text-burst-muted text-sm text-center py-6">
          Nenhum grupo WhatsApp Burst encontrado pra <strong>{clientName}</strong>.
          <br />
          Ou o sync ainda não rodou (próximo: domingo 23h).
        </div>
      </section>
    );
  }

  // Filtros de eventos
  const eventosFiltrados = events.filter((e) => {
    if (filtroEvento !== 'todos' && e.event_type !== filtroEvento) return false;
    if (busca) {
      const q = busca.toLowerCase();
      if (!(e.detail ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const score = latestScore?.score ?? null;
  const scoreColor = score === null
    ? 'text-burst-muted'
    : score >= 80 ? 'text-green-400'
    : score >= 60 ? 'text-burst-warning'
    : 'text-red-400';
  const scoreLabel = score === null ? '—'
    : score >= 80 ? 'Excelente'
    : score >= 60 ? 'Atenção'
    : 'Crítico';

  return (
    <section className="rounded-2xl bg-burst-card border border-burst-border p-6 flex flex-col gap-5">
      {/* Header */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="text-burst-orange-bright" size={20} />
          <div className="min-w-0">
            <h3 className="font-display text-xl text-white tracking-wide truncate">{group.name}</h3>
            <div className="text-[10px] text-burst-muted">
              {group.participants_count ?? '?'} participantes
              {group.last_message_at && ` · última msg ${fmtTs(group.last_message_at)}`}
            </div>
          </div>
        </div>
        {/* Score grande */}
        {score !== null && (
          <div className={`rounded-xl bg-black/30 border border-burst-border px-4 py-2 text-right`}>
            <div className="text-[9px] uppercase tracking-widest text-burst-muted">Score atendimento</div>
            <div className={`font-display text-3xl ${scoreColor}`}>{score}<span className="text-sm text-burst-muted">/100</span></div>
            <div className={`text-[10px] uppercase tracking-wider font-bold ${scoreColor}`}>{scoreLabel}</div>
          </div>
        )}
      </header>

      {/* Métricas resumidas */}
      {latestScore && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat
            icon={<Clock size={11} />}
            label="Tempo médio"
            value={fmtMin(latestScore.avg_response_time_minutes)}
            tone={
              latestScore.avg_response_time_minutes === null ? 'white' :
              latestScore.avg_response_time_minutes < 30 ? 'green' :
              latestScore.avg_response_time_minutes < 120 ? 'orange' : 'red'
            }
          />
          <Stat
            icon={<CheckCircle2 size={11} />}
            label="<30min"
            value={latestScore.pct_responses_under_30min !== null ? `${latestScore.pct_responses_under_30min.toFixed(0)}%` : '—'}
            tone={
              latestScore.pct_responses_under_30min === null ? 'white' :
              latestScore.pct_responses_under_30min >= 70 ? 'green' :
              latestScore.pct_responses_under_30min >= 50 ? 'orange' : 'red'
            }
          />
          <Stat
            icon={<ThumbsDown size={11} />}
            label="Reclamações"
            value={String(latestScore.count_reclamacoes)}
            tone={latestScore.count_reclamacoes === 0 ? 'green' : latestScore.count_reclamacoes <= 2 ? 'orange' : 'red'}
          />
          <Stat
            icon={<ThumbsUp size={11} />}
            label="Elogios"
            value={String(latestScore.count_elogios)}
            tone={latestScore.count_elogios > 0 ? 'green' : 'white'}
          />
        </div>
      )}

      {/* Membros */}
      {members.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-burst-muted mb-2 flex items-center gap-1">
            <Users size={11} /> Membros · {members.length}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {members
              .sort((a, b) => {
                const order: Record<string, number> = { cliente: 0, cs: 1, gestor: 2, designer: 3, programador: 4, admin: 5, unknown: 99 };
                return (order[a.inferred_role ?? 'unknown'] ?? 50) - (order[b.inferred_role ?? 'unknown'] ?? 50);
              })
              .map((m) => {
                const role = m.inferred_role ?? 'unknown';
                const bg = ROLE_BG_BADGE[role] ?? ROLE_BG_BADGE.unknown;
                const textCls = ROLE_COLOR[role] ?? 'text-burst-muted';
                return (
                  <span
                    key={m.phone}
                    className={`text-[10px] px-2 py-0.5 rounded border ${bg} ${textCls} flex items-center gap-1`}
                    title={`${m.display_name ?? '?'} · ${m.phone}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${ROLE_BAR[role] ?? 'bg-burst-muted'}`} />
                    {(m.inferred_name ?? m.display_name ?? m.phone).slice(0, 24)}
                    <span className="text-[8px] uppercase ml-1 opacity-70">{role}</span>
                  </span>
                );
              })}
          </div>

          {/* Legenda de cores */}
          <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-burst-muted">
            <LegendaCor cor="bg-teal-400" label="CS" />
            <LegendaCor cor="bg-blue-400" label="Gestor" />
            <LegendaCor cor="bg-purple-400" label="Designer" />
            <LegendaCor cor="bg-green-400" label="Programador" />
            <LegendaCor cor="bg-burst-muted" label="Cliente" />
          </div>
        </div>
      )}

      {/* Timeline de eventos */}
      <div>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div className="text-[10px] uppercase tracking-widest text-burst-muted flex items-center gap-1">
            <Smile size={11} /> Timeline do grupo · {events.length} eventos
          </div>
          <EventoPills filtro={filtroEvento} onChange={setFiltroEvento} events={events} />
        </div>

        {/* Busca */}
        <div className="relative mb-2">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-burst-muted" />
          <input
            type="text"
            placeholder="Buscar no detalhe dos eventos..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full bg-black/40 border border-burst-border rounded-lg pl-8 pr-8 py-1.5 text-xs text-white focus:outline-none focus:border-burst-orange placeholder:text-burst-muted/60"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-burst-muted hover:text-white">
              <X size={12} />
            </button>
          )}
        </div>

        {eventosFiltrados.length === 0 ? (
          <div className="text-burst-muted text-xs text-center py-4">Nenhum evento.</div>
        ) : (
          <ul className="flex flex-col gap-1.5 max-h-[480px] overflow-y-auto scrollbar-thin pr-1">
            {eventosFiltrados.slice(0, 100).map((e) => <EventoRow key={e.event_id} ev={e} />)}
            {eventosFiltrados.length > 100 && (
              <li className="text-[10px] text-burst-muted text-center py-1">
                +{eventosFiltrados.length - 100} eventos
              </li>
            )}
          </ul>
        )}
      </div>

      {latestScore && (
        <div className="text-[10px] text-burst-muted/70 text-center pt-2 border-t border-burst-border">
          Score atualizado em {fmtTs(latestScore.snapshot_at)} · período {fmtTs(latestScore.period_start)} → {fmtTs(latestScore.period_end)}
        </div>
      )}
    </section>
  );
}

function Stat({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'orange' | 'white' | 'red' | 'green';
}) {
  const cls =
    tone === 'orange' ? 'text-burst-orange-bright' :
    tone === 'red' ? 'text-red-400' :
    tone === 'green' ? 'text-green-400' :
    'text-white';
  return (
    <div className="rounded-lg bg-black/30 border border-burst-border px-3 py-2 flex flex-col text-left">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-burst-muted">
        {icon} {label}
      </div>
      <span className={`font-display text-lg ${cls} truncate`}>{value}</span>
    </div>
  );
}

function EventoPills({
  filtro, onChange, events,
}: {
  filtro: string;
  onChange: (v: string) => void;
  events: WhatsappEvent[];
}) {
  const counts: Record<string, number> = { todos: events.length };
  for (const e of events) counts[e.event_type] = (counts[e.event_type] ?? 0) + 1;
  const opts: { key: string; label: string }[] = [
    { key: 'todos', label: 'Tudo' },
    { key: 'reclamacao', label: 'Reclamação' },
    { key: 'atraso', label: 'Atraso' },
    { key: 'elogio', label: 'Elogio' },
    { key: 'aprovacao', label: 'Aprovado' },
    { key: 'demora_resposta', label: 'Demora' },
  ];
  return (
    <div className="flex items-center gap-1 bg-black/30 border border-burst-border rounded-lg p-1 flex-wrap">
      {opts.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={[
            'px-2 py-0.5 rounded text-[10px] font-semibold transition-colors flex items-center gap-1',
            filtro === o.key
              ? 'bg-burst-orange/20 text-burst-orange-bright'
              : 'text-burst-muted hover:bg-white/5 hover:text-white',
          ].join(' ')}
        >
          {o.label}
          <span className="text-[9px] text-burst-muted/80">{counts[o.key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

function LegendaCor({ cor, label }: { cor: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`w-2 h-2 rounded-full ${cor}`} />
      {label}
    </span>
  );
}

function EventoRow({ ev }: { ev: WhatsappEvent }) {
  const Icon = EVENT_ICON[ev.event_type] ?? AlertCircle;
  const c = EVENT_COLOR[ev.event_type] ?? EVENT_COLOR.duvida;
  const role = ev.triggered_by_role ?? 'unknown';
  const roleBar = ROLE_BAR[role] ?? 'bg-burst-muted/40';
  return (
    <li className={`rounded-lg ${c.bg} border ${c.border} px-3 py-2 flex items-start gap-2 text-xs`}>
      {/* Barra lateral colorida — papel do autor (CS/Gestor/Designer/...) */}
      <div className={`w-1 self-stretch rounded-full shrink-0 ${roleBar}`} />
      <Icon size={13} className={`${c.text} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${c.text}`}>{c.label}</span>
          {ev.triggered_by_role && (
            <span className={`text-[9px] uppercase tracking-wider font-bold ${ROLE_COLOR[ev.triggered_by_role] ?? 'text-burst-muted'}`}>
              · {ev.triggered_by_role}
            </span>
          )}
          <span className="text-[9px] text-burst-muted ml-auto">{fmtTs(ev.ts)}</span>
        </div>
        {ev.detail && (
          <div className="text-burst-muted whitespace-pre-wrap break-words">
            {ev.detail.length > 280 ? ev.detail.slice(0, 280) + '…' : ev.detail}
          </div>
        )}
      </div>
    </li>
  );
}

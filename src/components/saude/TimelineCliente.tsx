import { useMemo, useState } from 'react';
import {
  Clock,
  Palette,
  RefreshCw,
  AlertTriangle,
  Play,
  Pause,
  Bot,
  Sparkles,
  Activity,
  Zap,
  ExternalLink,
  FilePlus,
  CheckCircle2,
  PenLine,
  Tag,
  Wrench,
  Search,
  X,
} from 'lucide-react';
import type { TimelineEvent, TimelineEventType } from '../../lib/clienteSaude';

interface Props {
  events: TimelineEvent[];
}

const ICONS: Record<TimelineEventType, React.ElementType> = {
  'design-feito': Palette,
  'design-manutencao': RefreshCw,
  'design-atrasada': AlertTriangle,
  'design-criada': FilePlus,
  'design-aprovada': CheckCircle2,
  'design-em-criacao': PenLine,
  'design-status-tarefa': Tag,
  'design-status-designer': Tag,
  'gestor-otimizacao': Wrench,
  'bia-ativa': Play,
  'bia-manutencao': Pause,
  'bia-outra': Bot,
  'lead-primeiro': Sparkles,
  'lead-ultima-transf': Activity,
  'lead-volume-dia': Zap,
  'meta-campanha-spend': Activity,
};

const COLORS: Record<TimelineEventType, { dot: string; text: string; bg: string; border: string }> = {
  'design-feito': {
    dot: 'bg-burst-orange-bright',
    text: 'text-burst-orange-bright',
    bg: 'bg-burst-orange/5',
    border: 'border-burst-orange/30',
  },
  'design-manutencao': {
    dot: 'bg-burst-warning',
    text: 'text-burst-warning',
    bg: 'bg-burst-warning/5',
    border: 'border-burst-warning/30',
  },
  'design-atrasada': {
    dot: 'bg-red-400',
    text: 'text-red-400',
    bg: 'bg-red-500/5',
    border: 'border-red-500/30',
  },
  'design-criada': {
    dot: 'bg-burst-muted',
    text: 'text-burst-muted',
    bg: 'bg-white/5',
    border: 'border-burst-border',
  },
  'design-aprovada': {
    dot: 'bg-green-400',
    text: 'text-green-400',
    bg: 'bg-green-500/5',
    border: 'border-green-500/30',
  },
  'design-em-criacao': {
    dot: 'bg-burst-orange-bright',
    text: 'text-burst-orange-bright',
    bg: 'bg-burst-orange/5',
    border: 'border-burst-orange/30',
  },
  'design-status-tarefa': {
    dot: 'bg-burst-muted',
    text: 'text-burst-muted',
    bg: 'bg-white/5',
    border: 'border-burst-border',
  },
  'design-status-designer': {
    dot: 'bg-burst-muted',
    text: 'text-burst-muted',
    bg: 'bg-white/5',
    border: 'border-burst-border',
  },
  'gestor-otimizacao': {
    dot: 'bg-burst-orange-bright',
    text: 'text-burst-orange-bright',
    bg: 'bg-burst-orange/5',
    border: 'border-burst-orange/30',
  },
  'bia-ativa': {
    dot: 'bg-green-400',
    text: 'text-green-400',
    bg: 'bg-green-500/5',
    border: 'border-green-500/30',
  },
  'bia-manutencao': {
    dot: 'bg-burst-warning',
    text: 'text-burst-warning',
    bg: 'bg-burst-warning/5',
    border: 'border-burst-warning/30',
  },
  'bia-outra': {
    dot: 'bg-burst-muted',
    text: 'text-burst-muted',
    bg: 'bg-white/5',
    border: 'border-burst-border',
  },
  'lead-primeiro': {
    dot: 'bg-burst-orange-bright',
    text: 'text-burst-orange-bright',
    bg: 'bg-burst-orange/5',
    border: 'border-burst-orange/30',
  },
  'lead-ultima-transf': {
    dot: 'bg-green-400',
    text: 'text-green-400',
    bg: 'bg-green-500/5',
    border: 'border-green-500/30',
  },
  'lead-volume-dia': {
    dot: 'bg-burst-orange-bright',
    text: 'text-burst-orange-bright',
    bg: 'bg-burst-orange/5',
    border: 'border-burst-orange/30',
  },
  'meta-campanha-spend': {
    dot: 'bg-burst-muted',
    text: 'text-burst-muted',
    bg: 'bg-white/5',
    border: 'border-burst-border',
  },
};

type Categoria = 'todos' | 'design' | 'bia' | 'trafego' | 'meta';

function normalizeBusca(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function TimelineCliente({ events }: Props) {
  const [categoria, setCategoria] = useState<Categoria>('todos');
  const [limit, setLimit] = useState(50);
  const [busca, setBusca] = useState('');

  const filtrados = useMemo(() => {
    let list = categoria === 'todos' ? events : events.filter((e) => e.category === categoria);
    const q = normalizeBusca(busca);
    if (q) {
      list = list.filter((e) => {
        const haystack = `${e.title} ${e.detail ?? ''} ${e.responsavel ?? ''}`;
        return normalizeBusca(haystack).includes(q);
      });
    }
    return list;
  }, [events, categoria, busca]);

  // Agrupa por dia pra renderizar headers de data
  const grupos = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const ev of filtrados.slice(0, limit)) {
      const dia = ev.date.slice(0, 10);
      const arr = map.get(dia) ?? [];
      arr.push(ev);
      map.set(dia, arr);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtrados, limit]);

  const counts = useMemo(() => {
    const c = { todos: events.length, design: 0, bia: 0, trafego: 0, meta: 0 };
    for (const e of events) c[e.category]++;
    return c;
  }, [events]);

  if (events.length === 0) {
    return (
      <section className="rounded-2xl bg-burst-card border border-burst-border p-6">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="text-burst-orange-bright" size={20} />
          <h3 className="font-display text-xl text-white tracking-wide">Linha do tempo</h3>
        </div>
        <div className="text-burst-muted text-sm text-center py-8">
          Sem eventos registrados pra esse cliente ainda.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-burst-card border border-burst-border p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <Clock className="text-burst-orange-bright" size={20} />
          <h3 className="font-display text-xl text-white tracking-wide">Linha do tempo</h3>
          <span className="text-xs text-burst-muted">
            {busca ? `${filtrados.length} de ${events.length}` : `${events.length}`} evento(s)
          </span>
        </div>
        <CategoryPills categoria={categoria} onChange={setCategoria} counts={counts} />
      </div>

      {/* Campo de busca */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-burst-muted" />
        <input
          type="text"
          placeholder="Buscar na linha do tempo (título, detalhe, responsável)..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full bg-black/40 border border-burst-border rounded-lg pl-9 pr-9 py-2 text-sm text-white focus:outline-none focus:border-burst-orange placeholder:text-burst-muted/60"
        />
        {busca && (
          <button
            onClick={() => setBusca('')}
            title="Limpar busca"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-burst-muted hover:bg-white/5 hover:text-white"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {filtrados.length === 0 ? (
        <div className="text-burst-muted text-sm text-center py-8">
          {busca
            ? `Nenhum evento contém "${busca}".`
            : 'Sem eventos nessa categoria.'}
        </div>
      ) : (
        <div className="space-y-5">
          {grupos.map(([dia, evs]) => (
            <DiaGrupo key={dia} dia={dia} eventos={evs} />
          ))}
        </div>
      )}

      {filtrados.length > limit && (
        <button
          onClick={() => setLimit((l) => l + 50)}
          className="w-full mt-4 py-2 rounded-lg border border-burst-border text-xs text-burst-muted hover:bg-white/5 hover:text-white transition-colors"
        >
          Mostrar mais {Math.min(50, filtrados.length - limit)} evento(s) ({filtrados.length - limit} restante)
        </button>
      )}
    </section>
  );
}

function CategoryPills({
  categoria,
  onChange,
  counts,
}: {
  categoria: Categoria;
  onChange: (v: Categoria) => void;
  counts: Record<Categoria, number>;
}) {
  // Cores combinam com a barra lateral dos eventos (AREA_COLORS)
  const opts: { key: Categoria; label: string; dot: string; activeBg: string; activeText: string }[] = [
    { key: 'todos', label: 'Tudo', dot: 'bg-white', activeBg: 'bg-burst-orange/20', activeText: 'text-burst-orange-bright' },
    { key: 'design', label: 'Design', dot: 'bg-purple-400', activeBg: 'bg-purple-500/20', activeText: 'text-purple-400' },
    { key: 'trafego', label: 'Gestor / Tráfego', dot: 'bg-blue-400', activeBg: 'bg-blue-500/20', activeText: 'text-blue-400' },
    { key: 'bia', label: 'CS / Bia', dot: 'bg-teal-400', activeBg: 'bg-teal-500/20', activeText: 'text-teal-400' },
  ];
  return (
    <div className="flex items-center gap-1 bg-black/30 border border-burst-border rounded-lg p-1 flex-wrap">
      {opts.map((o) => {
        const active = categoria === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={[
              'px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1.5',
              active
                ? `${o.activeBg} ${o.activeText}`
                : 'text-burst-muted hover:bg-white/5 hover:text-white',
            ].join(' ')}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${o.dot}`} />
            {o.label}
            <span className="text-[10px] text-burst-muted/80">{counts[o.key]}</span>
          </button>
        );
      })}
    </div>
  );
}

function DiaGrupo({ dia, eventos }: { dia: string; eventos: TimelineEvent[] }) {
  const dateLabel = formatDiaHeader(dia);
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-burst-muted mb-2 flex items-center gap-2">
        <span className="font-mono">{dateLabel}</span>
        <span className="flex-1 h-px bg-burst-border" />
        <span className="text-burst-muted/60">{eventos.length} evento(s)</span>
      </div>
      <ul className="flex flex-col gap-2">
        {eventos.map((ev, i) => (
          <EventoRow key={i} event={ev} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Cor da BARRA LATERAL esquerda de cada evento — distingue ÁREA do app
 * de relance: Design (roxo), Gestor/Tráfego (azul), CS/Bia (teal).
 * Diferente das cores específicas de cada tipo (verde/laranja/vermelho por
 * status). A barra é o leitura rápida da "fonte" do evento.
 */
const AREA_COLORS: Record<TimelineEvent['category'], { bar: string; label: string; labelCls: string }> = {
  design: { bar: 'bg-purple-400', label: 'Design', labelCls: 'text-purple-400' },
  meta: { bar: 'bg-blue-400', label: 'Gestor', labelCls: 'text-blue-400' },
  trafego: { bar: 'bg-blue-400', label: 'Gestor', labelCls: 'text-blue-400' },
  bia: { bar: 'bg-teal-400', label: 'CS / Bia', labelCls: 'text-teal-400' },
};

function EventoRow({ event }: { event: TimelineEvent }) {
  const Icon = ICONS[event.type] ?? Activity;
  const c = COLORS[event.type];
  const area = AREA_COLORS[event.category];
  const hora = event.date.slice(11, 16);

  const inner = (
    <>
      {/* Barra lateral colorida — indica ÁREA (Design/Gestor/CS) */}
      <div className={`w-1 self-stretch rounded-full shrink-0 ${area.bar}`} />
      <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
        <div className={`w-2 h-2 rounded-full ${c.dot}`} />
        <span className="text-[9px] font-mono text-burst-muted">{hora}</span>
      </div>
      <Icon size={14} className={`${c.text} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[9px] uppercase tracking-widest font-bold ${area.labelCls}`}>
            {area.label}
          </span>
          <div className="text-sm text-white/95 break-words flex-1 min-w-0">{event.title}</div>
        </div>
        {event.detail && (
          <div className="text-xs text-burst-muted mt-0.5">{event.detail}</div>
        )}
        {event.responsavel && (
          <div className="text-[10px] text-burst-muted/80 mt-0.5">
            por <span className="text-white/80">{event.responsavel}</span>
          </div>
        )}
        {event.updates && event.updates.length > 0 && (
          <div className="mt-2 space-y-1.5 border-l-2 border-burst-orange/30 pl-2.5">
            {event.updates.map((u, i) => (
              <div key={i} className="text-[11px] text-burst-muted leading-snug">
                <div className="text-white/85 whitespace-pre-wrap break-words">
                  {u.text.length > 240 ? u.text.slice(0, 240) + '…' : u.text}
                </div>
                {(u.creatorName || u.createdAt) && (
                  <div className="text-[10px] text-burst-muted/70 mt-0.5">
                    {u.creatorName && <span>— {u.creatorName}</span>}
                    {u.createdAt && (
                      <span className="ml-1">
                        ({new Date(u.createdAt).toLocaleDateString('pt-BR')})
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {event.link && (
        <ExternalLink size={14} className="text-burst-muted shrink-0 mt-0.5" />
      )}
    </>
  );

  // Quando tem link, a linha INTEIRA vira um <a> clicável → abre no Monday.
  if (event.link) {
    return (
      <li>
        <a
          href={event.link}
          target="_blank"
          rel="noreferrer"
          title="Abrir no Monday"
          className={`rounded-lg ${c.bg} border ${c.border} px-3 py-2 flex items-start gap-3 transition-all hover:-translate-y-[1px] hover:bg-white/5 hover:border-burst-orange/50 cursor-pointer no-underline`}
        >
          {inner}
        </a>
      </li>
    );
  }
  // Sem link: renderiza só o conteúdo sem hover/click.
  return (
    <li className={`rounded-lg ${c.bg} border ${c.border} px-3 py-2 flex items-start gap-3`}>
      {inner}
    </li>
  );
}

function formatDiaHeader(dia: string): string {
  // "2026-05-12" → "12 mai 2026"
  const [y, m, d] = dia.split('-');
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const mi = parseInt(m, 10) - 1;
  if (mi < 0 || mi > 11) return dia;
  // Hoje / ontem
  const hoje = new Date();
  const ev = new Date(parseInt(y, 10), mi, parseInt(d, 10));
  const diffDias = Math.floor((hoje.getTime() - ev.getTime()) / 86400000);
  if (diffDias === 0) return 'HOJE';
  if (diffDias === 1) return 'ONTEM';
  if (diffDias < 7) return `há ${diffDias} dias`;
  return `${d} ${meses[mi]} ${y}`;
}

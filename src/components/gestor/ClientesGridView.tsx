import { useMemo, useState } from 'react';
import { Search, DollarSign, ArrowDownRight, UserX, Activity, AlertTriangle, Trophy, Users, MessageCircle, PhoneOff } from 'lucide-react';
import type { ClientMetrics } from '../../lib/gestorMetrics';
import { brl, tierColorCpt, tierForCpt } from '../../lib/gestorMetrics';

interface Props {
  clients: ClientMetrics[];
  onClickClient?: (cm: ClientMetrics) => void;
}

type FiltroVisao = 'todos' | 'ativos' | 'problemas' | 'melhores';

/**
 * Versao "grid de cards" da lista de clientes — substitui a ClientesTable
 * densa por algo mais visual (1 card por cliente, com cor pelo tier do CPT
 * e badges destacando status). Pensado pro popup grande do PainelMini de
 * Gestor e CS, onde o foco é comparacao rapida.
 *
 * Filtros visuais:
 *  - Todos: lista inteira
 *  - Ativos: so com Bia ativa
 *  - Problemas: gastou mas 0 transf (dinheiro queimando)
 *  - Melhores: top performers (transf > 0, ordenado por CPT)
 */
export function ClientesGridView({ clients, onClickClient }: Props) {
  const [query, setQuery] = useState('');
  // Default = 'ativos' — abre mostrando so quem ta valendo no projeto.
  // Pra ver inativos/churn, usuario clica em "Todos" no chip de cima.
  const [filtro, setFiltro] = useState<FiltroVisao>('ativos');

  // Helper: cliente onde > 50% dos chats foram interrompidos.
  // Problema do Bia (script/funil), nao do CS/gestor. Exclui de "Problemas"
  // pra nao penalizar quem nao tem culpa.
  const isBiaInterrompendo = (c: ClientMetrics) => {
    const total = c.mensagensIniciadas + c.chatsInterrompidos;
    if (total === 0) return false;
    return (c.chatsInterrompidos / total) > 0.5;
  };

  const counts = useMemo(() => {
    const ativos = clients.filter((c) => !c.inactive);
    const problemas = ativos.filter((c) => c.spend > 0 && c.transferencias === 0 && !isBiaInterrompendo(c));
    const melhores = ativos.filter((c) => c.transferencias > 0);
    return {
      todos: clients.length,
      ativos: ativos.length,
      problemas: problemas.length,
      melhores: melhores.length,
    };
  }, [clients]);

  const filtered = useMemo(() => {
    let base = clients;
    if (filtro === 'ativos') base = base.filter((c) => !c.inactive);
    else if (filtro === 'problemas') base = base.filter((c) => !c.inactive && c.spend > 0 && c.transferencias === 0 && !isBiaInterrompendo(c));
    else if (filtro === 'melhores') base = base.filter((c) => !c.inactive && c.transferencias > 0);

    if (query.trim()) {
      const q = query.toLowerCase();
      base = base.filter(
        (c) =>
          c.client.name.toLowerCase().includes(q) ||
          (c.client.cs ?? '').toLowerCase().includes(q) ||
          (c.client.gestor ?? '').toLowerCase().includes(q) ||
          (c.doutorMatch ?? '').toLowerCase().includes(q)
      );
    }

    // Ordenacao padrao: ativos primeiro, depois transferencias desc, depois spend desc
    return [...base].sort((a, b) => {
      if (a.inactive !== b.inactive) return a.inactive ? 1 : -1;
      if (b.transferencias !== a.transferencias) return b.transferencias - a.transferencias;
      return b.spend - a.spend;
    });
  }, [clients, query, filtro]);

  return (
    <div className="flex flex-col gap-4">
      {/* Search + filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2 flex-1">
          <Search size={14} className="text-burst-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente, CS, gestor ou doutor..."
            className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted min-w-0"
          />
          <span className="text-xs text-burst-muted shrink-0">
            {filtered.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <ChipFiltro label="Todos" count={counts.todos} active={filtro === 'todos'} onClick={() => setFiltro('todos')} accent="muted" icon={<Users size={11} />} />
          <ChipFiltro label="Ativos" count={counts.ativos} active={filtro === 'ativos'} onClick={() => setFiltro('ativos')} accent="info" icon={<Activity size={11} />} />
          <ChipFiltro label="Melhores" count={counts.melhores} active={filtro === 'melhores'} onClick={() => setFiltro('melhores')} accent="success" icon={<Trophy size={11} />} />
          <ChipFiltro label="Problemas" count={counts.problemas} active={filtro === 'problemas'} onClick={() => setFiltro('problemas')} accent="danger" icon={<AlertTriangle size={11} />} />
        </div>
      </div>

      {/* Grid de cards */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-burst-border bg-burst-card/40 p-12 text-center">
          <Users size={28} className="text-burst-muted/50 mx-auto mb-3" />
          <p className="text-sm text-burst-muted">Nenhum cliente encontrado pra esses filtros.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((cm) => (
            <ClienteCard key={cm.client.id} cm={cm} onClick={onClickClient ? () => onClickClient(cm) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChipFiltro({
  label,
  count,
  active,
  onClick,
  accent,
  icon,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  accent: 'muted' | 'info' | 'success' | 'danger';
  icon: React.ReactNode;
}) {
  const cores = {
    muted: active ? 'border-burst-border bg-white/[0.08] text-white' : 'border-burst-border bg-black/30 text-burst-muted hover:text-white',
    info: active ? 'border-burst-orange-bright/60 bg-burst-orange/15 text-burst-orange-bright' : 'border-burst-border bg-black/30 text-burst-muted hover:text-burst-orange-bright',
    success: active ? 'border-green-500/60 bg-green-500/15 text-green-400' : 'border-burst-border bg-black/30 text-burst-muted hover:text-green-400',
    danger: active ? 'border-red-500/60 bg-red-500/15 text-red-400' : 'border-burst-border bg-black/30 text-burst-muted hover:text-red-400',
  }[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${cores}`}
    >
      {icon}
      <span>{label}</span>
      <span className={`text-[10px] font-mono px-1 rounded ${active ? 'bg-black/30' : 'bg-white/[0.04]'}`}>
        {count}
      </span>
    </button>
  );
}

function ClienteCard({ cm, onClick }: { cm: ClientMetrics; onClick?: () => void }) {
  const cptTier = tierForCpt(cm.cpt);
  const colors = tierColorCpt(cptTier);

  // Sintoma "Bia interrompendo": > 50% dos chats foram interrompidos.
  // Indica problema no funil/script (nao do CS/gestor).
  const totalInteracoes = cm.mensagensIniciadas + cm.chatsInterrompidos;
  const biaInterrompendo = totalInteracoes > 0 && (cm.chatsInterrompidos / totalInteracoes) > 0.5;

  // Classifica visualmente — prioridade: inativo > churn > bia parando > queimando > top
  let statusBadge: { label: string; cls: string } | null = null;
  if (cm.inactive) {
    statusBadge = { label: 'inativo', cls: 'bg-burst-warning/15 text-burst-warning border-burst-warning/40' };
  } else if (cm.churned) {
    statusBadge = { label: 'churn', cls: 'bg-red-500/15 text-red-400 border-red-500/40' };
  } else if (biaInterrompendo) {
    statusBadge = { label: 'bia parando', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/40' };
  } else if (cm.spend > 0 && cm.transferencias === 0) {
    statusBadge = { label: 'queimando', cls: 'bg-red-500/15 text-red-400 border-red-500/40' };
  } else if (cm.transferencias > 0 && cm.cpt !== null && cm.cpt < 120) {
    statusBadge = { label: 'top', cls: 'bg-green-500/15 text-green-400 border-green-500/40' };
  }

  // Cor da borda principal pela "severidade visual"
  let borderCls = 'border-burst-border';
  let glowCls = '';
  if (cm.inactive) {
    borderCls = 'border-burst-warning/30';
  } else if (cm.churned) {
    borderCls = 'border-red-500/50';
    glowCls = 'shadow-[0_0_20px_rgba(239,68,68,0.15)]';
  } else if (biaInterrompendo) {
    // Roxo pra diferenciar do "queimando" — sinaliza problema do Bia
    borderCls = 'border-purple-500/50';
    glowCls = 'shadow-[0_0_20px_rgba(168,85,247,0.15)]';
  } else if (cm.spend > 0 && cm.transferencias === 0) {
    borderCls = 'border-red-500/50';
    glowCls = 'shadow-[0_0_20px_rgba(239,68,68,0.15)]';
  } else if (cm.transferencias > 0 && cm.cpt !== null && cm.cpt < 120) {
    borderCls = 'border-green-500/50';
    glowCls = 'shadow-[0_0_20px_rgba(34,197,94,0.15)]';
  } else if (cm.transferencias > 0 && cm.cpt !== null && cm.cpt <= 170) {
    borderCls = 'border-burst-orange/40';
  }

  const cptLabel = cm.cpt === null ? '—' : brl(cm.cpt);
  const cptText = cm.cpt === null ? 'text-burst-muted' : colors.text;

  const content = (
    <>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className={`font-display text-base leading-tight truncate ${cm.inactive ? 'text-white/50' : 'text-white'}`} title={cm.client.name}>
            {cm.client.name}
          </h3>
          {cm.client.groupTitle && (
            <div className="text-[10px] text-burst-muted truncate mt-0.5">{cm.client.groupTitle}</div>
          )}
        </div>
        {statusBadge && (
          <span className={`shrink-0 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border ${statusBadge.cls} flex items-center gap-1`}>
            {statusBadge.label === 'churn' && <UserX size={9} />}
            {statusBadge.label === 'queimando' && <AlertTriangle size={9} />}
            {statusBadge.label === 'bia parando' && <PhoneOff size={9} />}
            {statusBadge.label === 'top' && <Trophy size={9} />}
            {statusBadge.label}
          </span>
        )}
      </div>

      {/* Stats em linha — narrativa: Leads chegaram -> Transf -> Gasto -> CPT.
          4 colunas pra mostrar a jornada completa do funil. */}
      <div className="grid grid-cols-4 gap-1.5 mb-2">
        <div className="rounded-lg bg-black/30 border border-burst-border px-1.5 py-1.5">
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
            <MessageCircle size={9} /> Leads
          </div>
          <div className={`font-display text-base ${cm.mensagensIniciadas > 0 ? 'text-white' : 'text-burst-muted'}`}>
            {cm.mensagensIniciadas}
          </div>
        </div>
        <div className="rounded-lg bg-black/30 border border-burst-border px-1.5 py-1.5">
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
            <ArrowDownRight size={9} /> Transf.
          </div>
          <div className={`font-display text-base ${cm.transferencias > 0 ? 'text-burst-orange-bright' : 'text-burst-muted'}`}>
            {cm.transferencias}
          </div>
        </div>
        <div className="rounded-lg bg-black/30 border border-burst-border px-1.5 py-1.5">
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
            <DollarSign size={9} /> Gasto
          </div>
          <div className={`font-mono text-xs ${cm.spend > 0 ? 'text-white' : 'text-burst-muted'}`}>
            {brl(cm.spend)}
          </div>
        </div>
        <div className={`rounded-lg border px-1.5 py-1.5 ${colors.bg} ${colors.border}`}>
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
            CPT
          </div>
          <div className={`font-display text-base ${cptText}`}>{cptLabel}</div>
        </div>
      </div>

      {/* Alerta de chats interrompidos — quando relevante */}
      {cm.chatsInterrompidos > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] pt-1.5 mb-1">
          <PhoneOff size={10} className={biaInterrompendo ? 'text-purple-300' : 'text-burst-muted/70'} />
          <span className={biaInterrompendo ? 'text-purple-300 font-semibold' : 'text-burst-muted/80'}>
            {cm.chatsInterrompidos} chat(s) interrompido(s)
          </span>
          {biaInterrompendo && (
            <span className="text-purple-300/70 italic">
              · problema do Bia
            </span>
          )}
        </div>
      )}

      {/* Linha de meta info (gestor, CS) */}
      {(cm.client.gestor || cm.client.cs) && (
        <div className="flex items-center gap-3 text-[10px] text-burst-muted pt-2 border-t border-burst-border/40">
          {cm.client.gestor && (
            <span className="truncate">
              <span className="text-burst-muted/70">Gestor:</span>{' '}
              <span className="text-white/80 font-semibold">{cm.client.gestor}</span>
            </span>
          )}
          {cm.client.cs && (
            <span className="truncate">
              <span className="text-burst-muted/70">CS:</span>{' '}
              <span className="text-white/80 font-semibold">{cm.client.cs}</span>
            </span>
          )}
        </div>
      )}
    </>
  );

  const baseCls = `rounded-xl border-2 ${borderCls} ${glowCls} bg-burst-card p-3 transition-all`;

  if (!onClick) {
    return <div className={baseCls}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={`Ver detalhes de ${cm.client.name}`}
      className={`${baseCls} text-left w-full hover:-translate-y-[2px] hover:border-burst-orange-bright/70 hover:shadow-orange-glow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-burst-orange/40`}
    >
      {content}
    </button>
  );
}

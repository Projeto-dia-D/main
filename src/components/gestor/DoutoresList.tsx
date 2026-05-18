import { useMemo, useState } from 'react';
import { Search, MessageCircle, ArrowDownRight, DollarSign, UserX, AlertOctagon } from 'lucide-react';
import type { ClientMetrics } from '../../lib/gestorMetrics';
import { brl, tierColorCpt, tierForCpt } from '../../lib/gestorMetrics';

interface Props {
  clients: ClientMetrics[];
}

/**
 * Lista visual e simplificada de doutores/clientes — usada nos drill-downs
 * dos cards de CS e Gestor. Foco: nome do cliente, status (ativo/inativo),
 * número de mensagens, transferências, spend e CPT.
 */
export function DoutoresList({ clients }: Props) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'todos' | 'ativos' | 'inativos'>('todos');

  const filtered = useMemo(() => {
    let list = clients;
    if (tab === 'ativos') list = list.filter((c) => !c.inactive);
    else if (tab === 'inativos') list = list.filter((c) => c.inactive);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (c) =>
          c.client.name.toLowerCase().includes(q) ||
          (c.doutorMatch ?? '').toLowerCase().includes(q)
      );
    }
    // Ordena: ativos primeiro, depois por CPT ascendente (melhores primeiro),
    // null por último.
    return [...list].sort((a, b) => {
      if (a.inactive !== b.inactive) return a.inactive ? 1 : -1;
      if (a.cpt === null && b.cpt === null) return b.transferencias - a.transferencias;
      if (a.cpt === null) return 1;
      if (b.cpt === null) return -1;
      return a.cpt - b.cpt;
    });
  }, [clients, query, tab]);

  const counts = useMemo(() => ({
    todos: clients.length,
    ativos: clients.filter((c) => !c.inactive).length,
    inativos: clients.filter((c) => c.inactive).length,
  }), [clients]);

  return (
    <div className="flex flex-col gap-3">
      {/* Tabs + busca */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-burst-card border border-burst-border rounded-lg p-1">
          {(['todos', 'ativos', 'inativos'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'px-3 py-1 rounded-md text-xs font-semibold transition-colors',
                tab === t
                  ? 'bg-burst-orange/20 text-burst-orange-bright'
                  : 'text-burst-muted hover:text-white hover:bg-white/5',
              ].join(' ')}
            >
              {t === 'todos' ? 'Todos' : t === 'ativos' ? 'Bia ativa' : 'Inativos'}
              <span className="ml-1.5 text-burst-muted/80">({counts[t]})</span>
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2">
          <Search size={14} className="text-burst-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar doutor..."
            className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
          />
          <span className="text-xs text-burst-muted">{filtered.length}</span>
        </div>
      </div>

      {/* Lista de cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[70vh] overflow-y-auto scrollbar-thin pr-1">
        {filtered.map((cm) => (
          <DoutorRow key={cm.client.id} cm={cm} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-burst-muted text-sm py-8">
            Nenhum doutor encontrado.
          </div>
        )}
      </div>
    </div>
  );
}

function DoutorRow({ cm }: { cm: ClientMetrics }) {
  const cptTier = tierForCpt(cm.cpt);
  const colors = tierColorCpt(cptTier);

  return (
    <div
      className={[
        'rounded-lg border bg-burst-card p-3 transition-all',
        cm.inactive ? 'border-burst-border opacity-60' : `${colors.border}`,
      ].join(' ')}
      title={cm.inactive ? 'Sem Bia ativa — não conta no total' : undefined}
    >
      {/* Header — nome + badges */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">
            {cm.client.name}
          </div>
          {cm.doutorMatch && cm.doutorMatch !== cm.client.name && (
            <div className="text-[10px] text-burst-muted truncate mt-0.5">
              DB: {cm.doutorMatch}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {cm.inactive && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-burst-warning/15 text-burst-warning border border-burst-warning/30">
              <AlertOctagon size={9} /> inativo
            </span>
          )}
          {cm.churned && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400">
              <UserX size={9} /> churn
            </span>
          )}
        </div>
      </div>

      {/* Stats em linha */}
      <div className="grid grid-cols-4 gap-2 text-[11px]">
        <Stat icon={<MessageCircle size={11} />} label="Msgs" value={cm.mensagensIniciadas} />
        <Stat
          icon={<ArrowDownRight size={11} />}
          label="Transf"
          value={cm.transferencias}
          highlight={cm.transferencias > 0}
        />
        <Stat icon={<DollarSign size={11} />} label="Gasto" value={brl(cm.spend)} small />
        <Stat
          label="CPT"
          value={cm.cpt === null ? '—' : brl(cm.cpt)}
          small
          color={cm.cpt === null ? undefined : colors.text}
        />
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  highlight,
  small,
  color,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number | string;
  highlight?: boolean;
  small?: boolean;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-start">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
        {icon} {label}
      </div>
      <div
        className={[
          'font-display tabular-nums',
          small ? 'text-sm' : 'text-base',
          color ?? (highlight ? 'text-burst-orange-bright' : 'text-white'),
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  );
}

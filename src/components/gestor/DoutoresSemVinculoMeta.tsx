import { useMemo, useState } from 'react';
import { AlertTriangle, Link2, ChevronDown, ChevronUp, Users } from 'lucide-react';
import type { MondayClient } from '../../lib/monday';
import { isClientElegivelMeta } from '../../lib/monday';
import type { ClientMetaLink } from '../../lib/linkStorage';

interface Props {
  /** Lista COMPLETA de clientes (clientsAll com churnados/pausados/juridico). */
  allClients: MondayClient[];
  /** Vínculos existentes — pra filtrar quem já tem vínculo. */
  links: ClientMetaLink[];
  /** Click "Vincular" abre o modal de vinculações já filtrando pelo cliente. */
  onAbrirVinculacoes?: () => void;
}

/**
 * Banner que lista doutores ATIVOS na Burst (não churn, não pausa, não jurídico)
 * que ainda não têm conta Meta vinculada. Aparece quando há ≥1 caso.
 *
 * Objetivo: dar visibilidade pro time vincular esses clientes — campanhas
 * deles existem no Meta mas a app não sabe atribuir spend, então caem como
 * "campanhas órfãs".
 */
export function DoutoresSemVinculoMeta({ allClients, links, onAbrirVinculacoes }: Props) {
  const [expanded, setExpanded] = useState(false);

  const semVinculo = useMemo(() => {
    const linkedIds = new Set(links.map((l) => l.monday_client_id));
    return allClients
      .filter((c) => isClientElegivelMeta(c))
      .filter((c) => !linkedIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allClients, links]);

  if (semVinculo.length === 0) return null;

  return (
    <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3 flex-wrap">
        <AlertTriangle size={20} className="text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-display text-lg text-white tracking-wide flex items-center gap-2 flex-wrap">
            <span>{semVinculo.length} doutor(es) ativos sem conta Meta vinculada</span>
            <span className="text-xs uppercase tracking-widest text-red-400 px-2 py-0.5 rounded bg-red-500/10 border border-red-500/30">
              Crítico
            </span>
          </div>
          <p className="text-sm text-burst-muted mt-1">
            Doutores que rodam tráfego na Burst (não churn, não pausados, não jurídico) e
            ainda não têm conta Meta vinculada — o spend deles não aparece nas métricas.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onAbrirVinculacoes && (
            <button
              onClick={onAbrirVinculacoes}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-burst-orange/20 border border-burst-orange/50 hover:bg-burst-orange/30 text-burst-orange-bright text-sm font-semibold transition-colors"
            >
              <Link2 size={14} />
              Vincular agora
            </button>
          )}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 text-xs text-burst-muted hover:text-white"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {expanded ? 'Ocultar' : 'Ver lista'}
          </button>
        </div>
      </div>

      {expanded && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-72 overflow-y-auto scrollbar-thin pr-1">
          {semVinculo.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded bg-black/30 border border-burst-border text-xs"
            >
              <Users size={11} className="text-burst-orange-bright shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-white/95 truncate" title={c.name}>{c.name}</div>
                <div className="text-[10px] text-burst-muted truncate">
                  {c.gestor && <span>Gestor: {c.gestor}</span>}
                  {c.gestor && c.cs && <span> · </span>}
                  {c.cs && <span>CS: {c.cs}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

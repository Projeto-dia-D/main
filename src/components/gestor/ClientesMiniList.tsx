import { Users } from 'lucide-react';
import { brl, type ClientMetrics } from '../../lib/gestorMetrics';

interface Props {
  clients: ClientMetrics[];
  onClickCliente?: (cm: ClientMetrics) => void;
  /** Texto pra header (default "Todos os clientes"). */
  title?: string;
}

/**
 * Lista enxuta de TODOS os clientes de um CS/Gestor. Cada linha tem:
 * - Nome do cliente
 * - Transferências
 * - Spend
 * - CPT (colorido por tier)
 *
 * Scrollável quando passa de ~8 linhas. Cada linha é clicável (abre
 * ClienteDrilldown via onClickCliente).
 */
export function ClientesMiniList({ clients, onClickCliente, title = 'Todos os clientes' }: Props) {
  if (clients.length === 0) return null;

  // Ordena por transferências desc, depois por spend desc
  const sorted = [...clients].sort((a, b) => {
    if (b.transferencias !== a.transferencias) return b.transferencias - a.transferencias;
    return b.spend - a.spend;
  });

  return (
    <div className="border-t border-burst-border pt-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-burst-muted mb-2">
        <Users size={11} />
        <span>{title}</span>
        <span className="text-burst-muted/60">· {clients.length}</span>
      </div>
      <ul className="flex flex-col gap-1 max-h-56 overflow-y-auto scrollbar-thin pr-1">
        {sorted.map((cm) => {
          const cptColor = cptColorClass(cm.cpt);
          const row = (
            <>
              <span
                className={`flex-1 truncate text-xs ${cm.inactive ? 'text-white/40' : 'text-white/85'}`}
              >
                {cm.client.name}
              </span>
              {cm.inactive && (
                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-burst-warning/15 text-burst-warning border border-burst-warning/30">
                  inativo
                </span>
              )}
              <span className="text-burst-orange-bright font-mono text-xs w-8 text-right shrink-0">
                {cm.transferencias}
              </span>
              <span className="text-burst-muted text-[10px] font-mono w-16 text-right shrink-0">
                {brl(cm.spend)}
              </span>
              <span className={`font-mono text-[10px] w-16 text-right shrink-0 ${cptColor}`}>
                {cm.cpt === null ? '—' : brl(cm.cpt)}
              </span>
            </>
          );
          if (!onClickCliente) {
            return (
              <li
                key={cm.client.id}
                className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-black/20"
                title={cm.inactive ? 'Sem Bia ativa — não conta no total' : undefined}
              >
                {row}
              </li>
            );
          }
          return (
            <li key={cm.client.id}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClickCliente(cm); }}
                title={`Ver detalhes de ${cm.client.name}`}
                className="w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-black/20 hover:bg-black/40 hover:ring-1 hover:ring-burst-orange/40 transition-all focus:outline-none focus:ring-1 focus:ring-burst-orange/60"
              >
                {row}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function cptColorClass(cpt: number | null): string {
  if (cpt === null) return 'text-burst-muted';
  if (cpt < 120) return 'text-green-400';
  if (cpt <= 170) return 'text-burst-orange-bright';
  return 'text-red-400';
}

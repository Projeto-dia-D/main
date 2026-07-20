import { useMemo } from 'react';
import {
  Trophy,
  AlertTriangle,
  ArrowDownRight,
  MessagesSquare,
  Users,
} from 'lucide-react';
import { brl, type ClientMetrics } from '../../lib/gestorMetrics';
import { ClientesGridView } from './ClientesGridView';

/**
 * Bloco reutilizável que mostra 4 perspectivas mutuamente exclusivas dos
 * clientes + a lista completa (ClientesGridView com filtros).
 *
 * Usado em:
 *  - Perfil pessoal de CS (PerfilPessoalCs)
 *  - Perfil pessoal de Gestor (PerfilPessoalGestor)
 *  - Visão geral admin (CS.tsx e GestorTrafego.tsx, abaixo do PainelGeral)
 *
 * As 4 listas (Melhores, Piores, Menos transf, Menos leads) garantem que
 * um mesmo cliente aparece em apenas UMA delas. Em todas, exclui clientes
 * onde > 50% dos chats foram interrompidos pela CRC (atendimento manual —
 * funil não-avaliável).
 */
interface Props {
  clients: ClientMetrics[];
  onClickCliente?: (cm: ClientMetrics) => void;
  /** Label customizado pra contagem na seção "Todos os clientes". Ex:
   *  "{N} sob sua responsabilidade" (CS) vs "{N} sob sua gestão" (Gestor).
   *  Default: "{N} clientes". */
  totalLabelSuffix?: string;
}

export function ListasClientes({ clients, onClickCliente, totalLabelSuffix }: Props) {
  const { melhores, piores, menosTransferencias, menosLeads } = useMemo(() => {
    const ativos = clients.filter((c) => !c.inactive);

    const isCrcAtendendo = (c: ClientMetrics) => {
      const total = c.mensagensIniciadas + c.chatsInterrompidos;
      if (total === 0) return false;
      return c.chatsInterrompidos / total > 0.5;
    };

    // 1) Melhores — transf > 0, top 5 por transf desc (empate por CPT menor)
    const melhores = [...ativos]
      .filter((c) => c.transferencias > 0)
      .sort((a, b) => {
        if (b.transferencias !== a.transferencias) {
          return b.transferencias - a.transferencias;
        }
        return (a.cpt ?? Infinity) - (b.cpt ?? Infinity);
      })
      .slice(0, 5);
    const melhoresIds = new Set(melhores.map((c) => c.client.id));

    // 2) Piores — gastou mas converteu mal. Exclui CRC e melhores.
    const piores = [...ativos]
      .filter((c) => c.spend > 0 && (c.transferencias === 0 || (c.cpt ?? 0) > 100))
      .filter((c) => !isCrcAtendendo(c))
      .filter((c) => !melhoresIds.has(c.client.id))
      .sort((a, b) => {
        if (b.spend !== a.spend) return b.spend - a.spend;
        return (b.cpt ?? 0) - (a.cpt ?? 0);
      })
      .slice(0, 5);
    const pioresIds = new Set(piores.map((c) => c.client.id));

    // 3) Menos transferências — sobras, menos transf primeiro (empate: mais leads)
    const menosTransferencias = [...ativos]
      .filter((c) => !melhoresIds.has(c.client.id) && !pioresIds.has(c.client.id))
      .filter((c) => !isCrcAtendendo(c))
      .filter((c) => c.mensagensIniciadas > 0)
      .sort((a, b) => {
        if (a.transferencias !== b.transferencias) {
          return a.transferencias - b.transferencias;
        }
        return b.mensagensIniciadas - a.mensagensIniciadas;
      })
      .slice(0, 5);
    const menosTransfIds = new Set(menosTransferencias.map((c) => c.client.id));

    // 4) Menos leads — sobras das 3 anteriores
    const menosLeads = [...ativos]
      .filter(
        (c) =>
          !melhoresIds.has(c.client.id) &&
          !pioresIds.has(c.client.id) &&
          !menosTransfIds.has(c.client.id),
      )
      .filter((c) => !isCrcAtendendo(c))
      .filter((c) => c.mensagensIniciadas > 0)
      .sort((a, b) => a.mensagensIniciadas - b.mensagensIniciadas)
      .slice(0, 5);

    return { melhores, piores, menosTransferencias, menosLeads };
  }, [clients]);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ClientesPanel
          title="Melhores clientes"
          subtitle="Maior número de transferências"
          icon={<Trophy size={18} className="text-green-400" />}
          tone="success"
          clients={melhores}
          emptyMsg="Nenhum cliente com transferências no período."
          onClickCliente={onClickCliente}
        />
        <ClientesPanel
          title="Piores clientes"
          subtitle="Gastaram mas converteram pouco — precisam de atenção"
          icon={<AlertTriangle size={18} className="text-red-400" />}
          tone="danger"
          clients={piores}
          emptyMsg="Todos os clientes estão convertendo bem 🎉"
          onClickCliente={onClickCliente}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ClientesPanel
          title="Menos transferências"
          subtitle="Receberam leads mas converteram pouco — investigar funil"
          icon={<ArrowDownRight size={18} className="text-burst-warning" />}
          tone="warning"
          clients={menosTransferencias}
          emptyMsg="Sem clientes nessa faixa no período."
          onClickCliente={onClickCliente}
          metric="transferencias"
        />
        <ClientesPanel
          title="Menos leads"
          subtitle="Volume baixo de mensagens — pode ser questão de tráfego / criativo"
          icon={<MessagesSquare size={18} className="text-blue-400" />}
          tone="info"
          clients={menosLeads}
          emptyMsg="Sem clientes nessa faixa no período."
          onClickCliente={onClickCliente}
          metric="mensagens"
        />
      </div>

      {clients.length > 0 && (
        <section className="rounded-2xl bg-burst-card border border-burst-border p-5 animate-slide-up">
          <div className="flex items-start gap-3 mb-4">
            <Users size={18} className="text-burst-orange-bright" />
            <div className="min-w-0">
              <h3 className="font-display text-xl text-white tracking-wide">
                Todos os clientes
              </h3>
              <p className="text-xs text-burst-muted mt-0.5">
                {clients.length} {totalLabelSuffix ?? 'cliente(s)'} — busca, filtros e drill por cliente
              </p>
            </div>
          </div>
          <ClientesGridView clients={clients} onClickClient={onClickCliente} />
        </section>
      )}
    </div>
  );
}

// ============================================================================
// Subcomponentes internos
// ============================================================================
type PanelTone = 'success' | 'danger' | 'warning' | 'info';
type PanelMetric = 'cpt' | 'transferencias' | 'mensagens';

const TONE_BORDER: Record<PanelTone, string> = {
  success: 'border-green-500/40',
  danger: 'border-red-500/40',
  warning: 'border-burst-warning/40',
  info: 'border-blue-500/40',
};
const TONE_RANK_BG: Record<PanelTone, string> = {
  success: 'bg-green-500/15 text-green-400 border-green-500/30',
  danger: 'bg-red-500/15 text-red-400 border-red-500/30',
  warning: 'bg-burst-warning/15 text-burst-warning border-burst-warning/30',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};
const TONE_TEXT: Record<PanelTone, string> = {
  success: 'text-green-400',
  danger: 'text-red-400',
  warning: 'text-burst-warning',
  info: 'text-blue-400',
};

function ClientesPanel({
  title,
  subtitle,
  icon,
  tone,
  clients,
  emptyMsg,
  onClickCliente,
  metric = 'cpt',
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  tone: PanelTone;
  clients: ClientMetrics[];
  emptyMsg: string;
  onClickCliente?: (cm: ClientMetrics) => void;
  metric?: PanelMetric;
}) {
  return (
    <section
      className={`rounded-2xl bg-burst-card border ${TONE_BORDER[tone]} p-5 animate-slide-up`}
    >
      <div className="flex items-start gap-3 mb-4">
        {icon}
        <div className="min-w-0">
          <h3 className="font-display text-xl text-white tracking-wide">{title}</h3>
          <p className="text-xs text-burst-muted mt-0.5">{subtitle}</p>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="text-burst-muted text-sm py-4 text-center">{emptyMsg}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {clients.map((c, idx) => (
            <ClienteRow
              key={c.client.id}
              cm={c}
              rank={idx + 1}
              tone={tone}
              metric={metric}
              onClick={onClickCliente ? () => onClickCliente(c) : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ClienteRow({
  cm,
  rank,
  tone,
  metric,
  onClick,
}: {
  cm: ClientMetrics;
  rank: number;
  tone: PanelTone;
  metric: PanelMetric;
  onClick?: () => void;
}) {
  const cls =
    'flex items-center gap-3 rounded-lg bg-black/30 border border-burst-border px-3 py-2.5 transition-colors w-full';

  let metricValue: string;
  let metricLabel: string;
  if (metric === 'transferencias') {
    metricValue = String(cm.transferencias);
    metricLabel = 'transf.';
  } else if (metric === 'mensagens') {
    metricValue = String(cm.mensagensIniciadas);
    metricLabel = 'msgs';
  } else {
    metricValue = cm.cpt === null ? '—' : brl(cm.cpt);
    metricLabel = 'CPT';
  }

  const inner = (
    <>
      <span
        className={`flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold border ${TONE_RANK_BG[tone]}`}
      >
        {rank}
      </span>
      <div className="flex-1 min-w-0 text-left">
        <div className="text-sm text-white truncate font-medium">{cm.client.name}</div>
        <div className="text-[11px] text-burst-muted">
          {cm.transferencias} transf. • {cm.mensagensIniciadas} msg • {brl(cm.spend)}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-display text-lg ${TONE_TEXT[tone]}`}>{metricValue}</div>
        <div className="text-[10px] uppercase tracking-wider text-burst-muted">{metricLabel}</div>
      </div>
    </>
  );

  if (onClick) {
    return (
      <li>
        <button
          type="button"
          onClick={onClick}
          title={`Ver detalhes de ${cm.client.name}`}
          className={`${cls} cursor-pointer hover:bg-black/50 hover:border-burst-orange/60 focus:outline-none focus:ring-1 focus:ring-burst-orange/40`}
        >
          {inner}
        </button>
      </li>
    );
  }
  return <li className={`${cls} hover:bg-black/40`}>{inner}</li>;
}

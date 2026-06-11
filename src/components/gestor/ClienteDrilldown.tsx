import { useState } from 'react';
import { MessageCircle, ArrowDownRight, DollarSign } from 'lucide-react';
import { brl, type ClientMetrics } from '../../lib/gestorMetrics';
import { isTransferido, isInterrompido, isChatIncompleto, isDesclassificado, formatBiaAtiva } from '../../lib/metrics';
import { AnimatedNumber } from '../AnimatedNumber';
import { LeadsTable } from '../programacao/LeadsTable';
import { TransferidosTable } from '../programacao/TransferidosTable';
import { CampanhasTable } from './CampanhasTable';

interface Props {
  cm: ClientMetrics;
}

type Tab = 'leads' | 'transferencias' | 'campanhas';

/**
 * Mostra detalhes de UM cliente: mensagens, transferências e campanhas.
 * Usado em vários lugares do app (cards mini de CS/Gestor, perfis pessoais).
 *
 * É um conteúdo de modal — quem renderiza decide o Modal wrapper.
 */
export function ClienteDrilldown({ cm }: Props) {
  const [tab, setTab] = useState<Tab>('leads');
  // allLeads inclui interrompidos/incompletos/desclassificados (pra visibilidade
  // na tabela). cm.leads é o filtrado (usado nas métricas).
  const todasMensagens = cm.allLeads ?? cm.leads;
  const transferidos = cm.leads.filter(isTransferido);
  const interrompidos = todasMensagens.filter(isInterrompido).length;
  const incompletos = todasMensagens.filter(isChatIncompleto).length;
  const desclassificados = todasMensagens.filter(isDesclassificado).length;
  const excluidos = interrompidos + incompletos + desclassificados;

  return (
    <div className="flex flex-col gap-4">
      {/* Stats overview */}
      <div className="grid grid-cols-3 gap-3">
        <StatTab
          icon={<MessageCircle size={13} />}
          label="Mensagens"
          value={todasMensagens.length}
          active={tab === 'leads'}
          onClick={() => setTab('leads')}
          subText={excluidos > 0 ? `${cm.mensagensIniciadas} ativas + ${excluidos} excluídas` : undefined}
        />
        <StatTab
          icon={<ArrowDownRight size={13} />}
          label="Transferências"
          value={transferidos.length}
          active={tab === 'transferencias'}
          onClick={() => setTab('transferencias')}
          accent
        />
        <StatTab
          icon={<DollarSign size={13} />}
          label="Investido (contando)"
          valueText={brl(cm.spend)}
          active={tab === 'campanhas'}
          onClick={() => setTab('campanhas')}
          subText={[
            cm.spendGoogle > 0
              ? `Meta ${brl(cm.spendMeta)} · Google ${brl(cm.spendGoogle)}`
              : null,
            cm.spendBrutoTotal != null && cm.spendBrutoTotal > cm.spend + 0.01
              ? `Total: ${brl(cm.spendBrutoTotal)}`
              : null,
          ].filter(Boolean).join('  •  ') || undefined}
        />
      </div>

      <div className="text-xs text-burst-muted">
        {cm.cpt !== null && (
          <span className="text-white">
            CPT: <span className="text-burst-orange-bright font-mono">{brl(cm.cpt)}</span>
            <span className="text-burst-muted/70 mx-2">•</span>
          </span>
        )}
        <span className="text-white">
          Bia ativa há: <span className="text-burst-orange-bright">{formatBiaAtiva(cm.biaAtivaMs)}</span>
          <span className="text-burst-muted/70 mx-2">•</span>
        </span>
        {cm.doutorMatch && (
          <span>
            Matched a doutor: <span className="text-white">{cm.doutorMatch}</span>
            <span className="text-burst-muted/70 mx-2">•</span>
          </span>
        )}
        {cm.inactive && (
          <span className="text-burst-warning">Bia inativa nesse momento</span>
        )}
      </div>

      {/* Detalhamento da quebra dos leads — visível só na tab de Mensagens */}
      {tab === 'leads' && excluidos > 0 && (
        <div className="rounded-lg bg-black/30 border border-burst-border px-3 py-2 text-[11px] text-burst-muted flex flex-wrap items-center gap-x-3 gap-y-1">
          <span><strong className="text-white">{todasMensagens.length}</strong> mensagens recebidas:</span>
          <span><span className="text-green-400 font-mono">{cm.mensagensIniciadas}</span> ativas</span>
          {interrompidos > 0 && <span><span className="text-burst-warning font-mono">{interrompidos}</span> chat interrompido</span>}
          {incompletos > 0 && <span><span className="text-burst-muted font-mono">{incompletos}</span> chat incompleto</span>}
          {desclassificados > 0 && <span><span className="text-red-400 font-mono">{desclassificados}</span> desclassificadas</span>}
        </div>
      )}

      {/* Conteúdo da tab */}
      <div className="border-t border-burst-border pt-4">
        {tab === 'leads' && <LeadsTable leads={todasMensagens} />}
        {tab === 'transferencias' && <TransferidosTable leads={transferidos} />}
        {tab === 'campanhas' && <CampanhasTable insights={cm.campaigns} />}
      </div>
    </div>
  );
}

function StatTab({
  icon,
  label,
  value,
  valueText,
  active,
  onClick,
  accent,
  subText,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  valueText?: string;
  active: boolean;
  onClick: () => void;
  accent?: boolean;
  subText?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-xl px-4 py-3 flex flex-col items-start gap-1 border text-left transition-all',
        active
          ? 'bg-burst-orange/15 border-burst-orange shadow-orange-glow-sm'
          : 'bg-black/30 border-burst-border hover:bg-black/40 hover:border-burst-orange/40',
      ].join(' ')}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-burst-muted">
        {icon} {label}
      </div>
      {value !== undefined ? (
        <AnimatedNumber
          value={value}
          className={`font-display text-2xl ${accent ? 'text-burst-orange-bright' : 'text-white'}`}
        />
      ) : (
        <span className={`font-display text-2xl ${accent ? 'text-burst-orange-bright' : 'text-white'}`}>
          {valueText}
        </span>
      )}
      {subText && (
        <span className="text-[10px] text-burst-muted/80 truncate w-full">{subText}</span>
      )}
    </button>
  );
}

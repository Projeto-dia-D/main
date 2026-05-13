import { useMemo, useState } from 'react';
import { useLeads } from '../../hooks/useLeads';
import { useInstanceMap } from '../../hooks/useInstanceMap';
import { useMondayClients } from '../../hooks/useMondayClients';
import { computeMetrics, filterByDateRange, isTransferido, type DateRange } from '../../lib/metrics';
import { PainelGeral } from '../programacao/PainelGeral';
import { RankingDoutores } from '../programacao/RankingDoutores';
import { Alertas } from '../programacao/Alertas';
import { ChatsInterrompidos } from '../programacao/ChatsInterrompidos';
import { ChatsIncompletos } from '../programacao/ChatsIncompletos';
import { TierImage } from '../programacao/TierImage';
import { DoutorCard } from '../programacao/DoutorCard';
import { DateRangeFilter } from '../programacao/DateRangeFilter';
import { LeadsTable } from '../programacao/LeadsTable';
import { TransferidosTable } from '../programacao/TransferidosTable';
import { DoutoresTable } from '../programacao/DoutoresTable';
import { Modal } from '../Modal';
import { Users, AlertTriangle, PhoneOff, FileWarning, ListChecks } from 'lucide-react';

type ModalKind = 'leads' | 'transferidos' | 'doutores' | 'interrompidos' | 'incompletos' | null;

export function Programacao() {
  const { leads, loading, error, lastUpdate, configMissing } = useLeads();
  const instanceMap = useInstanceMap();
  // Clients são carregados pra aplicar o corte de churn por cliente.
  // Programação usa TODOS os clientes (não apenas com Bia) pra que o churn
  // cutoff funcione independente do filtro de Bia Soft.
  const { allClients: mondayClients } = useMondayClients();

  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [openModal, setOpenModal] = useState<ModalKind>(null);

  const filteredLeads = useMemo(
    () => filterByDateRange(leads, range),
    [leads, range]
  );
  const summary = useMemo(
    () => computeMetrics(filteredLeads, range, instanceMap, mondayClients),
    [filteredLeads, range, instanceMap, mondayClients]
  );
  // ATENÇÃO: os modais e listas devem usar `summary.activeLeads`, nunca
  // `filteredLeads`. activeLeads já tirou chats interrompidos e incompletos.
  const transferidos = useMemo(
    () => summary.activeLeads.filter(isTransferido),
    [summary.activeLeads]
  );

  if (configMissing.length > 0) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-burst-orange/40 bg-burst-card p-8 max-w-2xl">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="text-burst-orange-bright" />
            <h2 className="font-display text-2xl text-white tracking-wider">
              Configuração necessária
            </h2>
          </div>
          <p className="text-burst-muted mb-4 text-sm">
            Renomeie <code className="text-burst-orange">.env.example</code> para{' '}
            <code className="text-burst-orange">.env</code> na raiz do projeto e preencha:
          </p>
          <ul className="space-y-1 font-mono text-sm">
            {configMissing.map((k) => (
              <li key={k} className="text-red-400">
                • {k}
              </li>
            ))}
          </ul>
          <p className="text-xs text-burst-muted mt-4">
            Depois rode <code className="text-burst-orange">npm run dev</code> novamente.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-burst-orange border-t-transparent animate-spin mx-auto mb-4" />
          <div className="text-burst-muted text-sm">Carregando dados...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-6">
          <div className="text-red-400 font-bold mb-2">Erro ao carregar</div>
          <div className="text-burst-muted text-sm font-mono">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <HeaderBadge
            icon={<ListChecks size={13} />}
            label="Ativos"
            value={summary.totalLeads}
            tone="orange"
            onClick={() => setOpenModal('leads')}
            title={`${summary.totalLeads} de ${leads.length} leads totais no período`}
          />
          {summary.chatsInterrompidos.length > 0 && (
            <HeaderBadge
              icon={<PhoneOff size={13} />}
              label="Interrompidos"
              value={summary.chatsInterrompidos.length}
              tone="red"
              onClick={() => setOpenModal('interrompidos')}
              title="Excluídos do cálculo — clique para ver"
            />
          )}
          {summary.chatsIncompletos.length > 0 && (
            <HeaderBadge
              icon={<FileWarning size={13} />}
              label="Incompletos"
              value={summary.chatsIncompletos.length}
              tone="yellow"
              onClick={() => setOpenModal('incompletos')}
              title="Excluídos do cálculo — clique para ver"
            />
          )}
        </div>
        <DateRangeFilter range={range} onChange={setRange} />
      </div>

      <PainelGeral
        summary={summary}
        lastUpdate={lastUpdate}
        onOpenLeads={() => setOpenModal('leads')}
        onOpenTransferidos={() => setOpenModal('transferidos')}
        onOpenDoutores={() => setOpenModal('doutores')}
      />
      {summary.totalTransferidos > 0 && <TierImage tier={summary.tier} />}
      <RankingDoutores doutores={summary.doutores} />
      <Alertas summary={summary} />
      <ChatsInterrompidos leads={summary.chatsInterrompidos} />
      <ChatsIncompletos leads={summary.chatsIncompletos} />

      {summary.doutores.length > 0 && (
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Users className="text-burst-orange-bright" size={20} />
          <h3 className="font-display text-xl tracking-wider text-white">
            Análise por Doutor
          </h3>
          <span className="text-xs text-burst-muted">
            {summary.doutores.length} doutor(es)
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {summary.doutores.map((d) => (
              <DoutorCard key={d.nome} doutor={d} />
            ))}
          </div>
      </section>
      )}

      <Modal
        open={openModal === 'leads'}
        onClose={() => setOpenModal(null)}
        title="Leads cadastrados"
        subtitle={`${summary.totalLeads} leads ativos (sem interrompidos nem incompletos)`}
      >
        <LeadsTable leads={summary.activeLeads} />
      </Modal>

      <Modal
        open={openModal === 'transferidos'}
        onClose={() => setOpenModal(null)}
        title="Transferências detectadas"
        subtitle={`${transferidos.length} leads transferidos`}
      >
        <TransferidosTable leads={transferidos} />
      </Modal>

      <Modal
        open={openModal === 'doutores'}
        onClose={() => setOpenModal(null)}
        title="Doutores ativos"
        subtitle={`${summary.doutores.length} doutores no período`}
      >
        <DoutoresTable doutores={summary.doutores} />
      </Modal>

      <Modal
        open={openModal === 'interrompidos'}
        onClose={() => setOpenModal(null)}
        title="Chats Interrompidos"
        subtitle={`${summary.chatsInterrompidos.length} lead(s) excluídos das métricas`}
      >
        <LeadsTable leads={summary.chatsInterrompidos} />
      </Modal>

      <Modal
        open={openModal === 'incompletos'}
        onClose={() => setOpenModal(null)}
        title="Chats Incompletos"
        subtitle={`${summary.chatsIncompletos.length} lead(s) de doutores excluídos (Daiane Feduk, Sorriso Recife, VitaPrime Clínica Odontológica)`}
      >
        <LeadsTable leads={summary.chatsIncompletos} />
      </Modal>
    </div>
  );
}

function HeaderBadge({
  icon,
  label,
  value,
  tone,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'orange' | 'red' | 'yellow';
  onClick: () => void;
  title?: string;
}) {
  const toneClass =
    tone === 'red'
      ? 'border-red-500/40 bg-red-500/5 text-red-400 hover:bg-red-500/15'
      : tone === 'yellow'
      ? 'border-burst-warning/40 bg-burst-warning/5 text-burst-warning hover:bg-burst-warning/15'
      : 'border-burst-orange/40 bg-burst-orange/5 text-burst-orange-bright hover:bg-burst-orange/15';
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors ${toneClass}`}
    >
      {icon}
      <span className="font-semibold">{value}</span>
      <span className="uppercase tracking-wider text-[10px] opacity-90">{label}</span>
    </button>
  );
}

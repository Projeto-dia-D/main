import { useMemo, useState } from 'react';
import { Headphones, AlertTriangle, Link2 } from 'lucide-react';
import { useLeads } from '../../hooks/useLeads';
import { useMetaSpend } from '../../hooks/useMetaSpend';
import { useMondayClients } from '../../hooks/useMondayClients';
import { useMetaLinks } from '../../hooks/useMetaLinks';
import { useDoutorLinks } from '../../hooks/useDoutorLinks';
import { filterByDateRange, isTransferido, type DateRange } from '../../lib/metrics';
import { computeCsMetrics } from '../../lib/csMetrics';
import { assertConfig, assertGestorConfig } from '../../config';
import { DateRangeFilter } from '../programacao/DateRangeFilter';
import { Modal } from '../Modal';
import { PainelGeralCs } from '../cs/PainelGeralCs';
import { PainelMiniCs } from '../cs/PainelMiniCs';
import { RankingCs } from '../cs/RankingCs';
import { CsCard } from '../cs/CsCard';
import { CsesTable } from '../cs/CsesTable';
import { ClientesTable } from '../gestor/ClientesTable';
import { CampanhasTable } from '../gestor/CampanhasTable';
import { LeadsTable } from '../programacao/LeadsTable';
import { TransferidosTable } from '../programacao/TransferidosTable';

type ModalKind = 'clientes' | 'cses' | null;

export function CS() {
  const baseMissing = assertConfig();
  const gestorMissing = assertGestorConfig();

  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [openModal, setOpenModal] = useState<ModalKind>(null);
  // Nome do CS selecionado para abrir drill-down com seus clientes
  const [selectedCs, setSelectedCs] = useState<string | null>(null);
  // Drill-down adicional: { cs, type } onde type = mensagens | transferencias | spend
  const [drillCs, setDrillCs] = useState<{
    cs: string;
    type: 'mensagens' | 'transferencias' | 'spend';
  } | null>(null);

  const { leads, loading: leadsLoading, error: leadsError } = useLeads();
  const { clients: mondayClients, loading: mondayLoading, error: mondayError } = useMondayClients();
  const {
    links,
    byAccount: linksByAccount,
    error: linksError,
    missingTable: linksMissingTable,
  } = useMetaLinks();
  const { byClient: doutorLinksByClient } = useDoutorLinks();

  const linkedAccountIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of links) s.add(l.meta_account_id);
    return s;
  }, [links]);

  const { insights, errors: metaErrors, lastUpdate } = useMetaSpend(range, links);

  const filteredLeads = useMemo(
    () => filterByDateRange(leads, range),
    [leads, range]
  );

  const summary = useMemo(
    () =>
      computeCsMetrics({
        clients: mondayClients,
        insights,
        leads: filteredLeads,
        metaLinks: linksByAccount,
        doutorLinks: doutorLinksByClient,
      }),
    [mondayClients, insights, filteredLeads, linksByAccount, doutorLinksByClient]
  );

  if (baseMissing.length > 0 || gestorMissing.length > 0) {
    const missing = [...baseMissing, ...gestorMissing];
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-burst-orange/40 bg-burst-card p-8 max-w-2xl">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="text-burst-orange-bright" />
            <h2 className="font-display text-2xl text-white tracking-wider">
              Configuração incompleta
            </h2>
          </div>
          <ul className="space-y-1 font-mono text-sm">
            {missing.map((k) => (
              <li key={k} className="text-red-400">• {k}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const showLoadingOverlay = (leadsLoading || mondayLoading) && summary.cses.length === 0;

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-xs text-burst-muted">
          <span className="text-white font-semibold">{summary.clientesConsiderados}</span> de{' '}
          <span className="text-white font-semibold">{summary.clientesTotal}</span> cliente(s) vinculado(s){' '}
          • <span className="text-white font-semibold">{linkedAccountIds.size}</span> conta(s) Meta{' '}
          • <span className="text-white font-semibold">{insights.length}</span> campanha(s){' '}
          • <span className="text-white font-semibold">{filteredLeads.length}</span> lead(s) no período
        </div>
        <DateRangeFilter range={range} onChange={setRange} />
      </div>

      {linksMissingTable && (
        <div className="rounded-xl border border-burst-orange/50 bg-burst-orange/5 p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-burst-orange-bright shrink-0 mt-0.5" />
          <div className="text-sm text-burst-muted">
            Tabela <code className="text-burst-orange-bright">client_meta_links</code> não existe.
            Abra a aba <span className="text-white font-semibold">Gestor de Tráfego</span> e rode o SQL exibido lá.
          </div>
        </div>
      )}

      {(leadsError || mondayError || metaErrors.length > 0 || linksError) && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 space-y-1 text-sm">
          {leadsError && <div className="text-red-400">Supabase: {leadsError}</div>}
          {mondayError && <div className="text-red-400">Monday: {mondayError}</div>}
          {linksError && <div className="text-red-400">Vínculos: {linksError}</div>}
          {metaErrors.map((e, i) => (
            <div key={i} className="text-red-400">{e}</div>
          ))}
        </div>
      )}

      {!linksMissingTable && links.length === 0 && (
        <div className="rounded-xl border border-burst-orange/40 bg-burst-orange/5 p-5 flex items-start gap-3">
          <Link2 size={20} className="text-burst-orange-bright shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-display text-lg text-white tracking-wide">
              Nenhuma conta vinculada
            </div>
            <p className="text-sm text-burst-muted mt-1">
              Abra a aba <span className="text-burst-orange-bright font-semibold">Gestor de Tráfego</span> e use o botão <span className="text-white">Vincular contas</span> para associar cada cliente do Monday a uma conta de anúncios Meta. A aba CS reaproveita esses vínculos.
            </p>
          </div>
        </div>
      )}

      {showLoadingOverlay ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-2 border-burst-orange border-t-transparent animate-spin mx-auto mb-4" />
            <div className="text-burst-muted text-sm">Carregando dados...</div>
          </div>
        </div>
      ) : (
        <>
          <PainelGeralCs
            summary={summary}
            lastUpdate={lastUpdate}
            onOpenClientes={() => setOpenModal('clientes')}
            onOpenCses={() => setOpenModal('cses')}
          />

          {summary.cses.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {summary.cses.map((c) => (
                <PainelMiniCs key={c.cs} cs={c} />
              ))}
            </div>
          )}

          <RankingCs cses={summary.cses} />

          {summary.clientesSemCs.length > 0 && (
            <div className="rounded-xl border border-burst-warning/40 bg-burst-warning/5 p-4">
              <div className="text-xs uppercase tracking-widest text-burst-warning mb-2">
                {summary.clientesSemCs.length} cliente(s) vinculados sem CS atribuído no Monday
              </div>
              <div className="flex flex-wrap gap-1.5">
                {summary.clientesSemCs.slice(0, 30).map((cm) => (
                  <span
                    key={cm.client.id}
                    className="text-xs px-2 py-1 rounded bg-black/30 border border-burst-border text-white/80"
                  >
                    {cm.client.name}
                  </span>
                ))}
                {summary.clientesSemCs.length > 30 && (
                  <span className="text-xs text-burst-muted">+{summary.clientesSemCs.length - 30}</span>
                )}
              </div>
            </div>
          )}

          {summary.cses.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Headphones className="text-burst-orange-bright" size={20} />
                <h3 className="font-display text-xl tracking-wider text-white">Análise por CS</h3>
                <span className="text-xs text-burst-muted">{summary.cses.length} CS(s)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {summary.cses.map((c) => (
                  <CsCard
                    key={c.cs}
                    cs={c}
                    onClick={() => setSelectedCs(c.cs)}
                    onClickMensagens={() => setDrillCs({ cs: c.cs, type: 'mensagens' })}
                    onClickTransferencias={() => setDrillCs({ cs: c.cs, type: 'transferencias' })}
                    onClickSpend={() => setDrillCs({ cs: c.cs, type: 'spend' })}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <Modal
        open={openModal === 'clientes'}
        onClose={() => setOpenModal(null)}
        title="Clientes vinculados (CS)"
        subtitle={`${summary.clientesConsiderados} cliente(s) com Meta vinculado`}
      >
        <ClientesTable
          clients={summary.cses.flatMap((c) => c.clients).concat(summary.clientesSemCs)}
        />
      </Modal>

      <Modal
        open={openModal === 'cses'}
        onClose={() => setOpenModal(null)}
        title="CSs ativos"
        subtitle={`${summary.cses.length} CS(s) com clientes vinculados`}
      >
        <CsesTable cses={summary.cses} />
      </Modal>

      {/* Drill-down: clica num CS → mostra TODOS os clientes dele */}
      <Modal
        open={selectedCs !== null}
        onClose={() => setSelectedCs(null)}
        title={selectedCs ? `Clientes de ${selectedCs}` : ''}
        subtitle={(() => {
          const c = summary.cses.find((c) => c.cs === selectedCs);
          if (!c) return '';
          return `${c.clients.length} cliente(s) • ${c.totalTransferencias} transferência(s) • CPT ${c.cpt === null ? '—' : `R$ ${c.cpt.toFixed(2)}`}`;
        })()}
      >
        <ClientesTable
          clients={summary.cses.find((c) => c.cs === selectedCs)?.clients ?? []}
        />
      </Modal>

      {/* Drill-down por métrica: mensagens, transferencias, spend */}
      {(() => {
        if (!drillCs) return null;
        const c = summary.cses.find((cs) => cs.cs === drillCs.cs);
        if (!c) return null;
        const leads = c.clients.flatMap((cm) => cm.leads);
        const campanhas = c.clients.flatMap((cm) => cm.campaigns);

        if (drillCs.type === 'mensagens') {
          return (
            <Modal
              open
              onClose={() => setDrillCs(null)}
              title={`Mensagens — ${c.cs}`}
              subtitle={`${leads.length} chat(s) iniciado(s) pelos clientes de ${c.cs}`}
            >
              <LeadsTable leads={leads} />
            </Modal>
          );
        }
        if (drillCs.type === 'transferencias') {
          const transf = leads.filter(isTransferido);
          return (
            <Modal
              open
              onClose={() => setDrillCs(null)}
              title={`Transferências — ${c.cs}`}
              subtitle={`${transf.length} transferência(s) dos clientes de ${c.cs}`}
            >
              <TransferidosTable leads={transf} />
            </Modal>
          );
        }
        // spend
        return (
          <Modal
            open
            onClose={() => setDrillCs(null)}
            title={`Spend — ${c.cs}`}
            subtitle={`${campanhas.length} campanha(s) • R$ ${c.totalSpend.toFixed(2)} total`}
          >
            <CampanhasTable insights={campanhas} />
          </Modal>
        );
      })()}
    </div>
  );
}

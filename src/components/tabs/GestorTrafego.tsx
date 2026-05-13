import { useMemo, useState } from 'react';
import { AlertTriangle, Users, Link2, Database } from 'lucide-react';
import { useLeads } from '../../hooks/useLeads';
import { useMetaSpend } from '../../hooks/useMetaSpend';
import { useMondayClients } from '../../hooks/useMondayClients';
import { useMetaLinks } from '../../hooks/useMetaLinks';
import { useDoutorLinks } from '../../hooks/useDoutorLinks';
import { useAdAccountsForGestor } from '../../hooks/useAdAccountsForGestor';
import { filterByDateRange, isTransferido, type DateRange } from '../../lib/metrics';
import { computeGestorMetrics } from '../../lib/gestorMetrics';
import { LeadsTable } from '../programacao/LeadsTable';
import { TransferidosTable } from '../programacao/TransferidosTable';
import { assertConfig, assertGestorConfig } from '../../config';
import { DateRangeFilter } from '../programacao/DateRangeFilter';
import { Modal } from '../Modal';
import { PainelGeralGestor } from '../gestor/PainelGeralGestor';
import { PainelMiniGestor } from '../gestor/PainelMiniGestor';
import { RankingGestores } from '../gestor/RankingGestores';
import { GestorCard } from '../gestor/GestorCard';
import { ClientesTable } from '../gestor/ClientesTable';
import { CampanhasTable } from '../gestor/CampanhasTable';
import { GestoresTable } from '../gestor/GestoresTable';
import { VinculacoesModal } from '../gestor/VinculacoesModal';
import { DiagnosticoOrfaos } from '../gestor/DiagnosticoOrfaos';

type ModalKind = 'clientes' | 'campanhas' | 'gestores' | 'vinculos' | 'campanhas-orfas' | null;

export function GestorTrafego() {
  const baseMissing = assertConfig();
  const gestorMissing = assertGestorConfig();

  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [openModal, setOpenModal] = useState<ModalKind>(null);
  // Nome do gestor selecionado para drill-down com todos os seus clientes/doutores
  const [selectedGestor, setSelectedGestor] = useState<string | null>(null);
  // Drill-down por métrica do gestor: mensagens | transferencias | spend
  const [drillGestor, setDrillGestor] = useState<{
    gestor: string;
    type: 'mensagens' | 'transferencias' | 'spend';
  } | null>(null);

  const { leads, loading: leadsLoading, error: leadsError } = useLeads();
  const { clients: mondayClients, loading: mondayLoading, error: mondayError } =
    useMondayClients();
  const {
    links,
    byAccount: linksByAccount,
    setLink,
    removeLink,
    error: linksError,
    missingTable: linksMissingTable,
  } = useMetaLinks();
  const {
    byDoutor: doutorLinksByDoutor,
    byClient: doutorLinksByClient,
    setLink: setDoutorLink,
    removeLink: removeDoutorLink,
    missingTable: doutorLinksMissingTable,
  } = useDoutorLinks();

  // Lazy: contas só são buscadas quando o usuário aperta "Carregar Renan/Weslei/André"
  const {
    allAccounts: loadedAccounts,
    loading: accountsLoading,
    errors: accountsErrors,
    loadedGestores,
    load: loadGestor,
  } = useAdAccountsForGestor();

  // useMetaSpend busca insights direto pelos links — não precisa de discovery
  const { insights, loading: metaLoading, errors: metaErrors, lastUpdate } =
    useMetaSpend(range, links);

  const filteredLeads = useMemo(
    () => filterByDateRange(leads, range),
    [leads, range]
  );

  const summary = useMemo(
    () =>
      computeGestorMetrics({
        clients: mondayClients,
        insights,
        leads: filteredLeads,
        metaLinks: linksByAccount,
        doutorLinks: doutorLinksByClient,
      }),
    [mondayClients, insights, filteredLeads, linksByAccount, doutorLinksByClient]
  );

  const allClientMetrics = useMemo(
    () => summary.gestores.flatMap((g) => g.clients).concat(
      summary.clientsFora.map((c) => ({
        client: c,
        doutorMatch: null,
        matchVia: null,
        metaMatchVia: null,
        spend: 0,
        transferencias: 0,
        mensagensIniciadas: 0,
        cpt: null,
        campaigns: [],
        leads: [],
        churned: false,
        churnCutoff: null,
      }))
    ),
    [summary]
  );

  if (baseMissing.length > 0 || gestorMissing.length > 0) {
    const missing = [...baseMissing, ...gestorMissing];
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-burst-orange/40 bg-burst-card p-8 max-w-2xl">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="text-burst-orange-bright" />
            <h2 className="font-display text-2xl text-white tracking-wider">
              Configuração da aba Gestor incompleta
            </h2>
          </div>
          <p className="text-burst-muted mb-4 text-sm">
            Preencha no <code className="text-burst-orange">.env</code>:
          </p>
          <ul className="space-y-1 font-mono text-sm">
            {missing.map((k) => (
              <li key={k} className="text-red-400">
                • {k}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const showLoadingOverlay =
    (leadsLoading || mondayLoading) && summary.gestores.length === 0;

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-xs text-burst-muted">
          <span className="text-white font-semibold">{mondayClients.length}</span> cliente(s) com Bia •{' '}
          <span className="text-white font-semibold">{links.length}</span> vínculo(s) •{' '}
          <span className="text-white font-semibold">{insights.length}</span> campanha(s) Meta •{' '}
          <span className="text-white font-semibold">{filteredLeads.length}</span> lead(s) no período
          {metaLoading && <span className="ml-2 text-burst-orange-bright">atualizando Meta...</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpenModal('vinculos')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-burst-orange/15 border border-burst-orange/40 hover:border-burst-orange hover:bg-burst-orange/25 transition-colors text-sm text-burst-orange-bright font-semibold"
          >
            <Link2 size={15} />
            Vincular contas
          </button>
          <DateRangeFilter range={range} onChange={setRange} />
        </div>
      </div>

      {linksMissingTable && (
        <div className="rounded-xl border border-burst-orange/50 bg-burst-orange/5 p-5">
          <div className="flex items-start gap-3">
            <Database size={20} className="text-burst-orange-bright shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-display text-lg text-white tracking-wide">
                Tabela <code className="text-burst-orange-bright">client_meta_links</code> não existe no Supabase
              </div>
              <p className="text-sm text-burst-muted mt-1 mb-3">
                Cole o SQL abaixo em <span className="text-white">Supabase Dashboard → SQL Editor → Run</span>.
                Executar uma vez. Sem isso a aba não funciona.
              </p>
              <pre className="text-[11px] bg-black/40 border border-burst-border rounded p-3 overflow-x-auto text-white/85 font-mono">
{`CREATE TABLE IF NOT EXISTS public.client_meta_links (
  monday_client_id   TEXT PRIMARY KEY,
  monday_client_name TEXT,
  meta_account_id    TEXT NOT NULL,
  meta_account_name  TEXT,
  gestor             TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_meta_links_account
  ON public.client_meta_links (meta_account_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.client_meta_links;
ALTER TABLE public.client_meta_links DISABLE ROW LEVEL SECURITY;`}
              </pre>
            </div>
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

      {!linksMissingTable && !leadsLoading && !mondayLoading && links.length === 0 && (
        <div className="rounded-xl border border-burst-orange/40 bg-burst-orange/5 p-5 flex items-start gap-3">
          <Link2 size={20} className="text-burst-orange-bright shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-display text-lg text-white tracking-wide">
              Nenhuma conta vinculada ainda
            </div>
            <p className="text-sm text-burst-muted mt-1">
              Detectei <span className="text-white font-semibold">{mondayClients.length} cliente(s)</span> no Monday.
              Clica em <span className="text-burst-orange-bright font-semibold">Vincular contas</span> pra começar — lá você escolhe qual gestor carregar (Renan/Weslei/André) e associa cada cliente à conta correspondente.
            </p>
          </div>
        </div>
      )}

      {showLoadingOverlay ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-2 border-burst-orange border-t-transparent animate-spin mx-auto mb-4" />
            <div className="text-burst-muted text-sm">
              Carregando dados do Monday e Supabase...
            </div>
          </div>
        </div>
      ) : (
        <>
          <PainelGeralGestor
            summary={summary}
            lastUpdate={lastUpdate}
            onOpenClientes={() => setOpenModal('clientes')}
            onOpenCampanhas={() => setOpenModal('campanhas')}
            onOpenGestores={() => setOpenModal('gestores')}
          />

          {summary.gestores.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {summary.gestores.map((g) => (
                <PainelMiniGestor key={g.gestor} gestor={g} />
              ))}
            </div>
          )}

          <RankingGestores gestores={summary.gestores} />

          {summary.clientsFora.length > 0 && (
            <div className="rounded-xl border border-burst-warning/40 bg-burst-warning/5 p-4">
              <div className="text-xs uppercase tracking-widest text-burst-warning mb-2">
                {summary.clientsFora.length} cliente(s) sem gestor atribuído no Monday
              </div>
              <div className="flex flex-wrap gap-1.5">
                {summary.clientsFora.slice(0, 30).map((c) => (
                  <span
                    key={c.id}
                    className="text-xs px-2 py-1 rounded bg-black/30 border border-burst-border text-white/80"
                  >
                    {c.name}
                  </span>
                ))}
                {summary.clientsFora.length > 30 && (
                  <span className="text-xs text-burst-muted">+{summary.clientsFora.length - 30}</span>
                )}
              </div>
            </div>
          )}

          {summary.gestores.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Users className="text-burst-orange-bright" size={20} />
                <h3 className="font-display text-xl tracking-wider text-white">
                  Análise por Gestor
                </h3>
                <span className="text-xs text-burst-muted">
                  {summary.gestores.length} gestor(es)
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {summary.gestores.map((g) => (
                  <GestorCard
                    key={g.gestor}
                    gestor={g}
                    onClick={() => setSelectedGestor(g.gestor)}
                    onClickMensagens={() =>
                      setDrillGestor({ gestor: g.gestor, type: 'mensagens' })
                    }
                    onClickTransferencias={() =>
                      setDrillGestor({ gestor: g.gestor, type: 'transferencias' })
                    }
                    onClickSpend={() =>
                      setDrillGestor({ gestor: g.gestor, type: 'spend' })
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {summary.orfaos.length > 0 && (
            <DiagnosticoOrfaos
              orfaos={summary.orfaos}
              totalTransferenciasMapeadas={summary.totalTransferencias}
              mondayClients={mondayClients}
              linksByDoutor={doutorLinksByDoutor}
              onLink={setDoutorLink}
              onUnlink={removeDoutorLink}
              missingTable={doutorLinksMissingTable}
            />
          )}

          {summary.campaignsOrfas.length > 0 && (
            <button
              onClick={() => setOpenModal('campanhas-orfas')}
              className="text-left rounded-xl border border-burst-border bg-black/20 p-4 hover:border-burst-orange/50 hover:bg-black/40 transition-colors group"
            >
              <div className="text-xs uppercase tracking-widest text-burst-muted mb-2 flex items-center gap-2">
                {summary.campaignsOrfas.length} campanha(s) Fim/Venda sem cliente casado
                <span className="text-burst-orange-bright opacity-0 group-hover:opacity-100 transition-opacity normal-case tracking-normal">
                  → ver lista
                </span>
              </div>
              <div className="text-xs text-burst-muted">
                Estas campanhas têm o padrão de nome mas nenhum cliente do Monday foi encontrado no
                nome da campanha. O spend delas não está atribuído a nenhum gestor.
                <span className="block mt-1 text-burst-orange-bright">
                  Total: {summary.campaignsOrfas.reduce((s, c) => s + c.spend, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
              </div>
            </button>
          )}
        </>
      )}

      <Modal
        open={openModal === 'clientes'}
        onClose={() => setOpenModal(null)}
        title="Clientes do Monday"
        subtitle={`${allClientMetrics.length} cliente(s) com Bia (grupo Plano à vista + Normal + Bia Soft)`}
      >
        <ClientesTable clients={allClientMetrics} />
      </Modal>

      <Modal
        open={openModal === 'campanhas'}
        onClose={() => setOpenModal(null)}
        title="Campanhas Meta Ads"
        subtitle={`${insights.length} campanha(s) das contas vinculadas no período`}
      >
        <CampanhasTable insights={insights} />
      </Modal>

      <Modal
        open={openModal === 'gestores'}
        onClose={() => setOpenModal(null)}
        title="Gestores de Tráfego"
        subtitle={`${summary.gestores.length} gestor(es) com clientes atribuídos`}
      >
        <GestoresTable gestores={summary.gestores} />
      </Modal>

      <Modal
        open={openModal === 'vinculos'}
        onClose={() => setOpenModal(null)}
        title="Vincular Contas Meta ↔ Clientes Monday"
        subtitle="Carrega contas por gestor sob demanda • busca por nome no campo de conta • salva direto no banco"
        maxWidth="max-w-6xl"
      >
        <VinculacoesModal
          clients={mondayClients}
          loadedAccounts={loadedAccounts}
          accountsLoading={accountsLoading}
          accountsErrors={accountsErrors}
          loadedGestores={loadedGestores}
          onLoadGestor={loadGestor}
          links={links}
          onLink={setLink}
          onUnlink={removeLink}
        />
      </Modal>

      {/* Drill-down: clica num gestor → mostra TODOS os clientes/doutores dele */}
      <Modal
        open={selectedGestor !== null}
        onClose={() => setSelectedGestor(null)}
        title={selectedGestor ? `Clientes de ${selectedGestor}` : ''}
        subtitle={(() => {
          const g = summary.gestores.find((g) => g.gestor === selectedGestor);
          if (!g) return '';
          return `${g.clients.length} cliente(s) • ${g.totalTransferencias} transferência(s) • CPT ${g.cpt === null ? '—' : `R$ ${g.cpt.toFixed(2)}`}`;
        })()}
      >
        <ClientesTable
          clients={summary.gestores.find((g) => g.gestor === selectedGestor)?.clients ?? []}
        />
      </Modal>

      {/* Drill-down por métrica: mensagens, transferencias, spend */}
      {(() => {
        if (!drillGestor) return null;
        const g = summary.gestores.find((x) => x.gestor === drillGestor.gestor);
        if (!g) return null;
        const leads = g.clients.flatMap((cm) => cm.leads);
        const campanhas = g.clients.flatMap((cm) => cm.campaigns);

        if (drillGestor.type === 'mensagens') {
          return (
            <Modal
              open
              onClose={() => setDrillGestor(null)}
              title={`Mensagens — ${g.gestor}`}
              subtitle={`${leads.length} chat(s) iniciado(s) pelos clientes de ${g.gestor}`}
            >
              <LeadsTable leads={leads} />
            </Modal>
          );
        }
        if (drillGestor.type === 'transferencias') {
          const transf = leads.filter(isTransferido);
          return (
            <Modal
              open
              onClose={() => setDrillGestor(null)}
              title={`Transferências — ${g.gestor}`}
              subtitle={`${transf.length} transferência(s) dos clientes de ${g.gestor}`}
            >
              <TransferidosTable leads={transf} />
            </Modal>
          );
        }
        return (
          <Modal
            open
            onClose={() => setDrillGestor(null)}
            title={`Spend — ${g.gestor}`}
            subtitle={`${campanhas.length} campanha(s) • R$ ${g.totalSpend.toFixed(2)} total`}
          >
            <CampanhasTable insights={campanhas} />
          </Modal>
        );
      })()}

      <Modal
        open={openModal === 'campanhas-orfas'}
        onClose={() => setOpenModal(null)}
        title="Campanhas Fim/Venda sem cliente casado"
        subtitle={`${summary.campaignsOrfas.length} campanha(s) — spend não atribuído a nenhum gestor`}
      >
        <CampanhasTable insights={summary.campaignsOrfas} />
      </Modal>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { AlertTriangle, Link2 } from 'lucide-react';
import { useLeads } from '../../hooks/useLeads';
import { useMetaSpend } from '../../hooks/useMetaSpend';
import { useGoogleAdsSpend } from '../../hooks/useGoogleAdsSpend';
import { useMondayClients } from '../../hooks/useMondayClients';
import { useMetaLinks } from '../../hooks/useMetaLinks';
import { useDoutorLinks } from '../../hooks/useDoutorLinks';
import { filterByDateRange, isTransferido, type DateRange } from '../../lib/metrics';
import { computeCsMetrics } from '../../lib/csMetrics';
import { assertConfig, assertGestorConfig } from '../../config';
import { DateRangeFilter, diaDRange } from '../programacao/DateRangeFilter';
import { Modal } from '../Modal';
import { PainelGeralCs } from '../cs/PainelGeralCs';
import { PainelMiniCs } from '../cs/PainelMiniCs';
import { CsesTable } from '../cs/CsesTable';
import { PerfilPessoalCs } from '../cs/PerfilPessoalCs';
import { ClientesTable } from '../gestor/ClientesTable';
import { ClientesGridView } from '../gestor/ClientesGridView';
import { ListasClientes } from '../gestor/ListasClientes';
import { RankingPessoasCards } from '../gestor/RankingPessoasCards';
import { brl, tierForCpt, tierLabelCpt } from '../../lib/gestorMetrics';
import { useUserPhotos } from '../../hooks/useUserPhotos';
import { CampanhasTable } from '../gestor/CampanhasTable';
import { ClienteDrilldown } from '../gestor/ClienteDrilldown';
import { LeadsTable } from '../programacao/LeadsTable';
import { TransferidosTable } from '../programacao/TransferidosTable';
import { isClientChurned, nameMatchesScope } from '../../lib/monday';
import { useUser, hasFullAccess } from '../../lib/userContext';
import { ViewAsTab } from '../ViewAsTab';
import { useNotifications } from '../../lib/notificationsContext';
import { useEffect } from 'react';

type ModalKind = 'clientes' | 'cses' | null;

export function CS() {
  const baseMissing = assertConfig();
  const gestorMissing = assertGestorConfig();

  // Aba abre por padrão filtrada pelo período "Dia D" (dia 12 do mês até hoje)
  const [range, setRange] = useState<DateRange>(() => diaDRange());
  const [openModal, setOpenModal] = useState<ModalKind>(null);
  // Drill-down adicional: { cs, type } onde type = mensagens | transferencias | spend
  const [drillCs, setDrillCs] = useState<{
    cs: string;
    type: 'mensagens' | 'transferencias' | 'spend';
  } | null>(null);
  // Drill em um cliente específico (vindo de melhores/piores nos cards mini OU
  // da lista grande). `fromAllClientes` controla se mostra botao "Voltar".
  const [drillClient, setDrillClient] = useState<{ clientId: string; csNome: string; fromAllClientes?: boolean } | null>(null);
  // Drill em TODOS os clientes de UM CS (abre popup grande com a lista)
  const [drillAllClientesCs, setDrillAllClientesCs] = useState<string | null>(null);
  // View-as (admin): nome do CS pra simular o perfil pessoal dele.
  // null = visão completa (default do admin).
  const [viewAsCs, setViewAsCs] = useState<string | null>(null);
  const { lookup: lookupPhoto } = useUserPhotos();
  const { report: reportNotification, resolve: resolveNotification } = useNotifications();

  const { leads, loading: leadsLoading, error: leadsError } = useLeads();
  const {
    clients: mondayClients,
    allClients: mondayAllClients,
    // clientsAll é o universo TOTAL do main board (sem filtro de grupo/tipo).
    // Usado pra pegar clientes vinculados que estão fora do filtro padrão
    // (ex: Colnaghi — grupo "Plano normal", tipo "Normal").
    clientsAll: mondayClientsAll,
    biaActiveIds,
    biaTimelineByClientId,
    biaFaseByClientId,
    loading: mondayLoading,
    error: mondayError,
  } = useMondayClients();
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

  // Filtra links de clientes churned (perdemos acesso à BM deles)
  const linksParaMeta = useMemo(() => {
    if (mondayAllClients.length === 0) return links;
    const churnedIds = new Set<string>();
    for (const c of mondayAllClients) if (isClientChurned(c)) churnedIds.add(c.id);
    return links.filter((l) => !churnedIds.has(l.monday_client_id));
  }, [links, mondayAllClients]);

  const { insights, errors: metaErrors, lastUpdate } = useMetaSpend(range, linksParaMeta);
  const { googleSpend } = useGoogleAdsSpend(range);

  const filteredLeads = useMemo(
    () => filterByDateRange(leads, range),
    [leads, range]
  );

  // Inclui clientes com vínculo Meta MESMO se não estão no filtro padrão do
  // mondayClients (grupo "Plano à vista" + tipo "Normal + Bia Soft"). Usa
  // mondayClientsAll (universo TOTAL) — antes era mondayAllClients (que já
  // vem filtrado por grupo/tipo) e clientes de "Plano normal" como a Colnaghi
  // sumiam mesmo tendo vínculo Meta salvo.
  const clientesParaMetricas = useMemo(() => {
    if (mondayClientsAll.length === 0) return mondayClients;
    const idsAtivos = new Set(mondayClients.map((c) => c.id));
    const idsComLink = new Set(links.map((l) => l.monday_client_id));
    const extras = mondayClientsAll.filter(
      (c) => idsComLink.has(c.id) && !idsAtivos.has(c.id)
    );
    return extras.length === 0 ? mondayClients : [...mondayClients, ...extras];
  }, [mondayClients, mondayClientsAll, links]);

  const fullSummary = useMemo(
    () =>
      computeCsMetrics({
        clients: clientesParaMetricas,
        insights,
        leads: filteredLeads,
        metaLinks: linksByAccount,
        doutorLinks: doutorLinksByClient,
        biaActiveIds,
        biaTimelineByClientId,
        biaFaseByClientId,
        dateRange: range,
        googleSpend,
      }),
    [
      clientesParaMetricas,
      insights,
      filteredLeads,
      linksByAccount,
      doutorLinksByClient,
      biaActiveIds,
      biaTimelineByClientId,
      biaFaseByClientId,
      range,
      googleSpend,
    ]
  );

  // === FILTRO POR ROLE / VIEW-AS ===
  // Admin sem view-as → vê tudo
  // Admin com view-as → vê perfil pessoal daquele CS
  // CS → vê só seus dados (filtra por scope = nome do CS)
  // Outros roles → não veem
  const user = useUser();
  const summary = useMemo(() => {
    // Admin com view-as: simula perfil pessoal de um CS específico
    if (hasFullAccess(user) && viewAsCs) {
      const filteredCses = fullSummary.cses.filter((c) => c.cs === viewAsCs);
      const totalSpend = filteredCses.reduce((s, c) => s + c.totalSpend, 0);
      const totalSpendMeta = filteredCses.reduce((s, c) => s + c.totalSpendMeta, 0);
      const totalSpendGoogle = filteredCses.reduce((s, c) => s + c.totalSpendGoogle, 0);
      const totalTransferencias = filteredCses.reduce((s, c) => s + c.totalTransferencias, 0);
      const totalMensagens = filteredCses.reduce((s, c) => s + c.totalMensagens, 0);
      const cptGeral = totalTransferencias > 0
        ? Number((totalSpend / totalTransferencias).toFixed(2))
        : null;
      return {
        ...fullSummary,
        cses: filteredCses,
        totalSpend: Number(totalSpend.toFixed(2)),
        totalSpendMeta: Number(totalSpendMeta.toFixed(2)),
        totalSpendGoogle: Number(totalSpendGoogle.toFixed(2)),
        totalTransferencias,
        totalMensagens,
        cptGeral,
        clientesSemCs: [],
      };
    }
    if (hasFullAccess(user)) return fullSummary;
    if (user.role === 'cs' && user.scope) {
      const filteredCses = fullSummary.cses.filter((c) =>
        nameMatchesScope(user.scope!, c.cs)
      );
      const totalSpend = filteredCses.reduce((s, c) => s + c.totalSpend, 0);
      const totalSpendMeta = filteredCses.reduce((s, c) => s + c.totalSpendMeta, 0);
      const totalSpendGoogle = filteredCses.reduce((s, c) => s + c.totalSpendGoogle, 0);
      const totalTransferencias = filteredCses.reduce((s, c) => s + c.totalTransferencias, 0);
      const totalMensagens = filteredCses.reduce((s, c) => s + c.totalMensagens, 0);
      const cptGeral = totalTransferencias > 0
        ? Number((totalSpend / totalTransferencias).toFixed(2))
        : null;
      return {
        ...fullSummary,
        cses: filteredCses,
        totalSpend: Number(totalSpend.toFixed(2)),
        totalSpendMeta: Number(totalSpendMeta.toFixed(2)),
        totalSpendGoogle: Number(totalSpendGoogle.toFixed(2)),
        totalTransferencias,
        totalMensagens,
        cptGeral,
        clientesSemCs: [],
      };
    }
    return { ...fullSummary, cses: [], clientesSemCs: [] };
  }, [fullSummary, user, viewAsCs]);

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

  // Reporta erros pro centro de notificações
  useEffect(() => {
    if (leadsError) reportNotification({ id: 'cs-supabase', level: 'error', source: 'Supabase', message: leadsError });
    else resolveNotification('cs-supabase');
  }, [leadsError, reportNotification, resolveNotification]);
  useEffect(() => {
    if (mondayError) reportNotification({ id: 'cs-monday', level: 'error', source: 'Monday', message: mondayError });
    else resolveNotification('cs-monday');
  }, [mondayError, reportNotification, resolveNotification]);
  useEffect(() => {
    if (linksError) reportNotification({ id: 'cs-links', level: 'error', source: 'Vínculos', message: linksError });
    else resolveNotification('cs-links');
  }, [linksError, reportNotification, resolveNotification]);
  useEffect(() => {
    metaErrors.forEach((msg, i) => {
      reportNotification({ id: `cs-meta-${i}-${msg.slice(0,40)}`, level: 'error', source: 'Meta Ads', message: msg });
    });
  }, [metaErrors, reportNotification]);

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* === Admin view-as: tab bar com fotos dos CSs === */}
      {hasFullAccess(user) && fullSummary.cses.length > 0 && (
        <div className="flex items-center gap-1.5 bg-burst-card border border-burst-border rounded-xl p-1.5 w-fit flex-wrap">
          <ViewAsTab
            label="Visão geral"
            active={viewAsCs === null}
            onClick={() => setViewAsCs(null)}
            noAvatar
          />
          {fullSummary.cses.map((c) => {
            const firstName = c.cs.split(' ')[0];
            return (
              <ViewAsTab
                key={c.cs}
                label={firstName}
                fullName={c.cs}
                photoUrl={lookupPhoto(c.cs)}
                active={viewAsCs === c.cs}
                onClick={() => setViewAsCs(c.cs)}
              />
            );
          })}
        </div>
      )}

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

      {/* Erros foram movidos pra aba "Notificações" — visível pelo sininho na sidebar */}

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
          {/* === VISÃO PERSONALIZADA: CS não-admin OU admin com view-as === */}
          {((!hasFullAccess(user) && user.role === 'cs') || (hasFullAccess(user) && viewAsCs)) &&
            summary.cses.length === 1 && (
              <PerfilPessoalCs
                cs={summary.cses[0]}
                sectorSummary={fullSummary}
                onClickMensagens={() => setDrillCs({ cs: summary.cses[0].cs, type: 'mensagens' })}
                onClickTransferencias={() => setDrillCs({ cs: summary.cses[0].cs, type: 'transferencias' })}
                onClickSpend={() => setDrillCs({ cs: summary.cses[0].cs, type: 'spend' })}
                onClickCliente={(cm) => setDrillClient({ clientId: cm.client.id, csNome: summary.cses[0].cs })}
              />
            )}

          {/* === VISÃO ADMIN COMPLETA: painel geral + multi-grid + análise por CS === */}
          {hasFullAccess(user) && !viewAsCs && (
            <>
              <PainelGeralCs
                summary={summary}
                lastUpdate={lastUpdate}
                onOpenClientes={() => setOpenModal('clientes')}
                onOpenCses={() => setOpenModal('cses')}
              />

              {/* === RANKING COMPACTO DOS CSs (cards horizontais com foto)
                  Estilo Apresentação — comparação rápida antes dos PainelMini.
                  Ordenado por CPT crescente (melhores primeiro). */}
              <RankingPessoasCards
                titulo="Ranking dos CSs"
                subtitulo={`${summary.cses.length} CS(s) ordenados por melhor CPT`}
                pessoas={[...summary.cses]
                  .sort((a, b) => (a.cpt ?? Infinity) - (b.cpt ?? Infinity))
                  .map((c) => ({
                    id: c.cs,
                    nome: c.cs,
                    photoUrl: lookupPhoto(c.cs),
                    metricaPrincipal: c.cpt !== null ? brl(c.cpt) : '—',
                    metricaLabel: 'CPT',
                    tier: c.cpt !== null ? tierForCpt(c.cpt) : 0,
                    tierLabel: tierLabelCpt(c.cpt !== null ? tierForCpt(c.cpt) : 0),
                    spendTotal: c.totalSpend,
                    spendMeta: c.totalSpendMeta,
                    spendGoogle: c.totalSpendGoogle,
                    onClick: () => setDrillAllClientesCs(c.cs),
                  }))}
              />

              {/* === LISTAS AGREGADAS DE TODOS OS CLIENTES (Melhores/Piores/
                  Menos transf/Menos leads + Tabela completa) — visível
                  pra admin/super programador apenas. Universo: clientes
                  de todos os CSs + os sem CS atribuído. */}
              <ListasClientes
                clients={[...summary.cses.flatMap((c) => c.clients), ...summary.clientesSemCs]}
                onClickCliente={(cm) => {
                  // Procura em todos os CSs pra resolver o nome do CS
                  const csDoClient = summary.cses.find((c) =>
                    c.clients.some((cl) => cl.client.id === cm.client.id),
                  );
                  setDrillClient({
                    clientId: cm.client.id,
                    csNome: csDoClient?.cs ?? '(sem CS)',
                  });
                }}
                totalLabelSuffix="cliente(s) no time inteiro"
              />

              {summary.cses.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {summary.cses.map((c) => (
                    <PainelMiniCs
                      key={c.cs}
                      cs={c}
                      onClickCard={() => setDrillAllClientesCs(c.cs)}
                      onClickMensagens={() => setDrillCs({ cs: c.cs, type: 'mensagens' })}
                      onClickTransferencias={() => setDrillCs({ cs: c.cs, type: 'transferencias' })}
                      onClickSpend={() => setDrillCs({ cs: c.cs, type: 'spend' })}
                      onClickCliente={(cm) => setDrillClient({ clientId: cm.client.id, csNome: c.cs })}
                    />
                  ))}
                </div>
              )}

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

            </>
          )}

          {/* CS não-admin sem dados: mensagem clara */}
          {!hasFullAccess(user) && user.role === 'cs' && summary.cses.length === 0 && (
            <div className="rounded-2xl border border-burst-warning/40 bg-burst-warning/5 p-8 text-center">
              <AlertTriangle className="text-burst-warning mx-auto mb-3" size={28} />
              <div className="text-white font-display text-xl mb-2">
                Nenhum cliente vinculado a você no período
              </div>
              <p className="text-sm text-burst-muted">
                Não encontramos clientes no Monday com seu nome em "Atendimento CS" para o
                período selecionado. Verifique a aba <span className="text-white">Programação</span>{' '}
                ou ajuste o período.
              </p>
            </div>
          )}

          {/* Outros papéis (gestor, programador) — esconde tudo */}
          {!hasFullAccess(user) && user.role !== 'cs' && (
            <div className="rounded-2xl border border-burst-border bg-burst-card p-8 text-center">
              <p className="text-burst-muted text-sm">
                Esta aba mostra dados de CS. Use a aba do seu setor.
              </p>
            </div>
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
          onClickClient={(cm) => {
            const csOwner = summary.cses.find((cs) =>
              cs.clients.some((c) => c.client.id === cm.client.id)
            );
            setOpenModal(null);
            setDrillClient({
              clientId: cm.client.id,
              csNome: csOwner?.cs ?? '(sem CS)',
            });
          }}
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
            title={`Gasto — ${c.cs}`}
            subtitle={`${campanhas.length} campanha(s) • R$ ${c.totalSpend.toFixed(2)} total`}
          >
            <CampanhasTable insights={campanhas} />
          </Modal>
        );
      })()}

      {/* Drill-down de UM cliente específico (vindo de melhores/piores nos cards
          OU da lista grande do drillAllClientesCs) */}
      {(() => {
        if (!drillClient) return null;
        // Procura em todos os clientes (CS + sem CS)
        const all = summary.cses.flatMap((c) => c.clients).concat(summary.clientesSemCs);
        const cm = all.find((c) => c.client.id === drillClient.clientId);
        if (!cm) return null;
        const cameFromList = !!drillClient.fromAllClientes;
        return (
          <Modal
            open
            onClose={() => {
              setDrillClient(null);
              setDrillAllClientesCs(null);
            }}
            onBack={cameFromList ? () => setDrillClient(null) : undefined}
            title={cm.client.name}
            subtitle={`Cliente de ${drillClient.csNome}`}
            maxWidth="max-w-5xl"
          >
            <ClienteDrilldown cm={cm} />
          </Modal>
        );
      })()}

      {/* Drill-down de TODOS os clientes de um CS (popup grande).
          So renderiza se nao tem drillClient(fromAllClientes) sobreposto. */}
      {(() => {
        if (!drillAllClientesCs) return null;
        if (drillClient?.fromAllClientes) return null;
        const c = summary.cses.find((x) => x.cs === drillAllClientesCs);
        if (!c) return null;
        const ativos = c.clients.filter((cl) => !cl.inactive).length;
        return (
          <Modal
            open
            onClose={() => setDrillAllClientesCs(null)}
            title={`Clientes — ${c.cs}`}
            subtitle={`${c.clients.length} cliente(s) no total · ${ativos} ativo(s) no período`}
            maxWidth="max-w-6xl"
          >
            <ClientesGridView
              clients={c.clients}
              onClickClient={(cm) => {
                // Mantem drillAllClientesCs setado pra "Voltar" funcionar.
                setDrillClient({ clientId: cm.client.id, csNome: c.cs, fromAllClientes: true });
              }}
            />
          </Modal>
        );
      })()}
    </div>
  );
}


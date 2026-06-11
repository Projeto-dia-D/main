import { useMemo, useState } from 'react';
import { AlertTriangle, Users, Link2, Database } from 'lucide-react';
import { useLeads } from '../../hooks/useLeads';
import { useMetaSpend } from '../../hooks/useMetaSpend';
import { useGoogleAdsSpend } from '../../hooks/useGoogleAdsSpend';
import { useMondayClients } from '../../hooks/useMondayClients';
import { useMetaLinks } from '../../hooks/useMetaLinks';
import { useDoutorLinks } from '../../hooks/useDoutorLinks';
import { useAdAccountsForGestor } from '../../hooks/useAdAccountsForGestor';
import { filterByDateRange, isTransferido, type DateRange } from '../../lib/metrics';
import { computeGestorMetrics } from '../../lib/gestorMetrics';
import { LeadsTable } from '../programacao/LeadsTable';
import { TransferidosTable } from '../programacao/TransferidosTable';
import { isClientChurned, isClientElegivelMeta, nameMatchesScope } from '../../lib/monday';
import { useUser, hasFullAccess } from '../../lib/userContext';
import { ViewAsTab } from '../ViewAsTab';
import { useUserPhotos } from '../../hooks/useUserPhotos';
import { useNotifications } from '../../lib/notificationsContext';
import { useEffect } from 'react';
import { assertConfig, assertGestorConfig } from '../../config';
import { DateRangeFilter, diaDRange } from '../programacao/DateRangeFilter';
import { Modal } from '../Modal';
import { PainelGeralGestor } from '../gestor/PainelGeralGestor';
import { PainelMiniGestor } from '../gestor/PainelMiniGestor';
import { PerfilPessoalGestor } from '../gestor/PerfilPessoalGestor';
import { ClientesTable } from '../gestor/ClientesTable';
import { ClientesGridView } from '../gestor/ClientesGridView';
import { CampanhasTable } from '../gestor/CampanhasTable';
import { ClienteDrilldown } from '../gestor/ClienteDrilldown';
import { GestoresTable } from '../gestor/GestoresTable';
import { VinculacoesModal } from '../gestor/VinculacoesModal';
import { DiagnosticoOrfaos } from '../gestor/DiagnosticoOrfaos';
import { DiagnosticoCampanhasOrfas } from '../gestor/DiagnosticoCampanhasOrfas';
import { DoutoresSemVinculoMeta } from '../gestor/DoutoresSemVinculoMeta';
import { ListasClientes } from '../gestor/ListasClientes';
import { RankingPessoasCards } from '../gestor/RankingPessoasCards';
import { brl, tierForCpt, tierLabelCpt } from '../../lib/gestorMetrics';

type ModalKind = 'clientes' | 'campanhas' | 'gestores' | 'vinculos' | null;

export function GestorTrafego() {
  const baseMissing = assertConfig();
  const gestorMissing = assertGestorConfig();

  // Aba abre por padrão filtrada pelo período "Dia D" (dia 12 do mês até hoje)
  const [range, setRange] = useState<DateRange>(() => diaDRange());
  const [openModal, setOpenModal] = useState<ModalKind>(null);
  // Drill-down por métrica do gestor: mensagens | transferencias | spend
  const [drillGestor, setDrillGestor] = useState<{
    gestor: string;
    type: 'mensagens' | 'transferencias' | 'spend';
  } | null>(null);
  // View-as (admin): nome do gestor pra simular o perfil pessoal dele.
  const [viewAsGestor, setViewAsGestor] = useState<string | null>(null);
  // Drill em UM cliente específico
  // `fromAllClientes` indica se foi aberto a partir do popup "Ver todos" —
  // nesse caso, o modal mostra botao "Voltar" que retorna pra lista.
  const [drillClient, setDrillClient] = useState<{ clientId: string; gestorNome: string; fromAllClientes?: boolean } | null>(null);
  // Drill em TODOS os clientes de UM gestor (abre popup grande com a lista)
  const [drillAllClientesGestor, setDrillAllClientesGestor] = useState<string | null>(null);
  // Quando o modal "vinculos" é aberto via banner "X doutores sem vínculo",
  // guarda os IDs daqueles 16 (ou N) clientes pra restringir a tabela. Quando
  // abre pelo botão padrão "Vinculações", fica null = mostra todos.
  const [vinculosPreFilter, setVinculosPreFilter] = useState<Set<string> | null>(null);
  const { lookup: lookupPhoto } = useUserPhotos();
  const { report: reportNotification, resolve: resolveNotification } = useNotifications();

  const { leads, loading: leadsLoading, error: leadsError } = useLeads();
  const {
    clients: mondayClients,
    allClients: mondayAllClients,
    // `clientsAll` é o universo SEM filtro de grupo/tipo (inclui "Plano normal",
    // clientes Bia tipo "Normal" puro, etc). Necessário pro banner "doutores
    // sem vínculo Meta" e pro modal de Vinculações — senão clientes como a
    // Colnaghi (Plano normal) ficam invisíveis pra vincular.
    clientsAll: mondayClientsAll,
    biaActiveIds,
    biaAllIds,
    biaTimelineByClientId,
    biaFaseByClientId,
    loading: mondayLoading,
    error: mondayError,
  } = useMondayClients();
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

  // Filtra links de clientes churned — não temos mais acesso à BM deles,
  // logo evita tentar buscar insights e gerar erro de permissão.
  const linksParaMeta = useMemo(() => {
    if (mondayAllClients.length === 0) return links;
    const churnedIds = new Set<string>();
    for (const c of mondayAllClients) if (isClientChurned(c)) churnedIds.add(c.id);
    return links.filter((l) => !churnedIds.has(l.monday_client_id));
  }, [links, mondayAllClients]);

  // useMetaSpend busca insights direto pelos links — não precisa de discovery
  const { insights, loading: metaLoading, errors: metaErrors, lastUpdate } =
    useMetaSpend(range, linksParaMeta);

  // Google Ads: gasto diário do espelho no Supabase (sync agendado)
  const { googleSpend } = useGoogleAdsSpend(range);

  const filteredLeads = useMemo(
    () => filterByDateRange(leads, range),
    [leads, range]
  );

  // Augmenta a lista de clientes com Bia ativa adicionando os clientes que
  // têm vínculo Meta manual salvo, mesmo sem Bia ativa. Isso garante que ao
  // vincular uma conta órfã a um cliente "inativo", o spend dele entre nas
  // métricas imediatamente — sem precisar esperar voltar pra fase ativa.
  const clientesParaMetricas = useMemo(() => {
    // Usa clientsAll (universo TOTAL) — antes era mondayAllClients que já é
    // filtrado por grupo "Plano à vista" + tipo "Normal + Bia Soft". Clientes
    // de "Plano normal" tipo "Normal" (ex: Colnaghi) sumiam mesmo tendo
    // vínculo Meta salvo.
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
      computeGestorMetrics({
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
  const user = useUser();
  const summary = useMemo(() => {
    // Admin com view-as: simula perfil pessoal de um gestor específico
    if (hasFullAccess(user) && viewAsGestor) {
      const filteredGestores = fullSummary.gestores.filter((g) => g.gestor === viewAsGestor);
      const totalSpend = filteredGestores.reduce((s, g) => s + g.totalSpend, 0);
      const totalSpendMeta = filteredGestores.reduce((s, g) => s + g.totalSpendMeta, 0);
      const totalSpendGoogle = filteredGestores.reduce((s, g) => s + g.totalSpendGoogle, 0);
      const totalTransferencias = filteredGestores.reduce((s, g) => s + g.totalTransferencias, 0);
      const totalMensagens = filteredGestores.reduce((s, g) => s + g.totalMensagens, 0);
      const cptGeral = totalTransferencias > 0
        ? Number((totalSpend / totalTransferencias).toFixed(2))
        : null;
      return {
        ...fullSummary,
        gestores: filteredGestores,
        totalSpend: Number(totalSpend.toFixed(2)),
        totalSpendMeta: Number(totalSpendMeta.toFixed(2)),
        totalSpendGoogle: Number(totalSpendGoogle.toFixed(2)),
        totalTransferencias,
        totalMensagens,
        cptGeral,
        clientsFora: [],
        orfaos: [],
        campaignsOrfas: [],
      };
    }
    if (hasFullAccess(user)) return fullSummary;
    if (user.role === 'gestor' && user.scope) {
      const filteredGestores = fullSummary.gestores.filter((g) =>
        nameMatchesScope(user.scope!, g.gestor)
      );
      const totalSpend = filteredGestores.reduce((s, g) => s + g.totalSpend, 0);
      const totalSpendMeta = filteredGestores.reduce((s, g) => s + g.totalSpendMeta, 0);
      const totalSpendGoogle = filteredGestores.reduce((s, g) => s + g.totalSpendGoogle, 0);
      const totalTransferencias = filteredGestores.reduce((s, g) => s + g.totalTransferencias, 0);
      const totalMensagens = filteredGestores.reduce((s, g) => s + g.totalMensagens, 0);
      const cptGeral = totalTransferencias > 0
        ? Number((totalSpend / totalTransferencias).toFixed(2))
        : null;
      return {
        ...fullSummary,
        gestores: filteredGestores,
        totalSpend: Number(totalSpend.toFixed(2)),
        totalSpendMeta: Number(totalSpendMeta.toFixed(2)),
        totalSpendGoogle: Number(totalSpendGoogle.toFixed(2)),
        totalTransferencias,
        totalMensagens,
        cptGeral,
        clientsFora: [],
        orfaos: [],
        campaignsOrfas: [],
      };
    }
    return { ...fullSummary, gestores: [], clientsFora: [], orfaos: [], campaignsOrfas: [] };
  }, [fullSummary, user, viewAsGestor]);

  const allClientMetrics = useMemo(
    () => summary.gestores.flatMap((g) => g.clients).concat(
      summary.clientsFora.map((c) => ({
        client: c,
        doutorMatch: null,
        matchVia: null,
        metaMatchVia: null,
        spend: 0,
        spendMeta: 0,
        spendGoogle: 0,
        transferencias: 0,
        mensagensIniciadas: 0,
        chatsInterrompidos: 0,
        cpt: null,
        campaigns: [],
        leads: [],
        allLeads: [],
        churned: false,
        churnCutoff: null,
        inactive: false,
        spendBruto: 0,
        spendExcluido: 0,
        spendExcluidoCrc: 0,
        periodosManutencao: [],
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

  // Reporta erros das integrações pro sistema central de notificações.
  // Cada erro tem ID estável → não duplica, e some quando o erro some.
  useEffect(() => {
    if (leadsError) {
      reportNotification({ id: 'supabase-leads', level: 'error', source: 'Supabase', message: leadsError });
    } else {
      resolveNotification('supabase-leads');
    }
  }, [leadsError, reportNotification, resolveNotification]);

  useEffect(() => {
    if (mondayError) {
      reportNotification({ id: 'monday-clients', level: 'error', source: 'Monday', message: mondayError });
    } else {
      resolveNotification('monday-clients');
    }
  }, [mondayError, reportNotification, resolveNotification]);

  useEffect(() => {
    if (linksError) {
      reportNotification({ id: 'meta-links', level: 'error', source: 'Vínculos', message: linksError });
    } else {
      resolveNotification('meta-links');
    }
  }, [linksError, reportNotification, resolveNotification]);

  useEffect(() => {
    // metaErrors é um array — cada erro vira uma notificação com id derivado
    const idsAtual = new Set<string>();
    metaErrors.forEach((msg, i) => {
      const id = `meta-${i}-${msg.slice(0, 40)}`;
      idsAtual.add(id);
      reportNotification({ id, level: 'error', source: 'Meta Ads', message: msg });
    });
    // Não temos como saber quais sair sem tracking; deixa pro usuário dispensar manualmente
  }, [metaErrors, reportNotification]);

  // Garante que a notificacao antiga "gestor-doutores-sem-vinculo" seja
  // resolvida se ainda estiver ativa de syncs passados. NAO reporta mais —
  // a info fica disponivel apenas pelo banner inline (visivel so pra
  // admin/super programador).
  useEffect(() => {
    resolveNotification('gestor-doutores-sem-vinculo');
  }, [resolveNotification]);

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* === Admin view-as: tab bar com fotos dos gestores === */}
      {hasFullAccess(user) && fullSummary.gestores.length > 0 && (
        <div className="flex items-center gap-1.5 bg-burst-card border border-burst-border rounded-xl p-1.5 w-fit flex-wrap">
          <ViewAsTab
            label="Visão geral"
            active={viewAsGestor === null}
            onClick={() => setViewAsGestor(null)}
            noAvatar
          />
          {fullSummary.gestores.map((g) => {
            const firstName = g.gestor.split(' ')[0];
            return (
              <ViewAsTab
                key={g.gestor}
                label={firstName}
                fullName={g.gestor}
                photoUrl={lookupPhoto(g.gestor)}
                active={viewAsGestor === g.gestor}
                onClick={() => setViewAsGestor(g.gestor)}
              />
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-xs text-burst-muted">
          <span className="text-white font-semibold">{mondayClients.length}</span> cliente(s) com Bia •{' '}
          <span className="text-white font-semibold">{links.length}</span> vínculo(s) •{' '}
          <span className="text-white font-semibold">{insights.length}</span> campanha(s) Meta •{' '}
          <span className="text-white font-semibold">{filteredLeads.length}</span> lead(s) no período
          {metaLoading && <span className="ml-2 text-burst-orange-bright">atualizando Meta...</span>}
        </div>
        <div className="flex items-center gap-2">
          {/* "Vincular contas" e operacao de manutencao do sistema (so admin
              precisa). Gestor comum nao deve mexer em vinculos de outros. */}
          {hasFullAccess(user) && (
            <button
              onClick={() => setOpenModal('vinculos')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-burst-orange/15 border border-burst-orange/40 hover:border-burst-orange hover:bg-burst-orange/25 transition-colors text-sm text-burst-orange-bright font-semibold"
            >
              <Link2 size={15} />
              Vincular contas
            </button>
          )}
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

      {/* Erros foram movidos pra aba "Notificações" — visível pelo sininho na sidebar */}

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

      {/* Banner: doutores ATIVOS (não churn/pausa/jurídico) sem vínculo Meta.
          So aparece pra admin/super programador (info de manutencao do sistema,
          gestor comum nao precisa ver). */}
      {hasFullAccess(user) && !linksMissingTable && !mondayLoading && mondayClientsAll.length > 0 && (
        <DoutoresSemVinculoMeta
          // Usa clientsAll (universo TOTAL do main board) — sem isso, clientes
          // de grupo "Plano normal" (tipo Colnaghi) ficavam invisíveis. O
          // componente filtra com biaAllIds pra só mostrar quem roda Bia.
          allClients={mondayClientsAll}
          links={links}
          biaAllIds={biaAllIds}
          onAbrirVinculacoes={() => {
            // Mesma regra do banner: Bia Soft + elegível + sem vínculo.
            const linkedIds = new Set(links.map((l) => l.monday_client_id));
            const semVinculoIds = new Set(
              mondayClientsAll
                .filter((c) => biaAllIds.has(c.id))
                .filter((c) => isClientElegivelMeta(c))
                .filter((c) => !linkedIds.has(c.id))
                .map((c) => c.id),
            );
            setVinculosPreFilter(semVinculoIds);
            setOpenModal('vinculos');
          }}
        />
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
          {/* === VISÃO PERSONALIZADA: Gestor não-admin OU admin com view-as === */}
          {((!hasFullAccess(user) && user.role === 'gestor') || (hasFullAccess(user) && viewAsGestor)) &&
            summary.gestores.length === 1 && (
              <PerfilPessoalGestor
                gestor={summary.gestores[0]}
                sectorSummary={fullSummary}
                onClickMensagens={() => setDrillGestor({ gestor: summary.gestores[0].gestor, type: 'mensagens' })}
                onClickTransferencias={() => setDrillGestor({ gestor: summary.gestores[0].gestor, type: 'transferencias' })}
                onClickSpend={() => setDrillGestor({ gestor: summary.gestores[0].gestor, type: 'spend' })}
                onClickCliente={(cm) => setDrillClient({ clientId: cm.client.id, gestorNome: summary.gestores[0].gestor })}
              />
            )}

          {/* === VISÃO ADMIN COMPLETA === */}
          {hasFullAccess(user) && !viewAsGestor && (
            <>
              <PainelGeralGestor
                summary={summary}
                lastUpdate={lastUpdate}
                onOpenClientes={() => setOpenModal('clientes')}
                onOpenCampanhas={() => setOpenModal('campanhas')}
                onOpenGestores={() => setOpenModal('gestores')}
              />

              {/* === RANKING COMPACTO DOS GESTORES (cards horizontais com foto)
                  Estilo Apresentação — comparação rápida antes dos PainelMini.
                  Ordenado por CPT crescente (melhores primeiro). */}
              <RankingPessoasCards
                titulo="Ranking dos Gestores"
                subtitulo={`${summary.gestores.length} gestor(es) ordenados por melhor CPT`}
                pessoas={[...summary.gestores]
                  .sort((a, b) => (a.cpt ?? Infinity) - (b.cpt ?? Infinity))
                  .map((g) => ({
                    id: g.gestor,
                    nome: g.gestor,
                    photoUrl: lookupPhoto(g.gestor),
                    metricaPrincipal: g.cpt !== null ? brl(g.cpt) : '—',
                    metricaLabel: 'CPT',
                    tier: g.cpt !== null ? tierForCpt(g.cpt) : 0,
                    tierLabel: tierLabelCpt(g.cpt !== null ? tierForCpt(g.cpt) : 0),
                    spendTotal: g.totalSpend,
                    spendMeta: g.totalSpendMeta,
                    spendGoogle: g.totalSpendGoogle,
                    onClick: () => setDrillAllClientesGestor(g.gestor),
                  }))}
              />

              {/* === LISTAS AGREGADAS DE TODOS OS CLIENTES (Melhores/Piores/
                  Menos transf/Menos leads + tabela completa) — visível pra
                  admin/super programador apenas. Universo: clientes de todos
                  os gestores. `clientsFora` não entra (sem métricas computadas). */}
              <ListasClientes
                clients={summary.gestores.flatMap((g) => g.clients)}
                onClickCliente={(cm) => {
                  const gestorDoClient = summary.gestores.find((g) =>
                    g.clients.some((cl) => cl.client.id === cm.client.id),
                  );
                  setDrillClient({
                    clientId: cm.client.id,
                    gestorNome: gestorDoClient?.gestor ?? '(sem gestor)',
                  });
                }}
                totalLabelSuffix="cliente(s) no time inteiro"
              />

              {summary.gestores.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {summary.gestores.map((g) => (
                    <PainelMiniGestor
                      key={g.gestor}
                      gestor={g}
                      onClickMensagens={() => setDrillGestor({ gestor: g.gestor, type: 'mensagens' })}
                      onClickTransferencias={() => setDrillGestor({ gestor: g.gestor, type: 'transferencias' })}
                      onClickSpend={() => setDrillGestor({ gestor: g.gestor, type: 'spend' })}
                      onClickCliente={(cm) => setDrillClient({ clientId: cm.client.id, gestorNome: g.gestor })}
                      onClickCard={() => setDrillAllClientesGestor(g.gestor)}
                    />
                  ))}
                </div>
              )}

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

              {summary.orfaos.length > 0 && (
                <DiagnosticoOrfaos
                  orfaos={summary.orfaos}
                  totalTransferenciasMapeadas={summary.totalTransferencias}
                  mondayClients={mondayAllClients}
                  linksByDoutor={doutorLinksByDoutor}
                  onLink={setDoutorLink}
                  onUnlink={removeDoutorLink}
                  missingTable={doutorLinksMissingTable}
                />
              )}

              {summary.campaignsOrfas.length > 0 && (
                <DiagnosticoCampanhasOrfas
                  campaigns={summary.campaignsOrfas}
                  mondayClients={mondayAllClients}
                  linksByAccount={linksByAccount}
                  onLink={setLink}
                  onUnlink={removeLink}
                />
              )}
            </>
          )}

          {/* Gestor não-admin sem dados */}
          {!hasFullAccess(user) && user.role === 'gestor' && summary.gestores.length === 0 && (
            <div className="rounded-2xl border border-burst-warning/40 bg-burst-warning/5 p-8 text-center">
              <AlertTriangle className="text-burst-warning mx-auto mb-3" size={28} />
              <div className="text-white font-display text-xl mb-2">
                Nenhum cliente vinculado a você no período
              </div>
              <p className="text-sm text-burst-muted">
                Não encontramos clientes no Monday com seu nome em "Gestor" para o
                período selecionado. Ajuste o período ou contate o admin.
              </p>
            </div>
          )}

          {/* Outros papéis */}
          {!hasFullAccess(user) && user.role !== 'gestor' && (
            <div className="rounded-2xl border border-burst-border bg-burst-card p-8 text-center">
              <p className="text-burst-muted text-sm">
                Esta aba mostra dados de Gestor de Tráfego. Use a aba do seu setor.
              </p>
            </div>
          )}
        </>
      )}

      <Modal
        open={openModal === 'clientes'}
        onClose={() => setOpenModal(null)}
        title="Clientes do Monday"
        subtitle={`${allClientMetrics.length} cliente(s) com Bia (grupo Plano à vista + Normal + Bia Soft)`}
      >
        <ClientesTable
          clients={allClientMetrics}
          onClickClient={(cm) => {
            // Acha o gestor do cliente clicado pra abrir o drill
            const g = summary.gestores.find((gst) =>
              gst.clients.some((c) => c.client.id === cm.client.id)
            );
            setOpenModal(null);
            setDrillClient({
              clientId: cm.client.id,
              gestorNome: g?.gestor ?? '(sem gestor)',
            });
          }}
        />
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
        onClose={() => {
          setOpenModal(null);
          // Limpa o pré-filtro pra que a próxima abertura (botão normal)
          // mostre todos os clientes.
          setVinculosPreFilter(null);
        }}
        title="Vincular Contas Meta ↔ Clientes Monday"
        subtitle="Carrega contas por gestor sob demanda • busca por nome no campo de conta • salva direto no banco"
        maxWidth="max-w-6xl"
      >
        <VinculacoesModal
          // Sempre passa o universo COMPLETO (clientsAll — TUDO do main, sem
          // filtro de grupo/tipo) e deixa o modal filtrar pelos critérios de
          // elegibilidade (Bia Soft + não churn + não jurídico), exceto pelos
          // já vinculados — que continuam visíveis pra limpar/editar.
          clients={mondayClientsAll}
          loadedAccounts={loadedAccounts}
          accountsLoading={accountsLoading}
          accountsErrors={accountsErrors}
          loadedGestores={loadedGestores}
          onLoadGestor={loadGestor}
          links={links}
          onLink={setLink}
          onUnlink={removeLink}
          restrictToClientIds={vinculosPreFilter ?? undefined}
          initialOnlyUnlinked={vinculosPreFilter !== null}
          biaAllIds={biaAllIds}
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
            title={`Gasto — ${g.gestor}`}
            subtitle={`${campanhas.length} campanha(s) • R$ ${g.totalSpend.toFixed(2)} total`}
          >
            <CampanhasTable insights={campanhas} />
          </Modal>
        );
      })()}

      {/* Drill-down de UM cliente específico */}
      {(() => {
        if (!drillClient) return null;
        // Procura em todos os gestores + clientsFora pra cobrir clientes
        // sem gestor (vindos da tabela "Clientes do Monday")
        const cm =
          allClientMetrics.find((c) => c.client.id === drillClient.clientId);
        if (!cm) return null;
        const cameFromList = !!drillClient.fromAllClientes;
        return (
          <Modal
            open
            // Fechar (X ou ESC sem onBack) fecha TUDO — tanto o drill quanto a lista.
            onClose={() => {
              setDrillClient(null);
              setDrillAllClientesGestor(null);
            }}
            // Voltar (so se veio da lista) — fecha drill e mantem lista aberta.
            onBack={cameFromList ? () => setDrillClient(null) : undefined}
            title={cm.client.name}
            subtitle={`Cliente de ${drillClient.gestorNome}`}
            maxWidth="max-w-5xl"
          >
            <ClienteDrilldown cm={cm} />
          </Modal>
        );
      })()}

      {/* Drill-down de TODOS os clientes de um gestor (popup grande).
          So renderiza se NAO tem drillClient aberto — quando user clica num
          card de cliente la dentro, esse modal "esconde" e o drillClient
          aparece por cima, com botao "Voltar" pra retornar pra lista. */}
      {(() => {
        if (!drillAllClientesGestor) return null;
        if (drillClient?.fromAllClientes) return null;
        const g = summary.gestores.find((x) => x.gestor === drillAllClientesGestor);
        if (!g) return null;
        const ativos = g.clients.filter((c) => !c.inactive).length;
        return (
          <Modal
            open
            onClose={() => setDrillAllClientesGestor(null)}
            title={`Clientes — ${g.gestor}`}
            subtitle={`${g.clients.length} cliente(s) no total · ${ativos} ativo(s) no período`}
            maxWidth="max-w-6xl"
          >
            <ClientesGridView
              clients={g.clients}
              onClickClient={(cm) => {
                // Mantem drillAllClientesGestor setado (vai voltar quando user
                // clicar em "Voltar" no drill individual).
                setDrillClient({ clientId: cm.client.id, gestorNome: g.gestor, fromAllClientes: true });
              }}
            />
          </Modal>
        );
      })()}
    </div>
  );
}


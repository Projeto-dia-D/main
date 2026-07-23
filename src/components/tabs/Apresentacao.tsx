import { useMemo, useState, useEffect, useRef } from 'react';
import { LayoutDashboard, AlertTriangle, Code2, Megaphone, Palette, Headphones, Trophy } from 'lucide-react';
import { useLeads } from '../../hooks/useLeads';
import { useMondayClients } from '../../hooks/useMondayClients';
import { useMetaSpend } from '../../hooks/useMetaSpend';
import { useGoogleAdsSpend } from '../../hooks/useGoogleAdsSpend';
import { useMetaLinks } from '../../hooks/useMetaLinks';
import { useDoutorLinks } from '../../hooks/useDoutorLinks';
import { useDesignEventos } from '../../hooks/useDesignEventos';
import { useAtestados } from '../../hooks/useAtestados';
import { useHolidays } from '../../hooks/useHolidays';
import { useInstanceMap } from '../../hooks/useInstanceMap';
import { useUser, hasFullAccess } from '../../lib/userContext';
import { useUserPhotos } from '../../hooks/useUserPhotos';
import { useDoutorAdPhotos } from '../../hooks/useDoutorAdPhotos';
import { Avatar } from '../Avatar';
import {
  computeGestorMetrics, brl, tierForCpt, tierLabelCpt, findDestaqueClient,
  type ClientMetrics,
} from '../../lib/gestorMetrics';
import { computeCsMetrics } from '../../lib/csMetrics';
import {
  computeDesignMetrics, formatBonusTotal,
} from '../../lib/designMetrics';
import { computeMetrics, filterByDateRange, type DateRange } from '../../lib/metrics';
import {
  exclusoesPorNomeNoSetor,
  nomeCasaExcluidoEm,
  idsExcluidosNoSetorEm,
} from '../../lib/clientMetricControl';
import { useClientMetricControls } from '../../hooks/useClientMetricControls';
import { diaDRange, DateRangeFilter } from '../programacao/DateRangeFilter';
import { isClientChurned } from '../../lib/monday';
import { PainelGeral } from '../programacao/PainelGeral';
import { PainelGeralGestor } from '../gestor/PainelGeralGestor';
import { PainelGeralDesign } from '../design/PainelGeralDesign';
import { PainelGeralCs } from '../cs/PainelGeralCs';
import type { SalaryTier } from '../../lib/types';

/**
 * Aba "Apresentação" — dashboard executivo TV (admins only).
 *
 * Cada quadrante mostra:
 *  - Programação: só o PainelGeral (média do setor)
 *  - Gestor / Designer / CS: PainelGeral compacto no topo + linha de cards
 *    individuais (com foto, métrica e cor de tier) embaixo
 *
 * Tudo cabe em 1 tela (sem scroll).
 */
export function Apresentacao() {
  const user = useUser();
  const [range, setRange] = useState<DateRange>(() => diaDRange());

  if (!hasFullAccess(user)) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-burst-orange/40 bg-burst-card p-8 max-w-2xl">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="text-burst-orange-bright" />
            <h2 className="font-display text-2xl text-white tracking-wider">Acesso restrito</h2>
          </div>
          <p className="text-sm text-burst-muted">Esta aba é exclusiva pra administradores.</p>
        </div>
      </div>
    );
  }

  const { leads, lastUpdate } = useLeads();
  const {
    clients: mondayClients,
    allClients: mondayAllClients,
    biaActiveIds, biaTimelineByClientId, biaFaseByClientId,
    responsavelByName, nameByClientId,
  } = useMondayClients();
  const { controlsList: metricControls } = useClientMetricControls();
  const { links, byAccount: linksByAccount, byClient: linksByClient } = useMetaLinks();
  const { byClient: doutorLinksByClient } = useDoutorLinks();
  const { eventos: designEventos, lastUpdate: designLastUpdate } = useDesignEventos();
  const { atestados } = useAtestados();
  const { holidays } = useHolidays();
  const instanceMap = useInstanceMap();
  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);
  const { lookup: lookupPhoto } = useUserPhotos();

  const linksParaMeta = useMemo(() => {
    if (mondayAllClients.length === 0) return links;
    const churnedIds = new Set<string>();
    for (const c of mondayAllClients) if (isClientChurned(c)) churnedIds.add(c.id);
    return links.filter((l) => !churnedIds.has(l.monday_client_id));
  }, [links, mondayAllClients]);

  const { insights, lastUpdate: metaLastUpdate } = useMetaSpend(range, linksParaMeta);
  const { googleSpend } = useGoogleAdsSpend(range);
  const filteredLeads = useMemo(() => filterByDateRange(leads, range), [leads, range]);

  // === Controle de Clientes — MESMAS exclusões das abas individuais, pra o
  //     telão bater com a Programação/Gestor/CS. Design NÃO exclui ninguém. ===
  const mainNameById = useMemo(
    () => new Map(mondayAllClients.map((c) => [c.id, c.name] as const)),
    [mondayAllClients],
  );
  // Programação: filtra por NOME do doutor no lead (respeita "vale a partir de").
  const programacaoExclusoes = useMemo(
    () => exclusoesPorNomeNoSetor(metricControls, 'programacao', [mainNameById, nameByClientId]),
    [metricControls, mainNameById, nameByClientId],
  );
  const leadsProgramacao = useMemo(
    () =>
      programacaoExclusoes.length === 0
        ? filteredLeads
        : filteredLeads.filter(
            (l) => !nomeCasaExcluidoEm(l.nomeDoutor, l.dataCadastro, programacaoExclusoes),
          ),
    [filteredLeads, programacaoExclusoes],
  );
  // Gestor/CS: excluem por ID (herdam sempre o desligamento da Programação).
  const gestorExcluidos = useMemo(
    () => idsExcluidosNoSetorEm(metricControls, 'gestor', range.start),
    [metricControls, range],
  );
  const csExcluidos = useMemo(
    () => idsExcluidosNoSetorEm(metricControls, 'cs', range.start),
    [metricControls, range],
  );

  const clientesParaMetricas = useMemo(() => {
    if (mondayAllClients.length === 0) return mondayClients;
    const idsAtivos = new Set(mondayClients.map((c) => c.id));
    const idsComLink = new Set(links.map((l) => l.monday_client_id));
    const extras = mondayAllClients.filter((c) => idsComLink.has(c.id) && !idsAtivos.has(c.id));
    return extras.length === 0 ? mondayClients : [...mondayClients, ...extras];
  }, [mondayClients, mondayAllClients, links]);

  const clientesGestor = useMemo(
    () =>
      gestorExcluidos.size === 0
        ? clientesParaMetricas
        : clientesParaMetricas.filter((c) => !gestorExcluidos.has(c.id)),
    [clientesParaMetricas, gestorExcluidos],
  );
  const clientesCs = useMemo(
    () =>
      csExcluidos.size === 0
        ? clientesParaMetricas
        : clientesParaMetricas.filter((c) => !csExcluidos.has(c.id)),
    [clientesParaMetricas, csExcluidos],
  );

  const programacaoSummary = useMemo(
    () => computeMetrics(leadsProgramacao, range, instanceMap, mondayAllClients, biaTimelineByClientId, biaFaseByClientId),
    [leadsProgramacao, range, instanceMap, mondayAllClients, biaTimelineByClientId, biaFaseByClientId],
  );

  const gestorSummary = useMemo(
    () => computeGestorMetrics({
      clients: clientesGestor, insights, leads: filteredLeads,
      metaLinks: linksByAccount, doutorLinks: doutorLinksByClient,
      biaActiveIds, biaTimelineByClientId, biaFaseByClientId, dateRange: range,
      googleSpend,
    }),
    [clientesGestor, insights, filteredLeads, linksByAccount, doutorLinksByClient, biaActiveIds, biaTimelineByClientId, biaFaseByClientId, range, googleSpend],
  );

  const csSummary = useMemo(
    () => computeCsMetrics({
      ...gestorSummary, clients: clientesCs, insights, leads: filteredLeads,
      metaLinks: linksByAccount, doutorLinks: doutorLinksByClient,
      biaActiveIds, biaTimelineByClientId, biaFaseByClientId, dateRange: range,
      googleSpend,
    } as Parameters<typeof computeCsMetrics>[0]),
    [gestorSummary, clientesCs, insights, filteredLeads, linksByAccount, doutorLinksByClient, biaActiveIds, biaTimelineByClientId, biaFaseByClientId, range, googleSpend],
  );

  const designSummary = useMemo(
    () => computeDesignMetrics(designEventos, range, holidaySet, atestados),
    [designEventos, range, holidaySet, atestados],
  );

  // Doutores destaque por programador: top 2 doutores com MELHOR TAXA entre
  // os que estão sob sua responsabilidade, exigindo >10 transferências.
  // Um aparece na esquerda do mini-card, outro na direita.
  const doutoresDestaqueGabriel = useMemo(
    () => findTop2DoutoresPorTaxa(
      programacaoSummary.doutores,
      responsavelByName,
      'Gabriel Velho dos Santos',
    ),
    [programacaoSummary.doutores, responsavelByName],
  );
  const doutoresDestaqueEduardo = useMemo(
    () => findTop2DoutoresPorTaxa(
      programacaoSummary.doutores,
      responsavelByName,
      'Eduardo Henckemaier Borguesan',
    ),
    [programacaoSummary.doutores, responsavelByName],
  );

  // Pro caso "acima da meta" (mostra foto do rabino): 2 melhores doutores GLOBAIS
  // do setor de programação (>10 transferências, ordenados por taxa desc).
  const top2DoutoresSetor = useMemo(() => {
    const candidatos = programacaoSummary.doutores
      .filter((d) => d.totalTransferidos > 10)
      .sort((a, b) => b.taxa - a.taxa);
    return [candidatos[0] ?? null, candidatos[1] ?? null] as const;
  }, [programacaoSummary.doutores]);

  // Lista unica de TODOS os doutores destaque que vamos mostrar (programadores
  // individuais + globais quando tier 1). Usada pelo hook que busca foto Meta.
  const doutoresDestaqueAllNames = useMemo(() => {
    const names = new Set<string>();
    for (const d of doutoresDestaqueGabriel) if (d) names.add(d.nome);
    for (const d of doutoresDestaqueEduardo) if (d) names.add(d.nome);
    for (const d of top2DoutoresSetor) if (d) names.add(d.nome);
    return Array.from(names);
  }, [doutoresDestaqueGabriel, doutoresDestaqueEduardo, top2DoutoresSetor]);

  const doutorPhotos = useDoutorAdPhotos(doutoresDestaqueAllNames, mondayAllClients, linksByClient);

  const noop = () => {};

  return (
    <div className="h-screen w-full flex flex-col bg-burst-bg overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-5 py-2 border-b border-burst-border bg-burst-panel shrink-0">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="text-burst-orange-bright" size={20} />
          <h1 className="font-display text-lg text-white tracking-wide">Apresentação</h1>
          <span className="text-[10px] text-burst-muted ml-2">
            {range.start?.toLocaleDateString('pt-BR') ?? ''} → {range.end?.toLocaleDateString('pt-BR') ?? ''}
          </span>
        </div>
        <DateRangeFilter range={range} onChange={setRange} />
      </header>

      {/* (grid 2x2 vai aqui — adicionado abaixo) */}

      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-2 p-2 min-h-0 overflow-hidden">
        {/* PROGRAMAÇÃO — dashboard (~70%) + cards pequenos só foto dos
            programadores (Gabriel Velho e Eduardo Henckemaier) embaixo */}
        <Quadrante
          icon={<Code2 className="text-purple-400" size={20} />}
          titulo="Programação"
          subtitulo="Média do setor"
          accentColor="purple"
        >
          <div className="h-full w-full flex flex-col gap-2 min-h-0">
            {/* Quando ACIMA DA META: PainelGeral menor (45%) pra dar mais
                espaco pra foto celebratoria do Gabriel+Eduardo (55%).
                Quando abaixo: layout original 72/28 com os 2 mini-cards. */}
            <div
              className={`min-h-0 overflow-hidden ${programacaoSummary.tier === 1 ? 'h-[45%]' : 'h-[72%]'}`}
            >
              <FitToBox fullHeight>
                <PainelGeral
                  summary={programacaoSummary}
                  lastUpdate={lastUpdate}
                  onOpenLeads={noop}
                  onOpenTransferidos={noop}
                  onOpenDoutores={noop}
                />
              </FitToBox>
            </div>
            <div
              className={`min-h-0 flex items-stretch justify-center ${programacaoSummary.tier === 1 ? 'h-[55%]' : 'h-[28%]'}`}
            >
              {programacaoSummary.tier === 1 ? (
                <div className="h-full w-full flex items-stretch justify-center gap-3">
                  {top2DoutoresSetor[0] && (
                    <div className="flex-1 max-w-[26%] min-w-0">
                      <DoutorDestaqueCompact
                        doutor={top2DoutoresSetor[0]!}
                        photoUrl={doutorPhotos.get(top2DoutoresSetor[0]!.nome) ?? null}
                      />
                    </div>
                  )}
                  <img
                    src="/programadores-acima-meta.jpg"
                    alt="Gabriel e Eduardo acima da meta"
                    draggable={false}
                    className="h-full w-auto max-w-[48%] object-contain rounded-xl border-2 border-green-500/60 shadow-[0_0_24px_rgba(34,197,94,0.35)] shrink-0"
                  />
                  {top2DoutoresSetor[1] && (
                    <div className="flex-1 max-w-[26%] min-w-0">
                      <DoutorDestaqueCompact
                        doutor={top2DoutoresSetor[1]!}
                        photoUrl={doutorPhotos.get(top2DoutoresSetor[1]!.nome) ?? null}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-[70%] h-full grid grid-cols-2 gap-3 [&>*]:[container-type:size]">
                  <MiniFotoCard
                    nome="Gabriel Velho dos Santos"
                    photoUrl={lookupPhoto('Gabriel Velho dos Santos') ?? lookupPhoto('Gabriel Velho')}
                    doutoresDestaque={doutoresDestaqueGabriel}
                    doutorPhotos={doutorPhotos}
                  />
                  <MiniFotoCard
                    nome="Eduardo Henckemaier Borguesan"
                    photoUrl={lookupPhoto('Eduardo Henckemaier Borguesan') ?? lookupPhoto('Eduardo Henckemaier')}
                    doutoresDestaque={doutoresDestaqueEduardo}
                    doutorPhotos={doutorPhotos}
                  />
                </div>
              )}
            </div>
          </div>
        </Quadrante>

        {/* GESTOR — dashboard no topo + cards embaixo */}
        <Quadrante
          icon={<Megaphone className="text-blue-400" size={20} />}
          titulo="Gestor de Tráfego"
          subtitulo={`${gestorSummary.gestores.length} gestores`}
          accentColor="blue"
        >
          <DashboardComCards
            dashboard={
              <PainelGeralGestor
                summary={gestorSummary}
                lastUpdate={metaLastUpdate}
                onOpenClientes={noop}
                onOpenCampanhas={noop}
                onOpenGestores={noop}
              />
            }
          >
            {[...gestorSummary.gestores]
              .sort((a, b) => (a.cpt ?? Infinity) - (b.cpt ?? Infinity))
              .map((g, idx) => (
                <PessoaCard
                  key={g.gestor}
                  nome={g.gestor}
                  photoUrl={lookupPhoto(g.gestor)}
                  metricaPrincipal={g.cpt !== null ? brl(g.cpt) : '—'}
                  metricaLabel="CPT"
                  tier={g.cpt !== null ? tierForCpt(g.cpt) : 0}
                  tierLabel={tierLabelCpt(g.cpt !== null ? tierForCpt(g.cpt) : 0)}
                  isFirst={idx === 0}
                  clienteDestaque={findDestaqueClient(g.clients)}
                  spendMeta={g.totalSpendMeta}
                  spendGoogle={g.totalSpendGoogle}
                />
              ))}
          </DashboardComCards>
        </Quadrante>

        {/* DESIGNER — dashboard + cards */}
        <Quadrante
          icon={<Palette className="text-pink-400" size={20} />}
          titulo="Designer"
          subtitulo={`${designSummary.designers.length} designers`}
          accentColor="pink"
        >
          <DashboardComCards
            dashboard={
              <PainelGeralDesign
                summary={designSummary}
                lastUpdate={designLastUpdate}
                onOpenFeitos={noop}
                onOpenManutencoes={noop}
                onOpenDesigners={noop}
              />
            }
          >
            {[...designSummary.designers]
              .sort((a, b) => b.bonusTotal - a.bonusTotal || a.atrasoPct - b.atrasoPct)
              .map((d) => {
                // Bônus do designer = atraso + manutenção (já calculado no lib).
                const tierGeral = d.bonusTotal;
                return (
                  <PessoaCard
                    key={d.nome}
                    nome={d.nome}
                    photoUrl={lookupPhoto(d.nome)}
                    metricaPrincipal={`${d.atrasoPct.toFixed(1)}%`}
                    metricaLabel={`atraso · ${d.pctManutencao.toFixed(0)}% manut`}
                    tier={tierGeral}
                    tierLabel={formatBonusTotal(tierGeral)}
                  />
                );
              })}
          </DashboardComCards>
        </Quadrante>

        {/* CS — dashboard + cards */}
        <Quadrante
          icon={<Headphones className="text-teal-400" size={20} />}
          titulo="CS"
          subtitulo={`${csSummary.cses.length} CSs`}
          accentColor="teal"
        >
          <DashboardComCards
            dashboard={
              <PainelGeralCs
                summary={csSummary}
                lastUpdate={metaLastUpdate}
                onOpenClientes={noop}
                onOpenCses={noop}
              />
            }
          >
            {[...csSummary.cses]
              .sort((a, b) => (a.cpt ?? Infinity) - (b.cpt ?? Infinity))
              .map((c, idx) => (
                <PessoaCard
                  key={c.cs}
                  nome={c.cs}
                  photoUrl={lookupPhoto(c.cs)}
                  metricaPrincipal={c.cpt !== null ? brl(c.cpt) : '—'}
                  metricaLabel="CPT"
                  tier={c.cpt !== null ? tierForCpt(c.cpt) : 0}
                  tierLabel={tierLabelCpt(c.cpt !== null ? tierForCpt(c.cpt) : 0)}
                  isFirst={idx === 0}
                  clienteDestaque={findDestaqueClient(c.clients)}
                  spendMeta={c.totalSpendMeta}
                  spendGoogle={c.totalSpendGoogle}
                />
              ))}
          </DashboardComCards>
        </Quadrante>
      </div>

      {/* FOOTER — líderes Renan e Vanessa */}
      <footer className="shrink-0 border-t border-burst-border bg-gradient-to-r from-burst-panel via-burst-orange/5 to-burst-panel px-6 py-3 flex items-center justify-center gap-10">
        <LiderBadge nome="Renan Rafaeli" photoUrl={lookupPhoto('Renan Rafaeli')} cargo="Gestor de Projetos" />
        <div className="w-px h-12 bg-burst-orange/30" />
        <LiderBadge nome="Vanessa Rocha" photoUrl={lookupPhoto('Vanessa Rocha')} cargo="Lider de CS" />
      </footer>
    </div>
  );
}

/** Badge no footer com foto + nome + cargo dos líderes. */
function LiderBadge({ nome, photoUrl, cargo }: { nome: string; photoUrl: string | null; cargo: string }) {
  const [errored, setErrored] = useState(false);
  const initials = getInitials(nome);
  const showImage = photoUrl && !errored;
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 h-16 rounded-full overflow-hidden ring-2 ring-burst-orange/60 shadow-orange-glow flex items-center justify-center">
        {showImage ? (
          <img
            src={photoUrl}
            alt={nome}
            referrerPolicy="no-referrer"
            onError={() => setErrored(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="font-display font-bold text-white text-lg">{initials}</span>
        )}
      </div>
      <div className="flex flex-col leading-tight">
        <div className="text-[11px] uppercase tracking-[0.2em] text-burst-orange-bright font-semibold">{cargo}</div>
        <div className="text-lg font-display text-white tracking-wide">{nome}</div>
      </div>
    </div>
  );
}

// ============================================================
// Container de cada quadrante
// ============================================================
function Quadrante({
  icon, titulo, subtitulo, accentColor, children,
}: {
  icon: React.ReactNode;
  titulo: string;
  subtitulo?: string;
  accentColor: 'purple' | 'blue' | 'pink' | 'teal';
  children: React.ReactNode;
}) {
  const borderColor = {
    purple: 'border-purple-500/40',
    blue: 'border-blue-500/40',
    pink: 'border-pink-500/40',
    teal: 'border-teal-500/40',
  }[accentColor];
  return (
    <section className={`rounded-xl border-2 ${borderColor} bg-burst-card flex flex-col overflow-hidden min-h-0`}>
      <header className="flex items-center gap-2 px-4 py-1.5 border-b border-burst-border shrink-0">
        {icon}
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-base text-white tracking-wide leading-tight">{titulo}</h2>
          {subtitulo && <div className="text-[10px] text-burst-muted leading-none">{subtitulo}</div>}
        </div>
      </header>
      <div className="flex-1 overflow-hidden p-2 min-h-0">{children}</div>
    </section>
  );
}

// ============================================================
// Layout interno: dashboard no topo (~55%) + cards embaixo (~45%)
// ============================================================
function DashboardComCards({
  dashboard, children,
}: {
  dashboard: React.ReactNode;
  children: React.ReactNode;
}) {
  const arr = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <div className="h-full w-full flex flex-col gap-2 min-h-0">
      {/* Dashboard escalado (~60% — mais espaço pra fonte ficar legível) */}
      <div className="h-[60%] min-h-0 overflow-hidden">
        <FitToBox fullHeight>{dashboard}</FitToBox>
      </div>
      {/* Grid de cards individuais (~40%) */}
      <div className="h-[40%] min-h-0">
        <CardsGrid count={arr.length}>{arr}</CardsGrid>
      </div>
    </div>
  );
}

// ============================================================
// Grid adaptativo pros cards
// ============================================================
function CardsGrid({ count, children }: { count: number; children: React.ReactNode }) {
  // Como cada card agora é HORIZONTAL (largura > altura), preferimos colunas
  // menores pra cada card ficar mais largo. Aspect ideal ~2:1 (W:H).
  let cols = 2;
  let rows = 1;
  if (count <= 0) { cols = 1; rows = 1; }
  else if (count <= 2) { cols = 1; rows = count; }
  else if (count <= 4) { cols = 2; rows = 2; }
  else if (count <= 6) { cols = 2; rows = 3; }
  else if (count <= 8) { cols = 2; rows = 4; }
  else if (count <= 9) { cols = 3; rows = 3; }
  else if (count <= 12) { cols = 3; rows = 4; }
  else { cols = 3; rows = Math.ceil(count / 3); }
  return (
    <div
      className="h-full w-full grid gap-2 [&>*]:[container-type:size]"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Mini-card do programador (Gabriel ou Eduardo) no quadrante Programação.
 *
 * Layout: [Doutor #2 destaque] [Foto + Nome] [Doutor #1 destaque]
 * Os destaques sao os 2 doutores com MELHOR TAXA entre os que ele é responsável,
 * exigindo >10 transferências. Se houver só 1 candidato, mostra um lado só.
 * Se 0, foto e nome ficam centralizados sem destaque.
 */
function MiniFotoCard({
  nome,
  photoUrl,
  doutoresDestaque,
  doutorPhotos,
}: {
  nome: string;
  photoUrl: string | null;
  doutoresDestaque: [
    { nome: string; taxa: number; totalTransferidos: number } | null,
    { nome: string; taxa: number; totalTransferidos: number } | null,
  ];
  doutorPhotos?: Map<string, string | null>;
}) {
  const firstName = nome.split(' ')[0];
  const [primeiro, segundo] = doutoresDestaque;
  return (
    <div className="rounded-xl border-2 border-green-500/60 bg-green-500/15 shadow-[0_0_24px_rgba(34,197,94,0.25)] flex items-stretch overflow-hidden min-h-0 relative gap-0">
      {/* DOUTOR DESTAQUE #2 — esquerda da foto (so se existir) */}
      {segundo && (
        <DoutorDestaqueSide
          doutor={segundo}
          side="left"
          photoUrl={doutorPhotos?.get(segundo.nome) ?? null}
        />
      )}

      {/* FOTO + NOME + 1 SALARIO no meio */}
      <div className="flex items-stretch flex-1 min-w-0">
        <FotoSquare name={nome} photoUrl={photoUrl} />
        <div
          className="flex-1 min-w-0 flex flex-col justify-center items-start gap-1"
          style={{ padding: 'clamp(8px, 2cqh, 16px)' }}
        >
          <div
            className="text-white font-display tracking-wide truncate w-full leading-tight uppercase"
            style={{ fontSize: 'clamp(11px, 2.5cqh, 18px)' }}
            title={nome}
          >
            {firstName}
          </div>
          <div
            className="font-display text-green-400 tracking-tight leading-none"
            style={{ fontSize: 'clamp(18px, 5cqh, 42px)' }}
          >
            1 SALÁRIO
          </div>
          <div
            className="uppercase tracking-widest font-bold text-green-400 leading-none"
            style={{ fontSize: 'clamp(8px, 1.5cqh, 11px)' }}
          >
            ↑ ACIMA DA META
          </div>
        </div>
      </div>

      {/* DOUTOR DESTAQUE #1 — direita da foto (so se existir) */}
      {primeiro && (
        <DoutorDestaqueSide
          doutor={primeiro}
          side="right"
          photoUrl={doutorPhotos?.get(primeiro.nome) ?? null}
        />
      )}
    </div>
  );
}

/** Versão compacta do destaque pra ladear a foto do rabino no tier 1.
 *  Layout: foto do anuncio em cima (full opacity, sem overlay escuro),
 *  texto embaixo com fundo escuro solido pra contraste. */
function DoutorDestaqueCompact({
  doutor,
  photoUrl,
}: {
  doutor: { nome: string; taxa: number; totalTransferidos: number };
  photoUrl?: string | null;
}) {
  return (
    <div className="h-full rounded-xl border-2 border-green-500/50 overflow-hidden relative flex flex-col bg-black/40">
      {/* Foto do anúncio em cima — full opacity. Sem foto = espaço com tom verde. */}
      {photoUrl ? (
        <div
          className="flex-1 bg-cover bg-center min-h-0"
          style={{ backgroundImage: `url(${photoUrl})` }}
        />
      ) : (
        <div className="flex-1 bg-green-500/[0.12] min-h-0 flex items-center justify-center">
          <span className="text-green-400/40 text-3xl font-display">★</span>
        </div>
      )}
      {/* Texto embaixo com fundo escuro solido (readability garantida) */}
      <div className="bg-black/85 backdrop-blur-sm px-3 py-2 flex flex-col gap-0.5 shrink-0">
        <div className="uppercase tracking-widest text-green-400 leading-tight font-bold text-[9px]">
          Doutor Destaque
        </div>
        <div
          className="text-white font-semibold leading-tight break-words text-sm"
          title={doutor.nome}
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
          }}
        >
          {doutor.nome}
        </div>
        <div className="flex items-baseline gap-1.5 flex-wrap mt-0.5">
          <span className="font-display text-green-400 leading-none text-xl">
            {doutor.taxa.toFixed(1)}%
          </span>
          <span className="text-white/60 leading-tight uppercase tracking-wider text-[9px]">
            · {doutor.totalTransferidos} transf
          </span>
        </div>
      </div>
    </div>
  );
}

/** Coluna lateral com info de um doutor destaque (esquerda ou direita do card).
 *  Foto do anuncio em cima (full opacity), texto embaixo com fundo escuro. */
function DoutorDestaqueSide({
  doutor,
  side,
  photoUrl,
}: {
  doutor: { nome: string; taxa: number; totalTransferidos: number };
  side: 'left' | 'right';
  photoUrl?: string | null;
}) {
  const borderCls = side === 'left' ? 'border-r-2' : 'border-l-2';
  return (
    <div
      className={`shrink-0 self-stretch flex flex-col ${borderCls} border-green-500/40 overflow-hidden relative bg-black/40`}
      style={{
        minWidth: 'clamp(110px, 24cqh, 180px)',
        maxWidth: 'clamp(150px, 32cqh, 240px)',
      }}
    >
      {/* Foto do anuncio em cima — full opacity */}
      {photoUrl ? (
        <div
          className="flex-1 bg-cover bg-center min-h-0"
          style={{ backgroundImage: `url(${photoUrl})` }}
        />
      ) : (
        <div className="flex-1 bg-green-500/[0.12] min-h-0 flex items-center justify-center">
          <span className="text-green-400/40 text-2xl font-display">★</span>
        </div>
      )}
      {/* Texto embaixo com fundo solido */}
      <div
        className="bg-black/85 backdrop-blur-sm flex flex-col shrink-0"
        style={{ padding: 'clamp(6px, 1.5cqh, 11px)', gap: 'clamp(1px, 0.4cqh, 4px)' }}
      >
        <div
          className="uppercase tracking-widest text-green-400 leading-tight font-bold"
          style={{ fontSize: 'clamp(7px, 1.3cqh, 10px)' }}
        >
          Doutor Destaque
        </div>
        <div
          className="text-white font-semibold leading-tight break-words"
          style={{
            fontSize: 'clamp(10px, 1.9cqh, 13px)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
          }}
          title={doutor.nome}
        >
          {doutor.nome}
        </div>
        <div className="flex items-baseline gap-1 flex-wrap">
          <span
            className="font-display text-green-400 leading-none"
            style={{ fontSize: 'clamp(13px, 3cqh, 22px)' }}
          >
            {doutor.taxa.toFixed(1)}%
          </span>
          <span
            className="text-white/60 leading-tight uppercase tracking-wider"
            style={{ fontSize: 'clamp(7px, 1.1cqh, 9px)' }}
          >
            · {doutor.totalTransferidos} transf
          </span>
        </div>
      </div>
    </div>
  );
}

/** Foto quadrada que ocupa altura inteira do card. SEM fundo — quando não
 *  tem foto, mostra só as iniciais sobre o fundo do card. */
function FotoSquare({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const [errored, setErrored] = useState(false);
  const initials = getInitials(name);
  const showImage = photoUrl && !errored;
  return (
    <div
      className="shrink-0 self-stretch flex items-center justify-center overflow-hidden"
      style={{ aspectRatio: '1 / 1', height: '100%' }}
    >
      {showImage ? (
        <img
          src={photoUrl}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setErrored(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span
          className="font-display font-bold text-white/90"
          style={{ fontSize: 'clamp(20px, 6cqh, 56px)' }}
        >
          {initials}
        </span>
      )}
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ============================================================
// Card de uma pessoa — layout HORIZONTAL:
//   foto QUADRADA grande à esquerda (toma altura toda) + info à direita.
// Sem espaço vazio.
// ============================================================
function PessoaCard({
  nome, photoUrl, metricaPrincipal, metricaLabel, tier, tierLabel, isFirst = false,
  clienteDestaque = null, spendMeta, spendGoogle,
}: {
  nome: string;
  photoUrl: string | null;
  metricaPrincipal: string;
  metricaLabel: string;
  tier: SalaryTier;
  tierLabel: string;
  /** Quando true, este card e do #1 do ranking. Mostra troféu ao lado do nome. */
  isFirst?: boolean;
  /** Cliente destaque (alto volume de transf, baixo CPT) — exibido a direita
   *  no card pra preencher o espaco vazio. null quando nenhum cliente qualifica. */
  clienteDestaque?: ClientMetrics | null;
  /** Breakdown do investido por origem — quando presentes, mostra
   *  "Meta R$X · Google R$Y" no rodapé do card (gestor/CS). */
  spendMeta?: number;
  spendGoogle?: number;
}) {
  const cor = tier === 1
    ? { bg: 'bg-green-500/15', border: 'border-green-500/60', text: 'text-green-400', glow: 'shadow-[0_0_24px_rgba(34,197,94,0.25)]' }
    : tier === 0.5
    ? { bg: 'bg-burst-orange/15', border: 'border-burst-orange/60', text: 'text-burst-orange-bright', glow: 'shadow-orange-glow' }
    : { bg: 'bg-red-500/15', border: 'border-red-500/60', text: 'text-red-400', glow: 'shadow-[0_0_24px_rgba(239,68,68,0.25)]' };

  const firstName = nome.split(' ')[0];

  return (
    <div
      className={`rounded-xl border-2 ${cor.border} ${cor.bg} ${cor.glow} flex items-stretch min-h-0 overflow-hidden relative gap-0`}
    >
      {/* FOTO LATERAL — quadrada, ocupa altura toda do card. */}
      <FotoSquare name={nome} photoUrl={photoUrl} />

      {/* INFO no meio — métrica principal + nome */}
      <div
        className="flex-1 min-w-0 flex flex-col justify-center items-start gap-1"
        style={{ padding: 'clamp(8px, 2cqh, 16px)' }}
      >
        <div
          className="text-white font-display tracking-wide truncate w-full leading-tight uppercase flex items-center gap-1.5"
          style={{ fontSize: 'clamp(11px, 2.5cqh, 18px)' }}
          title={nome}
        >
          <span className="truncate">{firstName}</span>
          {isFirst && (
            <Trophy
              className="text-yellow-400 shrink-0 drop-shadow-[0_0_6px_rgba(250,204,21,0.7)]"
              style={{ width: 'clamp(12px, 2.5cqh, 20px)', height: 'clamp(12px, 2.5cqh, 20px)' }}
            />
          )}
        </div>
        <div
          className={`font-display ${cor.text} tracking-tight leading-none`}
          style={{ fontSize: 'clamp(20px, 6cqh, 52px)' }}
        >
          {metricaPrincipal}
        </div>
        <div
          className="text-burst-muted leading-none"
          style={{ fontSize: 'clamp(9px, 1.8cqh, 12px)' }}
        >
          {metricaLabel}
        </div>
        <div
          className={`uppercase tracking-widest font-bold ${cor.text} leading-none`}
          style={{ fontSize: 'clamp(8px, 1.5cqh, 11px)' }}
        >
          {tierLabel}
        </div>
        {(spendMeta !== undefined || spendGoogle !== undefined) && (
          <div
            className="text-burst-muted leading-tight whitespace-nowrap"
            style={{ fontSize: 'clamp(8px, 1.5cqh, 11px)' }}
          >
            Meta <span className="text-white/85 font-semibold">{brl(spendMeta ?? 0)}</span>
            {' · '}
            Google <span className="text-white/85 font-semibold">{brl(spendGoogle ?? 0)}</span>
          </div>
        )}
      </div>

      {/* CLIENTE DESTAQUE — aparece pra TODO gestor/CS que tiver cliente com
          >10 transf. Mostra NOME + CPT (custo por transferência). SEM troféu
          aqui — o troféu fica só ao lado do nome do #1 do ranking. */}
      {clienteDestaque && (
        <div
          className="shrink-0 self-stretch flex flex-col justify-center border-l-2 border-green-500/40 bg-green-500/[0.07] p-2"
          style={{
            minWidth: 'clamp(140px, 32cqh, 200px)',
            maxWidth: 'clamp(160px, 36cqh, 220px)',
            gap: 'clamp(2px, 0.6cqh, 6px)',
          }}
        >
          <div
            className="uppercase tracking-wider text-green-400 leading-tight font-bold"
            style={{ fontSize: 'clamp(8px, 1.4cqh, 10px)' }}
          >
            Cliente Destaque
          </div>
          <div
            className="text-white font-semibold leading-tight break-words"
            title={clienteDestaque.client.name}
            style={{
              fontSize: 'clamp(11px, 2cqh, 14px)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical' as const,
              overflow: 'hidden',
            }}
          >
            {clienteDestaque.client.name}
          </div>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span
              className="font-display text-green-400 leading-none"
              style={{ fontSize: 'clamp(15px, 3.5cqh, 24px)' }}
            >
              {clienteDestaque.cpt !== null ? brl(clienteDestaque.cpt) : '—'}
            </span>
            <span
              className="text-burst-muted leading-tight uppercase tracking-wider"
              style={{ fontSize: 'clamp(7px, 1.2cqh, 9px)' }}
            >
              custo/transf
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// FitToBox — escala conteúdo pra caber no quadrante.
//
// Modo default: scale uniforme min(cw/w, ch/h) preservando aspect.
// Modo fullHeight: força o conteúdo a ocupar 100% do container
//   esticando o width pro tamanho natural do container (sem
//   manter aspect ratio do source). Bom pra dashboards que devem
//   preencher o quadrante.
// ============================================================
function FitToBox({ children, fullHeight }: { children: React.ReactNode; fullHeight?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const recalc = () => {
      const container = containerRef.current;
      const content = contentRef.current;
      if (!container || !content) return;
      content.style.transform = 'none';
      content.style.width = fullHeight ? '100%' : 'auto';
      content.style.height = 'auto';
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const w = content.scrollWidth;
      const h = content.scrollHeight;
      if (w === 0 || h === 0 || cw === 0 || ch === 0) {
        return;
      }
      let s: number;
      if (fullHeight) {
        // Prioriza altura — escala pelo lado mais limitante mas inflando
        // width pra preencher o container quando proporção é menor.
        s = Math.min(cw / w, ch / h);
      } else {
        s = Math.min(cw / w, ch / h, 1);
      }
      content.style.transform = `scale(${s})`;
      content.style.width = `${cw / s}px`;
      content.style.height = `${ch / s}px`;
      setScale(s);
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    if (containerRef.current) ro.observe(containerRef.current);
    if (contentRef.current) ro.observe(contentRef.current);
    const t1 = setTimeout(recalc, 50);
    const t2 = setTimeout(recalc, 200);
    const t3 = setTimeout(recalc, 800);
    return () => {
      ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullHeight]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <div
        ref={contentRef}
        style={{
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Acha os TOP 2 doutores com MELHOR TAXA de conversão entre os que estão
 * sob a responsabilidade de um programador específico. Exige >10
 * transferências pra qualificar (filtra ruído de baixa amostragem).
 *
 * `responsavelByName` mapeia normalize(nomeDoutor) → nome do responsavel.
 * Match com `programmerName` por substring case-insensitive — cobre
 * variações como "Gabriel Velho" vs "Gabriel Velho dos Santos".
 *
 * Retorna [primeiro, segundo] — qualquer um pode ser null se não houver
 * candidatos suficientes.
 */
function findTop2DoutoresPorTaxa(
  doutores: Array<{ nome: string; taxa: number; totalTransferidos: number }>,
  responsavelByName: Map<string, string>,
  programmerName: string,
): [typeof doutores[number] | null, typeof doutores[number] | null] {
  const normalize = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const programmerNorm = normalize(programmerName);

  const candidatos = doutores.filter((d) => {
    if (d.totalTransferidos <= 10) return false;
    const respDoutor = responsavelByName.get(normalize(d.nome));
    if (!respDoutor) return false;
    const respNorm = normalize(respDoutor);
    return respNorm.includes(programmerNorm) || programmerNorm.includes(respNorm);
  });
  const sorted = [...candidatos].sort((a, b) => b.taxa - a.taxa);
  return [sorted[0] ?? null, sorted[1] ?? null];
}

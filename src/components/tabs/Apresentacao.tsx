import { useMemo, useState, useEffect, useRef } from 'react';
import { LayoutDashboard, AlertTriangle, Code2, Megaphone, Palette, Headphones } from 'lucide-react';
import { useLeads } from '../../hooks/useLeads';
import { useMondayClients } from '../../hooks/useMondayClients';
import { useMetaSpend } from '../../hooks/useMetaSpend';
import { useMetaLinks } from '../../hooks/useMetaLinks';
import { useDoutorLinks } from '../../hooks/useDoutorLinks';
import { useDesignEventos } from '../../hooks/useDesignEventos';
import { useAtestados } from '../../hooks/useAtestados';
import { useHolidays } from '../../hooks/useHolidays';
import { useInstanceMap } from '../../hooks/useInstanceMap';
import { useUser, hasFullAccess } from '../../lib/userContext';
import { useUserPhotos } from '../../hooks/useUserPhotos';
import { Avatar } from '../Avatar';
import {
  computeGestorMetrics, brl, tierForCpt, tierLabelCpt,
} from '../../lib/gestorMetrics';
import { computeCsMetrics } from '../../lib/csMetrics';
import {
  computeDesignMetrics, tierForDemandasDia, tierForPctManutencao,
} from '../../lib/designMetrics';
import { computeMetrics, filterByDateRange, type DateRange } from '../../lib/metrics';
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
  } = useMondayClients();
  const { links, byAccount: linksByAccount } = useMetaLinks();
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
  const filteredLeads = useMemo(() => filterByDateRange(leads, range), [leads, range]);

  const clientesParaMetricas = useMemo(() => {
    if (mondayAllClients.length === 0) return mondayClients;
    const idsAtivos = new Set(mondayClients.map((c) => c.id));
    const idsComLink = new Set(links.map((l) => l.monday_client_id));
    const extras = mondayAllClients.filter((c) => idsComLink.has(c.id) && !idsAtivos.has(c.id));
    return extras.length === 0 ? mondayClients : [...mondayClients, ...extras];
  }, [mondayClients, mondayAllClients, links]);

  const programacaoSummary = useMemo(
    () => computeMetrics(filteredLeads, range, instanceMap, mondayAllClients),
    [filteredLeads, range, instanceMap, mondayAllClients],
  );

  const gestorSummary = useMemo(
    () => computeGestorMetrics({
      clients: clientesParaMetricas, insights, leads: filteredLeads,
      metaLinks: linksByAccount, doutorLinks: doutorLinksByClient,
      biaActiveIds, biaTimelineByClientId, biaFaseByClientId, dateRange: range,
    }),
    [clientesParaMetricas, insights, filteredLeads, linksByAccount, doutorLinksByClient, biaActiveIds, biaTimelineByClientId, biaFaseByClientId, range],
  );

  const csSummary = useMemo(
    () => computeCsMetrics({
      ...gestorSummary, clients: clientesParaMetricas, insights, leads: filteredLeads,
      metaLinks: linksByAccount, doutorLinks: doutorLinksByClient,
      biaActiveIds, biaTimelineByClientId, biaFaseByClientId, dateRange: range,
    } as Parameters<typeof computeCsMetrics>[0]),
    [gestorSummary, clientesParaMetricas, insights, filteredLeads, linksByAccount, doutorLinksByClient, biaActiveIds, biaTimelineByClientId, biaFaseByClientId, range],
  );

  const designSummary = useMemo(
    () => computeDesignMetrics(designEventos, range, holidaySet, atestados),
    [designEventos, range, holidaySet, atestados],
  );

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
            {/* PainelGeral preenche o topo */}
            <div className="h-[72%] min-h-0 overflow-hidden">
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
            {/* Mini-cards dos programadores (centralizados no meio, com largura
                reduzida pra não ficar 90% do card vazio) */}
            <div className="h-[28%] min-h-0 flex items-stretch justify-center">
              <div className="w-[70%] h-full grid grid-cols-2 gap-3 [&>*]:[container-type:size]">
                <MiniFotoCard nome="Gabriel Velho dos Santos" photoUrl={lookupPhoto('Gabriel Velho dos Santos') ?? lookupPhoto('Gabriel Velho')} />
                <MiniFotoCard nome="Eduardo Henckemaier Borguesan" photoUrl={lookupPhoto('Eduardo Henckemaier Borguesan') ?? lookupPhoto('Eduardo Henckemaier')} />
              </div>
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
              .map((g) => (
                <PessoaCard
                  key={g.gestor}
                  nome={g.gestor}
                  photoUrl={lookupPhoto(g.gestor)}
                  metricaPrincipal={g.cpt !== null ? brl(g.cpt) : '—'}
                  metricaLabel="CPT"
                  tier={g.cpt !== null ? tierForCpt(g.cpt) : 0}
                  tierLabel={tierLabelCpt(g.cpt !== null ? tierForCpt(g.cpt) : 0)}
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
              .sort((a, b) => b.demandasPorDia - a.demandasPorDia)
              .map((d) => {
                const tDem = tierForDemandasDia(d.demandasPorDia);
                const tMan = tierForPctManutencao(d.pctManutencao);
                const tierGeral = Math.min(tDem, tMan) as SalaryTier;
                return (
                  <PessoaCard
                    key={d.nome}
                    nome={d.nome}
                    photoUrl={lookupPhoto(d.nome)}
                    metricaPrincipal={`${d.demandasPorDia.toFixed(1)}/d`}
                    metricaLabel={`${d.pctManutencao.toFixed(0)}% manut`}
                    tier={tierGeral}
                    tierLabel={tierGeral === 1 ? '1 SALÁRIO' : tierGeral === 0.5 ? '0,5 SALÁRIO' : 'SEM BÔNUS'}
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
              .map((c) => (
                <PessoaCard
                  key={c.cs}
                  nome={c.cs}
                  photoUrl={lookupPhoto(c.cs)}
                  metricaPrincipal={c.cpt !== null ? brl(c.cpt) : '—'}
                  metricaLabel="CPT"
                  tier={c.cpt !== null ? tierForCpt(c.cpt) : 0}
                  tierLabel={tierLabelCpt(c.cpt !== null ? tierForCpt(c.cpt) : 0)}
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
 * Mini-card só com foto (sem métrica). Usado pros programadores Gabriel
 * Velho e Eduardo Henckemaier no quadrante de Programação.
 *
 * Como não temos métricas individuais pra programadores, mostramos o tier
 * (1 SALÁRIO) em destaque pra preencher o card e bater visualmente com os
 * PessoaCards dos outros setores.
 */
function MiniFotoCard({ nome, photoUrl }: { nome: string; photoUrl: string | null }) {
  const firstName = nome.split(' ')[0];
  return (
    <div className="rounded-xl border-2 border-green-500/60 bg-green-500/15 shadow-[0_0_24px_rgba(34,197,94,0.25)] flex items-stretch overflow-hidden min-h-0 relative gap-0">
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
          style={{ fontSize: 'clamp(20px, 6cqh, 52px)' }}
        >
          1 SALÁRIO
        </div>
        <div
          className="text-burst-muted leading-none"
          style={{ fontSize: 'clamp(9px, 1.8cqh, 12px)' }}
        >
          Bônus do mês
        </div>
        <div
          className="uppercase tracking-widest font-bold text-green-400 leading-none"
          style={{ fontSize: 'clamp(8px, 1.5cqh, 11px)' }}
        >
          ↑ ACIMA DA META
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
  nome, photoUrl, metricaPrincipal, metricaLabel, tier, tierLabel,
}: {
  nome: string;
  photoUrl: string | null;
  metricaPrincipal: string;
  metricaLabel: string;
  tier: SalaryTier;
  tierLabel: string;
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
      {/* FOTO LATERAL — quadrada, ocupa altura toda do card */}
      <FotoSquare name={nome} photoUrl={photoUrl} />


      {/* INFO À DIREITA — flex column, centralizado vertical */}
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
      </div>
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

import { useMemo, useState } from 'react';
import { Search, HeartPulse, ArrowLeft, AlertCircle, AlertTriangle } from 'lucide-react';
import { useUser, hasFullAccess } from '../../lib/userContext';
import { useLeads } from '../../hooks/useLeads';
import { useMondayClients } from '../../hooks/useMondayClients';
import { useDesignEventos } from '../../hooks/useDesignEventos';
import { useDesignAtrasos } from '../../hooks/useDesignAtrasos';
import { useDesignClientLinks } from '../../hooks/useDesignClientLinks';
import { useDesignActivityLogs } from '../../hooks/useDesignActivityLogs';
import { useOtimizacaoEvents } from '../../hooks/useOtimizacaoEvents';
import { useItemUpdates } from '../../hooks/useItemUpdates';
import { useMetaLinks } from '../../hooks/useMetaLinks';
import { useDoutorLinks } from '../../hooks/useDoutorLinks';
import { useMetaAccountIndex } from '../../hooks/useMetaAccountIndex';
import { isClientChurned } from '../../lib/monday';
import { computeClienteSaude, computeTimelineUnificada, buildEventosPorCliente, buildAtrasosPorCliente, statusColors, type SaudeStatus } from '../../lib/clienteSaude';
import { computeGestorMetrics } from '../../lib/gestorMetrics';
import { BlocoTrafego } from '../saude/BlocoTrafego';
import { BlocoDesign } from '../saude/BlocoDesign';
import { BlocoBia } from '../saude/BlocoBia';
import { BlocoWhatsappGrupo } from '../saude/BlocoWhatsappGrupo';
import { TimelineCliente } from '../saude/TimelineCliente';
import { Avatar } from '../Avatar';

export function SaudeCliente() {
  const user = useUser();
  const { leads, loading: leadsLoading } = useLeads();
  const {
    clientsAll: allClients,            // ← agora usa a lista COMPLETA (com churnados)
    biaAllIds,
    biaTimelineByClientId,
    biaFaseByClientId,
    biaItemIdByClientId,
    loading: mondayLoading,
  } = useMondayClients();
  const { eventos: designEventos, loading: designLoading } = useDesignEventos();
  const { atrasos: designAtrasos } = useDesignAtrasos();
  // Mapa monday_item_id (demanda) → monday_client_id[] vindo do board_relation
  // "Clientes" no Monday. Usado pra casar demandas/atrasos exato por ID.
  const { links: designClientLinks } = useDesignClientLinks();

  const { byClient: metaLinkByClient, byAccount: metaLinkByAccount } = useMetaLinks();
  const { byClient: doutorLinksByClient } = useDoutorLinks();

  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<SaudeStatus | 'todos'>('todos');
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);

  // LAZY LOAD: hooks pesados só carregam quando um cliente foi selecionado.
  // Na LISTA, eles ficam dormentes (só leem cache local) → carregamento rápido.
  // ~17 MB de dados (updates, activity logs, otimização) economizados na lista.
  const perfilAberto = selecionadoId !== null;
  // Activity logs e datas de criação das demandas no Monday (Status da Tarefa,
  // Status do Designer, created_at). Usado pra timeline rica na aba Saúde.
  const { events: designActivityEvents, createdAtByItemId: designCreatedAtByItemId } = useDesignActivityLogs(perfilAberto);
  // Eventos do board "Otimização Clientes" (auto-descoberta via nome)
  const { events: otimizacaoEvents, clientLinks: otimizacaoClientLinks } = useOtimizacaoEvents(perfilAberto);
  // Comentários (updates) do Monday — aparecem inline nos eventos da timeline
  const { updatesByPulseId } = useItemUpdates(perfilAberto);
  // useMetaAccountIndex lazy — só dispara quando um perfil específico é aberto
  const metaIndex = useMetaAccountIndex(selecionadoId !== null);
  // Filtros adicionais — defaults razoáveis
  const [excluirChurn, setExcluirChurn] = useState(false); // false = mostrar churnados também
  const [excluirPausados, setExcluirPausados] = useState(false);
  const [excluirSemBia, setExcluirSemBia] = useState(false);
  // "tem Bia": só clientes que estão no board Bia Soft (qualquer fase)
  const [apenasComBia, setApenasComBia] = useState(false);
  // "tem atrasos": só clientes que já tiveram atraso no design
  const [apenasComAtrasos, setApenasComAtrasos] = useState(false);

  // Usa a MESMA lógica do app principal pra casar leads → clientes.
  // computeGestorMetrics já considera: token uazapi, match por nome E
  // vínculos manuais doutor_client_links. Isso garante que aqui aparece
  // exatamente o que aparece nas abas Gestor/CS.
  const gestorSummary = useMemo(
    () =>
      computeGestorMetrics({
        clients: allClients,
        insights: [],                          // não precisamos do spend daqui (vem do useClientSpendAllTime no perfil)
        leads,
        metaLinks: metaLinkByAccount,
        doutorLinks: doutorLinksByClient,
        biaTimelineByClientId,
        biaFaseByClientId,
      }),
    [allClients, leads, metaLinkByAccount, doutorLinksByClient, biaTimelineByClientId, biaFaseByClientId]
  );

  // Indexa ClientMetrics por monday_client_id (rápido lookup por cliente)
  const clientMetricsById = useMemo(() => {
    const map = new Map<string, import('../../lib/gestorMetrics').ClientMetrics>();
    for (const g of gestorSummary.gestores) {
      for (const cm of g.clients) map.set(cm.client.id, cm);
    }
    return map;
  }, [gestorSummary]);

  // Indexa eventos design por cliente UMA VEZ (em vez de iterar pra cada cliente)
  // Usa `designClientLinks` (board_relation Monday) pra match EXATO por ID — fuzzy
  // só rola pra items sem link no board (raro).
  const eventosPorClienteId = useMemo(() => {
    if (allClients.length === 0 || designEventos.length === 0) {
      return new Map<string, typeof designEventos>();
    }
    return buildEventosPorCliente(allClients, designEventos, designClientLinks);
  }, [allClients, designEventos, designClientLinks]);

  // Indexa atrasos design por cliente — mesma estratégia
  const atrasosPorClienteId = useMemo(() => {
    if (allClients.length === 0 || designAtrasos.length === 0) {
      return new Map<string, typeof designAtrasos>();
    }
    return buildAtrasosPorCliente(allClients, designAtrasos, designClientLinks);
  }, [allClients, designAtrasos, designClientLinks]);

  // Calcula saúde de TODOS os clientes — usa leads E eventos JÁ casados
  const todos = useMemo(() => {
    if (allClients.length === 0) return [];
    return allClients.map((c) => {
      const cm = clientMetricsById.get(c.id);
      const leadsDoCliente = cm?.leads ?? [];
      const eventosDoCliente = eventosPorClienteId.get(c.id) ?? [];
      const atrasosDoCliente = atrasosPorClienteId.get(c.id) ?? [];
      return computeClienteSaude({
        client: c,
        leads: leadsDoCliente,
        designEventos: eventosDoCliente,
        designAtrasos: atrasosDoCliente,
        biaTimelineByClientId,
        biaFaseByClientId,
      });
    });
  }, [allClients, clientMetricsById, eventosPorClienteId, atrasosPorClienteId, biaTimelineByClientId, biaFaseByClientId]);

  // Filtro + busca
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return todos
      .filter((cs) => {
        if (filtroStatus !== 'todos' && cs.statusGeral !== filtroStatus) return false;
        if (q && !cs.client.name.toLowerCase().includes(q)) return false;
        // Filtros adicionais
        if (excluirChurn && isClientChurned(cs.client)) return false;
        if (excluirChurn) {
          // Cliente em grupo de churn também conta
          const g = (cs.client.groupTitle ?? '').toLowerCase();
          if (g.includes('churn') || g.includes('perdido') || g.includes('inadimpl')) return false;
        }
        if (excluirPausados) {
          const st = (cs.client.status ?? '').toLowerCase();
          const fase = (cs.bia.faseAtual ?? '').toLowerCase();
          const g = (cs.client.groupTitle ?? '').toLowerCase();
          if (st.includes('pausa') || fase.includes('pausa') || g.includes('pausa') || g.includes('aviso pr')) return false;
        }
        if (excluirSemBia) {
          // Sem Bia ativa = fase não inclui "ativa"
          const fase = (cs.bia.faseAtual ?? '').toLowerCase();
          if (!fase.includes('ativa')) return false;
        }
        if (apenasComBia) {
          // Cliente tem que estar no board Bia Soft
          if (!biaAllIds.has(cs.client.id)) return false;
        }
        if (apenasComAtrasos) {
          if (cs.design.demandasAtrasadas.length === 0) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ord: Record<SaudeStatus, number> = {
          atencao: 0,
          'sem-dados': 1,
          bom: 2,
          critico: 0, // mantido pra compatibilidade — não é mais usado
        };
        if (ord[a.statusGeral] !== ord[b.statusGeral]) {
          return ord[a.statusGeral] - ord[b.statusGeral];
        }
        return a.client.name.localeCompare(b.client.name);
      });
  }, [todos, busca, filtroStatus, excluirChurn, excluirPausados, excluirSemBia, apenasComBia, apenasComAtrasos, biaAllIds]);

  const selecionado = useMemo(
    () => todos.find((cs) => cs.client.id === selecionadoId) ?? null,
    [todos, selecionadoId]
  );

  const counts = useMemo(() => {
    const c = { todos: todos.length, critico: 0, atencao: 0, bom: 0, 'sem-dados': 0 };
    for (const t of todos) c[t.statusGeral]++;
    return c;
  }, [todos]);

  const loading = leadsLoading || mondayLoading || designLoading;

  // === GUARD ===
  // Saude do Cliente expoe dados sensiveis (scoring, historico, atrasos)
  // de TODOS os clientes. So admin (Renan/Vanessa) e super programador
  // (Gabriel/Eduardo) podem acessar.
  if (!hasFullAccess(user)) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-burst-orange/40 bg-burst-card p-8 max-w-2xl">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="text-burst-orange-bright" />
            <h2 className="font-display text-2xl text-white tracking-wider">Acesso restrito</h2>
          </div>
          <p className="text-sm text-burst-muted">
            Esta aba mostra dados consolidados de todos os clientes — disponivel apenas para administradores.
          </p>
        </div>
      </div>
    );
  }

  // === Vista de perfil ===
  if (selecionado) {
    const link = metaLinkByClient.get(selecionado.client.id);
    // Fallback: se não tem link salvo, tenta descobrir conta Meta pelo nome
    const discovered = !link ? metaIndex.lookup(selecionado.client.name) : null;
    const accountId = link?.meta_account_id ?? discovered?.accountId ?? null;
    const gestor = link?.gestor ?? discovered?.gestor ?? null;
    const accountName = link?.meta_account_name ?? discovered?.accountName ?? null;
    return (
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
        <button
          onClick={() => setSelecionadoId(null)}
          className="flex items-center gap-2 text-sm text-burst-muted hover:text-burst-orange-bright transition-colors w-fit"
        >
          <ArrowLeft size={16} /> Voltar pra lista
        </button>

        <PerfilHeader
          saude={selecionado}
          metaAccount={accountName}
          metaAutoDescoberta={!link && !!discovered}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <BlocoTrafego
            trafego={selecionado.trafego}
            metaAccountId={accountId}
            metaGestor={gestor}
          />
          <BlocoBia bia={selecionado.bia} />
          <BlocoDesign
            design={selecionado.design}
            designEventos={eventosPorClienteId.get(selecionado.client.id) ?? []}
          />
        </div>

        {/* Grupo WhatsApp: score, membros e timeline de eventos */}
        <BlocoWhatsappGrupo
          clientName={selecionado.client.name}
          clientId={selecionado.client.id}
        />

        <TimelineCliente
          events={(() => {
            // Filtra activity events e createdAt SÓ pros monday_item_ids deste cliente
            const eventosCli = eventosPorClienteId.get(selecionado.client.id) ?? [];
            const itemIdsDoCliente = new Set<string>();
            for (const ev of eventosCli) {
              if (ev.monday_item_id) itemIdsDoCliente.add(String(ev.monday_item_id));
            }
            const activityCliente = designActivityEvents.filter((a) =>
              itemIdsDoCliente.has(a.pulseId)
            );
            const createdAtCliente = new Map<string, string>();
            for (const id of itemIdsDoCliente) {
              const c = designCreatedAtByItemId.get(id);
              if (c) createdAtCliente.set(id, c);
            }
            // Filtra otimizações deste cliente — usa otimizacaoClientLinks
            // pra saber quais items de Otimização apontam pro client.id
            const otimItemIdsDoCliente = new Set<string>();
            for (const [otimId, clientIds] of otimizacaoClientLinks) {
              if (clientIds.includes(selecionado.client.id)) {
                otimItemIdsDoCliente.add(otimId);
              }
            }
            const otimDoCliente = otimizacaoEvents.filter((e) =>
              otimItemIdsDoCliente.has(e.pulseId)
            );
            return computeTimelineUnificada({
              client: selecionado.client,
              trafego: selecionado.trafego,
              design: selecionado.design,
              bia: selecionado.bia,
              designEventos: eventosCli,
              biaItemIdByClientId,
              designActivityEvents: activityCliente,
              designCreatedAtByItemId: createdAtCliente,
              otimizacaoEvents: otimDoCliente,
              updatesByPulseId,
            });
          })()}
        />
      </div>
    );
  }

  // === Vista de lista ===
  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Header com contadores */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <HeartPulse className="text-burst-orange-bright" size={28} />
          <div>
            <h2 className="font-display text-2xl text-white tracking-wide">Saúde dos Clientes</h2>
            <div className="text-xs text-burst-muted">
              {counts.todos} cliente(s) monitorado(s) • clique pra ver detalhes
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-burst-muted" />
          <input
            type="text"
            placeholder="Buscar cliente..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full bg-black/40 border border-burst-border rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-burst-orange placeholder:text-burst-muted/60"
          />
        </div>
        <FiltroPills filtroAtivo={filtroStatus} onChange={setFiltroStatus} counts={counts} />
      </div>

      {/* Toggles de exclusão / inclusão */}
      <div className="flex items-center gap-2 flex-wrap text-xs text-burst-muted">
        <span className="uppercase tracking-widest text-[10px]">Excluir:</span>
        <Toggle ativo={excluirChurn} onChange={setExcluirChurn} label="Churnados" />
        <Toggle ativo={excluirPausados} onChange={setExcluirPausados} label="Pausados" />
        <Toggle ativo={excluirSemBia} onChange={setExcluirSemBia} label="Sem Bia ativa" />
        <span className="text-burst-border">|</span>
        <span className="uppercase tracking-widest text-[10px]">Mostrar só:</span>
        <Toggle ativo={apenasComBia} onChange={setApenasComBia} label="Tem Bia" />
        <Toggle ativo={apenasComAtrasos} onChange={setApenasComAtrasos} label="Com atrasos" />
        <span className="text-burst-muted/70 ml-2">
          mostrando {filtrados.length} de {todos.length}
        </span>
      </div>

      {loading && todos.length === 0 ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-2 border-burst-orange border-t-transparent animate-spin mx-auto mb-4" />
            <div className="text-burst-muted text-sm">Carregando saúde dos clientes...</div>
          </div>
        </div>
      ) : filtrados.length === 0 ? (
        <div className="rounded-2xl border border-burst-border bg-burst-card p-12 text-center">
          <AlertCircle size={28} className="text-burst-muted mx-auto mb-3" />
          <div className="text-white font-display text-xl mb-1">Nenhum cliente encontrado</div>
          <p className="text-sm text-burst-muted">Ajuste o filtro ou a busca.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {filtrados.map((cs) => (
            <ClienteCard
              key={cs.client.id}
              saude={cs}
              onClick={() => setSelecionadoId(cs.client.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({
  ativo,
  onChange,
  label,
}: {
  ativo: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      onClick={() => onChange(!ativo)}
      className={[
        'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors border',
        ativo
          ? 'bg-burst-orange/20 border-burst-orange/40 text-burst-orange-bright'
          : 'bg-burst-card border-burst-border text-burst-muted hover:text-white',
      ].join(' ')}
    >
      <span
        className={`w-3 h-3 rounded-sm border ${
          ativo
            ? 'bg-burst-orange-bright border-burst-orange-bright'
            : 'border-burst-muted/60'
        }`}
      >
        {ativo && <span className="block text-[10px] leading-3 text-black text-center">✓</span>}
      </span>
      {label}
    </button>
  );
}

function FiltroPills({
  filtroAtivo,
  onChange,
  counts,
}: {
  filtroAtivo: SaudeStatus | 'todos';
  onChange: (v: SaudeStatus | 'todos') => void;
  counts: Record<SaudeStatus | 'todos', number>;
}) {
  const opts: { key: SaudeStatus | 'todos'; label: string; cls: string }[] = [
    { key: 'todos', label: 'Todos', cls: 'text-white' },
    { key: 'atencao', label: 'Atenção', cls: 'text-burst-warning' },
    { key: 'bom', label: 'Bom', cls: 'text-green-400' },
    { key: 'sem-dados', label: 'Sem dados', cls: 'text-burst-muted' },
  ];
  return (
    <div className="flex items-center gap-1.5 bg-burst-card border border-burst-border rounded-xl p-1.5 flex-wrap">
      {opts.map((o) => {
        const active = filtroAtivo === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={[
              'px-3 py-1 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5',
              active
                ? 'bg-burst-orange/20 text-burst-orange-bright shadow-orange-glow-sm'
                : `${o.cls}/80 hover:bg-white/5`,
            ].join(' ')}
          >
            <span>{o.label}</span>
            <span className="text-[10px] text-burst-muted">{counts[o.key]}</span>
          </button>
        );
      })}
    </div>
  );
}

function ClienteCard({
  saude,
  onClick,
}: {
  saude: ReturnType<typeof computeClienteSaude>;
  onClick: () => void;
}) {
  const c = statusColors(saude.statusGeral);
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl bg-burst-card border ${c.border} p-4 flex flex-col gap-3 text-left hover:translate-y-[-2px] transition-all focus:outline-none focus:ring-2 focus:ring-burst-orange/50`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-display text-base text-white tracking-wide truncate">
            {saude.client.name}
          </div>
          <div className="text-[10px] text-burst-muted mt-0.5">
            {saude.client.cs && <span>CS {saude.client.cs}</span>}
            {saude.client.gestor && <span> • Gestor {saude.client.gestor}</span>}
          </div>
        </div>
        <span
          className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold border ${c.border} ${c.bg} ${c.text} shrink-0`}
        >
          {c.label}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-center">
        <MiniStat
          label="Tráfego"
          status={saude.trafego.status}
          value={`${saude.trafego.transferencias}/${saude.trafego.totalLeads}`}
        />
        <MiniStat
          label="BIA"
          status={saude.bia.status}
          value={
            saude.bia.faseAtual
              ? saude.bia.faseAtual.toLowerCase().includes('ativa')
                ? `${saude.bia.diasFaseAtual}d`
                : saude.bia.faseAtual.length > 8
                ? saude.bia.faseAtual.slice(0, 7) + '…'
                : saude.bia.faseAtual
              : '—'
          }
        />
        <MiniStat
          label="Design"
          status={saude.design.status}
          value={
            saude.design.demandasAtrasadas.length > 0
              ? `${saude.design.demandasAtrasadas.length} atras.`
              : `${saude.design.totalDemandas} ok`
          }
        />
      </div>
    </button>
  );
}

function MiniStat({
  label,
  status,
  value,
}: {
  label: string;
  status: SaudeStatus;
  value: string;
}) {
  const c = statusColors(status);
  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} px-1.5 py-1`}>
      <div className="text-[8px] uppercase tracking-wider text-burst-muted">{label}</div>
      <div className={`text-xs font-mono font-semibold truncate ${c.text}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function PerfilHeader({
  saude,
  metaAccount,
  metaAutoDescoberta,
}: {
  saude: ReturnType<typeof computeClienteSaude>;
  metaAccount: string | null;
  metaAutoDescoberta?: boolean;
}) {
  const c = statusColors(saude.statusGeral);
  return (
    <section
      className={`rounded-2xl border bg-burst-card p-6 relative overflow-hidden ${c.border}`}
    >
      <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-burst-orange/10 blur-3xl pointer-events-none" />

      <div className="relative flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar name={saude.client.name} size={64} className="ring-2 ring-burst-orange/30" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-burst-muted">
              Saúde do cliente
            </div>
            <h1 className="font-display text-3xl text-white tracking-wide truncate">
              {saude.client.name}
            </h1>
            <div className="text-xs text-burst-muted mt-1 flex flex-wrap gap-x-3">
              {saude.client.cs && <span>CS: <span className="text-white">{saude.client.cs}</span></span>}
              {saude.client.gestor && <span>Gestor: <span className="text-white">{saude.client.gestor}</span></span>}
              {saude.client.tipoCliente && (
                <span>Tipo: <span className="text-white">{saude.client.tipoCliente}</span></span>
              )}
              {metaAccount && (
                <span>
                  Meta: <span className="text-white truncate">{metaAccount}</span>
                  {metaAutoDescoberta && (
                    <span
                      className="ml-1 text-[9px] uppercase tracking-wider text-burst-orange-bright"
                      title="Conta descoberta automaticamente pelo nome — vale vincular oficialmente em Gestor"
                    >
                      (auto)
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
        <div
          className={`px-3 py-1.5 rounded-md border text-xs uppercase tracking-wider font-bold ${c.border} ${c.bg} ${c.text}`}
        >
          {c.label}
        </div>
      </div>
    </section>
  );
}

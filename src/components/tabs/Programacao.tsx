import { useMemo, useState } from 'react';
import { useLeads } from '../../hooks/useLeads';
import { useInstanceMap } from '../../hooks/useInstanceMap';
import { useMondayClients } from '../../hooks/useMondayClients';
import {
  computeMetrics,
  filterByDateRange,
  getResponsavelForDoutor,
  isTransferido,
  type DateRange,
} from '../../lib/metrics';
import { PainelGeral } from '../programacao/PainelGeral';
import { RankingDoutores } from '../programacao/RankingDoutores';
import { Alertas } from '../programacao/Alertas';
import { ChatsInterrompidos } from '../programacao/ChatsInterrompidos';
import { ChatsIncompletos } from '../programacao/ChatsIncompletos';
import { TierImage } from '../programacao/TierImage';
import { DoutorCard } from '../programacao/DoutorCard';
import { DateRangeFilter, diaDRange } from '../programacao/DateRangeFilter';
import { LeadsTable } from '../programacao/LeadsTable';
import { TransferidosTable } from '../programacao/TransferidosTable';
import { DoutoresTable } from '../programacao/DoutoresTable';
import { PerfilPessoalProgramador } from '../programacao/PerfilPessoalProgramador';
import { RevisaoMotivos } from '../programacao/RevisaoMotivos';
import { Modal } from '../Modal';
import { Users, AlertTriangle, PhoneOff, FileWarning, ListChecks, HelpCircle, BarChart3, Search, X } from 'lucide-react';
import { useUser, hasFullAccess } from '../../lib/userContext';
import { ViewAsTab } from '../ViewAsTab';
import { useUserPhotos } from '../../hooks/useUserPhotos';
import { nameMatchesScope } from '../../lib/monday';

type ModalKind = 'leads' | 'transferidos' | 'doutores' | 'interrompidos' | 'incompletos' | null;
type SubAba = 'metricas' | 'revisao';

export function Programacao() {
  const { leads, loading, error, lastUpdate, configMissing } = useLeads();
  const instanceMap = useInstanceMap();
  // Clients são carregados pra aplicar o corte de churn por cliente.
  // Programação usa TODOS os clientes (não apenas com Bia) pra que o churn
  // cutoff funcione independente do filtro de Bia Soft.
  const {
    allClients: mondayClients,
    responsavelByName: responsavelByClient,
    responsaveis,
    biaTimelineByClientId,
    biaFaseByClientId,
  } = useMondayClients();

  // Default: range "Dia D" (dia 12 do mes atual ate hoje) — igual ao das
  // outras abas (Apresentacao, Gestor, CS) pra os numeros baterem ao abrir.
  // User pode trocar pra "Tudo" ou outro range no DateRangeFilter.
  const [range, setRange] = useState<DateRange>(() => diaDRange());
  const [openModal, setOpenModal] = useState<ModalKind>(null);
  const [subAba, setSubAba] = useState<SubAba>('metricas');
  // null = mostra todos; senão filtra leads por responsável (Gabriel/Eduardo)
  const [responsavelFiltro, setResponsavelFiltro] = useState<string | null>(null);
  // Drill-down em UM doutor a partir do PerfilPessoalProgramador
  const [drillDoutor, setDrillDoutor] = useState<string | null>(null);
  // Busca textual na seção "Análise por Doutor" — acent-insensitive
  const [buscaDoutor, setBuscaDoutor] = useState('');
  const { lookup: lookupPhoto } = useUserPhotos();

  // === FILTRO POR ROLE ===
  const user = useUser();
  // Programador não-admin: filtro é FIXO no scope dele (não pode trocar).
  const enforcedResponsavel = useMemo<string | null>(() => {
    if (hasFullAccess(user)) return null; // admin escolhe via tabs
    if (user.role === 'programador' && user.scope) {
      // Procura o responsável real que casa com o scope (Bia Soft usa nome
      // completo; user.scope também é o completo).
      for (const r of responsaveis) {
        if (nameMatchesScope(user.scope, r)) return r;
      }
      return user.scope; // fallback
    }
    return null;
  }, [user, responsaveis]);

  // Override: se enforced existe, usa ele; senão usa o que o usuário escolheu
  const effectiveResponsavel = enforcedResponsavel ?? responsavelFiltro;

  const filteredLeads = useMemo(() => {
    const byRange = filterByDateRange(leads, range);
    if (!effectiveResponsavel) return byRange;
    return byRange.filter((l) => {
      const r = getResponsavelForDoutor(l.nomeDoutor, responsavelByClient);
      return r === effectiveResponsavel;
    });
  }, [leads, range, effectiveResponsavel, responsavelByClient]);

  const summary = useMemo(
    () => computeMetrics(filteredLeads, range, instanceMap, mondayClients, biaTimelineByClientId, biaFaseByClientId),
    [filteredLeads, range, instanceMap, mondayClients, biaTimelineByClientId, biaFaseByClientId]
  );

  // Summary com TODOS os leads (sem filtro por responsável) — usado pela
  // visão pessoal pra calcular comparação vs média geral da agência.
  const fullSummary = useMemo(() => {
    const all = filterByDateRange(leads, range);
    return computeMetrics(all, range, instanceMap, mondayClients, biaTimelineByClientId, biaFaseByClientId);
  }, [leads, range, instanceMap, mondayClients, biaTimelineByClientId, biaFaseByClientId]);
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
      {/* Sub-abas: Métricas (normal) | Revisão de motivos (curadoria semanal) */}
      <div className="flex items-center gap-1.5 bg-burst-card border border-burst-border rounded-xl p-1.5 w-fit">
        <button
          onClick={() => setSubAba('metricas')}
          className={[
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors',
            subAba === 'metricas'
              ? 'bg-burst-orange/20 text-burst-orange-bright shadow-orange-glow-sm'
              : 'text-burst-muted hover:text-white hover:bg-white/5',
          ].join(' ')}
        >
          <BarChart3 size={14} /> Métricas
        </button>
        <button
          onClick={() => setSubAba('revisao')}
          className={[
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors',
            subAba === 'revisao'
              ? 'bg-burst-orange/20 text-burst-orange-bright shadow-orange-glow-sm'
              : 'text-burst-muted hover:text-white hover:bg-white/5',
          ].join(' ')}
        >
          <HelpCircle size={14} /> Revisar dúvidas
        </button>
      </div>

      {subAba === 'revisao' && <RevisaoMotivos />}
      {subAba === 'metricas' && (
      <>
      {/* Tabs de responsável: só admin pode trocar. Programador vê os
          próprios dados fixados (sem opção de troca). */}
      {hasFullAccess(user) && responsaveis.length > 0 && (
        <div className="flex items-center gap-1.5 bg-burst-card border border-burst-border rounded-xl p-1.5 w-fit flex-wrap">
          <ViewAsTab
            label="Todos"
            active={responsavelFiltro === null}
            onClick={() => setResponsavelFiltro(null)}
            noAvatar
          />
          {responsaveis.map((r) => {
            const firstName = r.split(' ')[0];
            return (
              <ViewAsTab
                key={r}
                label={firstName}
                fullName={r}
                photoUrl={lookupPhoto(r)}
                active={responsavelFiltro === r}
                onClick={() => setResponsavelFiltro(r)}
              />
            );
          })}
        </div>
      )}
      {!hasFullAccess(user) && enforcedResponsavel && (
        <div className="text-xs text-burst-muted bg-burst-card border border-burst-border rounded-xl px-4 py-2 w-fit">
          Filtrado em <span className="text-white font-semibold">{enforcedResponsavel}</span>
        </div>
      )}

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

      {/* === VISÃO PERSONALIZADA: Programador não-admin OU admin com responsável selecionado === */}
      {((!hasFullAccess(user) && user.role === 'programador' && enforcedResponsavel) ||
        (hasFullAccess(user) && responsavelFiltro)) && (
        <>
          <PerfilPessoalProgramador
            nomeProgramador={
              responsavelFiltro ?? user.displayName ?? enforcedResponsavel ?? ''
            }
            summary={summary}
            fullSummary={fullSummary}
            onClickLeads={() => setOpenModal('leads')}
            onClickTransferidos={() => setOpenModal('transferidos')}
            onClickDoutores={() => setOpenModal('doutores')}
            onClickDoutor={(d) => setDrillDoutor(d.nome)}
          />
          {summary.doutores.length === 0 && (
            <div className="rounded-2xl border border-burst-warning/40 bg-burst-warning/5 p-8 text-center">
              <AlertTriangle className="text-burst-warning mx-auto mb-3" size={28} />
              <div className="text-white font-display text-xl mb-2">
                Sem doutores no período
              </div>
              <p className="text-sm text-burst-muted">
                Não encontramos leads atribuídos aos seus doutores no período selecionado.
                Ajuste o período ou veja os Chats Interrompidos/Incompletos abaixo.
              </p>
            </div>
          )}
          <ChatsInterrompidos leads={summary.chatsInterrompidos} />
          <ChatsIncompletos leads={summary.chatsIncompletos} />
        </>
      )}

      {/* === VISÃO ADMIN COMPLETA: só quando "Todos" está selecionado === */}
      {hasFullAccess(user) && !responsavelFiltro && (
        <>
          <PainelGeral
            summary={summary}
            lastUpdate={lastUpdate}
            onOpenLeads={() => setOpenModal('leads')}
            onOpenTransferidos={() => setOpenModal('transferidos')}
            onOpenDoutores={() => setOpenModal('doutores')}
          />
          {summary.totalTransferidos > 0 && <TierImage tier={summary.tier} />}
          <RankingDoutores doutores={summary.doutores} />
          <Alertas summary={summary} range={range} />
          <ChatsInterrompidos leads={summary.chatsInterrompidos} />
          <ChatsIncompletos leads={summary.chatsIncompletos} />

          {summary.doutores.length > 0 && (() => {
            // Normaliza pra busca acent-insensitive ("barbara" acha "Bárbara")
            const norm = (s: string) =>
              s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
            const termos = norm(buscaDoutor).split(/\s+/).filter(Boolean);
            const doutoresFiltrados = termos.length === 0
              ? summary.doutores
              : summary.doutores.filter((d) => {
                  const h = norm(d.nome);
                  return termos.every((t) => h.includes(t));
                });
            return (
              <section>
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <Users className="text-burst-orange-bright" size={20} />
                  <h3 className="font-display text-xl tracking-wider text-white">
                    Análise por Doutor
                  </h3>
                  <span className="text-xs text-burst-muted">
                    {buscaDoutor.trim()
                      ? `${doutoresFiltrados.length} de ${summary.doutores.length} doutor(es)`
                      : `${summary.doutores.length} doutor(es)`}
                  </span>
                  {/* Campo de busca */}
                  <div className="ml-auto flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-1.5 min-w-[200px] sm:min-w-[260px]">
                    <Search size={13} className="text-burst-muted shrink-0" />
                    <input
                      value={buscaDoutor}
                      onChange={(e) => setBuscaDoutor(e.target.value)}
                      placeholder="Buscar doutor..."
                      className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted min-w-0"
                    />
                    {buscaDoutor && (
                      <button
                        type="button"
                        onClick={() => setBuscaDoutor('')}
                        title="Limpar busca"
                        className="text-burst-muted hover:text-white shrink-0"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>
                {doutoresFiltrados.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-burst-border bg-burst-card/40 p-8 text-center text-sm text-burst-muted">
                    Nenhum doutor casa com "{buscaDoutor}"
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {doutoresFiltrados.map((d) => (
                      <DoutorCard key={d.nome} doutor={d} />
                    ))}
                  </div>
                )}
              </section>
            );
          })()}
        </>
      )}

      {/* Outros papéis (cs, gestor) — não veem a Programação detalhada */}
      {!hasFullAccess(user) && user.role !== 'programador' && (
        <div className="rounded-2xl border border-burst-border bg-burst-card p-8 text-center">
          <p className="text-burst-muted text-sm">
            Esta aba mostra dados de Programação. Use a aba do seu setor.
          </p>
        </div>
      )}
      </>
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
        <DoutoresTable
          doutores={summary.doutores}
          onClickDoutor={(d) => {
            setOpenModal(null);
            setDrillDoutor(d.nome);
          }}
        />
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

      {/* Drill-down em UM doutor (a partir do PerfilPessoalProgramador) */}
      {(() => {
        if (!drillDoutor) return null;
        const d = summary.doutores.find((x) => x.nome === drillDoutor);
        if (!d) return null;
        return (
          <Modal
            open
            onClose={() => setDrillDoutor(null)}
            title={d.nome}
            subtitle={`${d.totalLeads} lead(s) • ${d.totalTransferidos} transferido(s) • taxa ${d.taxa.toFixed(1)}%`}
          >
            <LeadsTable leads={d.leads} />
          </Modal>
        );
      })()}
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

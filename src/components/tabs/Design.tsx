import { useMemo, useState } from 'react';
import { Palette, AlertTriangle, Database } from 'lucide-react';
import { useDesignEventos } from '../../hooks/useDesignEventos';
import { useDesignAtrasos } from '../../hooks/useDesignAtrasos';
import { useHolidays } from '../../hooks/useHolidays';
import { useAtestados } from '../../hooks/useAtestados';
import { computeDesignMetrics, type DesignerMetrics } from '../../lib/designMetrics';
import type { DateRange } from '../../lib/metrics';
import { DateRangeFilter, diaDRange } from '../programacao/DateRangeFilter';
import { Modal } from '../Modal';
import { PainelGeralDesign } from '../design/PainelGeralDesign';
import { PainelMiniDesigner } from '../design/PainelMiniDesigner';
import { RankingDesigners } from '../design/RankingDesigners';
import { EventosTable } from '../design/EventosTable';
import { EventosSemDesignerEditor } from '../design/EventosSemDesignerEditor';
import { AtribuirMetricas } from '../design/AtribuirMetricas';
import { useUser, hasFullAccess } from '../../lib/userContext';
import { nameMatchesScope } from '../../lib/monday';
import { primeiroDesignerAtivo } from '../../config';

type ModalKind = 'feitos' | 'manutencoes' | 'designers' | 'sem-designer' | null;
type DrillKind = { designer: string; type: 'feitas' | 'manutencoes' } | null;

export function Design() {
  const user = useUser();
  const [range, setRange] = useState<DateRange>(() => diaDRange());
  const [openModal, setOpenModal] = useState<ModalKind>(null);
  const [drill, setDrill] = useState<DrillKind>(null);
  const [subAba, setSubAba] = useState<'metricas' | 'atribuir'>('metricas');

  const { eventos, loading, error, missingTable, lastUpdate } = useDesignEventos();
  const { atrasos } = useDesignAtrasos();
  const { dateSet: holidaySet } = useHolidays();
  const { atestados } = useAtestados();

  // === SCOPE FILTER ===
  // Designer não-admin: ve so seus proprios eventos.
  // Admin/super: ve todos.
  const eventosVisiveis = useMemo(() => {
    if (hasFullAccess(user)) return eventos;
    if (user.role === 'designer' && user.scope) {
      // CONSISTÊNCIA com designMetrics.computeDesignMetrics: aquele agrupa
      // eventos compostos (ex: "Felipe Moraes, Lais Beisheim") atribuindo
      // ao PRIMEIRO designer ativo via primeiroDesignerAtivo. Se aqui só
      // usássemos nameMatchesScope direto contra designer_responsavel, os
      // combos com vírgula falham (a string completa não bate com o nome
      // do designer logado) e os eventos somem da visão pessoal — mas o
      // admin continua vendo eles (na visão geral). Daí 122 entregas no
      // perfil dela vs 181 na visão admin. Agora ambos usam a mesma regra.
      return eventos.filter((e) => {
        const ativoLabel = primeiroDesignerAtivo(e.designer_responsavel);
        if (!ativoLabel) return false;
        return nameMatchesScope(user.scope!, ativoLabel);
      });
    }
    return eventos;
  }, [eventos, user]);

  const summary = useMemo(
    () => computeDesignMetrics(eventosVisiveis, range, holidaySet, atestados, atrasos),
    [eventosVisiveis, range, holidaySet, atestados, atrasos]
  );

  // === SUMMARY GERAL (sem scope filter) — pra ranking comparativo do time ===
  // Designer ve seus numeros pessoais via `summary`, mas o RankingDesigners
  // precisa mostrar TODOS os designers (pra ele saber onde se encaixa em
  // produtividade/qualidade no time).
  const summaryGeral = useMemo(
    () => computeDesignMetrics(eventos, range, holidaySet, atestados, atrasos),
    [eventos, range, holidaySet, atestados, atrasos]
  );

  // === GUARD ===
  // Acesso permitido apenas para:
  //  - hasFullAccess (admin Renan/Vanessa, super programador Gabriel/Eduardo)
  //  - role = 'designer' (e ele só ve os proprios dados via scope filter acima)
  // IMPORTANTE: guard fica DEPOIS dos hooks (Rules of Hooks — hooks sempre na mesma ordem).
  if (!hasFullAccess(user) && user.role !== 'designer') {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-burst-orange/40 bg-burst-card p-8 max-w-2xl">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="text-burst-orange-bright" />
            <h2 className="font-display text-2xl text-white tracking-wider">Acesso restrito</h2>
          </div>
          <p className="text-sm text-burst-muted">Esta aba é exclusiva para Designers e administradores.</p>
        </div>
      </div>
    );
  }

  const feitosFiltered = useMemo(
    () => summary.eventosFiltrados.filter((e) => e.tipo_evento === 'feito'),
    [summary.eventosFiltrados]
  );
  const manutFiltered = useMemo(
    () =>
      summary.eventosFiltrados.filter((e) =>
        e.tipo_evento === 'manutencao' || e.tipo_evento === 'manutencao_c'
      ),
    [summary.eventosFiltrados]
  );

  const drillDesigner: DesignerMetrics | null = drill
    ? summary.designers.find((d) => d.nome === drill.designer) ?? null
    : null;
  const drillEventos = useMemo(() => {
    if (!drillDesigner || !drill) return [];
    if (drill.type === 'feitas') return drillDesigner.eventos.filter((e) => e.tipo_evento === 'feito');
    return drillDesigner.eventos.filter((e) => e.tipo_evento === 'manutencao' || e.tipo_evento === 'manutencao_c');
  }, [drillDesigner, drill]);

  if (missingTable) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-burst-orange/40 bg-burst-card p-8 max-w-2xl">
          <div className="flex items-center gap-2 mb-4">
            <Database className="text-burst-orange-bright" />
            <h2 className="font-display text-2xl text-white tracking-wider">
              Tabela design_demandas não existe
            </h2>
          </div>
          <p className="text-burst-muted text-sm">
            Rode o SQL em <code className="text-burst-orange-bright">db/design_demandas.sql</code> no Supabase Dashboard → SQL Editor.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-6">
          <div className="flex items-center gap-2 text-red-400 font-bold mb-2">
            <AlertTriangle size={18} /> Erro ao carregar
          </div>
          <div className="text-burst-muted text-sm font-mono">{error}</div>
        </div>
      </div>
    );
  }

  if (loading && eventos.length === 0) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-burst-orange border-t-transparent animate-spin mx-auto mb-4" />
          <div className="text-burst-muted text-sm">Carregando demandas do design...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Alternador de sub-aba (igual "Revisar dúvidas" em Programação) */}
      <div className="flex items-center gap-1.5 bg-black/30 border border-burst-border rounded-lg p-1 self-start">
        {(['metricas', 'atribuir'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSubAba(k)}
            className={[
              'px-4 py-1.5 rounded text-xs font-semibold transition-colors',
              subAba === k
                ? 'bg-burst-orange/20 text-burst-orange-bright'
                : 'text-burst-muted hover:bg-white/5 hover:text-white',
            ].join(' ')}
          >
            {k === 'metricas' ? 'Métricas' : 'Atribuir métricas'}
          </button>
        ))}
      </div>

      {subAba === 'atribuir' ? (
        <AtribuirMetricas eventos={eventosVisiveis} />
      ) : (
      <>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-xs text-burst-muted">
          <span className="text-white font-semibold">{eventos.length}</span> evento(s) no banco •{' '}
          <span className="text-white font-semibold">{summary.eventosFiltrados.length}</span> no período •{' '}
          <span className="text-white font-semibold">{summary.designers.length}</span> designer(s)
        </div>
        <DateRangeFilter range={range} onChange={setRange} />
      </div>

      <PainelGeralDesign
        summary={summary}
        lastUpdate={lastUpdate}
        onOpenFeitos={() => setOpenModal('feitos')}
        onOpenManutencoes={() => setOpenModal('manutencoes')}
        onOpenDesigners={() => setOpenModal('designers')}
      />

      {summary.designers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {summary.designers.map((d) => (
            <PainelMiniDesigner
              key={d.nome}
              designer={d}
              onClickFeitas={() => setDrill({ designer: d.nome, type: 'feitas' })}
              onClickManutencoes={() => setDrill({ designer: d.nome, type: 'manutencoes' })}
            />
          ))}
        </div>
      )}

      {/* Ranking usa summaryGeral (TODOS designers do time) — designer ve
          onde ele se encaixa em vez de comparar com ele mesmo. */}
      <RankingDesigners designers={summaryGeral.designers} />

      {summary.eventosSemDesigner.length > 0 && (
        <button
          onClick={() => setOpenModal('sem-designer')}
          className="rounded-xl border border-burst-warning/40 bg-burst-warning/5 p-4 text-left hover:bg-burst-warning/10 hover:border-burst-warning/60 transition-colors group"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-burst-warning mb-1">
                {summary.eventosSemDesigner.length} evento(s) sem designer atribuído
              </div>
              <div className="text-xs text-burst-muted">
                Clique aqui para atribuir um designer ou apagar individualmente.
              </div>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-burst-warning bg-burst-warning/10 border border-burst-warning/40 rounded px-2 py-1 group-hover:bg-burst-warning/20 transition-colors whitespace-nowrap">
              Gerenciar →
            </div>
          </div>
        </button>
      )}

      {/* Modais agregados */}
      <Modal
        open={openModal === 'feitos'}
        onClose={() => setOpenModal(null)}
        title="Demandas Feitas"
        subtitle={`${feitosFiltered.length} evento(s) de entrega no período`}
      >
        <EventosTable eventos={feitosFiltered} />
      </Modal>

      <Modal
        open={openModal === 'manutencoes'}
        onClose={() => setOpenModal(null)}
        title="Manutenções"
        subtitle={`${manutFiltered.length} evento(s) de manutenção no período`}
      >
        <EventosTable eventos={manutFiltered} />
      </Modal>

      <Modal
        open={openModal === 'designers'}
        onClose={() => setOpenModal(null)}
        title="Designers ativos"
        subtitle={`${summary.designers.length} designer(s) com pelo menos 1 evento`}
      >
        <EventosTable eventos={summary.eventosFiltrados} />
      </Modal>

      <Modal
        open={openModal === 'sem-designer'}
        onClose={() => setOpenModal(null)}
        title="Eventos sem designer"
        subtitle={`${summary.eventosSemDesigner.length} evento(s) — atribua um designer ou apague`}
      >
        <EventosSemDesignerEditor eventos={summary.eventosSemDesigner} />
      </Modal>

      {/* Drill-down por designer */}
      <Modal
        open={drill !== null}
        onClose={() => setDrill(null)}
        title={
          drill
            ? `${drill.type === 'feitas' ? 'Feitas' : 'Manutenções'} — ${drill.designer}`
            : ''
        }
        subtitle={drill ? `${drillEventos.length} evento(s)` : ''}
      >
        <EventosTable eventos={drillEventos} />
      </Modal>
      </>
      )}
    </div>
  );
}

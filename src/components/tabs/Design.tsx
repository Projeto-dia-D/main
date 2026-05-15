import { useMemo, useState } from 'react';
import { Palette, AlertTriangle, Database } from 'lucide-react';
import { useDesignEventos } from '../../hooks/useDesignEventos';
import { useHolidays } from '../../hooks/useHolidays';
import { useAtestados } from '../../hooks/useAtestados';
import { computeDesignMetrics, type DesignerMetrics } from '../../lib/designMetrics';
import type { DateRange } from '../../lib/metrics';
import { DateRangeFilter, esteMesRange } from '../programacao/DateRangeFilter';
import { Modal } from '../Modal';
import { PainelGeralDesign } from '../design/PainelGeralDesign';
import { PainelMiniDesigner } from '../design/PainelMiniDesigner';
import { RankingDesigners } from '../design/RankingDesigners';
import { DesignerCard } from '../design/DesignerCard';
import { EventosTable } from '../design/EventosTable';
import { EventosSemDesignerEditor } from '../design/EventosSemDesignerEditor';

type ModalKind = 'feitos' | 'manutencoes' | 'designers' | 'sem-designer' | null;
type DrillKind = { designer: string; type: 'feitas' | 'manutencoes' } | null;

export function Design() {
  const [range, setRange] = useState<DateRange>(() => esteMesRange());
  const [openModal, setOpenModal] = useState<ModalKind>(null);
  const [drill, setDrill] = useState<DrillKind>(null);

  const { eventos, loading, error, missingTable, lastUpdate } = useDesignEventos();
  const { dateSet: holidaySet } = useHolidays();
  const { atestados } = useAtestados();

  const summary = useMemo(
    () => computeDesignMetrics(eventos, range, holidaySet, atestados),
    [eventos, range, holidaySet, atestados]
  );

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
            <PainelMiniDesigner key={d.nome} designer={d} />
          ))}
        </div>
      )}

      <RankingDesigners designers={summary.designers} />

      {summary.designers.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Palette className="text-burst-orange-bright" size={20} />
            <h3 className="font-display text-xl tracking-wider text-white">Análise por Designer</h3>
            <span className="text-xs text-burst-muted">{summary.designers.length} designer(s)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {summary.designers.map((d) => (
              <DesignerCard
                key={d.nome}
                designer={d}
                onClickFeitas={() => setDrill({ designer: d.nome, type: 'feitas' })}
                onClickManutencoes={() => setDrill({ designer: d.nome, type: 'manutencoes' })}
              />
            ))}
          </div>
        </section>
      )}

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
    </div>
  );
}

import { useState } from 'react';
import { Palette, AlertTriangle, CheckCircle2, RefreshCw, ExternalLink, Clock, History, Users, Calendar } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { AnimatedNumber } from '../AnimatedNumber';
import { statusColors, fmtDataBrasilia, buildMondayDemandaLink, type DesignSaude, type DemandaAtrasada } from '../../lib/clienteSaude';
import type { DesignEvento } from '../../lib/designMetrics';
import { Modal } from '../Modal';

interface Props {
  design: DesignSaude;
  /** Lista completa de eventos de design do cliente (entregas + manut)
   *  pra mostrar no modal quando clicar em "Entregas". */
  designEventos?: DesignEvento[];
}

export function BlocoDesign({ design, designEventos = [] }: Props) {
  const c = statusColors(design.status);
  const [demandaAberta, setDemandaAberta] = useState<DemandaAtrasada | null>(null);
  const [entregasAberto, setEntregasAberto] = useState(false);

  return (
    <section
      className={`rounded-2xl bg-burst-card border ${c.border} p-5 flex flex-col gap-4 animate-slide-up`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Palette size={18} className={c.text} />
          <h3 className="font-display text-xl text-white tracking-wide">Design</h3>
        </div>
        <span
          className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-bold border ${c.border} ${c.bg} ${c.text}`}
        >
          {c.label}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <StatNum
          icon={<CheckCircle2 size={11} />}
          label="Entregas"
          value={design.totalDemandas}
          tone="orange"
          onClick={designEventos.length > 0 ? () => setEntregasAberto(true) : undefined}
        />
        <StatNum
          icon={<AlertTriangle size={11} />}
          label="Atrasadas"
          value={design.demandasAtrasadas.length}
          tone={design.demandasAtrasadas.length > 0 ? 'red' : 'green'}
          onClick={design.demandasAtrasadas.length > 0 && design.demandasAtrasadas[0] ? () => setDemandaAberta(design.demandasAtrasadas[0]) : undefined}
        />
        <StatText
          icon={<RefreshCw size={11} />}
          label="No prazo"
          value={`${design.pctNoPrazo.toFixed(1)}%`}
          tone={design.pctNoPrazo >= 85 ? 'green' : design.pctNoPrazo >= 60 ? 'orange' : 'red'}
          onClick={designEventos.length > 0 ? () => setEntregasAberto(true) : undefined}
        />
      </div>

      {/* Linha cronológica — entregas + manutenções por dia (30 dias) */}
      <DesignChart serie={design.serie} />

      {/* Histórico all-time */}
      <div className="border-t border-burst-border pt-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-burst-muted mb-2">
          <History size={11} />
          <span>Histórico completo</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <HistStat
            label="Total demandas"
            value={design.demandasUnicas}
            sub={`${design.totalDemandas} eventos`}
            tone="orange"
          />
          <HistStat
            label="Manutenções"
            value={design.manutencoes}
            sub={`${design.pctManutencao.toFixed(1)}% do total`}
            tone={design.pctManutencao < 15 ? 'green' : design.pctManutencao < 19 ? 'orange' : 'red'}
          />
          <HistStat
            label="Relacionamento"
            value={design.diasRelacionamento ?? 0}
            sub={
              design.dataEntradaCliente
                ? `desde ${new Date(design.dataEntradaCliente).toLocaleDateString('pt-BR')}`
                : 'sem demandas'
            }
            tone="white"
            suffix=" dia(s)"
          />
        </div>

        {design.designersAtenderam.length > 0 && (
          <div className="mt-2 rounded-lg bg-black/30 border border-burst-border px-3 py-2">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-burst-muted mb-1">
              <Users size={11} /> Designers que atenderam ({design.designersAtenderam.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {design.designersAtenderam.map((d) => (
                <span
                  key={d}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-burst-orange/15 text-burst-orange-bright border border-burst-orange/30"
                >
                  {d}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {design.manutencoes > 0 && (
        <div className="text-xs text-burst-muted flex items-center gap-1.5">
          <RefreshCw size={12} />
          <span>
            <span className="text-white font-semibold">{design.manutencoes}</span> demanda(s)
            voltaram pra manutenção
          </span>
        </div>
      )}

      {/* Lista de demandas atrasadas */}
      {design.demandasAtrasadas.length > 0 && (
        <div className="border-t border-burst-border pt-3">
          <div className="text-[11px] uppercase tracking-widest text-red-400 mb-2 flex items-center gap-1.5">
            <Clock size={11} />
            <span>Demandas atrasadas</span>
            <span className="text-burst-muted/70">· {design.demandasAtrasadas.length}</span>
          </div>
          <ul className="flex flex-col gap-1.5 max-h-44 overflow-y-auto scrollbar-thin pr-1">
            {design.demandasAtrasadas.slice(0, 10).map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setDemandaAberta(d)}
                  title="Ver detalhes"
                  className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/40 transition-all"
                >
                  <span className="flex-1 truncate text-xs text-white/90">
                    {d.nome || `Demanda #${d.id}`}
                  </span>
                  {d.diasAtraso !== null && (
                    <span className="text-[10px] font-mono text-red-400 shrink-0">
                      +{d.diasAtraso}d
                    </span>
                  )}
                  <span className="text-[10px] text-burst-muted/80 shrink-0 truncate max-w-[80px]">
                    {d.designer ?? '—'}
                  </span>
                </button>
              </li>
            ))}
            {design.demandasAtrasadas.length > 10 && (
              <li className="text-[10px] text-burst-muted text-center py-1">
                +{design.demandasAtrasadas.length - 10} demanda(s) atrasada(s)
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Análise verbal */}
      <div className="border-t border-burst-border pt-3 text-xs text-burst-muted leading-relaxed">
        {design.status === 'sem-dados' ? (
          <span>Sem demandas de design para este cliente no período.</span>
        ) : design.demandasAtrasadas.length === 0 ? (
          <span className="text-green-400">
            <strong>Todas as demandas no prazo.</strong> Time de design está conseguindo entregar tudo a tempo.
          </span>
        ) : design.pctNoPrazo < 60 ? (
          <span className="text-red-400">
            <strong>Atrasos críticos.</strong> Mais de 40% das demandas estão atrasadas — investigar urgência.
          </span>
        ) : (
          <span className="text-burst-warning">
            <strong>{design.demandasAtrasadas.length} demanda(s) atrasada(s).</strong> Atenção pra não acumular.
          </span>
        )}
      </div>

      {/* Modal de detalhes da demanda */}
      <Modal
        open={demandaAberta !== null}
        onClose={() => setDemandaAberta(null)}
        title={demandaAberta?.nome ?? `Demanda #${demandaAberta?.id ?? ''}`}
        subtitle={demandaAberta?.designer ? `Designer: ${demandaAberta.designer}` : undefined}
        maxWidth="max-w-3xl"
      >
        {demandaAberta && <DemandaDetalhes d={demandaAberta} />}
      </Modal>

      {/* Modal: TODAS as entregas do cliente */}
      <Modal
        open={entregasAberto}
        onClose={() => setEntregasAberto(false)}
        title="Todas as entregas"
        subtitle={`${designEventos.filter((e) => e.tipo_evento === 'feito').length} demanda(s) entregue(s) pra esse cliente`}
        maxWidth="max-w-5xl"
      >
        <EntregasList eventos={designEventos} atrasos={design.demandasAtrasadas} />
      </Modal>
    </section>
  );
}

/** Lista detalhada de TODAS as entregas, com foto (link Monday), designer, atraso etc. */
function EntregasList({
  eventos,
  atrasos,
}: {
  eventos: DesignEvento[];
  atrasos: DemandaAtrasada[];
}) {
  // Indexa atrasos por monday_item_id pra cruzar
  const atrasoPorId = new Map<string, DemandaAtrasada>();
  for (const a of atrasos) {
    if (a.id !== undefined) atrasoPorId.set(String(a.id), a);
  }
  // Ordena por data desc (mais recente primeiro)
  const ordenados = [...eventos]
    .filter((e) => e.tipo_evento === 'feito')
    .sort((a, b) => {
      const ax = a.data_feito ?? a.log_criacao ?? a.imported_at ?? '';
      const bx = b.data_feito ?? b.log_criacao ?? b.imported_at ?? '';
      return ax < bx ? 1 : -1;
    });

  if (ordenados.length === 0) {
    return <div className="text-burst-muted text-sm py-6 text-center">Sem entregas registradas.</div>;
  }

  return (
    <ul className="flex flex-col gap-2 max-h-[65vh] overflow-y-auto scrollbar-thin pr-1">
      {ordenados.map((ev) => {
        const atraso = ev.monday_item_id ? atrasoPorId.get(ev.monday_item_id) : null;
        return <EntregaRow key={ev.id} evento={ev} atraso={atraso} />;
      })}
    </ul>
  );
}

function EntregaRow({ evento, atraso }: { evento: DesignEvento; atraso: DemandaAtrasada | null | undefined }) {
  const data = fmtDataBrasilia(evento.data_feito ?? evento.log_criacao);
  // Usa o helper que extrai URL embutida em link_demanda ("Nome - URL"),
  // ou monta a URL pelo board_id correto baseado em `evento.origem`.
  const link = buildMondayDemandaLink(evento.link_demanda, evento.monday_item_id, evento.origem);
  return (
    <li className={`rounded-lg ${atraso ? 'bg-red-500/5 border-red-500/30' : 'bg-black/30 border-burst-border'} border p-3 flex flex-col gap-2`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-white/95 font-medium break-words">
            {evento.nome ?? `Demanda #${evento.id}`}
          </div>
          <div className="text-[11px] text-burst-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {evento.designer_responsavel && (
              <span><Users size={10} className="inline mr-0.5" /> {evento.designer_responsavel}</span>
            )}
            {data !== '—' && (
              <span><Calendar size={10} className="inline mr-0.5" /> {data}</span>
            )}
            {evento.prioridade && (
              <span>Prioridade: <span className="text-white/80">{evento.prioridade}</span></span>
            )}
            {evento.padrao_tarefa && (
              <span>Tipo: <span className="text-white/80">{evento.padrao_tarefa}</span></span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {atraso && atraso.diasAtraso !== null && (
            <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold border border-red-500/40 bg-red-500/15 text-red-400">
              {atraso.diasAtraso}d atraso
            </span>
          )}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              title="Abrir no Monday"
              className="p-1.5 rounded text-burst-muted hover:bg-white/5 hover:text-burst-orange-bright transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
      {atraso && (atraso.cronograma?.inicio || atraso.tipoAtraso) && (
        <div className="text-[11px] text-red-400/80 border-t border-red-500/20 pt-2">
          {atraso.tipoAtraso && <span>Tipo: <span className="text-white/80">{atraso.tipoAtraso}</span> · </span>}
          {atraso.cronograma?.inicio && atraso.cronograma?.fim && (
            <span>Cronograma: {atraso.cronograma.inicio} → {atraso.cronograma.fim}</span>
          )}
        </div>
      )}
    </li>
  );
}

/** Conteúdo do modal: detalhes da demanda em tela cheia. */
function DemandaDetalhes({ d }: { d: DemandaAtrasada }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DetailField label="Atraso" value={d.tempoAtrasado ?? '—'} tone={d.diasAtraso !== null && d.diasAtraso > 7 ? 'red' : 'orange'} />
        <DetailField label="Prioridade" value={d.prioridade ?? '—'} tone="white" />
        <DetailField label="Status" value={d.statusTarefa ?? '—'} tone="white" />
        <DetailField label="Designer" value={d.designer ?? '—'} tone="orange" />
      </div>

      <div className="rounded-xl bg-black/30 border border-burst-border p-4">
        <div className="text-[10px] uppercase tracking-widest text-burst-muted mb-2">
          Data de criação
        </div>
        <div className="text-sm text-white/90 font-mono">{fmtDataBrasilia(d.dataCriacao)}</div>
      </div>

      {d.link && (
        <a
          href={d.link}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-burst-orange/15 border border-burst-orange/40 text-burst-orange-bright hover:bg-burst-orange/25 hover:border-burst-orange transition-colors font-semibold"
        >
          <ExternalLink size={16} />
          Abrir demanda no Monday
        </a>
      )}
    </div>
  );
}

function DetailField({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'orange' | 'white' | 'red';
}) {
  const cls = tone === 'orange'
    ? 'text-burst-orange-bright'
    : tone === 'red'
    ? 'text-red-400'
    : 'text-white';
  return (
    <div className="rounded-lg bg-black/30 border border-burst-border p-3">
      <div className="text-[9px] uppercase tracking-wider text-burst-muted mb-1">{label}</div>
      <div className={`font-display text-base truncate ${cls}`} title={value}>
        {value}
      </div>
    </div>
  );
}

function StatNum({
  icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'orange' | 'white' | 'red' | 'green';
  onClick?: () => void;
}) {
  const cls = tone === 'orange' ? 'text-burst-orange-bright' : tone === 'red' ? 'text-red-400' : tone === 'green' ? 'text-green-400' : 'text-white';
  const base = 'rounded-lg bg-black/30 border border-burst-border px-3 py-2 flex flex-col text-left';
  const inner = (
    <>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-burst-muted">
        {icon} {label}
      </div>
      <AnimatedNumber value={value} className={`font-display text-2xl ${cls}`} />
    </>
  );
  if (!onClick) return <div className={base}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} cursor-pointer transition-all hover:bg-black/50 hover:border-burst-orange/60 hover:-translate-y-[1px] focus:outline-none focus:ring-1 focus:ring-burst-orange/40`}
    >
      {inner}
    </button>
  );
}

function StatText({
  icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'orange' | 'white' | 'red' | 'green';
  onClick?: () => void;
}) {
  const cls = tone === 'orange' ? 'text-burst-orange-bright' : tone === 'red' ? 'text-red-400' : tone === 'green' ? 'text-green-400' : 'text-white';
  const base = 'rounded-lg bg-black/30 border border-burst-border px-3 py-2 flex flex-col text-left';
  const inner = (
    <>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-burst-muted">
        {icon} {label}
      </div>
      <span className={`font-display text-2xl ${cls}`}>{value}</span>
    </>
  );
  if (!onClick) return <div className={base}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} cursor-pointer transition-all hover:bg-black/50 hover:border-burst-orange/60 hover:-translate-y-[1px] focus:outline-none focus:ring-1 focus:ring-burst-orange/40`}
    >
      {inner}
    </button>
  );
}

function HistStat({
  label,
  value,
  sub,
  tone,
  suffix,
}: {
  label: string;
  value: number;
  sub?: string;
  tone: 'orange' | 'white' | 'red' | 'green';
  suffix?: string;
}) {
  const cls = tone === 'orange' ? 'text-burst-orange-bright' : tone === 'red' ? 'text-red-400' : tone === 'green' ? 'text-green-400' : 'text-white';
  return (
    <div className="rounded-lg bg-black/30 border border-burst-border px-3 py-2 flex flex-col">
      <div className="text-[10px] uppercase tracking-wider text-burst-muted">{label}</div>
      <span className={`font-display text-xl ${cls}`}>
        <AnimatedNumber value={value} />{suffix && <span className="text-xs ml-1 text-burst-muted">{suffix}</span>}
      </span>
      {sub && <span className="text-[9px] text-burst-muted">{sub}</span>}
    </div>
  );
}

function DesignChart({ serie }: { serie: DesignSaude['serie'] }) {
  const data = serie.map((p) => ({
    ...p,
    label: p.date.slice(8) + '/' + p.date.slice(5, 7),
  }));
  const total = serie.reduce((s, p) => s + p.feitos + p.manutencoes, 0);
  if (total === 0) {
    return (
      <div className="border-t border-burst-border pt-3">
        <div className="text-[10px] uppercase tracking-widest text-burst-muted mb-2">
          Cronologia — 30 dias
        </div>
        <div className="h-24 flex items-center justify-center text-xs text-burst-muted">
          sem demandas no período
        </div>
      </div>
    );
  }
  return (
    <div className="border-t border-burst-border pt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest text-burst-muted">
          Cronologia — 30 dias
        </div>
        <div className="flex items-center gap-3 text-[10px] text-burst-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-burst-orange-bright" /> Entregas
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-400" /> Manutenções
          </span>
        </div>
      </div>
      <div className="h-32 -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="#666"
              tick={{ fontSize: 9 }}
              interval={Math.floor(data.length / 8)}
            />
            <YAxis stroke="#666" tick={{ fontSize: 9 }} allowDecimals={false} width={20} />
            <Tooltip
              contentStyle={{
                background: '#111',
                border: '1px solid #1f1f1f',
                borderRadius: 8,
                fontSize: 11,
              }}
              labelStyle={{ color: '#9CA3AF', fontSize: 10 }}
              labelFormatter={(label) => `Dia ${label}`}
            />
            <Line
              type="monotone"
              dataKey="feitos"
              name="Entregas"
              stroke="#FF8C00"
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="manutencoes"
              name="Manutenções"
              stroke="#EF4444"
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

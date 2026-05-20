import { useState } from 'react';
import { Bot, Pause, Play, RefreshCw, Calendar } from 'lucide-react';
import { AnimatedNumber } from '../AnimatedNumber';
import { statusColors, fmtDataBrasilia, type BiaSaude, type BiaPeriodo } from '../../lib/clienteSaude';
import { Modal } from '../Modal';

type BiaDrill = 'faseAtual' | 'vezesAtivada' | 'vezesManut' | 'diasAtivos' | 'diasManut' | 'historico' | null;

interface Props {
  bia: BiaSaude;
}

export function BlocoBia({ bia }: Props) {
  const c = statusColors(bia.status);
  const [drill, setDrill] = useState<BiaDrill>(null);
  const faseIcon = bia.faseAtual?.toLowerCase().includes('ativa') ? (
    <Play size={14} className="text-green-400" />
  ) : bia.faseAtual?.toLowerCase().includes('manut') ? (
    <Pause size={14} className="text-burst-warning" />
  ) : (
    <Bot size={14} className={c.text} />
  );

  return (
    <section
      className={`rounded-2xl bg-burst-card border ${c.border} p-5 flex flex-col gap-4 animate-slide-up`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bot size={18} className={c.text} />
          <h3 className="font-display text-xl text-white tracking-wide">BIA</h3>
        </div>
        <span
          className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-bold border ${c.border} ${c.bg} ${c.text}`}
        >
          {c.label}
        </span>
      </header>

      {/* Fase atual — clicável */}
      <button
        type="button"
        onClick={() => setDrill('faseAtual')}
        className="rounded-xl bg-black/30 border border-burst-border p-3 flex items-center gap-3 text-left transition-all hover:bg-black/50 hover:border-burst-orange/60 hover:-translate-y-[1px] focus:outline-none focus:ring-1 focus:ring-burst-orange/40"
      >
        {faseIcon}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-burst-muted">Fase atual</div>
          <div className="font-display text-lg text-white truncate">
            {bia.faseAtual ?? 'Desconhecida'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-burst-muted">há</div>
          <div className="font-display text-lg text-burst-orange-bright">
            <AnimatedNumber value={bia.diasFaseAtual} /> <span className="text-sm">dia(s)</span>
          </div>
        </div>
      </button>

      <div className="grid grid-cols-2 gap-2">
        <StatNum
          icon={<Play size={11} />}
          label="Vezes ativada"
          value={bia.vezesAtivado}
          tone="green"
          onClick={() => setDrill('vezesAtivada')}
        />
        <StatNum
          icon={<RefreshCw size={11} />}
          label="Vezes em manut."
          value={bia.vezesEmManutencao}
          tone={bia.vezesEmManutencao >= 3 ? 'red' : bia.vezesEmManutencao >= 1 ? 'orange' : 'white'}
          onClick={() => setDrill('vezesManut')}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatNum
          icon={<Calendar size={11} />}
          label="Dias ativa total"
          value={bia.diasAtivoTotal}
          tone="orange"
          onClick={() => setDrill('diasAtivos')}
        />
        <StatNum
          icon={<Pause size={11} />}
          label="Dias em manut."
          value={bia.diasManutencaoTotal}
          tone={bia.diasManutencaoTotal > bia.diasAtivoTotal ? 'red' : 'white'}
          onClick={() => setDrill('diasManut')}
        />
      </div>

      {/* Histórico (timeline mini) — clica pra ver completo */}
      {bia.periodos.length > 0 && (
        <div className="border-t border-burst-border pt-3">
          <button
            type="button"
            onClick={() => setDrill('historico')}
            className="w-full text-left text-[11px] uppercase tracking-widest text-burst-muted mb-2 flex items-center gap-1.5 hover:text-burst-orange-bright transition-colors"
          >
            <RefreshCw size={11} />
            <span>Histórico</span>
            <span className="text-burst-muted/60">· {bia.periodos.length} mudança(s)</span>
            <span className="ml-auto text-[10px] text-burst-muted/70">ver tudo →</span>
          </button>
          <ul className="flex flex-col gap-1 max-h-44 overflow-y-auto scrollbar-thin pr-1">
            {bia.periodos.slice().reverse().slice(0, 10).map((p, i) => (
              <PeriodoRow key={i} periodo={p} />
            ))}
            {bia.periodos.length > 10 && (
              <li>
                <button
                  type="button"
                  onClick={() => setDrill('historico')}
                  className="w-full text-[10px] text-burst-muted hover:text-burst-orange-bright text-center py-1 transition-colors"
                >
                  +{bia.periodos.length - 10} período(s) anterior(es) — clique pra ver
                </button>
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Análise verbal */}
      <div className="border-t border-burst-border pt-3 text-xs text-burst-muted leading-relaxed">
        {bia.status === 'sem-dados' ? (
          <span>Sem timeline de fase registrada — verifique se o cliente está no Bia Soft.</span>
        ) : bia.faseAtual?.toLowerCase().includes('manut') ? (
          <span className="text-red-400">
            <strong>Bia em manutenção há {bia.diasFaseAtual} dia(s).</strong> Cliente não recebe leads.
          </span>
        ) : bia.vezesEmManutencao >= 3 ? (
          <span className="text-burst-warning">
            <strong>{bia.vezesEmManutencao} idas pra manutenção.</strong> Cliente instável — investigar padrão.
          </span>
        ) : bia.faseAtual?.toLowerCase().includes('ativa') ? (
          <span className="text-green-400">
            Bia ativa há <strong>{bia.diasFaseAtual} dia(s)</strong>. Tudo rodando.
          </span>
        ) : (
          <span>Fase corrente: {bia.faseAtual ?? '—'}</span>
        )}
      </div>

      <Modal
        open={drill !== null}
        onClose={() => setDrill(null)}
        title={biaDrillTitle(drill)}
        maxWidth="max-w-3xl"
      >
        {drill && <BiaDrillContent drill={drill} bia={bia} />}
      </Modal>
    </section>
  );
}

function biaDrillTitle(d: BiaDrill): string {
  switch (d) {
    case 'faseAtual': return 'Fase atual da Bia';
    case 'vezesAtivada': return 'Vezes que a Bia foi ativada';
    case 'vezesManut': return 'Vezes em manutenção';
    case 'diasAtivos': return 'Dias ativos (total)';
    case 'diasManut': return 'Dias em manutenção (total)';
    case 'historico': return 'Histórico completo de fases';
    default: return '';
  }
}

function BiaDrillContent({ drill, bia }: { drill: BiaDrill; bia: BiaSaude }) {
  if (drill === 'historico') {
    return (
      <ul className="flex flex-col gap-2 max-h-[65vh] overflow-y-auto scrollbar-thin pr-1">
        {bia.periodos.slice().reverse().map((p, i) => {
          const ativo = p.fase.toLowerCase().includes('ativa');
          const manut = p.fase.toLowerCase().includes('manut');
          const dot = ativo ? 'bg-green-400' : manut ? 'bg-burst-warning' : 'bg-burst-muted';
          return (
            <li key={i} className="rounded-lg bg-black/30 border border-burst-border px-3 py-2 flex items-start gap-3">
              <span className={`w-3 h-3 rounded-full ${dot} mt-1 shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white font-medium">{p.fase}</div>
                <div className="text-[11px] text-burst-muted mt-0.5">
                  Início: {fmtDataBrasilia(p.inicio)}
                  {p.fim ? ` → Fim: ${fmtDataBrasilia(p.fim)}` : ' · em andamento'}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-display text-lg text-burst-orange-bright">{p.dias}</div>
                <div className="text-[9px] uppercase tracking-wider text-burst-muted">dia(s)</div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
  // Pra outros drills (faseAtual, vezesX, diasX), mostra apenas os períodos relevantes
  const filtered = (() => {
    if (drill === 'vezesAtivada' || drill === 'diasAtivos') {
      return bia.periodos.filter((p) => p.fase.toLowerCase().includes('ativa'));
    }
    if (drill === 'vezesManut' || drill === 'diasManut') {
      return bia.periodos.filter((p) => p.fase.toLowerCase().includes('manut'));
    }
    if (drill === 'faseAtual') {
      // só o último período (aberto)
      return bia.periodos.length > 0 ? [bia.periodos[bia.periodos.length - 1]] : [];
    }
    return bia.periodos;
  })();
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-burst-muted">
        {filtered.length} período(s)
        {(drill === 'diasAtivos' || drill === 'diasManut') && (
          <> · {filtered.reduce((s, p) => s + p.dias, 0)} dia(s) total</>
        )}
      </div>
      <ul className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto scrollbar-thin pr-1">
        {filtered.slice().reverse().map((p, i) => (
          <li key={i} className="rounded-lg bg-black/30 border border-burst-border px-3 py-2 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white font-medium">{p.fase}</div>
              <div className="text-[11px] text-burst-muted mt-0.5">
                {fmtDataBrasilia(p.inicio)}
                {p.fim ? ` → ${fmtDataBrasilia(p.fim)}` : ' · em andamento'}
              </div>
            </div>
            <div className="font-display text-lg text-burst-orange-bright shrink-0">
              {p.dias} <span className="text-xs text-burst-muted">d</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PeriodoRow({ periodo }: { periodo: BiaPeriodo }) {
  const ativo = periodo.fase.toLowerCase().includes('ativa');
  const manut = periodo.fase.toLowerCase().includes('manut');
  const dotCls = ativo
    ? 'bg-green-400'
    : manut
    ? 'bg-burst-warning'
    : 'bg-burst-muted';
  const aberto = periodo.fim === null;
  return (
    <li className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded bg-black/20">
      <span className={`w-2 h-2 rounded-full ${dotCls} shrink-0`} />
      <span className="text-white/90 flex-1 truncate">{periodo.fase}</span>
      <span className="text-burst-muted font-mono shrink-0">
        {periodo.dias}d {aberto && '· agora'}
      </span>
      <span className="text-burst-muted/70 text-[10px] font-mono shrink-0">
        {new Date(periodo.inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
      </span>
    </li>
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

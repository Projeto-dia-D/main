import { Palette, CheckCircle2, RefreshCw, Zap, Stethoscope, Clock } from 'lucide-react';
import { AnimatedNumber } from '../AnimatedNumber';
import {
  halfTierColor,
  tierColor,
  formatBonusTotal,
} from '../../lib/designMetrics';
import type { DesignerMetrics } from '../../lib/designMetrics';
import { DesignerHeroImage } from './DesignerHeroImage';
import { Avatar } from '../Avatar';
import { useUserPhotos } from '../../hooks/useUserPhotos';
import { Users } from 'lucide-react';
import { uniqueDemandaKey } from '../../lib/designMetrics';

interface Props {
  designer: DesignerMetrics;
  onClick?: () => void;
  onClickFeitas?: () => void;
  onClickManutencoes?: () => void;
}

export function PainelMiniDesigner({
  designer,
  onClick,
  onClickFeitas,
  onClickManutencoes,
}: Props) {
  // Cores pela FAIXA paga (não pelo % arredondado) — cor sempre bate com o bônus.
  const colorsManut = halfTierColor(designer.tierManutencao);
  const colorsAtraso = halfTierColor(designer.tierAtraso);
  // bonusTotal agora é a SOMA de atraso + manutenção (0 | 0,25 | 0,5 | 0,75 | 1).
  const colorsBonus = tierColor(designer.bonusTotal);
  const { lookup: lookupPhoto } = useUserPhotos();
  const photoUrl = lookupPhoto(designer.nome);

  // Helpers de click: stop propagation pra não disparar onClick do card
  // quando o user clicar dentro de uma estatística.
  function makeHandler(fn?: () => void) {
    if (!fn) return undefined;
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      fn();
    };
  }
  const clickFeitas = makeHandler(onClickFeitas);
  const clickManutencoes = makeHandler(onClickManutencoes);

  return (
    <section
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={[
        'rounded-2xl border bg-burst-card p-5 relative overflow-hidden animate-slide-up transition-all',
        onClick ? 'cursor-pointer hover:translate-y-[-2px] hover:border-burst-orange' : '',
        colorsBonus.border,
        colorsBonus.glow,
      ].join(' ')}
    >
      <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-burst-orange/5 blur-3xl pointer-events-none" />

      {/* Modo herói: banner cinematográfico (com fogo verde) quando bateu
          1 salário cheio. Tem precedência sobre o avatar pequeno. */}
      {designer.bonusTotal === 1 && (
        <div className="flex justify-center mb-3 relative">
          <DesignerHeroImage designerNome={designer.nome} size={120} />
        </div>
      )}

      <div className="flex items-center justify-between mb-3 relative gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar Monday: só quando NÃO está em modo herói (evita
              duplicar foto). Clicável → abre lightbox. */}
          {designer.bonusTotal !== 1 && (
            <Avatar
              src={photoUrl}
              name={designer.nome}
              size={44}
              className="ring-2 ring-burst-orange/30"
              clickable
            />
          )}
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-burst-muted">Designer</div>
            <h3
              className="font-display text-2xl text-white tracking-wide truncate flex items-center gap-2"
              title={designer.nome}
            >
              {firstName(designer.nome)}
              <Palette size={16} className={colorsBonus.text} />
            </h3>
          </div>
        </div>
        <div
          className={`shrink-0 px-2 py-1 rounded-md border text-[10px] uppercase tracking-wider font-bold ${colorsBonus.border} ${colorsBonus.bg} ${colorsBonus.text}`}
        >
          {formatBonusTotal(designer.bonusTotal)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3 relative">
        {/* ATRASO % — métrica pontuada principal (jul/2026+) */}
        <ClickableStat
          title="Demandas que atrasaram ÷ demandas feitas"
          className={`border ${colorsAtraso.border} ${colorsAtraso.bg}`}
        >
          <div className="text-[9px] uppercase tracking-wider text-burst-muted flex items-center gap-1">
            <Clock size={10} /> % Atraso
          </div>
          <div className={`font-display text-2xl ${colorsAtraso.text}`}>
            {designer.atrasoPct.toFixed(1)}%
          </div>
          <span className="text-[9px] text-burst-muted">
            {designer.atrasadasNoPeriodo}/{designer.feitasNoAtraso} atrasadas
          </span>
        </ClickableStat>

        {/* TAX APROV (% manutenção) — clicável: abre lista de Manutenções */}
        <ClickableStat
          onClick={clickManutencoes}
          title="Ver manutenções"
          className={`border ${colorsManut.border} ${colorsManut.bg}`}
        >
          <div className="text-[9px] uppercase tracking-wider text-burst-muted flex items-center gap-1">
            <RefreshCw size={10} /> % Manutenção
          </div>
          <div className={`font-display text-2xl ${colorsManut.text}`}>
            {designer.pctManutencao.toFixed(1)}%
          </div>
        </ClickableStat>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ClickableStat
          onClick={clickFeitas}
          title="Ver demandas feitas"
          className="bg-black/30 border border-burst-border"
        >
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
            <CheckCircle2 size={11} /> Entregas
          </div>
          <AnimatedNumber
            value={designer.totalEventosFeito}
            className="font-display text-base text-burst-orange-bright"
          />
          <span className="text-[9px] text-burst-muted">{designer.feitasUnicas} únicas</span>
          <span className="text-[9px] text-burst-muted/70 flex items-center gap-0.5">
            <Zap size={9} /> {designer.demandasPorDia.toFixed(1)}/dia
          </span>
        </ClickableStat>
        <ClickableStat
          onClick={clickManutencoes}
          title="Ver manutenções"
          className="bg-black/30 border border-burst-border"
        >
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
            <RefreshCw size={11} /> Manutenções
          </div>
          <AnimatedNumber
            value={designer.totalEventosManutencaoC}
            className="font-display text-base text-white"
          />
          <span className="text-[9px] text-burst-muted">{designer.manutencoesUnicas} únicas</span>
          <span className="text-[9px] text-burst-muted/60">{designer.totalEventosManutencao + designer.totalEventosManutencaoC} c/ gestor</span>
        </ClickableStat>
      </div>

      {designer.atestadosNoPeriodo.length > 0 && (
        <div className="mt-2 mb-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-1 flex items-center gap-1.5 text-[10px]">
          <Stethoscope size={11} className="text-blue-300" />
          <span className="text-blue-300 font-bold uppercase tracking-wider">
            Atestado: -{designer.diasAtestadoNoPeriodo} dia(s)
          </span>
          <span className="text-burst-muted/70 truncate">
            ({designer.atestadosNoPeriodo.length} reg.)
          </span>
        </div>
      )}

      <ClientesDoDesigner designer={designer} />
    </section>
  );
}

/** Agrupa as demandas do designer por CLIENTE e mostra
 *  contagem de entregas + manutenções pra cada cliente. */
function ClientesDoDesigner({ designer }: { designer: DesignerMetrics }) {
  // Agrupa por nome do cliente
  const byCliente = new Map<string, { feitos: Set<string>; manuts: Set<string> }>();
  for (const ev of designer.eventos) {
    const cli = (ev.clientes || '').trim();
    if (!cli) continue;
    // Split por vírgula (pode ter múltiplos clientes na mesma demanda)
    for (const c of cli.split(/\s*,\s*/)) {
      const nome = c.trim();
      if (!nome) continue;
      const entry = byCliente.get(nome) ?? { feitos: new Set(), manuts: new Set() };
      const k = uniqueDemandaKey(ev);
      if (ev.tipo_evento === 'feito') entry.feitos.add(k);
      else entry.manuts.add(k);
      byCliente.set(nome, entry);
    }
  }
  const rows = [...byCliente.entries()]
    .map(([nome, v]) => ({
      nome,
      feitas: v.feitos.size,
      manut: v.manuts.size,
      pct: v.feitos.size > 0 ? (v.manuts.size / v.feitos.size) * 100 : 0,
    }))
    .sort((a, b) => b.feitas - a.feitas);

  if (rows.length === 0) return null;

  return (
    <div className="border-t border-burst-border pt-3 mt-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-burst-muted mb-2">
        <Users size={11} />
        <span>Clientes atendidos</span>
        <span className="text-burst-muted/60">· {rows.length}</span>
      </div>
      <ul className="flex flex-col gap-1 max-h-56 overflow-y-auto scrollbar-thin pr-1">
        {rows.map((r) => {
          const pctCls = r.pct <= 15 ? 'text-green-400' : r.pct <= 19 ? 'text-burst-orange-bright' : 'text-red-400';
          return (
            <li
              key={r.nome}
              className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-black/20"
            >
              <span className="flex-1 truncate text-white/85">{r.nome}</span>
              <span className="text-burst-orange-bright font-mono text-xs w-8 text-right shrink-0" title="Entregas únicas">
                {r.feitas}
              </span>
              <span className="text-burst-muted font-mono text-xs w-8 text-right shrink-0" title="Manutenções únicas">
                {r.manut}
              </span>
              <span className={`font-mono text-[10px] w-12 text-right shrink-0 ${pctCls}`} title="% Manutenção">
                {r.pct.toFixed(1)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function firstName(s: string): string {
  // "Paulo Henrique Pires Da Silva" → "Paulo Henrique"
  // Pega os 2 primeiros tokens pra dar mais identidade.
  const parts = s.trim().split(/\s+/);
  return parts.slice(0, 2).join(' ') || s;
}

/** Wrapper que torna um stat clicável (com hover) quando recebe onClick.
 *  Sem onClick, vira só uma div estática. */
function ClickableStat({
  onClick,
  title,
  className,
  children,
}: {
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (!onClick) {
    return (
      <div className={`rounded-lg px-3 py-2 flex flex-col ${className ?? ''}`}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-lg px-3 py-2 flex flex-col text-left cursor-pointer transition-all hover:brightness-110 hover:-translate-y-[1px] focus:outline-none focus:ring-1 focus:ring-burst-orange/60 ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

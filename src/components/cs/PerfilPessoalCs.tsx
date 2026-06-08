import { useMemo } from 'react';
import {
  TrendingDown,
  TrendingUp,
  MessageCircle,
  ArrowDownRight,
  DollarSign,
  BarChart3,
  Award,
  Sparkles,
} from 'lucide-react';
import {
  tierColorCpt,
  tierLabelCpt,
  progressToNextTierCpt,
  brl,
  type ClientMetrics,
} from '../../lib/gestorMetrics';
import type { CsMetrics, CsSummary } from '../../lib/csMetrics';
import { AnimatedNumber } from '../AnimatedNumber';
import { Avatar } from '../Avatar';
import { useUserPhotos } from '../../hooks/useUserPhotos';
import { ListasClientes } from '../gestor/ListasClientes';

interface Props {
  cs: CsMetrics;
  // sectorSummary = média de todos CSs (não filtrado por role) — usado pra
  // comparar a performance pessoal com a média do setor.
  sectorSummary: CsSummary;
  onClickCliente?: (cm: ClientMetrics) => void;
  onClickMensagens?: () => void;
  onClickTransferencias?: () => void;
  onClickSpend?: () => void;
}

/**
 * Dashboard PERSONALIZADO de um CS. Mostra:
 * - Hero card com CPT, transf, mensagens, gasto, badge de tier
 * - Comparação vs média do setor
 * - Melhores clientes (top 3 por transferências)
 * - Piores clientes (clientes com 0 transf ou CPT alto)
 *
 * Substitui a multi-grid "Análise por CS" quando o usuário é CS (não-admin).
 */
export function PerfilPessoalCs({
  cs,
  sectorSummary,
  onClickCliente,
  onClickMensagens,
  onClickTransferencias,
  onClickSpend,
}: Props) {
  const colors = tierColorCpt(cs.tier);
  const prog = progressToNextTierCpt(cs.cpt);
  const { lookup: lookupPhoto } = useUserPhotos();
  const photoUrl = lookupPhoto(cs.cs);

  // Média do setor: usa o cptGeral do summary completo (todos CSs).
  // Se o CS atual tem CPT melhor que a média, é positivo.
  const sectorCpt = sectorSummary.cptGeral;
  const cptDelta = useMemo(() => {
    if (cs.cpt === null || sectorCpt === null) return null;
    return cs.cpt - sectorCpt; // negativo = melhor (CPT menor é melhor)
  }, [cs.cpt, sectorCpt]);

  // Ranking entre todos os CSs
  const ranking = useMemo(() => {
    const ranked = [...sectorSummary.cses]
      .filter((c) => c.cpt !== null)
      .sort((a, b) => (a.cpt ?? Infinity) - (b.cpt ?? Infinity));
    const myIdx = ranked.findIndex((c) => c.cs === cs.cs);
    return {
      position: myIdx + 1,
      total: ranked.length,
    };
  }, [sectorSummary.cses, cs.cs]);

  return (
    <div className="flex flex-col gap-5">
      {/* === HERO === */}
      <section
        className={[
          'rounded-2xl border bg-burst-card p-7 relative overflow-hidden animate-slide-up',
          colors.border,
          colors.glow,
        ].join(' ')}
      >
        {/* Glow decorativo */}
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-burst-orange/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-burst-orange/5 blur-3xl pointer-events-none" />

        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar src={photoUrl} name={cs.cs} size={64} className="ring-2 ring-burst-orange/30" clickable />
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={14} className="text-burst-orange-bright" />
                <span className="text-[10px] uppercase tracking-[0.3em] text-burst-muted">
                  Seu painel
                </span>
              </div>
              <h2 className="font-display text-4xl text-white tracking-wide truncate">
                {cs.cs}
              </h2>
              <div className="text-xs text-burst-muted mt-1">
                {cs.clients.length} cliente(s) sob sua responsabilidade
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div
              className={`px-3 py-1.5 rounded-md border text-xs uppercase tracking-wider font-bold ${colors.border} ${colors.bg} ${colors.text}`}
            >
              {tierLabelCpt(cs.tier)}
            </div>
            {ranking.total > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-burst-muted">
                <Award size={13} className="text-burst-orange-bright" />
                <span>
                  <span className="text-white font-semibold">#{ranking.position}</span>
                  <span className="text-burst-muted"> de {ranking.total} CSs</span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* CPT gigante */}
        <div className="relative mt-6 flex items-end gap-3">
          {cs.cpt === null ? (
            <span className="font-display text-6xl leading-none text-burst-muted">—</span>
          ) : (
            <span className={`font-display text-6xl leading-none ${colors.text}`}>
              {brl(cs.cpt)}
            </span>
          )}
          <div className="pb-1.5">
            <div className="text-xs uppercase tracking-wider text-burst-muted">
              Custo por transferência
            </div>
            {cptDelta !== null && sectorCpt !== null && (
              <div
                className={[
                  'text-xs flex items-center gap-1 mt-0.5',
                  cptDelta < 0 ? 'text-green-400' : 'text-red-400',
                ].join(' ')}
              >
                {cptDelta < 0 ? (
                  <TrendingDown size={12} />
                ) : (
                  <TrendingUp size={12} />
                )}
                {brl(Math.abs(cptDelta))} {cptDelta < 0 ? 'abaixo' : 'acima'} da média (
                {brl(sectorCpt)})
              </div>
            )}
          </div>
        </div>

        {/* Progresso pro próximo tier */}
        <div className="relative w-full mt-5">
          <div className="flex justify-between items-center text-[10px] text-burst-muted mb-1.5">
            <span className="truncate">{prog.nextLabel}</span>
            <span className="shrink-0">
              {prog.remaining > 0 && cs.cpt !== null
                ? `faltam ${brl(prog.remaining)} ↓`
                : cs.cpt === null
                ? ''
                : '✓ no topo'}
            </span>
          </div>
          <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-burst-border">
            <div
              className="h-full bg-gradient-to-r from-burst-orange to-burst-orange-bright transition-all duration-700"
              style={{ width: `${prog.pctOfBar}%` }}
            />
          </div>
        </div>

        {/* Stats grid */}
        <div className="relative grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          <BigStat
            icon={<MessageCircle size={14} />}
            label="Mensagens"
            value={cs.totalMensagens}
            tone="white"
            onClick={onClickMensagens}
          />
          <BigStat
            icon={<ArrowDownRight size={14} />}
            label="Transferências"
            value={cs.totalTransferencias}
            tone="orange"
            onClick={onClickTransferencias}
          />
          <BigStatText
            icon={<DollarSign size={14} />}
            label="Investido"
            value={brl(cs.totalSpend)}
            tone="white"
            onClick={onClickSpend}
          />
          <BigStatText
            icon={<BarChart3 size={14} />}
            label="Taxa conversão"
            value={
              cs.totalMensagens > 0
                ? `${((cs.totalTransferencias / cs.totalMensagens) * 100).toFixed(1)}%`
                : '—'
            }
            tone="orange"
            onClick={onClickTransferencias}
          />
        </div>
      </section>

      <ListasClientes
        clients={cs.clients}
        onClickCliente={onClickCliente}
        totalLabelSuffix="sob sua responsabilidade"
      />
    </div>
  );
}

function BigStat({
  icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'orange' | 'white';
  onClick?: () => void;
}) {
  const cls = 'rounded-xl bg-black/30 border border-burst-border px-4 py-3 text-left';
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-burst-muted mb-1">
        {icon} {label}
      </div>
      <AnimatedNumber
        value={value}
        className={`font-display text-2xl ${tone === 'orange' ? 'text-burst-orange-bright' : 'text-white'}`}
      />
    </>
  );
  if (!onClick) return <div className={cls}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${cls} cursor-pointer transition-all hover:bg-black/50 hover:border-burst-orange/60 hover:-translate-y-[1px] focus:outline-none focus:ring-1 focus:ring-burst-orange/40`}
    >
      {inner}
    </button>
  );
}

function BigStatText({
  icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'orange' | 'white';
  onClick?: () => void;
}) {
  const cls = 'rounded-xl bg-black/30 border border-burst-border px-4 py-3 text-left';
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-burst-muted mb-1">
        {icon} {label}
      </div>
      <span className={`font-display text-2xl ${tone === 'orange' ? 'text-burst-orange-bright' : 'text-white'}`}>
        {value}
      </span>
    </>
  );
  if (!onClick) return <div className={cls}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${cls} cursor-pointer transition-all hover:bg-black/50 hover:border-burst-orange/60 hover:-translate-y-[1px] focus:outline-none focus:ring-1 focus:ring-burst-orange/40`}
    >
      {inner}
    </button>
  );
}


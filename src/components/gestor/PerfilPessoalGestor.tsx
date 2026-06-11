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
  type GestorMetrics,
  type GestorSummary,
} from '../../lib/gestorMetrics';
import { AnimatedNumber } from '../AnimatedNumber';
import { Avatar } from '../Avatar';
import { useUserPhotos } from '../../hooks/useUserPhotos';
import { ListasClientes } from './ListasClientes';

interface Props {
  gestor: GestorMetrics;
  // sectorSummary = média de todos gestores (não filtrado por role) — usado pra
  // comparar a performance pessoal com a média do setor.
  sectorSummary: GestorSummary;
  onClickCliente?: (cm: ClientMetrics) => void;
  onClickMensagens?: () => void;
  onClickTransferencias?: () => void;
  onClickSpend?: () => void;
}

/**
 * Dashboard PERSONALIZADO de um gestor de tráfego. Estrutura idêntica a
 * PerfilPessoalCs, mas usando os tipos de gestor.
 */
export function PerfilPessoalGestor({
  gestor,
  sectorSummary,
  onClickCliente,
  onClickMensagens,
  onClickTransferencias,
  onClickSpend,
}: Props) {
  const colors = tierColorCpt(gestor.tier);
  const prog = progressToNextTierCpt(gestor.cpt);
  const { lookup: lookupPhoto } = useUserPhotos();
  const photoUrl = lookupPhoto(gestor.gestor);

  const sectorCpt = sectorSummary.cptGeral;
  const cptDelta = useMemo(() => {
    if (gestor.cpt === null || sectorCpt === null) return null;
    return gestor.cpt - sectorCpt;
  }, [gestor.cpt, sectorCpt]);

  const ranking = useMemo(() => {
    const ranked = [...sectorSummary.gestores]
      .filter((g) => g.cpt !== null)
      .sort((a, b) => (a.cpt ?? Infinity) - (b.cpt ?? Infinity));
    const myIdx = ranked.findIndex((g) => g.gestor === gestor.gestor);
    return {
      position: myIdx + 1,
      total: ranked.length,
    };
  }, [sectorSummary.gestores, gestor.gestor]);

  return (
    <div className="flex flex-col gap-5">
      <section
        className={[
          'rounded-2xl border bg-burst-card p-7 relative overflow-hidden animate-slide-up',
          colors.border,
          colors.glow,
        ].join(' ')}
      >
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-burst-orange/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-burst-orange/5 blur-3xl pointer-events-none" />

        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar src={photoUrl} name={gestor.gestor} size={64} className="ring-2 ring-burst-orange/30" clickable />
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={14} className="text-burst-orange-bright" />
                <span className="text-[10px] uppercase tracking-[0.3em] text-burst-muted">
                  Seu painel
                </span>
              </div>
              <h2 className="font-display text-4xl text-white tracking-wide truncate">
                {gestor.gestor}
              </h2>
              <div className="text-xs text-burst-muted mt-1">
                {gestor.clients.length} cliente(s) sob sua gestão
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div
              className={`px-3 py-1.5 rounded-md border text-xs uppercase tracking-wider font-bold ${colors.border} ${colors.bg} ${colors.text}`}
            >
              {tierLabelCpt(gestor.tier)}
            </div>
            {ranking.total > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-burst-muted">
                <Award size={13} className="text-burst-orange-bright" />
                <span>
                  <span className="text-white font-semibold">#{ranking.position}</span>
                  <span className="text-burst-muted"> de {ranking.total} gestores</span>
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="relative mt-6 flex items-end gap-3">
          {gestor.cpt === null ? (
            <span className="font-display text-6xl leading-none text-burst-muted">—</span>
          ) : (
            <span className={`font-display text-6xl leading-none ${colors.text}`}>
              {brl(gestor.cpt)}
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

        <div className="relative w-full mt-5">
          <div className="flex justify-between items-center text-[10px] text-burst-muted mb-1.5">
            <span className="truncate">{prog.nextLabel}</span>
            <span className="shrink-0">
              {prog.remaining > 0 && gestor.cpt !== null
                ? `faltam ${brl(prog.remaining)} ↓`
                : gestor.cpt === null
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

        <div className="relative grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          <BigStat
            icon={<MessageCircle size={14} />}
            label="Mensagens"
            value={gestor.totalMensagens}
            tone="white"
            onClick={onClickMensagens}
          />
          <BigStat
            icon={<ArrowDownRight size={14} />}
            label="Transferências"
            value={gestor.totalTransferencias}
            tone="orange"
            onClick={onClickTransferencias}
          />
          <BigStatText
            icon={<DollarSign size={14} />}
            label="Investido"
            value={brl(gestor.totalSpend)}
            tone="white"
            onClick={onClickSpend}
          />
          <BigStatText
            icon={<BarChart3 size={14} />}
            label="Taxa conversão"
            value={
              gestor.totalMensagens > 0
                ? `${((gestor.totalTransferencias / gestor.totalMensagens) * 100).toFixed(1)}%`
                : '—'
            }
            tone="orange"
            onClick={onClickTransferencias}
          />
        </div>
        <div className="flex items-center justify-end gap-4 text-[11px] text-burst-muted mt-2 px-1">
          <span>Meta <span className="text-white/85 font-semibold">{brl(gestor.totalSpendMeta)}</span></span>
          <span>Google <span className="text-white/85 font-semibold">{brl(gestor.totalSpendGoogle)}</span></span>
        </div>
      </section>

      <ListasClientes
        clients={gestor.clients}
        onClickCliente={onClickCliente}
        totalLabelSuffix="sob sua gestão"
      />
    </div>
  );
}

function BigStat({
  icon, label, value, tone, onClick,
}: {
  icon: React.ReactNode; label: string; value: number; tone: 'orange' | 'white'; onClick?: () => void;
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
  icon, label, value, tone, onClick,
}: {
  icon: React.ReactNode; label: string; value: string; tone: 'orange' | 'white'; onClick?: () => void;
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


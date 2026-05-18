import { useMemo } from 'react';
import {
  Trophy,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
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

interface Props {
  gestor: GestorMetrics;
  // sectorSummary = média de todos gestores (não filtrado por role) — usado pra
  // comparar a performance pessoal com a média do setor.
  sectorSummary: GestorSummary;
}

/**
 * Dashboard PERSONALIZADO de um gestor de tráfego. Estrutura idêntica a
 * PerfilPessoalCs, mas usando os tipos de gestor.
 */
export function PerfilPessoalGestor({ gestor, sectorSummary }: Props) {
  const colors = tierColorCpt(gestor.tier);
  const prog = progressToNextTierCpt(gestor.cpt);

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

  const { melhores, piores } = useMemo(() => {
    const ativos = gestor.clients.filter((c) => !c.inactive);

    const melhores = [...ativos]
      .filter((c) => c.transferencias > 0)
      .sort((a, b) => {
        if (b.transferencias !== a.transferencias) {
          return b.transferencias - a.transferencias;
        }
        return (a.cpt ?? Infinity) - (b.cpt ?? Infinity);
      })
      .slice(0, 5);

    const piores = [...ativos]
      .filter((c) => c.spend > 0 && (c.transferencias === 0 || (c.cpt ?? 0) > 170))
      .sort((a, b) => {
        const aBad = a.transferencias === 0;
        const bBad = b.transferencias === 0;
        if (aBad !== bBad) return aBad ? -1 : 1;
        return (b.cpt ?? 0) - (a.cpt ?? 0);
      })
      .slice(0, 5);

    return { melhores, piores };
  }, [gestor.clients]);

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
          />
          <BigStat
            icon={<ArrowDownRight size={14} />}
            label="Transferências"
            value={gestor.totalTransferencias}
            tone="orange"
          />
          <BigStatText
            icon={<DollarSign size={14} />}
            label="Investido"
            value={brl(gestor.totalSpend)}
            tone="white"
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
          />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ClientesPanel
          title="Melhores clientes"
          subtitle="Maior número de transferências"
          icon={<Trophy size={18} className="text-green-400" />}
          tone="success"
          clients={melhores}
          emptyMsg="Nenhum cliente com transferências no período."
        />
        <ClientesPanel
          title="Piores clientes"
          subtitle="Gastaram mas converteram pouco — precisam de atenção"
          icon={<AlertTriangle size={18} className="text-red-400" />}
          tone="danger"
          clients={piores}
          emptyMsg="Todos seus clientes estão convertendo bem 🎉"
        />
      </div>
    </div>
  );
}

function BigStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'orange' | 'white';
}) {
  return (
    <div className="rounded-xl bg-black/30 border border-burst-border px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-burst-muted mb-1">
        {icon} {label}
      </div>
      <AnimatedNumber
        value={value}
        className={`font-display text-2xl ${
          tone === 'orange' ? 'text-burst-orange-bright' : 'text-white'
        }`}
      />
    </div>
  );
}

function BigStatText({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'orange' | 'white';
}) {
  return (
    <div className="rounded-xl bg-black/30 border border-burst-border px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-burst-muted mb-1">
        {icon} {label}
      </div>
      <span
        className={`font-display text-2xl ${
          tone === 'orange' ? 'text-burst-orange-bright' : 'text-white'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function ClientesPanel({
  title,
  subtitle,
  icon,
  tone,
  clients,
  emptyMsg,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  tone: 'success' | 'danger';
  clients: ClientMetrics[];
  emptyMsg: string;
}) {
  const borderCls =
    tone === 'success' ? 'border-green-500/40' : 'border-red-500/40';

  return (
    <section
      className={`rounded-2xl bg-burst-card border ${borderCls} p-5 animate-slide-up`}
    >
      <div className="flex items-start gap-3 mb-4">
        {icon}
        <div className="min-w-0">
          <h3 className="font-display text-xl text-white tracking-wide">{title}</h3>
          <p className="text-xs text-burst-muted mt-0.5">{subtitle}</p>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="text-burst-muted text-sm py-4 text-center">{emptyMsg}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {clients.map((c, idx) => (
            <ClienteRow key={c.client.id} cm={c} rank={idx + 1} tone={tone} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ClienteRow({
  cm,
  rank,
  tone,
}: {
  cm: ClientMetrics;
  rank: number;
  tone: 'success' | 'danger';
}) {
  const rankBg =
    tone === 'success'
      ? 'bg-green-500/15 text-green-400 border-green-500/30'
      : 'bg-red-500/15 text-red-400 border-red-500/30';

  return (
    <li className="flex items-center gap-3 rounded-lg bg-black/30 border border-burst-border px-3 py-2.5 hover:bg-black/40 transition-colors">
      <span
        className={`flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold border ${rankBg}`}
      >
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate font-medium">{cm.client.name}</div>
        <div className="text-[11px] text-burst-muted">
          {cm.transferencias} transf. • {cm.mensagensIniciadas} msg • {brl(cm.spend)}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div
          className={[
            'font-display text-lg',
            tone === 'success' ? 'text-green-400' : 'text-red-400',
          ].join(' ')}
        >
          {cm.cpt === null ? '—' : brl(cm.cpt)}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-burst-muted">
          CPT
        </div>
      </div>
    </li>
  );
}

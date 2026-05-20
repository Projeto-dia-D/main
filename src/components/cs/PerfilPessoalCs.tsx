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
} from '../../lib/gestorMetrics';
import type { CsMetrics, CsSummary } from '../../lib/csMetrics';
import { AnimatedNumber } from '../AnimatedNumber';
import { Avatar } from '../Avatar';
import { useUserPhotos } from '../../hooks/useUserPhotos';

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

  // Melhores e piores clientes
  const { melhores, piores } = useMemo(() => {
    const ativos = cs.clients.filter((c) => !c.inactive);

    // Melhores: ordena por transferências desc; quebra empate por CPT menor.
    const melhores = [...ativos]
      .filter((c) => c.transferencias > 0)
      .sort((a, b) => {
        if (b.transferencias !== a.transferencias) {
          return b.transferencias - a.transferencias;
        }
        return (a.cpt ?? Infinity) - (b.cpt ?? Infinity);
      })
      .slice(0, 5);

    // Piores: clientes que GASTARAM mas com 0 transferências OU CPT muito alto.
    // Ordena por SPEND desc (quem gastou mais sem retorno é o pior).
    // Empate em spend cai pra CPT desc (mais caro pior).
    const piores = [...ativos]
      .filter((c) => c.spend > 0 && (c.transferencias === 0 || (c.cpt ?? 0) > 170))
      .sort((a, b) => {
        if (b.spend !== a.spend) return b.spend - a.spend;
        return (b.cpt ?? 0) - (a.cpt ?? 0);
      })
      .slice(0, 5);

    return { melhores, piores };
  }, [cs.clients]);

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

      {/* === MELHORES / PIORES === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ClientesPanel
          title="Melhores clientes"
          subtitle="Maior número de transferências"
          icon={<Trophy size={18} className="text-green-400" />}
          tone="success"
          clients={melhores}
          emptyMsg="Nenhum cliente com transferências no período."
          onClickCliente={onClickCliente}
        />
        <ClientesPanel
          title="Piores clientes"
          subtitle="Gastaram mas converteram pouco — precisam de atenção"
          icon={<AlertTriangle size={18} className="text-red-400" />}
          tone="danger"
          clients={piores}
          emptyMsg="Todos seus clientes estão convertendo bem 🎉"
          onClickCliente={onClickCliente}
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

function ClientesPanel({
  title,
  subtitle,
  icon,
  tone,
  clients,
  emptyMsg,
  onClickCliente,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  tone: 'success' | 'danger';
  clients: ClientMetrics[];
  emptyMsg: string;
  onClickCliente?: (cm: ClientMetrics) => void;
}) {
  const borderCls =
    tone === 'success'
      ? 'border-green-500/40'
      : 'border-red-500/40';

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
            <ClienteRow
              key={c.client.id}
              cm={c}
              rank={idx + 1}
              tone={tone}
              onClick={onClickCliente ? () => onClickCliente(c) : undefined}
            />
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
  onClick,
}: {
  cm: ClientMetrics;
  rank: number;
  tone: 'success' | 'danger';
  onClick?: () => void;
}) {
  const rankBg =
    tone === 'success'
      ? 'bg-green-500/15 text-green-400 border-green-500/30'
      : 'bg-red-500/15 text-red-400 border-red-500/30';

  const cls = 'flex items-center gap-3 rounded-lg bg-black/30 border border-burst-border px-3 py-2.5 transition-colors w-full';
  const inner = (
    <>
      <span
        className={`flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold border ${rankBg}`}
      >
        {rank}
      </span>
      <div className="flex-1 min-w-0 text-left">
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
    </>
  );

  if (onClick) {
    return (
      <li>
        <button
          type="button"
          onClick={onClick}
          title={`Ver detalhes de ${cm.client.name}`}
          className={`${cls} cursor-pointer hover:bg-black/50 hover:border-burst-orange/60 focus:outline-none focus:ring-1 focus:ring-burst-orange/40`}
        >
          {inner}
        </button>
      </li>
    );
  }
  return <li className={`${cls} hover:bg-black/40`}>{inner}</li>;
}

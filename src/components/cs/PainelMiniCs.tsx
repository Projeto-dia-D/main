import { useMemo } from 'react';
import { TrendingDown, DollarSign, ArrowDownRight, MessageCircle, Trophy, AlertTriangle } from 'lucide-react';
import { AnimatedNumber } from '../AnimatedNumber';
import { tierColorCpt, tierLabelCpt, progressToNextTierCpt, brl, type ClientMetrics } from '../../lib/gestorMetrics';
import type { CsMetrics } from '../../lib/csMetrics';
import { Avatar } from '../Avatar';
import { useUserPhotos } from '../../hooks/useUserPhotos';

interface Props {
  cs: CsMetrics;
  onClickMensagens?: () => void;
  onClickTransferencias?: () => void;
  onClickSpend?: () => void;
  onClickCliente?: (cm: ClientMetrics) => void;
}

export function PainelMiniCs({
  cs,
  onClickMensagens,
  onClickTransferencias,
  onClickSpend,
  onClickCliente,
}: Props) {
  const colors = tierColorCpt(cs.tier);
  const prog = progressToNextTierCpt(cs.cpt);
  const { lookup: lookupPhoto } = useUserPhotos();
  const photoUrl = lookupPhoto(cs.cs);
  const { melhores, piores } = useMemo(() => rankClients(cs.clients), [cs.clients]);

  return (
    <section
      className={[
        'rounded-2xl border bg-burst-card p-5 relative overflow-hidden animate-slide-up transition-all hover:translate-y-[-2px]',
        colors.border,
        colors.glow,
      ].join(' ')}
    >
      <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-burst-orange/5 blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between mb-3 relative">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar src={photoUrl} name={cs.cs} size={44} className="ring-2 ring-burst-orange/30" clickable />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-burst-muted">CS</div>
            <h3 className="font-display text-2xl text-white tracking-wide truncate flex items-center gap-2">
              {firstName(cs.cs)}
              <TrendingDown size={16} className={colors.text} />
            </h3>
          </div>
        </div>
        <div className={`px-2 py-1 rounded-md border text-[10px] uppercase tracking-wider font-bold ${colors.border} ${colors.bg} ${colors.text}`}>
          {tierLabelCpt(cs.tier)}
        </div>
      </div>

      <div className="flex items-baseline gap-2 mb-3 relative">
        {cs.cpt === null ? (
          <span className="font-display text-4xl leading-none text-burst-muted">—</span>
        ) : (
          <span className={`font-display text-4xl leading-none ${colors.text}`}>{brl(cs.cpt)}</span>
        )}
        <span className="text-xs text-burst-muted">CPT</span>
      </div>

      <div className="w-full mb-3">
        <div className="flex justify-between items-center text-[10px] text-burst-muted mb-1">
          <span className="truncate">{prog.nextLabel}</span>
          <span className="shrink-0">
            {prog.remaining > 0 && cs.cpt !== null
              ? `${brl(prog.remaining)} ↓`
              : cs.cpt === null
              ? ''
              : '✓'}
          </span>
        </div>
        <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden border border-burst-border">
          <div
            className="h-full bg-gradient-to-r from-burst-orange to-burst-orange-bright transition-all duration-700"
            style={{ width: `${prog.pctOfBar}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <MiniStat icon={<DollarSign size={11} />} label="Investido" value={brl(cs.totalSpend)} accent onClick={onClickSpend} />
        <MiniStatNum icon={<ArrowDownRight size={11} />} label="Transf." value={cs.totalTransferencias} accent onClick={onClickTransferencias} />
        <MiniStatNum icon={<MessageCircle size={11} />} label="Mensagens" value={cs.totalMensagens} onClick={onClickMensagens} />
      </div>

      {(melhores.length > 0 || piores.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <ClientesMiniList title="Melhores" icon={<Trophy size={10} className="text-green-400" />} clients={melhores} tone="success" onClickCliente={onClickCliente} />
          <ClientesMiniList title="Piores" icon={<AlertTriangle size={10} className="text-red-400" />} clients={piores} tone="danger" onClickCliente={onClickCliente} />
        </div>
      )}
    </section>
  );
}

function rankClients(clients: ClientMetrics[]): {
  melhores: ClientMetrics[];
  piores: ClientMetrics[];
} {
  const ativos = clients.filter((c) => !c.inactive);
  const melhores = [...ativos]
    .filter((c) => c.transferencias > 0)
    .sort((a, b) => {
      if (b.transferencias !== a.transferencias) return b.transferencias - a.transferencias;
      return (a.cpt ?? Infinity) - (b.cpt ?? Infinity);
    })
    .slice(0, 3);
  const piores = [...ativos]
    .filter((c) => c.spend > 0 && (c.transferencias === 0 || (c.cpt ?? 0) > 170))
    .sort((a, b) => {
      const aBad = a.transferencias === 0;
      const bBad = b.transferencias === 0;
      if (aBad !== bBad) return aBad ? -1 : 1;
      return (b.cpt ?? 0) - (a.cpt ?? 0);
    })
    .slice(0, 3);
  return { melhores, piores };
}

function ClientesMiniList({
  title,
  icon,
  clients,
  tone,
  onClickCliente,
}: {
  title: string;
  icon: React.ReactNode;
  clients: ClientMetrics[];
  tone: 'success' | 'danger';
  onClickCliente?: (cm: ClientMetrics) => void;
}) {
  const borderCls = tone === 'success' ? 'border-green-500/30' : 'border-red-500/30';
  const textCls = tone === 'success' ? 'text-green-400' : 'text-red-400';
  return (
    <div className={`rounded-lg bg-black/30 border ${borderCls} px-2.5 py-2`}>
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted mb-1.5">
        {icon} {title}
      </div>
      {clients.length === 0 ? (
        <div className="text-[10px] text-burst-muted py-1">—</div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {clients.map((c) => {
            const inner = (
              <>
                <span className="truncate text-white/90 flex-1 text-left">{c.client.name}</span>
                <span className={`font-mono font-semibold ${textCls}`}>
                  {c.cpt === null ? '—' : brl(c.cpt)}
                </span>
              </>
            );
            if (!onClickCliente) {
              return (
                <li key={c.client.id} className="flex items-center justify-between gap-1 text-[10px]">
                  {inner}
                </li>
              );
            }
            return (
              <li key={c.client.id}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onClickCliente(c); }}
                  title={`Ver detalhes de ${c.client.name}`}
                  className="w-full flex items-center justify-between gap-1 text-[10px] px-1 py-0.5 rounded hover:bg-white/5 transition-colors focus:outline-none focus:ring-1 focus:ring-burst-orange/40"
                >
                  {inner}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MiniStat({ icon, label, value, accent, onClick }: { icon: React.ReactNode; label: string; value: string; accent?: boolean; onClick?: () => void }) {
  const cls = `rounded-lg bg-black/30 border border-burst-border px-2 py-1.5 flex flex-col text-left`;
  const content = (
    <>
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
        {icon} {label}
      </div>
      <span className={`font-display text-base truncate ${accent ? 'text-burst-orange-bright' : 'text-white'}`}>{value}</span>
    </>
  );
  if (!onClick) return <div className={cls}>{content}</div>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`${cls} cursor-pointer transition-all hover:bg-black/50 hover:border-burst-orange/60 hover:-translate-y-[1px] focus:outline-none focus:ring-1 focus:ring-burst-orange/40`}
    >
      {content}
    </button>
  );
}

function MiniStatNum({ icon, label, value, accent, onClick }: { icon: React.ReactNode; label: string; value: number; accent?: boolean; onClick?: () => void }) {
  const cls = `rounded-lg bg-black/30 border border-burst-border px-2 py-1.5 flex flex-col text-left`;
  const content = (
    <>
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-burst-muted">
        {icon} {label}
      </div>
      <AnimatedNumber value={value} className={`font-display text-base ${accent ? 'text-burst-orange-bright' : 'text-white'}`} />
    </>
  );
  if (!onClick) return <div className={cls}>{content}</div>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`${cls} cursor-pointer transition-all hover:bg-black/50 hover:border-burst-orange/60 hover:-translate-y-[1px] focus:outline-none focus:ring-1 focus:ring-burst-orange/40`}
    >
      {content}
    </button>
  );
}

function firstName(s: string): string {
  return s.trim().split(/\s+/)[0] ?? s;
}

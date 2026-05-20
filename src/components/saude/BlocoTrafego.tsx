import { useState } from 'react';
import { MessageCircle, ArrowDownRight, TrendingUp, Calendar, Activity, DollarSign, History } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { AnimatedNumber } from '../AnimatedNumber';
import { statusColors, fmtDataBrasilia, type TrafegoSaude } from '../../lib/clienteSaude';
import { useClientSpendAllTime } from '../../hooks/useClientSpendAllTime';
import { Modal } from '../Modal';

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
}

type DrillKey = 'leads' | 'transferencias' | 'taxa' | 'investido' | 'relacionamento' | 'leadsPorDia' | 'cpt' | 'serie' | null;

interface Props {
  trafego: TrafegoSaude;
  /** Conta Meta vinculada do cliente (pra puxar spend histórico). */
  metaAccountId?: string | null;
  /** Gestor da conta (necessário pra resolver o token Meta correto). */
  metaGestor?: string | null;
}

export function BlocoTrafego({ trafego, metaAccountId, metaGestor }: Props) {
  const spend = useClientSpendAllTime(metaAccountId, metaGestor);
  const c = statusColors(trafego.status);
  const [drill, setDrill] = useState<DrillKey>(null);

  return (
    <section
      className={`rounded-2xl bg-burst-card border ${c.border} p-5 flex flex-col gap-4 animate-slide-up`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity size={18} className={c.text} />
          <h3 className="font-display text-xl text-white tracking-wide">Tráfego</h3>
        </div>
        <span
          className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-bold border ${c.border} ${c.bg} ${c.text}`}
        >
          {c.label}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Stat
          icon={<MessageCircle size={11} />}
          label="Leads"
          value={trafego.totalLeads}
          tone={trafego.totalLeads === 0 ? 'red' : 'white'}
          onClick={() => setDrill('leads')}
        />
        <Stat
          icon={<ArrowDownRight size={11} />}
          label="Transferências"
          value={trafego.transferencias}
          tone="orange"
          onClick={() => setDrill('transferencias')}
        />
        <StatText
          icon={<TrendingUp size={11} />}
          label="Taxa"
          value={`${trafego.taxaTransferencia.toFixed(1)}%`}
          tone={trafego.taxaTransferencia >= 20 ? 'green' : trafego.taxaTransferencia >= 10 ? 'orange' : 'red'}
          onClick={() => setDrill('taxa')}
        />
      </div>

      {/* Linha cronológica — leads + transferências por dia (últimos 30 dias) */}
      <TrafegoChart serie={trafego.serie} />

      {/* Histórico all-time */}
      <div className="border-t border-burst-border pt-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-burst-muted mb-2">
          <History size={11} />
          <span>Histórico completo</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ClickableBox onClick={metaAccountId ? () => setDrill('investido') : undefined}>
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-burst-muted">
              <DollarSign size={11} /> Investido total
            </div>
            {!metaAccountId ? (
              <span className="font-display text-sm text-burst-muted">sem conta Meta</span>
            ) : spend.loading ? (
              <span className="font-display text-lg text-burst-muted animate-pulse">carregando...</span>
            ) : spend.error ? (
              // Mostra mensagem detalhada + clique pra ver detalhes
              <div className="flex flex-col gap-0.5" title={spend.error}>
                <span className="font-display text-sm text-red-400">erro</span>
                <span className="text-[9px] text-burst-muted/80 line-clamp-2 leading-tight">
                  {spend.error.length > 60 ? spend.error.slice(0, 60) + '…' : spend.error}
                </span>
                <span className="text-[9px] text-burst-orange-bright">clique pra detalhes</span>
              </div>
            ) : (
              <>
                <span className="font-display text-xl text-burst-orange-bright truncate">{brl(spend.totalSpend)}</span>
                {spend.firstDay && (
                  <span className="text-[9px] text-burst-muted">
                    desde {new Date(spend.firstDay).toLocaleDateString('pt-BR')}
                  </span>
                )}
                {spend.tokenUsado && metaGestor && spend.tokenUsado.toLowerCase() !== metaGestor.toLowerCase() && (
                  <span className="text-[9px] text-burst-orange-bright" title={`Vínculo está como ${metaGestor}, mas dados puxaram via token do ${spend.tokenUsado}`}>
                    via {spend.tokenUsado}
                  </span>
                )}
              </>
            )}
          </ClickableBox>
          <ClickableBox onClick={() => setDrill('relacionamento')}>
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-burst-muted">
              <History size={11} /> Relacionamento
            </div>
            <span className="font-display text-xl text-white">
              {trafego.diasRelacionamento ?? 0}
              <span className="text-xs text-burst-muted ml-1">dia(s)</span>
            </span>
            {trafego.dataEntradaCliente && (
              <span className="text-[9px] text-burst-muted">
                desde {new Date(trafego.dataEntradaCliente).toLocaleDateString('pt-BR')}
              </span>
            )}
          </ClickableBox>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <ClickableBox onClick={() => setDrill('leadsPorDia')}>
            <div className="text-[10px] uppercase tracking-wider text-burst-muted">
              Leads / dia (média)
            </div>
            <span className="font-display text-lg text-white">{trafego.leadsPorDia.toFixed(2)}</span>
          </ClickableBox>
          {metaAccountId && !spend.loading && spend.totalSpend > 0 && trafego.transferencias > 0 && (
            <ClickableBox onClick={() => setDrill('cpt')}>
              <div className="text-[10px] uppercase tracking-wider text-burst-muted">
                CPT histórico
              </div>
              <span className="font-display text-lg text-burst-orange-bright">
                {brl(spend.totalSpend / trafego.transferencias)}
              </span>
            </ClickableBox>
          )}
        </div>
      </div>

      <div className="border-t border-burst-border pt-3 space-y-1.5 text-xs">
        <Row
          icon={<Calendar size={12} />}
          label="Último lead"
          value={formatRel(trafego.ultimoLead, trafego.diasSemLead)}
          critical={trafego.diasSemLead !== null && trafego.diasSemLead > 7}
        />
        <Row
          icon={<ArrowDownRight size={12} />}
          label="Última transf."
          value={formatRel(trafego.ultimaTransferencia, trafego.diasSemTransferencia)}
          critical={trafego.diasSemTransferencia !== null && trafego.diasSemTransferencia > 14}
        />
      </div>

      {/* Análise verbal */}
      <div className="border-t border-burst-border pt-3 text-xs text-burst-muted leading-relaxed">
        {trafego.totalLeads === 0 ? (
          <span className="text-red-400">
            <strong>Nenhum lead recebido.</strong> Verifique se a Bia está conectada e se há campanha rodando.
          </span>
        ) : trafego.transferencias === 0 ? (
          <span className="text-red-400">
            <strong>{trafego.totalLeads} leads, mas 0 transferências.</strong> Pode ser ajuste no prompt da Bia.
          </span>
        ) : trafego.taxaTransferencia < 10 ? (
          <span className="text-burst-warning">
            Taxa abaixo de 10% — vale revisar a qualidade dos leads (criativo) e o atendimento.
          </span>
        ) : trafego.taxaTransferencia >= 20 ? (
          <span className="text-green-400">
            Excelente conversão — {trafego.taxaTransferencia.toFixed(1)}% dos leads viram transferência.
          </span>
        ) : (
          <span>
            Conversão saudável ({trafego.taxaTransferencia.toFixed(1)}%) dentro da faixa esperada.
          </span>
        )}
      </div>

      {/* Modal de drill — abre quando qualquer stat é clicado */}
      <Modal
        open={drill !== null}
        onClose={() => setDrill(null)}
        title={drillTitle(drill)}
        maxWidth="max-w-3xl"
      >
        {drill && (
          <TrafegoDrillContent
            drill={drill}
            trafego={trafego}
            spend={spend}
          />
        )}
      </Modal>
    </section>
  );
}

function drillTitle(d: DrillKey): string {
  switch (d) {
    case 'leads': return 'Leads recebidos';
    case 'transferencias': return 'Transferências';
    case 'taxa': return 'Taxa de transferência';
    case 'investido': return 'Investimento histórico';
    case 'relacionamento': return 'Tempo de relacionamento';
    case 'leadsPorDia': return 'Leads por dia';
    case 'cpt': return 'CPT histórico';
    default: return '';
  }
}

function TrafegoDrillContent({
  drill,
  trafego,
  spend,
}: {
  drill: DrillKey;
  trafego: TrafegoSaude;
  spend: ReturnType<typeof useClientSpendAllTime>;
}) {
  if (drill === 'leads' || drill === 'transferencias' || drill === 'taxa') {
    const totalLeads = trafego.totalLeads;
    const totalTransf = trafego.transferencias;
    const taxa = trafego.taxaTransferencia;
    return (
      <div className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-3 gap-3">
          <Box label="Total leads" value={totalLeads.toString()} tone="white" />
          <Box label="Transferências" value={totalTransf.toString()} tone="orange" />
          <Box label="Taxa" value={`${taxa.toFixed(1)}%`} tone={taxa >= 20 ? 'green' : taxa >= 10 ? 'orange' : 'red'} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Box label="Primeiro lead" value={trafego.primeiroLead ? fmtDataBrasilia(trafego.primeiroLead) : '—'} tone="white" />
          <Box label="Último lead" value={trafego.ultimoLead ? fmtDataBrasilia(trafego.ultimoLead) : '—'} tone="white" />
          <Box label="Última transferência" value={trafego.ultimaTransferencia ? fmtDataBrasilia(trafego.ultimaTransferencia) : '—'} tone="white" />
          <Box label="Dias sem lead" value={trafego.diasSemLead?.toString() ?? '—'} tone={trafego.diasSemLead !== null && trafego.diasSemLead > 7 ? 'red' : 'white'} />
        </div>
        <div className="text-xs text-burst-muted">
          A lista completa de leads aparece nas abas <strong>CS</strong> e <strong>Gestor</strong> — esta aba traz o resumo agregado.
        </div>
      </div>
    );
  }
  if (drill === 'investido' || drill === 'cpt') {
    if (spend.loading) return <div className="text-burst-muted text-center py-6">Carregando histórico do Meta…</div>;
    if (spend.error) {
      return (
        <div className="flex flex-col gap-3 py-2">
          <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4">
            <div className="text-red-400 font-semibold mb-2">Não consegui puxar o spend dessa conta Meta</div>
            <div className="text-xs text-burst-muted mb-3 font-mono break-words">{spend.error}</div>
            <div className="text-[11px] text-burst-muted leading-relaxed">
              <strong className="text-white/90">Causas comuns:</strong>
              <ul className="list-disc pl-4 mt-1 space-y-0.5">
                <li>Conta Meta foi excluída ou ficou inacessível</li>
                <li>Nenhum dos tokens (Renan/Weslei/André) tem permissão nessa Business Manager</li>
                <li>Token Meta expirou — abrir <em>Vincular contas</em> e renovar</li>
                <li>Account ID errado no vínculo — verificar em <em>Vincular contas</em></li>
              </ul>
            </div>
            <button
              onClick={() => {
                // Limpa o cache desta conta pra forçar refetch
                const accountId = (window as any).__currentMetaAccountId;
                if (accountId) {
                  Object.keys(localStorage)
                    .filter((k) => k.includes('spend:alltime') && k.includes(accountId))
                    .forEach((k) => localStorage.removeItem(k));
                }
                location.reload();
              }}
              className="mt-3 px-3 py-1.5 rounded-md bg-burst-orange/20 border border-burst-orange/40 text-burst-orange-bright text-xs font-semibold hover:bg-burst-orange/30"
            >
              Limpar cache e tentar de novo
            </button>
          </div>
        </div>
      );
    }
    const cpt = trafego.transferencias > 0 ? spend.totalSpend / trafego.transferencias : null;
    return (
      <div className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-3 gap-3">
          <Box label="Investido total" value={brl(spend.totalSpend)} tone="orange" />
          <Box label="Dias com gasto" value={spend.diasComSpend.toString()} tone="white" />
          <Box label="CPT histórico" value={cpt !== null ? brl(cpt) : '—'} tone="orange" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Box label="Primeira data" value={spend.firstDay ? new Date(spend.firstDay).toLocaleDateString('pt-BR') : '—'} tone="white" />
          <Box label="Última data" value={spend.lastDay ? new Date(spend.lastDay).toLocaleDateString('pt-BR') : '—'} tone="white" />
        </div>
        {spend.dailySpend.length > 0 && (
          <div className="border-t border-burst-border pt-3">
            <div className="text-[10px] uppercase tracking-widest text-burst-muted mb-2">
              Spend dia a dia · {spend.dailySpend.length} dias
            </div>
            <ul className="flex flex-col gap-1 max-h-64 overflow-y-auto scrollbar-thin pr-1 text-xs">
              {[...spend.dailySpend].reverse().slice(0, 60).map((d) => (
                <li key={d.date} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-black/20">
                  <span className="text-burst-muted font-mono">{new Date(d.date).toLocaleDateString('pt-BR')}</span>
                  <span className="text-burst-orange-bright font-mono">{brl(d.spend)}</span>
                </li>
              ))}
              {spend.dailySpend.length > 60 && (
                <li className="text-[10px] text-burst-muted text-center py-1">
                  +{spend.dailySpend.length - 60} dia(s) anterior(es)
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (drill === 'relacionamento') {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Box label="Primeiro lead" value={trafego.primeiroLead ? fmtDataBrasilia(trafego.primeiroLead) : '—'} tone="orange" />
          <Box label="Duração" value={`${trafego.diasRelacionamento ?? 0} dia(s)`} tone="white" />
        </div>
        <div className="text-xs text-burst-muted">
          Tempo entre o primeiro lead recebido e a data atual.
        </div>
      </div>
    );
  }
  if (drill === 'leadsPorDia') {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-3 gap-3">
          <Box label="Média diária" value={trafego.leadsPorDia.toFixed(2)} tone="orange" />
          <Box label="Total leads" value={trafego.totalLeads.toString()} tone="white" />
          <Box label="Período (dias)" value={(trafego.diasRelacionamento ?? 0).toString()} tone="white" />
        </div>
        <div className="text-xs text-burst-muted">
          Média = total de leads ÷ dias desde o primeiro lead.
        </div>
      </div>
    );
  }
  return null;
}

function Box({ label, value, tone }: { label: string; value: string; tone: 'orange' | 'white' | 'red' | 'green' }) {
  const cls = toneCls(tone);
  return (
    <div className="rounded-lg bg-black/30 border border-burst-border px-3 py-2 flex flex-col">
      <div className="text-[10px] uppercase tracking-wider text-burst-muted">{label}</div>
      <span className={`font-display text-xl ${cls} truncate`}>{value}</span>
    </div>
  );
}

function Stat({
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
  return (
    <ClickableBox onClick={onClick}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-burst-muted">
        {icon} {label}
      </div>
      <AnimatedNumber value={value} className={`font-display text-2xl ${toneCls(tone)}`} />
    </ClickableBox>
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
  return (
    <ClickableBox onClick={onClick}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-burst-muted">
        {icon} {label}
      </div>
      <span className={`font-display text-2xl ${toneCls(tone)}`}>{value}</span>
    </ClickableBox>
  );
}

/** Caixa stat reutilizável que vira botão quando recebe onClick. */
function ClickableBox({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  const base = 'rounded-lg bg-black/30 border border-burst-border px-3 py-2 flex flex-col text-left';
  if (!onClick) return <div className={base}>{children}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} cursor-pointer transition-all hover:bg-black/50 hover:border-burst-orange/60 hover:-translate-y-[1px] focus:outline-none focus:ring-1 focus:ring-burst-orange/40`}
    >
      {children}
    </button>
  );
}

function toneCls(tone: 'orange' | 'white' | 'red' | 'green'): string {
  if (tone === 'orange') return 'text-burst-orange-bright';
  if (tone === 'red') return 'text-red-400';
  if (tone === 'green') return 'text-green-400';
  return 'text-white';
}

function Row({
  icon,
  label,
  value,
  critical,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  critical?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-burst-muted">
      {icon}
      <span>{label}:</span>
      <span className={`ml-auto ${critical ? 'text-red-400 font-semibold' : 'text-white/80'}`}>
        {value}
      </span>
    </div>
  );
}

function formatRel(iso: string | null, dias: number | null): string {
  if (!iso) return 'nunca';
  if (dias === null) return new Date(iso).toLocaleDateString('pt-BR');
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} dias`;
}

function TrafegoChart({ serie }: { serie: TrafegoSaude['serie'] }) {
  // Formata label do eixo X: "12/05"
  const data = serie.map((p) => ({
    ...p,
    label: p.date.slice(8) + '/' + p.date.slice(5, 7),
  }));
  const total = serie.reduce((s, p) => s + p.leads + p.transferencias, 0);
  if (total === 0) {
    return (
      <div className="border-t border-burst-border pt-3">
        <div className="text-[10px] uppercase tracking-widest text-burst-muted mb-2">
          Cronologia — 30 dias
        </div>
        <div className="h-24 flex items-center justify-center text-xs text-burst-muted">
          sem leads no período
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
            <span className="w-2 h-2 rounded-full bg-burst-orange-bright" /> Leads
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-400" /> Transf.
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
              dataKey="leads"
              name="Leads"
              stroke="#FF8C00"
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="transferencias"
              name="Transferências"
              stroke="#22C55E"
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

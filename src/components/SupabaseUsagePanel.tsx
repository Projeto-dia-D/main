import { useState } from 'react';
import { Database, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useSupabaseUsage } from '../hooks/useSupabaseUsage';

// Limites do plano FREE do Supabase (Janeiro 2025).
// Se você está em plano pago, ajuste aqui.
const FREE_TIER_LIMITS = {
  database_mb: 500,          // 500 MB DB storage
  egress_gb: 5,              // 5 GB/mês egress (não monitoramos no client — info)
  realtime_concurrent: 200,  // 200 conexões realtime simultâneas
  monthly_active_users: 50_000,
  realtime_messages_per_month: 2_000_000,
};

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtRel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diffMin = (Date.now() - d.getTime()) / 60000;
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${Math.floor(diffMin)} min`;
  if (diffMin < 60 * 24) return `há ${Math.floor(diffMin / 60)} h`;
  return `há ${Math.floor(diffMin / 60 / 24)} dias`;
}

export function SupabaseUsagePanel() {
  const usage = useSupabaseUsage();
  const [expanded, setExpanded] = useState(true);

  const totalMB = usage.estimatedTotalBytes / 1024 / 1024;
  const pctOfLimit = (totalMB / FREE_TIER_LIMITS.database_mb) * 100;
  const alertLevel: 'ok' | 'warning' | 'critical' =
    pctOfLimit > 80 ? 'critical' : pctOfLimit > 50 ? 'warning' : 'ok';

  const alertColors = {
    ok: { bg: 'bg-green-500/10', border: 'border-green-500/40', text: 'text-green-400' },
    warning: { bg: 'bg-burst-warning/10', border: 'border-burst-warning/40', text: 'text-burst-warning' },
    critical: { bg: 'bg-red-500/10', border: 'border-red-500/40', text: 'text-red-400' },
  }[alertLevel];

  return (
    <section className="rounded-2xl bg-burst-card border border-burst-border p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Database className="text-burst-orange-bright" size={20} />
          <div>
            <h3 className="font-display text-xl text-white tracking-wide">Uso do Supabase</h3>
            <div className="text-[10px] text-burst-muted">
              {usage.lastUpdate ? `atualizado ${fmtRel(usage.lastUpdate.toISOString())}` : 'nunca atualizado'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={usage.refresh}
            disabled={usage.loading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-burst-border bg-black/30 hover:bg-black/50 text-burst-muted text-xs disabled:opacity-50"
          >
            <RefreshCw size={12} className={usage.loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 text-xs text-burst-muted hover:text-white"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </header>

      {/* Resumo: ocupação total + status do limite */}
      <div className={`rounded-xl border ${alertColors.border} ${alertColors.bg} p-4`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-burst-muted mb-1">
              Storage estimado (plano free: {FREE_TIER_LIMITS.database_mb} MB)
            </div>
            <div className="font-display text-3xl text-white">
              {fmtBytes(usage.estimatedTotalBytes)}
              <span className={`text-sm ml-2 ${alertColors.text}`}>
                ({pctOfLimit.toFixed(1)}% do limite)
              </span>
            </div>
            <div className="text-xs text-burst-muted mt-1">
              {usage.totalRows.toLocaleString('pt-BR')} linha(s) em {usage.tables.length} tabela(s)
            </div>
          </div>
          {alertLevel !== 'ok' && (
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${alertColors.bg} border ${alertColors.border}`}>
              <AlertTriangle size={14} className={alertColors.text} />
              <span className={`text-xs uppercase tracking-wider font-bold ${alertColors.text}`}>
                {alertLevel === 'critical' ? 'CRÍTICO' : 'ATENÇÃO'}
              </span>
            </div>
          )}
        </div>

        {/* Barra de progresso */}
        <div className="mt-3 h-2 rounded-full bg-black/40 overflow-hidden">
          <div
            className={`h-full transition-all ${
              alertLevel === 'critical' ? 'bg-red-400' :
              alertLevel === 'warning' ? 'bg-burst-warning' :
              'bg-green-400'
            }`}
            style={{ width: `${Math.min(100, pctOfLimit)}%` }}
          />
        </div>

        <div className="mt-2 text-[10px] text-burst-muted leading-relaxed">
          <strong className="text-white/80">Como esse número é calculado:</strong> linhas × bytes estimados por linha (média conservadora).
          O número real é visível em Supabase Dashboard → Settings → Usage. Este é só uma aproximação.
        </div>
      </div>

      {expanded && (
        <>
          {/* Lista de tabelas */}
          <div className="rounded-xl border border-burst-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-black/30 text-burst-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Tabela</th>
                  <th className="text-right px-3 py-2 font-semibold uppercase tracking-wider">Linhas</th>
                  <th className="text-right px-3 py-2 font-semibold uppercase tracking-wider">Tamanho est.</th>
                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Último sync</th>
                </tr>
              </thead>
              <tbody>
                {[...usage.tables]
                  .sort((a, b) => (b.estimatedBytes ?? 0) - (a.estimatedBytes ?? 0))
                  .map((t) => (
                  <tr key={t.table} className="border-t border-burst-border hover:bg-white/2">
                    <td className="px-3 py-2 font-mono text-white/90">{t.table}</td>
                    <td className="px-3 py-2 text-right text-white">
                      {t.error ? <span className="text-red-400">erro</span> : (t.rows ?? 0).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-3 py-2 text-right text-burst-muted">
                      {t.estimatedBytes !== null ? fmtBytes(t.estimatedBytes) : '—'}
                    </td>
                    <td className="px-3 py-2 text-burst-muted/80 text-[10px]">
                      {t.lastSyncAt ? fmtRel(t.lastSyncAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Outros limites do plano free */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <LimitBox
              label="Egress (download)"
              value="—"
              limit={`${FREE_TIER_LIMITS.egress_gb} GB / mês`}
              note="Monitor em Dashboard → Usage"
            />
            <LimitBox
              label="Realtime simultâneo"
              value="—"
              limit={`${FREE_TIER_LIMITS.realtime_concurrent} conexões`}
              note="Conta cada aba aberta"
            />
            <LimitBox
              label="Mensagens realtime"
              value="—"
              limit={`${(FREE_TIER_LIMITS.realtime_messages_per_month / 1_000_000).toFixed(0)} M / mês`}
              note="postgres_changes + broadcast"
            />
          </div>

          <a
            href="https://supabase.com/dashboard/project/_/settings/usage"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-burst-orange-bright hover:underline self-start"
          >
            <ExternalLink size={12} />
            Ver uso real no Supabase Dashboard
          </a>

          {/* Erro geral */}
          {usage.error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-400">
              {usage.error}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LimitBox({
  label,
  value,
  limit,
  note,
}: {
  label: string;
  value: string;
  limit: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg bg-black/30 border border-burst-border px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-burst-muted">{label}</div>
      <div className="font-display text-lg text-white">{value}</div>
      <div className="text-[10px] text-burst-muted">limite: {limit}</div>
      {note && <div className="text-[9px] text-burst-muted/60 italic mt-0.5">{note}</div>}
    </div>
  );
}

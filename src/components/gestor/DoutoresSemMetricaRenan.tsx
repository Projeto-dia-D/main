import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Link2, RotateCcw, ShieldAlert, EyeOff } from 'lucide-react';
import type { MondayClient } from '../../lib/monday';
import type { ClientMetaLink } from '../../lib/linkStorage';
import { useAdAccountsForGestor } from '../../hooks/useAdAccountsForGestor';

interface Props {
  /** Universo total de clientes do Monday (clientsAll). */
  allClients: MondayClient[];
  /** IDs dos clientes com Bia em fase "I.A ativa" (não churn / não parado). */
  biaActiveIds: Set<string>;
  /** Vínculos cliente Monday → conta Meta. */
  links: ClientMetaLink[];
  /** Abre o modal de Vinculações já filtrando os clientes sem conta (categoria B). */
  onVincular?: (clientIds: Set<string>) => void;
}

function normAcc(id: string | null | undefined): string {
  return (id || '').replace(/^act_/, '');
}

/**
 * PAINEL EXCLUSIVO (devs + Renan): doutores com Bia ATIVA cujas métricas de Meta
 * NÃO estão sendo puxadas com o token do Renan. Dois motivos:
 *   A) a conta existe (vinculada) mas o token do Renan NÃO tem acesso a ela;
 *   B) o doutor não tem NENHUMA conta Meta vinculada no sistema.
 * Recalcula ao vivo: Bia ativa (Monday) × contas acessíveis do Renan (Graph) × vínculos.
 */
export function DoutoresSemMetricaRenan({ allClients, biaActiveIds, links, onVincular }: Props) {
  const { accountsByGestor, loading, errors, load } = useAdAccountsForGestor();
  const [openA, setOpenA] = useState(true);
  const [openB, setOpenB] = useState(true);

  // Carrega as contas que o Renan acessa (uma vez).
  useEffect(() => { load('Renan'); }, [load]);

  const renanAccounts = accountsByGestor['Renan'] ?? [];
  const renanLoading = !!loading['Renan'];
  const renanError = errors['Renan'];
  const renanLoaded = renanAccounts.length > 0;

  const renanSet = useMemo(() => {
    const s = new Set<string>();
    for (const a of renanAccounts) {
      if (a.id) { s.add(a.id); s.add(normAcc(a.id)); }
      if (a.account_id) { s.add(a.account_id); s.add(`act_${a.account_id}`); }
    }
    return s;
  }, [renanAccounts]);

  const byClient = useMemo(() => {
    const m = new Map<string, ClientMetaLink>();
    for (const l of links) m.set(l.monday_client_id, l);
    return m;
  }, [links]);

  const ativos = useMemo(
    () => allClients.filter((c) => biaActiveIds.has(c.id)),
    [allClients, biaActiveIds]
  );

  // B) sem conta vinculada — independe do token do Renan
  const semConta = useMemo(
    () => ativos.filter((c) => !byClient.has(c.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [ativos, byClient]
  );

  // A) tem conta vinculada, mas o Renan não acessa — só computa após carregar contas
  const semAcesso = useMemo(() => {
    if (!renanLoaded) return [] as { client: MondayClient; link: ClientMetaLink }[];
    const out: { client: MondayClient; link: ClientMetaLink }[] = [];
    for (const c of ativos) {
      const link = byClient.get(c.id);
      if (!link) continue;
      const ok = renanSet.has(link.meta_account_id) || renanSet.has(normAcc(link.meta_account_id));
      if (!ok) out.push({ client: c, link });
    }
    return out.sort((a, b) => a.client.name.localeCompare(b.client.name));
  }, [ativos, byClient, renanSet, renanLoaded]);

  const totalProblema = semAcesso.length + semConta.length;

  return (
    <div className="rounded-2xl border-2 border-red-500/50 bg-red-500/[0.06] p-5 flex flex-col gap-4 shadow-[0_0_24px_rgba(239,68,68,0.15)]">
      {/* Cabeçalho */}
      <div className="flex items-start gap-3 flex-wrap">
        <ShieldAlert size={22} className="text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-display text-xl text-white tracking-wide flex items-center gap-2 flex-wrap">
            Métricas do Meta NÃO puxadas (acesso do Renan)
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-burst-muted px-2 py-0.5 rounded bg-black/40 border border-burst-border">
              <EyeOff size={11} /> só devs e Renan
            </span>
          </div>
          <p className="text-sm text-burst-muted mt-1">
            Só doutores com a <strong className="text-white/90">Bia rodando (Fase "I.A ativa")</strong> cujo gasto de Meta
            <strong className="text-white/90"> não entra nas métricas</strong> — ou o token do Renan não acessa a conta,
            ou não há conta vinculada. Recalculado ao vivo. <span className="text-white/70">≠ do banner "qualquer fase" acima.</span>
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-3xl font-display text-red-400 leading-none">{renanLoaded ? totalProblema : '…'}</div>
          <div className="text-[10px] uppercase tracking-widest text-burst-muted mt-1">de {ativos.length} ativos</div>
        </div>
      </div>

      {/* ===== A) Conta existe, Renan não acessa ===== */}
      <section className="rounded-xl border border-red-500/40 bg-black/30 overflow-hidden">
        <button
          onClick={() => setOpenA((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
        >
          <AlertTriangle size={16} className="text-red-400 shrink-0" />
          <span className="font-semibold text-white text-sm">
            Conta existe, mas o Renan NÃO acessa
            <span className="ml-2 text-red-400">{renanLoaded ? semAcesso.length : '…'}</span>
          </span>
          <span className="ml-auto text-[11px] text-burst-muted hidden sm:block">→ liberar acesso do Renan no Business Manager</span>
          {openA ? <ChevronUp size={15} className="text-burst-muted" /> : <ChevronDown size={15} className="text-burst-muted" />}
        </button>
        {openA && (
          <div className="px-4 pb-4">
            {renanError ? (
              <div className="flex items-center gap-3 text-sm text-red-400">
                <span>Erro carregando as contas do Renan: {renanError}</span>
                <button onClick={() => load('Renan', true)} className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-burst-border hover:bg-white/5 text-white">
                  <RotateCcw size={12} /> tentar de novo
                </button>
              </div>
            ) : !renanLoaded ? (
              <div className="flex items-center gap-2 text-sm text-burst-muted">
                <RotateCcw size={14} className="animate-spin" /> carregando as contas que o Renan acessa…
              </div>
            ) : semAcesso.length === 0 ? (
              <div className="text-sm text-green-400">Nenhuma — o Renan acessa todas as contas vinculadas. ✅</div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {semAcesso.map(({ client, link }) => (
                  <li key={client.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded bg-black/40 border border-burst-border text-sm">
                    <span className="text-white/95 truncate" title={client.name}>{client.name}</span>
                    <span className="text-[11px] text-burst-muted font-mono truncate max-w-[45%] text-right" title={link.meta_account_name ?? link.meta_account_id}>
                      {link.meta_account_name ?? link.meta_account_id}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ===== B) Sem conta Meta vinculada ===== */}
      <section className="rounded-xl border border-burst-warning/40 bg-black/30 overflow-hidden">
        <button
          onClick={() => setOpenB((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
        >
          <AlertTriangle size={16} className="text-burst-warning shrink-0" />
          <span className="font-semibold text-white text-sm">
            Sem conta Meta vinculada <span className="text-burst-muted font-normal">(só Bia rodando "I.A ativa")</span>
            <span className="ml-2 text-burst-warning">{semConta.length}</span>
          </span>
          {onVincular && semConta.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onVincular(new Set(semConta.map((c) => c.id))); }}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-burst-orange/20 border border-burst-orange/50 hover:bg-burst-orange/30 text-burst-orange-bright text-xs font-semibold transition-colors"
            >
              <Link2 size={12} /> Vincular
            </button>
          )}
          {openB ? <ChevronUp size={15} className="text-burst-muted ml-2" /> : <ChevronDown size={15} className="text-burst-muted ml-2" />}
        </button>
        {openB && (
          <div className="px-4 pb-4">
            {semConta.length === 0 ? (
              <div className="text-sm text-green-400">Nenhum — todos os doutores ativos têm conta vinculada. ✅</div>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {semConta.map((c) => (
                  <li key={c.id} className="px-3 py-2 rounded bg-black/40 border border-burst-border text-sm">
                    <div className="text-white/95 truncate" title={c.name}>{c.name}</div>
                    <div className="text-[10px] text-burst-muted truncate">
                      {c.gestor && <span>Gestor: {c.gestor}</span>}
                      {c.gestor && c.cs && <span> · </span>}
                      {c.cs && <span>CS: {c.cs}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

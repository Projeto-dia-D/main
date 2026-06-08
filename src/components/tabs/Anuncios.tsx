import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquareText, Search, AlertTriangle, ExternalLink, RefreshCw,
  Copy, Check, ChevronDown, ChevronUp, Loader2, Link2, X,
} from 'lucide-react';
import { useUser, hasFullAccess } from '../../lib/userContext';
import { useMondayClients } from '../../hooks/useMondayClients';
import { useMetaLinks } from '../../hooks/useMetaLinks';
import { useAdAccountsForGestor } from '../../hooks/useAdAccountsForGestor';
import { fetchAdsWithMessage, type AdWithMessage } from '../../lib/meta';
import type { MondayClient } from '../../lib/monday';
import { config } from '../../config';
import { SearchableAccountSelect } from '../gestor/SearchableAccountSelect';

/**
 * Aba "Anúncios" — ferramenta de dev/admin.
 *
 * Busca um doutor por nome (Monday), acha a conta Meta vinculada (client_meta_links)
 * e lista os anuncios ativos/pausados da conta, mostrando a "saudacao automatica"
 * (mensagem pre-preenchida do WhatsApp/Messenger que o lead manda ao clicar no
 * anuncio — "Olá, vi seu anúncio...").
 *
 * Util pra auditar o copy do click-to-WhatsApp sem precisar abrir o Ads Manager
 * conta por conta.
 *
 * Acesso: programador (qualquer) + admin/super (hasFullAccess).
 */
export function Anuncios() {
  const user = useUser();

  const isDev = hasFullAccess(user) || user.role === 'programador';
  if (!isDev) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-burst-orange/40 bg-burst-card p-8 max-w-2xl">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="text-burst-orange-bright" />
            <h2 className="font-display text-2xl text-white tracking-wider">Acesso restrito</h2>
          </div>
          <p className="text-sm text-burst-muted">
            Esta aba é exclusiva pra programadores e admins.
          </p>
        </div>
      </div>
    );
  }

  return <AnunciosInner />;
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function AnunciosInner() {
  // Usa clientsAll (lista TOTAL do board principal, sem filtro de grupo/tipo).
  // allClients excluiria churn/inativos e poderia deixar de fora doutores que
  // a gente queria auditar. Pra ferramenta de dev a lista mais completa e melhor.
  const { clientsAll, loading: mondayLoading } = useMondayClients();
  const { byClient: linkByClient, setLink } = useMetaLinks();
  const {
    allAccounts,
    load: loadGestor,
    loadedGestores,
  } = useAdAccountsForGestor();

  const [query, setQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<MondayClient | null>(null);
  const [ads, setAds] = useState<AdWithMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOnlyWhatsapp, setShowOnlyWhatsapp] = useState(true);
  const [linker, setLinker] = useState<{ open: boolean; saving: boolean; error: string | null }>({
    open: false,
    saving: false,
    error: null,
  });

  // Auto-carrega os 3 tokens no mount pra ja ter as contas disponiveis quando
  // o user abrir o vinculador (sem precisar clicar "Carregar Renan/Weslei/André").
  // Mesmo padrao do VinculacoesModal.
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    for (const acc of config.META_ACCOUNTS) {
      if (acc.token && !loadedGestores.includes(acc.gestor)) {
        loadGestor(acc.gestor).catch(() => { /* erro silencioso — UI mostra fallback */ });
      }
    }
  }, [loadedGestores, loadGestor]);

  // Busca acent-insensitive + multi-termo (igual ao select de contas).
  // 1 char ja conta — pra doutores de nome curto / pra ver quando ta digitando.
  const searchResults = useMemo(() => {
    const q = norm(query);
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    const matches = clientsAll.filter((c) => {
      const haystack = norm(`${c.name} ${c.groupTitle ?? ''} ${c.cs ?? ''} ${c.gestor ?? ''}`);
      return terms.every((t) => haystack.includes(t));
    });
    return matches.slice(0, 30);
  }, [clientsAll, query]);

  const selectedLink = selectedClient ? linkByClient.get(selectedClient.id) ?? null : null;

  async function loadAds(client: MondayClient) {
    setSelectedClient(client);
    setAds([]);
    setError(null);
    setQuery('');
    setLinker({ open: false, saving: false, error: null });
    const link = linkByClient.get(client.id);
    if (!link) {
      // Sem link — abre o vinculador inline em vez de mostrar um erro morto.
      setLinker({ open: true, saving: false, error: null });
      return;
    }
    setLoading(true);
    try {
      const result = await fetchAdsWithMessage(link.meta_account_id, link.gestor);
      setAds(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    if (selectedClient) await loadAds(selectedClient);
  }

  async function handlePickAccount(acc: { id: string; account_id: string; name: string; gestor: string }) {
    if (!selectedClient) return;
    setLinker({ open: true, saving: true, error: null });
    try {
      await setLink({
        monday_client_id: selectedClient.id,
        monday_client_name: selectedClient.name,
        meta_account_id: acc.id,
        meta_account_name: acc.name,
        gestor: acc.gestor,
      });
      setLinker({ open: false, saving: false, error: null });
      // Re-busca os ads agora que o vinculo existe
      setError(null);
      setLoading(true);
      try {
        const result = await fetchAdsWithMessage(acc.id, acc.gestor);
        setAds(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    } catch (e) {
      setLinker({ open: true, saving: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Filtro WhatsApp-only — agora baseado em PREFILL (ou CTA WHATSAPP_MESSAGE,
  // pra cobrir ads que sao click-to-WhatsApp mas sem prefill configurado).
  const adsToShow = useMemo(() => {
    if (!showOnlyWhatsapp) return ads;
    return ads.filter((a) => a.ctaType === 'WHATSAPP_MESSAGE' || a.prefill !== null);
  }, [ads, showOnlyWhatsapp]);

  const counts = useMemo(() => {
    const active = ads.filter((a) => a.effective_status === 'ACTIVE').length;
    const withPrefill = ads.filter((a) => a.prefill !== null).length;
    return { total: ads.length, active, withPrefill };
  }, [ads]);

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
      <header className="flex items-start gap-3 flex-wrap">
        <MessageSquareText className="text-burst-orange-bright mt-1" size={22} />
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-2xl text-white tracking-wider">
            Anúncios — Saudação automática
          </h2>
          <p className="text-sm text-burst-muted mt-1">
            Busca um doutor e lista a mensagem pré-preenchida do WhatsApp em cada anúncio.
            Útil pra auditar o copy do click-to-WhatsApp sem abrir o Ads Manager.
          </p>
        </div>
      </header>

      {/* Busca de doutor */}
      <section className="rounded-2xl bg-burst-card border border-burst-border p-5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[10px] uppercase tracking-widest text-burst-muted">
            1. Buscar doutor (Monday)
          </div>
          <div className="text-[10px] text-burst-muted">
            {mondayLoading && clientsAll.length === 0 ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" />
                Carregando lista do Monday...
              </span>
            ) : (
              <span>
                <span className="text-white font-mono">{clientsAll.length}</span> doutor(es) na base
              </span>
            )}
          </div>
        </div>
        <div className="relative">
          <div className="flex items-center gap-2 bg-black/40 border border-burst-border rounded-lg px-3 py-2.5">
            <Search size={16} className="text-burst-muted shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                clientsAll.length === 0
                  ? 'Aguardando dados do Monday carregarem...'
                  : 'Ex: "barbara guimaraes", "iris", "templare"...'
              }
              disabled={clientsAll.length === 0}
              className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted/70 disabled:opacity-50"
              autoFocus
            />
            {query && (
              <span className="text-xs text-burst-muted">{searchResults.length}</span>
            )}
          </div>

          {/* Hint quando digitou mas zero resultado e ja temos base carregada */}
          {query.length >= 2 && searchResults.length === 0 && clientsAll.length > 0 && (
            <div className="mt-2 text-[11px] text-burst-muted italic">
              Sem match em {clientsAll.length} doutor(es). Tenta menos termos ou outra variação.
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 max-h-[360px] overflow-y-auto bg-burst-panel border border-burst-border rounded-lg shadow-card scrollbar-thin">
              {searchResults.map((c) => {
                const link = linkByClient.get(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => loadAds(c)}
                    className="w-full text-left px-3 py-2.5 hover:bg-white/[0.04] border-b border-burst-border/40 last:border-b-0 flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{c.name}</div>
                      <div className="text-[10px] text-burst-muted truncate">
                        {c.gestor ? `gestor: ${c.gestor}` : 'sem gestor'}
                        {c.cs && ` · CS: ${c.cs}`}
                      </div>
                    </div>
                    {link ? (
                      <span className="text-[9px] uppercase tracking-wider font-bold text-green-400 bg-green-500/10 border border-green-500/30 px-1.5 py-0.5 rounded shrink-0">
                        com link
                      </span>
                    ) : (
                      <span className="text-[9px] uppercase tracking-wider font-bold text-burst-warning bg-burst-warning/10 border border-burst-warning/30 px-1.5 py-0.5 rounded shrink-0">
                        sem link
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Conta selecionada */}
      {selectedClient && (
        <section className="rounded-2xl bg-burst-card border border-burst-border p-5 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-burst-muted">
                Doutor
              </div>
              <h3 className="font-display text-xl text-white tracking-wide">
                {selectedClient.name}
              </h3>
              {selectedLink ? (
                <div className="text-xs text-burst-muted mt-1">
                  Conta Meta: <span className="text-white font-mono">{selectedLink.meta_account_id}</span>
                  {selectedLink.meta_account_name && (
                    <span> · {selectedLink.meta_account_name}</span>
                  )}
                  {selectedLink.gestor && (
                    <span> · token via {selectedLink.gestor}</span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-burst-warning mt-1">Sem conta Meta vinculada — vincule abaixo.</div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setLinker((p) => ({ ...p, open: !p.open, error: null }))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-burst-border bg-black/30 hover:bg-burst-orange/10 hover:border-burst-orange/50 text-burst-muted hover:text-burst-orange-bright text-xs transition-colors"
                title={selectedLink ? 'Trocar vinculo Meta' : 'Vincular conta Meta'}
              >
                <Link2 size={12} />
                {selectedLink ? 'Trocar vinculo' : 'Vincular conta'}
              </button>
              <button
                type="button"
                onClick={refresh}
                disabled={loading || !selectedLink}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-burst-border bg-black/30 hover:bg-black/50 text-burst-muted text-xs disabled:opacity-50"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                Atualizar
              </button>
            </div>
          </div>

          {/* Vinculador inline — aparece quando: sem link OU user clicou em "Trocar" */}
          {linker.open && (
            <div className="rounded-xl bg-black/30 border border-burst-orange/40 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Link2 size={14} className="text-burst-orange-bright" />
                <span className="text-[10px] uppercase tracking-widest text-burst-orange-bright font-bold">
                  {selectedLink ? 'Trocar vinculo Meta' : 'Vincular conta Meta'}
                </span>
                <button
                  type="button"
                  onClick={() => setLinker({ open: false, saving: false, error: null })}
                  className="ml-auto text-burst-muted hover:text-white"
                  title="Fechar"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="text-[11px] text-burst-muted">
                Escolha a conta Meta do <span className="text-white font-semibold">{selectedClient.name}</span>.
                Se ainda não souber qual é, abre o Ads Manager, copia o nome ou ID, e procura aqui.
              </div>
              {allAccounts.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-burst-muted">
                  <Loader2 size={12} className="animate-spin" />
                  Carregando contas Meta dos tokens (Renan/Weslei/André)...
                </div>
              ) : (
                <SearchableAccountSelect
                  value={selectedLink?.meta_account_id ?? null}
                  options={allAccounts}
                  onChange={(acc) => handlePickAccount(acc)}
                  onClear={() => { /* limpar nao se aplica aqui — pra desvincular, use a aba Gestor */ }}
                  disabled={linker.saving}
                  placeholder="Buscar conta Meta..."
                />
              )}
              {linker.saving && (
                <div className="flex items-center gap-2 text-[11px] text-burst-muted">
                  <Loader2 size={11} className="animate-spin" />
                  Salvando vínculo...
                </div>
              )}
              {linker.error && (
                <div className="text-[11px] text-red-400">Falhou: {linker.error}</div>
              )}
            </div>
          )}

          {/* Stats */}
          {ads.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <Stat label="Anúncios" value={String(counts.total)} tone="white" />
              <Stat label="Ativos agora" value={String(counts.active)} tone="green" />
              <Stat label="Com pré-preenchido" value={String(counts.withPrefill)} tone="orange" />
              <label className="ml-auto flex items-center gap-2 text-xs text-burst-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={showOnlyWhatsapp}
                  onChange={(e) => setShowOnlyWhatsapp(e.target.checked)}
                  className="accent-burst-orange"
                />
                Só click-to-WhatsApp
              </label>
            </div>
          )}

        </section>
      )}

      {/* Loading / Erro */}
      {loading && (
        <div className="rounded-2xl bg-burst-card border border-burst-border p-8 flex items-center justify-center gap-3">
          <Loader2 className="animate-spin text-burst-orange-bright" size={20} />
          <span className="text-sm text-burst-muted">Buscando anúncios na Meta...</span>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-2xl bg-red-500/10 border border-red-500/40 p-5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={18} />
            <div className="text-sm text-red-400">{error}</div>
          </div>
        </div>
      )}

      {/* Lista de ads */}
      {!loading && selectedClient && ads.length > 0 && (
        <section className="flex flex-col gap-3">
          {adsToShow.length === 0 ? (
            <div className="rounded-2xl bg-burst-card border border-burst-border p-8 text-center">
              <p className="text-sm text-burst-muted">
                Nenhum anúncio com mensagem pré-preenchida. Tente desmarcar o filtro.
              </p>
            </div>
          ) : (
            adsToShow.map((ad) => <AdCard key={ad.id} ad={ad} />)
          )}
        </section>
      )}

      {!loading && selectedClient && !error && ads.length === 0 && selectedLink && (
        <div className="rounded-2xl bg-burst-card border border-burst-border p-8 text-center">
          <p className="text-sm text-burst-muted">
            Nenhum anúncio encontrado nessa conta (ou só tem DELETED/ARCHIVED).
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'white' | 'green' | 'orange' }) {
  const cls =
    tone === 'green' ? 'text-green-400' :
    tone === 'orange' ? 'text-burst-orange-bright' :
    'text-white';
  return (
    <div className="rounded-lg bg-black/30 border border-burst-border px-3 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-burst-muted leading-tight">{label}</div>
      <div className={`font-display text-lg leading-none ${cls}`}>{value}</div>
    </div>
  );
}

function AdCard({ ad }: { ad: AdWithMessage }) {
  const [showRawJson, setShowRawJson] = useState(false);
  const [copied, setCopied] = useState(false);

  const statusColor =
    ad.effective_status === 'ACTIVE' ? 'text-green-400 bg-green-500/10 border-green-500/30' :
    ad.effective_status === 'PAUSED' || ad.effective_status === 'CAMPAIGN_PAUSED' || ad.effective_status === 'ADSET_PAUSED' ? 'text-burst-muted bg-black/30 border-burst-border' :
    ad.effective_status === 'DISAPPROVED' || ad.effective_status === 'WITH_ISSUES' ? 'text-red-400 bg-red-500/10 border-red-500/30' :
    'text-burst-warning bg-burst-warning/10 border-burst-warning/30';

  async function copyPrefill() {
    if (!ad.prefill) return;
    try {
      await navigator.clipboard.writeText(ad.prefill);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignora */
    }
  }

  const hasPostText = ad.postText !== null || ad.postTextVariants.length > 0;

  return (
    <div className="rounded-xl border border-burst-border bg-burst-card p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[9px] uppercase tracking-wider font-bold border px-1.5 py-0.5 rounded ${statusColor}`}>
              {ad.effective_status}
            </span>
            {ad.ctaType && (
              <span className="text-[9px] uppercase tracking-wider font-mono text-burst-muted">
                {ad.ctaType}
              </span>
            )}
            {ad.whatsappPhone && (
              <span className="text-[9px] font-mono text-burst-muted">
                → +{ad.whatsappPhone}
              </span>
            )}
          </div>
          <h4 className="text-sm text-white font-semibold leading-tight" title={ad.name}>
            {ad.name}
          </h4>
          <div className="text-[10px] text-burst-muted font-mono mt-0.5">id: {ad.id}</div>
        </div>
        <a
          href={ad.adsManagerUrl}
          target="_blank"
          rel="noreferrer"
          className="text-burst-muted hover:text-burst-orange-bright transition-colors shrink-0"
          title="Abrir no Ads Manager"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {/* MENSAGEM — "Olá, tenho interesse em..." (o que o lead manda ao clicar) */}
      {ad.prefill ? (
        <div className="rounded-lg bg-burst-orange/10 border border-burst-orange/40 p-3 relative">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquareText size={11} className="text-burst-orange-bright" />
            <span className="text-[9px] uppercase tracking-widest text-burst-orange-bright font-bold">
              Mensagem do anúncio
            </span>
            <button
              type="button"
              onClick={copyPrefill}
              className="ml-auto flex items-center gap-1 text-[10px] text-burst-muted hover:text-white"
              title="Copiar mensagem"
            >
              {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
              {copied ? 'copiado' : 'copiar'}
            </button>
          </div>
          <div className="text-sm text-white whitespace-pre-wrap break-words leading-relaxed">
            {ad.prefill}
          </div>
        </div>
      ) : (
        <div className="text-xs text-burst-muted italic">
          Não achei a mensagem. Abre o JSON cru pra ver onde tá.
        </div>
      )}

      {/* Toggle JSON cru — só pra debug quando a mensagem não bate */}
      <div>
        <button
          type="button"
          onClick={() => setShowRawJson((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-burst-muted/60 hover:text-white"
        >
          {showRawJson ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {showRawJson ? 'esconder' : 'ver'} JSON cru (debug)
        </button>
        {showRawJson && (
          <pre className="mt-2 rounded-lg bg-black/60 border border-burst-border p-3 text-[10px] text-burst-muted/90 font-mono overflow-x-auto max-h-[400px] overflow-y-auto scrollbar-thin">
            {JSON.stringify(ad.rawCreative, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

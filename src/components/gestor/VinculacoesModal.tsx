import { useMemo, useState } from 'react';
import { Search, Link2, X, AlertTriangle, Check, Download, Loader2, RefreshCw } from 'lucide-react';
import type { MondayClient } from '../../lib/monday';
import type { AdAccountInfo, GestorName } from '../../lib/meta';
import type { ClientMetaLink } from '../../lib/linkStorage';
import { SearchableAccountSelect } from './SearchableAccountSelect';
import { config, tokenFingerprint } from '../../config';

interface Props {
  clients: MondayClient[];
  loadedAccounts: AdAccountInfo[];
  accountsLoading: Record<string, boolean>;
  accountsErrors: Record<string, string>;
  loadedGestores: GestorName[];
  onLoadGestor: (gestor: GestorName, force?: boolean) => Promise<void>;
  links: ClientMetaLink[];
  onLink: (link: Omit<ClientMetaLink, 'updated_at'>) => Promise<void>;
  onUnlink: (mondayClientId: string) => Promise<void>;
}

export function VinculacoesModal({
  clients,
  loadedAccounts,
  accountsLoading,
  accountsErrors,
  loadedGestores,
  onLoadGestor,
  links,
  onLink,
  onUnlink,
}: Props) {
  const [query, setQuery] = useState('');
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);

  const linksByClient = useMemo(() => {
    const m = new Map<string, ClientMetaLink>();
    for (const l of links) m.set(l.monday_client_id, l);
    return m;
  }, [links]);

  const linkedAccountIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of links) s.add(l.meta_account_id);
    return s;
  }, [links]);

  const filteredClients = useMemo(() => {
    let list = [...clients].sort((a, b) => a.name.localeCompare(b.name));
    if (onlyUnlinked) list = list.filter((c) => !linksByClient.has(c.id));
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.gestor ?? '').toLowerCase().includes(q) ||
          (linksByClient.get(c.id)?.meta_account_name ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [clients, query, onlyUnlinked, linksByClient]);

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: carregar contas por gestor */}
      <div className="rounded-lg border border-burst-border bg-black/30 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Download size={14} className="text-burst-orange-bright" />
          <div className="text-[11px] uppercase tracking-widest text-burst-muted">
            Carregar contas do Meta
          </div>
          <span className="text-xs text-burst-muted ml-auto">
            {loadedAccounts.length} conta(s) na lista
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {config.META_ACCOUNTS.map((acc) => {
            const isLoaded = loadedGestores.includes(acc.gestor);
            const isLoading = accountsLoading[acc.gestor];
            const hasToken = !!acc.token;
            return (
              <button
                key={acc.gestor}
                onClick={() => onLoadGestor(acc.gestor, isLoaded)}
                disabled={!hasToken || isLoading}
                title={
                  !hasToken
                    ? `Token do ${acc.gestor} não configurado no .env`
                    : `Token: ${tokenFingerprint(acc.token)}${
                        acc.accountId ? ` • Account: ${acc.accountId}` : ''
                      }`
                }
                className={[
                  'flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm transition-colors',
                  !hasToken
                    ? 'border-burst-border bg-black/30 text-burst-muted/50 cursor-not-allowed'
                    : isLoaded
                    ? 'border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500/20'
                    : 'border-burst-orange/40 bg-burst-orange/10 text-burst-orange-bright hover:bg-burst-orange/20',
                  isLoading ? 'opacity-60' : '',
                ].join(' ')}
              >
                {isLoading ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : isLoaded ? (
                  <RefreshCw size={13} />
                ) : (
                  <Download size={13} />
                )}
                <span className="font-semibold">{acc.gestor}</span>
                {!hasToken && (
                  <span className="text-[10px] uppercase tracking-wider">sem token</span>
                )}
                {hasToken && (
                  <span className="text-[9px] font-mono text-burst-muted">
                    {tokenFingerprint(acc.token)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {Object.entries(accountsErrors).map(([gestor, msg]) => (
          <div key={gestor} className="mt-2 text-xs text-red-400">
            <span className="font-semibold">{gestor}:</span> {msg}
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[280px] flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2">
          <Search size={14} className="text-burst-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente, gestor ou conta vinculada..."
            className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
          />
        </div>
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-burst-border bg-black/30 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyUnlinked}
            onChange={(e) => setOnlyUnlinked(e.target.checked)}
            className="accent-burst-orange"
          />
          <span className="text-xs text-white">Só não vinculados</span>
        </label>
        <div className="px-3 py-2 rounded-lg border border-burst-orange/30 bg-burst-orange/10">
          <div className="text-[10px] uppercase tracking-wider text-burst-muted">Vinculados</div>
          <div className="font-display text-lg text-burst-orange-bright">
            {links.length} / {clients.length}
          </div>
        </div>
      </div>

      {loadedAccounts.length === 0 && (
        <div className="rounded-lg border border-burst-warning/40 bg-burst-warning/5 p-3 flex items-center gap-2 text-sm">
          <AlertTriangle size={16} className="text-burst-warning shrink-0" />
          <span className="text-burst-warning">
            Carregue pelo menos um gestor acima pra começar a vincular.
          </span>
        </div>
      )}

      {/* Tabela */}
      <div className="overflow-x-auto rounded-lg border border-burst-border max-h-[55vh] overflow-y-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="bg-black/40 text-[10px] uppercase tracking-widest text-burst-muted sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Cliente (Monday)</th>
              <th className="text-left px-3 py-2 font-semibold">Gestor</th>
              <th className="text-left px-3 py-2 font-semibold w-[40%]">Conta de anúncios</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Ação</th>
            </tr>
          </thead>
          <tbody>
            {filteredClients.map((c) => (
              <Row
                key={c.id}
                client={c}
                currentLink={linksByClient.get(c.id) ?? null}
                loadedAccounts={loadedAccounts}
                linkedAccountIds={linkedAccountIds}
                linksByClient={linksByClient}
                onLink={onLink}
                onUnlink={onUnlink}
              />
            ))}
            {filteredClients.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-burst-muted text-sm">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface RowProps {
  client: MondayClient;
  currentLink: ClientMetaLink | null;
  loadedAccounts: AdAccountInfo[];
  linkedAccountIds: Set<string>;
  linksByClient: Map<string, ClientMetaLink>;
  onLink: (link: Omit<ClientMetaLink, 'updated_at'>) => Promise<void>;
  onUnlink: (mondayClientId: string) => Promise<void>;
}

function Row({
  client,
  currentLink,
  loadedAccounts,
  linkedAccountIds,
  linksByClient,
  onLink,
  onUnlink,
}: RowProps) {
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Opções: contas carregadas + a já vinculada (mesmo se de um gestor não carregado)
  const options = useMemo<AdAccountInfo[]>(() => {
    const out = [...loadedAccounts];
    if (currentLink) {
      const alreadyIn = out.find((a) => a.id === currentLink.meta_account_id);
      if (!alreadyIn) {
        // Inclui a conta vinculada mesmo sem ter sido recarregada
        out.push({
          id: currentLink.meta_account_id,
          account_id: currentLink.meta_account_id.replace(/^act_/, ''),
          name: currentLink.meta_account_name ?? currentLink.meta_account_id,
          gestor: (currentLink.gestor ?? 'desconhecido') as AdAccountInfo['gestor'],
        });
      }
    }
    return out;
  }, [loadedAccounts, currentLink]);

  async function flash() {
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1200);
  }

  async function handleSelect(acc: AdAccountInfo) {
    if (saving) return;
    const conflict = Array.from(linksByClient.values()).find(
      (l) => l.meta_account_id === acc.id && l.monday_client_id !== client.id
    );
    if (conflict) {
      const ok = window.confirm(
        `A conta "${acc.name}" já está vinculada a "${conflict.monday_client_name}". Mover para "${client.name}"?`
      );
      if (!ok) return;
      setSaving(true);
      try {
        await onUnlink(conflict.monday_client_id);
        await onLink({
          monday_client_id: client.id,
          monday_client_name: client.name,
          meta_account_id: acc.id,
          meta_account_name: acc.name,
          gestor: acc.gestor,
        });
        flash();
      } catch (e) {
        alert(`Erro: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      await onLink({
        monday_client_id: client.id,
        monday_client_name: client.name,
        meta_account_id: acc.id,
        meta_account_name: acc.name,
        gestor: acc.gestor,
      });
      flash();
    } catch (e) {
      alert(`Erro: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!currentLink || saving) return;
    setSaving(true);
    try {
      await onUnlink(client.id);
      flash();
    } catch (e) {
      alert(`Erro: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const isLinked = Boolean(currentLink);

  return (
    <tr
      className={[
        'border-t border-burst-border hover:bg-white/[0.02] transition-colors',
        justSaved ? 'bg-green-500/10' : '',
      ].join(' ')}
    >
      <td className="px-3 py-2 text-white font-semibold align-top">
        <div className="flex items-center gap-2">
          <Link2
            size={13}
            className={isLinked ? 'text-green-400 shrink-0' : 'text-burst-muted/40 shrink-0'}
          />
          <span>{client.name}</span>
        </div>
        <div className="text-[10px] font-mono text-burst-muted/60 mt-0.5">
          id: {client.id}
        </div>
      </td>
      <td className="px-3 py-2 text-white/85 text-xs align-top">
        {client.gestor ?? <span className="text-burst-muted/60 italic">—</span>}
      </td>
      <td className="px-3 py-2 align-top">
        <SearchableAccountSelect
          value={currentLink?.meta_account_id ?? null}
          options={options.map((o) => ({
            ...o,
            name: linkedAccountIds.has(o.id) && o.id !== currentLink?.meta_account_id
              ? `• ${o.name} (vinculada)`
              : o.name,
          }))}
          onChange={handleSelect}
          onClear={handleClear}
          disabled={saving || options.length === 0}
          placeholder={options.length === 0 ? 'carregue um gestor' : 'selecionar...'}
        />
      </td>
      <td className="px-3 py-2 text-right align-top">
        {isLinked ? (
          <button
            onClick={handleClear}
            disabled={saving}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] uppercase tracking-wider text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            title="Remover vínculo"
          >
            <X size={12} /> Limpar
          </button>
        ) : justSaved ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-green-400">
            <Check size={12} /> salvo
          </span>
        ) : (
          <span className="text-[10px] text-burst-muted/60">—</span>
        )}
      </td>
    </tr>
  );
}

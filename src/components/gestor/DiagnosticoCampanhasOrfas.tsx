import { useMemo, useState } from 'react';
import { Megaphone, ChevronDown, ChevronUp, Search, Check } from 'lucide-react';
import type { CampaignInsight } from '../../lib/meta';
import type { MondayClient } from '../../lib/monday';
import type { ClientMetaLink } from '../../lib/linkStorage';
import { brl } from '../../lib/gestorMetrics';
import { SearchableClientSelect } from './SearchableClientSelect';

interface Props {
  campaigns: CampaignInsight[];
  mondayClients: MondayClient[];
  linksByAccount: Map<string, ClientMetaLink>;
  onLink: (link: Omit<ClientMetaLink, 'updated_at'>) => Promise<void>;
  onUnlink: (mondayClientId: string) => Promise<void>;
}

interface AccountGroup {
  accountId: string;
  accountName: string;
  gestor: string;
  totalSpend: number;
  campaigns: CampaignInsight[];
}

function buildGroups(campaigns: CampaignInsight[]): AccountGroup[] {
  const map = new Map<string, AccountGroup>();
  for (const c of campaigns) {
    const k = c.accountId;
    const g = map.get(k);
    if (g) {
      g.totalSpend += c.spend;
      g.campaigns.push(c);
    } else {
      map.set(k, {
        accountId: c.accountId,
        accountName: c.accountName,
        gestor: c.gestor,
        totalSpend: c.spend,
        campaigns: [c],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalSpend - a.totalSpend);
}

export function DiagnosticoCampanhasOrfas({
  campaigns,
  mondayClients,
  linksByAccount,
  onLink,
  onUnlink,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => buildGroups(campaigns), [campaigns]);
  const filtered = useMemo(() => {
    if (!query.trim()) return groups;
    const q = query.toLowerCase();
    return groups.filter(
      (g) =>
        g.accountName.toLowerCase().includes(q) ||
        g.accountId.toLowerCase().includes(q) ||
        g.gestor.toLowerCase().includes(q) ||
        g.campaigns.some((c) => c.campaign_name.toLowerCase().includes(q))
    );
  }, [groups, query]);

  const totalSpend = groups.reduce((s, g) => s + g.totalSpend, 0);

  if (campaigns.length === 0) return null;

  return (
    <section className="rounded-2xl bg-burst-card border border-burst-warning/40 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-6 py-4 hover:bg-white/[0.03] transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-lg bg-burst-warning/15 text-burst-warning flex items-center justify-center shrink-0">
          <Megaphone size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-lg text-white tracking-wide">
            Campanhas Fim/Venda sem cliente
          </div>
          <div className="text-xs text-burst-muted mt-0.5">
            <span className="text-burst-warning font-semibold">{campaigns.length}</span> campanha(s){' '}
            de <span className="text-burst-warning font-semibold">{groups.length}</span> conta(s) Meta{' '}
            • spend não atribuído:{' '}
            <span className="text-burst-warning font-semibold">{brl(totalSpend)}</span>
          </div>
        </div>
        <span className="text-burst-muted">
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-burst-warning/30 p-4">
          <p className="text-xs text-burst-muted mb-3">
            Estas campanhas seguem o padrão de nome de Fim/Venda mas nenhum cliente do Monday foi
            casado. Selecione abaixo um cliente Monday para vincular à <strong className="text-white">conta de anúncios</strong> —
            ao salvar, todas as campanhas dessa conta passam a contar pro gestor/CS do cliente.
          </p>

          <div className="flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2 mb-3">
            <Search size={14} className="text-burst-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar por conta, gestor ou nome de campanha..."
              className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
            />
            <span className="text-xs text-burst-muted">
              {filtered.length} / {groups.length}
            </span>
          </div>

          <div className="flex flex-col gap-3 max-h-[600px] overflow-y-auto scrollbar-thin pr-1">
            {filtered.map((g) => (
              <AccountBlock
                key={g.accountId}
                group={g}
                currentLink={linksByAccount.get(g.accountId) ?? null}
                mondayClients={mondayClients}
                onLink={onLink}
                onUnlink={onUnlink}
              />
            ))}
            {filtered.length === 0 && (
              <div className="text-burst-muted text-sm text-center py-6">
                Nenhuma conta corresponde à busca.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function AccountBlock({
  group,
  currentLink,
  mondayClients,
  onLink,
  onUnlink,
}: {
  group: AccountGroup;
  currentLink: ClientMetaLink | null;
  mondayClients: MondayClient[];
  onLink: (link: Omit<ClientMetaLink, 'updated_at'>) => Promise<void>;
  onUnlink: (mondayClientId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  async function handleSelect(cli: MondayClient) {
    if (saving) return;
    setSaving(true);
    try {
      await onLink({
        monday_client_id: cli.id,
        monday_client_name: cli.name,
        meta_account_id: group.accountId,
        meta_account_name: group.accountName,
        gestor: group.gestor,
      });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } catch (e) {
      alert(`Erro ao vincular: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!currentLink || saving) return;
    setSaving(true);
    try {
      await onUnlink(currentLink.monday_client_id);
    } catch (e) {
      alert(`Erro ao desvincular: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={[
        'rounded-xl border bg-black/40 p-4 flex flex-col gap-3 transition-colors',
        justSaved ? 'border-green-500/40 bg-green-500/10' : 'border-burst-border',
      ].join(' ')}
    >
      {/* Cabeçalho do bloco */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-white text-sm">
              {group.accountName || group.accountId}
            </span>
            {justSaved && <Check size={14} className="text-green-400 shrink-0" />}
            <span className="text-[10px] uppercase tracking-wider text-burst-muted px-2 py-0.5 rounded bg-white/5">
              {group.gestor}
            </span>
          </div>
          <div className="text-[11px] text-burst-muted font-mono break-all">
            {group.accountId}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-display text-lg text-burst-warning leading-tight">
            {brl(group.totalSpend)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-burst-muted">
            {group.campaigns.length} camp.
          </div>
        </div>
      </div>

      {/* Dropdown de vínculo */}
      <SearchableClientSelect
        value={currentLink?.monday_client_id ?? null}
        options={mondayClients}
        onChange={handleSelect}
        onClear={handleClear}
        disabled={saving}
        placeholder="Vincular esta conta a um cliente Monday"
      />

      {/* Toggle de campanhas */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-[11px] text-burst-muted hover:text-white transition-colors flex items-center justify-center gap-2 py-1"
      >
        <span>
          {open ? 'Esconder' : 'Ver'} {group.campaigns.length} campanha
          {group.campaigns.length !== 1 ? 's' : ''}
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div className="rounded-lg border border-burst-border bg-black/30 max-h-60 overflow-y-auto scrollbar-thin">
          <table className="w-full text-xs">
            <tbody>
              {group.campaigns.map((c) => (
                <tr key={c.campaign_id} className="border-b border-burst-border/50 last:border-0">
                  <td className="px-3 py-1.5 text-white/85">
                    {c.campaign_name}
                  </td>
                  <td className="px-3 py-1.5 text-right text-burst-warning font-mono whitespace-nowrap">
                    {brl(c.spend)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

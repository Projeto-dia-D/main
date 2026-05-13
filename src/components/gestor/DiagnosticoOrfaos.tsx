import { useMemo, useState } from 'react';
import { AlertOctagon, ChevronDown, ChevronUp, Search, Database, Check } from 'lucide-react';
import type { OrfaoTransferencia } from '../../lib/gestorMetrics';
import type { MondayClient } from '../../lib/monday';
import type { DoutorClientLink } from '../../lib/linkStorage';
import { SearchableClientSelect } from './SearchableClientSelect';

interface Props {
  orfaos: OrfaoTransferencia[];
  totalTransferenciasMapeadas: number;
  mondayClients: MondayClient[];
  linksByDoutor: Map<string, DoutorClientLink>;
  onLink: (link: Omit<DoutorClientLink, 'updated_at'>) => Promise<void>;
  onUnlink: (doutorName: string) => Promise<void>;
  missingTable: boolean;
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function DiagnosticoOrfaos({
  orfaos,
  totalTransferenciasMapeadas,
  mondayClients,
  linksByDoutor,
  onLink,
  onUnlink,
  missingTable,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const totalOrfaos = orfaos.reduce((s, o) => s + o.transferencias, 0);
  const filtered = useMemo(() => {
    if (!query.trim()) return orfaos;
    const q = query.toLowerCase();
    return orfaos.filter((o) => o.doutor.toLowerCase().includes(q));
  }, [orfaos, query]);

  if (orfaos.length === 0) return null;

  return (
    <section className="rounded-2xl bg-burst-card border border-burst-warning/40 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-6 py-4 hover:bg-white/[0.03] transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-lg bg-burst-warning/15 text-burst-warning flex items-center justify-center shrink-0">
          <AlertOctagon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-lg text-white tracking-wide">
            Transferências sem cliente Monday
          </div>
          <div className="text-xs text-burst-muted mt-0.5">
            <span className="text-burst-warning font-semibold">{totalOrfaos}</span> transferências
            de <span className="text-burst-warning font-semibold">{orfaos.length}</span> doutor(es)
            não casam com nenhum cliente Monday — total Gestor ({totalTransferenciasMapeadas}) é
            menor que Programação ({totalOrfaos + totalTransferenciasMapeadas}).
          </div>
        </div>
        <span className="text-burst-muted">
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-burst-warning/30 p-4">
          {missingTable && (
            <div className="rounded-lg border border-burst-orange/50 bg-burst-orange/5 p-3 mb-3 flex items-start gap-2">
              <Database size={16} className="text-burst-orange-bright shrink-0 mt-0.5" />
              <div className="text-xs text-burst-muted">
                Tabela <code className="text-burst-orange-bright">doutor_client_links</code> não
                existe — rode o SQL em <code className="text-white">db/doutor_client_links.sql</code> no Supabase pra habilitar a vinculação manual.
                Enquanto isso, a coluna "Vincular a" abaixo fica desabilitada.
              </div>
            </div>
          )}

          <p className="text-xs text-burst-muted mb-3">
            Estes doutores têm leads no Supabase mas nenhum cliente Monday casou (nem por token
            uazapi, nem por substring de nome). Use a coluna <strong className="text-white">Vincular a</strong> abaixo pra associar
            manualmente — a partir do vínculo, as transferências passam a contar pro gestor/CS daquele cliente Monday.
          </p>

          <div className="flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2 mb-3">
            <Search size={14} className="text-burst-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar doutor..."
              className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
            />
            <span className="text-xs text-burst-muted">
              {filtered.length} / {orfaos.length}
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-burst-border max-h-[500px] overflow-y-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead className="bg-black/40 text-[10px] uppercase tracking-widest text-burst-muted sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Doutor (Supabase)</th>
                  <th className="text-right px-3 py-2 font-semibold">Leads</th>
                  <th className="text-right px-3 py-2 font-semibold">Transf.</th>
                  <th className="text-left px-3 py-2 font-semibold">Último lead</th>
                  <th className="text-left px-3 py-2 font-semibold w-[36%]">Vincular a</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <Row
                    key={o.doutor}
                    orfao={o}
                    currentLink={linksByDoutor.get(o.doutor) ?? null}
                    mondayClients={mondayClients}
                    onLink={onLink}
                    onUnlink={onUnlink}
                    disabled={missingTable}
                  />
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-burst-muted text-xs">
                      Nenhum doutor encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function Row({
  orfao,
  currentLink,
  mondayClients,
  onLink,
  onUnlink,
  disabled,
}: {
  orfao: OrfaoTransferencia;
  currentLink: DoutorClientLink | null;
  mondayClients: MondayClient[];
  onLink: (link: Omit<DoutorClientLink, 'updated_at'>) => Promise<void>;
  onUnlink: (doutorName: string) => Promise<void>;
  disabled: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  async function flash() {
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1200);
  }

  async function handleSelect(cli: MondayClient) {
    if (saving) return;
    setSaving(true);
    try {
      await onLink({
        doutor_name: orfao.doutor,
        monday_client_id: cli.id,
        monday_client_name: cli.name,
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
      await onUnlink(orfao.doutor);
      flash();
    } catch (e) {
      alert(`Erro: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr
      className={[
        'border-t border-burst-border hover:bg-white/[0.02]',
        justSaved ? 'bg-green-500/10' : '',
      ].join(' ')}
    >
      <td className="px-3 py-2 text-white font-semibold align-top">
        <div className="flex items-center gap-2">
          <span>{orfao.doutor}</span>
          {justSaved && <Check size={12} className="text-green-400" />}
        </div>
      </td>
      <td className="px-3 py-2 text-right text-white/90 font-mono align-top">
        {orfao.totalLeads}
      </td>
      <td className="px-3 py-2 text-right text-burst-warning font-mono font-semibold align-top">
        {orfao.transferencias}
      </td>
      <td className="px-3 py-2 text-burst-muted text-xs whitespace-nowrap align-top">
        {fmt(orfao.ultimoLead)}
      </td>
      <td className="px-3 py-2 align-top">
        <SearchableClientSelect
          value={currentLink?.monday_client_id ?? null}
          options={mondayClients}
          onChange={handleSelect}
          onClear={handleClear}
          disabled={saving || disabled}
          placeholder={disabled ? 'Crie a tabela primeiro' : 'Vincular a cliente Monday'}
        />
      </td>
    </tr>
  );
}

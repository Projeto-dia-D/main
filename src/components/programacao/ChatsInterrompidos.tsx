import { useMemo, useState } from 'react';
import { PhoneOff, Search, ChevronDown, ChevronUp, User } from 'lucide-react';
import type { RelatorioBias } from '../../lib/types';

interface Props {
  leads: RelatorioBias[];
}

interface ClienteRow {
  telefone: string;
  nome: string | null;
  quantidade: number;
  ultimoCadastro: string;
}

interface DoutorGroup {
  doutor: string;
  totalChats: number;
  clientes: ClienteRow[];
}

function formatPhone(t: string): string {
  return t.replace('@s.whatsapp.net', '');
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

function buildGroups(leads: RelatorioBias[]): DoutorGroup[] {
  const byDoutor = new Map<string, RelatorioBias[]>();

  for (const l of leads) {
    const key = l.nomeDoutor?.trim() || '(sem doutor)';
    const arr = byDoutor.get(key) ?? [];
    arr.push(l);
    byDoutor.set(key, arr);
  }

  const groups: DoutorGroup[] = [];
  for (const [doutor, dleads] of byDoutor) {
    const clienteMap = new Map<string, ClienteRow>();
    for (const l of dleads) {
      const tel = formatPhone(l.telefone);
      const existing = clienteMap.get(tel);
      if (!existing) {
        clienteMap.set(tel, {
          telefone: tel,
          nome: l.senderName,
          quantidade: 1,
          ultimoCadastro: l.dataCadastro,
        });
      } else {
        existing.quantidade += 1;
        if (new Date(l.dataCadastro) > new Date(existing.ultimoCadastro)) {
          existing.ultimoCadastro = l.dataCadastro;
          existing.nome = l.senderName ?? existing.nome;
        }
      }
    }
    groups.push({
      doutor,
      totalChats: dleads.length,
      clientes: Array.from(clienteMap.values()).sort((a, b) => b.quantidade - a.quantidade),
    });
  }

  return groups.sort((a, b) => b.totalChats - a.totalChats);
}

function DoutorBlock({ group, query }: { group: DoutorGroup; query: string }) {
  const [open, setOpen] = useState(true);

  const clientes = useMemo(() => {
    if (!query.trim()) return group.clientes;
    const q = query.toLowerCase();
    return group.clientes.filter(
      (c) =>
        c.telefone.toLowerCase().includes(q) ||
        (c.nome ?? '').toLowerCase().includes(q)
    );
  }, [group.clientes, query]);

  const semDoutor = group.doutor === '(sem doutor)';

  return (
    <div className="rounded-xl border border-burst-border bg-black/20 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center shrink-0">
          <User size={15} />
        </div>
        <span className={`font-display text-base tracking-wide ${semDoutor ? 'text-burst-muted italic' : 'text-white'}`}>
          {group.doutor}
        </span>
        <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-bold">
          {group.totalChats} chat{group.totalChats !== 1 ? 's' : ''}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-burst-muted">
          {group.clientes.length} cliente{group.clientes.length !== 1 ? 's' : ''}
        </span>
        <span className="ml-auto text-burst-muted">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-burst-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black/30 text-[10px] uppercase tracking-widest text-burst-muted">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Telefone</th>
                <th className="text-left px-4 py-2 font-semibold">Nome</th>
                <th className="text-center px-4 py-2 font-semibold">Chats</th>
                <th className="text-left px-4 py-2 font-semibold">Último contato</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.telefone} className="border-t border-burst-border/50 hover:bg-white/[0.02]">
                  <td className="px-4 py-2 font-mono text-xs text-white/90">{c.telefone}</td>
                  <td className="px-4 py-2 text-white/80 max-w-[200px] truncate">
                    {c.nome || <span className="text-burst-muted/60 italic text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span
                      className={[
                        'inline-flex items-center justify-center w-7 h-7 rounded-full font-display text-sm font-bold',
                        c.quantidade > 1 ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-burst-muted',
                      ].join(' ')}
                    >
                      {c.quantidade}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-burst-muted text-xs whitespace-nowrap">
                    {fmt(c.ultimoCadastro)}
                  </td>
                </tr>
              ))}
              {clientes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-burst-muted text-xs">
                    Nenhum cliente corresponde à busca.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ChatsInterrompidos({ leads }: Props) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(true);

  const groups = useMemo(() => buildGroups(leads), [leads]);

  const totalClientes = useMemo(
    () => new Set(leads.map((l) => formatPhone(l.telefone))).size,
    [leads]
  );

  if (leads.length === 0) return null;

  return (
    <section className="rounded-2xl bg-burst-card border border-red-500/40 p-6">
      <div className="flex items-center gap-2 mb-4">
        <PhoneOff className="text-red-400" size={20} />
        <h3 className="font-display text-xl tracking-wider text-white">
          Chats Interrompidos
        </h3>
        <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-bold">
          {leads.length} chat{leads.length !== 1 ? 's' : ''}
        </span>
        <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-white/5 text-burst-muted">
          {totalClientes} cliente{totalClientes !== 1 ? 's' : ''}
        </span>
        <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-white/5 text-burst-muted">
          {groups.length} doutor{groups.length !== 1 ? 'es' : ''}
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-burst-muted hover:text-white transition-colors"
        >
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>

      {expanded && (
        <>
          <div className="flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2 mb-4">
            <Search size={14} className="text-burst-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar clientes por telefone ou nome..."
              className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted"
            />
          </div>

          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <DoutorBlock key={g.doutor} group={g} query={query} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Database } from 'lucide-react';
import type { AdAccountInfo } from '../../lib/meta';

interface Props {
  adAccounts: AdAccountInfo[];
}

export function ContasMetaDetectadas({ adAccounts }: Props) {
  const [open, setOpen] = useState(false);

  const byGestor = useMemo(() => {
    const map = new Map<string, AdAccountInfo[]>();
    for (const a of adAccounts) {
      const arr = map.get(a.gestor) ?? [];
      arr.push(a);
      map.set(a.gestor, arr);
    }
    return Array.from(map.entries()).map(([gestor, accs]) => ({
      gestor,
      accs: accs.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [adAccounts]);

  if (adAccounts.length === 0) return null;

  return (
    <section className="rounded-xl bg-burst-card border border-burst-border overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-lg bg-burst-orange/15 text-burst-orange-bright flex items-center justify-center shrink-0">
          <Database size={17} />
        </div>
        <div className="flex-1">
          <div className="font-display text-lg text-white tracking-wide">
            Contas Meta detectadas
          </div>
          <div className="text-xs text-burst-muted">
            {adAccounts.length} conta(s) de anúncios em {byGestor.length} token(s)
          </div>
        </div>
        <span className="text-burst-muted">
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-burst-border p-4 space-y-3">
          {byGestor.map((g) => (
            <div key={g.gestor} className="rounded-lg bg-black/30 border border-burst-border p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs uppercase tracking-widest text-burst-orange-bright font-bold">
                  {g.gestor}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-burst-muted">
                  {g.accs.length} conta(s)
                </span>
              </div>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {g.accs.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded bg-black/30"
                  >
                    <span className="text-white/90 truncate">{a.name}</span>
                    <span className="font-mono text-[10px] text-burst-muted shrink-0">
                      {a.account_id}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

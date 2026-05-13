import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown, X, Check } from 'lucide-react';
import type { AdAccountInfo } from '../../lib/meta';

interface Props {
  value: string | null; // meta_account_id selecionado
  options: AdAccountInfo[];
  onChange: (acc: AdAccountInfo) => void;
  onClear: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function SearchableAccountSelect({
  value,
  options,
  onChange,
  onClear,
  disabled,
  placeholder = 'Selecionar conta',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  // click-outside fecha
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      // foca o input ao abrir
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.gestor.toLowerCase().includes(q) ||
        o.account_id.toLowerCase().includes(q)
    );
  }, [options, query]);

  // Agrupa por gestor pra mostrar de forma organizada na lista
  const grouped = useMemo(() => {
    const m = new Map<string, AdAccountInfo[]>();
    for (const o of filtered) {
      const arr = m.get(o.gestor) ?? [];
      arr.push(o);
      m.set(o.gestor, arr);
    }
    return Array.from(m.entries()).map(([gestor, accs]) => ({
      gestor,
      accs: accs.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [filtered]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={[
          'w-full flex items-center gap-2 px-2 py-1.5 rounded border text-xs text-left transition-colors',
          'bg-black/40 border-burst-border hover:border-burst-orange/50',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          open ? 'border-burst-orange' : '',
        ].join(' ')}
      >
        <span className="flex-1 min-w-0 truncate">
          {current ? (
            <>
              <span className="text-white">{current.name}</span>
              <span className="text-burst-muted ml-1.5 font-mono">({current.gestor})</span>
            </>
          ) : (
            <span className="text-burst-muted italic">{placeholder}</span>
          )}
        </span>
        {current && (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="text-burst-muted hover:text-red-400 transition-colors shrink-0"
            title="Limpar"
          >
            <X size={12} />
          </span>
        )}
        <ChevronDown size={12} className="text-burst-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 right-0 min-w-[280px] bg-burst-panel border border-burst-border rounded-lg shadow-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-burst-border bg-black/40">
            <Search size={13} className="text-burst-muted shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar conta..."
              className="bg-transparent border-none outline-none text-xs text-white flex-1 placeholder:text-burst-muted"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-burst-muted hover:text-white"
                type="button"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto scrollbar-thin">
            {grouped.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-burst-muted">
                {options.length === 0
                  ? 'Carregue um gestor primeiro pra ver as contas.'
                  : 'Nenhuma conta encontrada com esse texto.'}
              </div>
            ) : (
              grouped.map((g) => (
                <div key={g.gestor}>
                  <div className="px-3 py-1 text-[9px] uppercase tracking-widest text-burst-orange-bright/80 bg-black/30 sticky top-0">
                    {g.gestor}
                  </div>
                  <ul>
                    {g.accs.map((acc) => {
                      const isSelected = acc.id === value;
                      return (
                        <li key={acc.id}>
                          <button
                            type="button"
                            onClick={() => {
                              onChange(acc);
                              setOpen(false);
                            }}
                            className={[
                              'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                              isSelected
                                ? 'bg-burst-orange/15 text-burst-orange-bright'
                                : 'text-white hover:bg-white/[0.04]',
                            ].join(' ')}
                          >
                            <span className="flex-1 truncate">{acc.name}</span>
                            <span className="text-[10px] text-burst-muted font-mono">
                              {acc.account_id}
                            </span>
                            {isSelected && <Check size={12} className="text-burst-orange-bright" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

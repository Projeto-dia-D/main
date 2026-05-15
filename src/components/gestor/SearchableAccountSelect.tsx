import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

const DROPDOWN_WIDTH = 380;
const DROPDOWN_MAX_HEIGHT = 360;

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
  const [coords, setCoords] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  function updateCoords() {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < DROPDOWN_MAX_HEIGHT + 20 && r.top > spaceBelow;
    // Alinha pelo left do botão, mas trava na viewport
    let left = r.left;
    const desiredRight = left + DROPDOWN_WIDTH;
    if (desiredRight > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - DROPDOWN_WIDTH - 8);
    }
    if (left < 8) left = 8;
    const top = openUp ? r.top - 4 : r.bottom + 4;
    setCoords({ top, left, openUp });
  }

  useLayoutEffect(() => {
    if (open) updateCoords();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onScrollOrResize() { updateCoords(); }
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
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
        ref={buttonRef}
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

      {open && coords && createPortal(
        <div
          ref={popupRef}
          style={{
            position: 'fixed',
            top: coords.openUp ? undefined : coords.top,
            bottom: coords.openUp ? window.innerHeight - coords.top : undefined,
            left: coords.left,
            width: DROPDOWN_WIDTH,
            maxHeight: DROPDOWN_MAX_HEIGHT,
            zIndex: 100,
          }}
          className="bg-burst-panel border border-burst-border rounded-lg shadow-card overflow-hidden flex flex-col"
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-burst-border bg-black/40 shrink-0">
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

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
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
        </div>,
        document.body
      )}
    </div>
  );
}

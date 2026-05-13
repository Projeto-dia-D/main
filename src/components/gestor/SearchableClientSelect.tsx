import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, X, Check } from 'lucide-react';
import type { MondayClient } from '../../lib/monday';

interface Props {
  value: string | null; // monday_client_id selecionado
  options: MondayClient[];
  onChange: (client: MondayClient) => void;
  onClear: () => void;
  disabled?: boolean;
  placeholder?: string;
}

const DROPDOWN_WIDTH = 360;
const DROPDOWN_MAX_HEIGHT = 360;

export function SearchableClientSelect({
  value,
  options,
  onChange,
  onClear,
  disabled,
  placeholder = 'Vincular a cliente Monday',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  // Calcula posição do dropdown a partir do botão (posição fixa, sem clipping)
  function updateCoords() {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < DROPDOWN_MAX_HEIGHT + 20 && r.top > spaceBelow;
    // Alinha pela direita: dropdown termina no mesmo right do botão.
    let left = r.right - DROPDOWN_WIDTH;
    // Garante que não sai da viewport
    if (left < 8) left = 8;
    if (left + DROPDOWN_WIDTH > window.innerWidth - 8) left = window.innerWidth - DROPDOWN_WIDTH - 8;
    const top = openUp ? r.top - 4 : r.bottom + 4;
    setCoords({ top, left, openUp });
  }

  useLayoutEffect(() => {
    if (open) updateCoords();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onScrollOrResize() {
      updateCoords();
    }
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
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
    const sorted = [...options].sort((a, b) => a.name.localeCompare(b.name));
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.gestor ?? '').toLowerCase().includes(q) ||
        (o.cs ?? '').toLowerCase().includes(q)
    );
  }, [options, query]);

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
              {current.gestor && (
                <span className="text-burst-muted ml-1.5 text-[10px]">({current.gestor})</span>
              )}
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
            title="Limpar vínculo"
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
              placeholder="Buscar cliente, gestor ou CS..."
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
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-burst-muted">
                Nenhum cliente encontrado.
              </div>
            ) : (
              <ul>
                {filtered.map((cli) => {
                  const isSelected = cli.id === value;
                  return (
                    <li key={cli.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(cli);
                          setOpen(false);
                        }}
                        className={[
                          'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                          isSelected
                            ? 'bg-burst-orange/15 text-burst-orange-bright'
                            : 'text-white hover:bg-white/[0.04]',
                        ].join(' ')}
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block truncate">{cli.name}</span>
                          <span className="block text-[10px] text-burst-muted">
                            {cli.gestor ?? 'sem gestor'}
                            {cli.cs ? ` • CS: ${cli.cs}` : ''}
                          </span>
                        </span>
                        {isSelected && <Check size={12} className="text-burst-orange-bright" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

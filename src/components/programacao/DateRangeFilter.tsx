import { useState } from 'react';
import { CalendarRange, X } from 'lucide-react';
import type { DateRange } from '../../lib/metrics';

interface Props {
  range: DateRange;
  onChange: (r: DateRange) => void;
}

function toInputValue(d: Date | null): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseInput(v: string, endOfDay: boolean): Date | null {
  if (!v) return null;
  const [y, m, d] = v.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !d) return null;
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
}

function presetRange(days: number): DateRange {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function ontemRange(): DateRange {
  const start = new Date();
  start.setDate(start.getDate() - 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

interface Preset {
  label: string;
  getRange: () => DateRange;
}

const PRESETS: Preset[] = [
  { label: 'Hoje', getRange: () => presetRange(1) },
  { label: 'Ontem', getRange: ontemRange },
  { label: '7 dias', getRange: () => presetRange(7) },
  { label: '14 dias', getRange: () => presetRange(14) },
  { label: '30 dias', getRange: () => presetRange(30) },
  { label: '90 dias', getRange: () => presetRange(90) },
];

export function DateRangeFilter({ range, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const label = (() => {
    if (!range.start && !range.end) return 'Todo o período';
    const a = range.start ? range.start.toLocaleDateString('pt-BR') : '...';
    const b = range.end ? range.end.toLocaleDateString('pt-BR') : '...';
    return `${a} → ${b}`;
  })();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-burst-card border border-burst-border hover:border-burst-orange/50 transition-colors text-sm"
      >
        <CalendarRange size={16} className="text-burst-orange-bright" />
        <span className="text-white">{label}</span>
        {(range.start || range.end) && (
          <X
            size={14}
            className="text-burst-muted hover:text-red-400 ml-1"
            onClick={(e) => {
              e.stopPropagation();
              onChange({ start: null, end: null });
            }}
          />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-40 w-80 bg-burst-card border border-burst-border rounded-xl p-4 shadow-card">
            <div className="text-[11px] uppercase tracking-widest text-burst-muted mb-2">
              Atalhos
            </div>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    onChange(p.getRange());
                    setOpen(false);
                  }}
                  className="px-2.5 py-1 text-xs rounded-md border border-burst-border hover:border-burst-orange hover:bg-burst-orange/10 transition-colors text-white"
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => {
                  onChange({ start: null, end: null });
                  setOpen(false);
                }}
                className="px-2.5 py-1 text-xs rounded-md border border-burst-border hover:border-burst-orange hover:bg-burst-orange/10 transition-colors text-white"
              >
                Tudo
              </button>
            </div>

            <div className="text-[11px] uppercase tracking-widest text-burst-muted mb-2">
              Personalizado
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase text-burst-muted">Início</span>
                <input
                  type="date"
                  value={toInputValue(range.start)}
                  onChange={(e) =>
                    onChange({ ...range, start: parseInput(e.target.value, false) })
                  }
                  className="bg-black/30 border border-burst-border rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:border-burst-orange"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase text-burst-muted">Fim</span>
                <input
                  type="date"
                  value={toInputValue(range.end)}
                  onChange={(e) =>
                    onChange({ ...range, end: parseInput(e.target.value, true) })
                  }
                  className="bg-black/30 border border-burst-border rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:border-burst-orange"
                />
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

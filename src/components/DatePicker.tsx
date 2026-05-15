import { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

interface Props {
  value: Date | null;
  onChange: (d: Date | null) => void;
  placeholder?: string;
  /** Se true, ao selecionar/digitar atribui 23:59:59 ao final do dia. */
  endOfDay?: boolean;
  /** Se true, o calendário fica sempre aberto (sem trigger). */
  alwaysOpen?: boolean;
}

/**
 * Picker de data com:
 *  - Input de texto mascarado (dd/mm/aaaa) — usuário pode digitar
 *  - Popover com calendário visual (grade de dias) — clicar pra selecionar
 *  - Navegação entre meses
 */
export function DatePicker({ value, onChange, placeholder = 'dd/mm/aaaa', endOfDay, alwaysOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => formatBR(value));
  const [view, setView] = useState<Date>(() => value ?? new Date());
  const containerRef = useRef<HTMLDivElement>(null);

  // Sincroniza texto/view quando value muda externamente
  useEffect(() => {
    setText(formatBR(value));
    if (value) setView(value);
  }, [value]);

  // Click fora pra fechar
  useEffect(() => {
    if (!open || alwaysOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, alwaysOpen]);

  function commitDate(d: Date | null) {
    if (!d) {
      onChange(null);
      return;
    }
    const out = new Date(d);
    if (endOfDay) out.setHours(23, 59, 59, 999);
    else out.setHours(0, 0, 0, 0);
    onChange(out);
    setView(out);
  }

  function onInputChange(raw: string) {
    const masked = applyMask(raw);
    setText(masked);
    const parsed = parseBR(masked);
    if (parsed) commitDate(parsed);
    else if (!masked.trim()) onChange(null);
    // Se incompleto, não chama onChange — espera completar
  }

  function selectDay(d: Date) {
    commitDate(d);
    setOpen(false);
  }

  function prevMonth() {
    setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1));
  }
  function nextMonth() {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1));
  }
  function setToday() {
    const t = new Date();
    commitDate(t);
    setOpen(false);
  }

  const days = useMemo(() => generateDays(view), [view]);
  const todayISO = formatISO(new Date());
  const selectedISO = value ? formatISO(value) : null;

  const grid = (
    <div className={alwaysOpen ? '' : 'absolute top-full left-0 mt-1 z-50'}>
      <div className="bg-burst-card border border-burst-border rounded-lg p-3 shadow-card w-64">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={prevMonth}
            className="w-7 h-7 rounded hover:bg-burst-orange/20 flex items-center justify-center text-white"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-sm text-white font-display tracking-wider">
            {MONTHS[view.getMonth()]} {view.getFullYear()}
          </span>
          <button
            type="button"
            onClick={nextMonth}
            className="w-7 h-7 rounded hover:bg-burst-orange/20 flex items-center justify-center text-white"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-[10px] text-center text-burst-muted mb-1 uppercase tracking-wider">
          {WEEKDAYS.map((w, i) => (
            <span key={i} className="py-1">{w}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {days.map((d, i) => {
            const iso = formatISO(d);
            const isToday = iso === todayISO;
            const isSelected = iso === selectedISO;
            const isOtherMonth = d.getMonth() !== view.getMonth();
            return (
              <button
                key={i}
                type="button"
                onClick={() => selectDay(d)}
                className={[
                  'h-7 text-xs rounded transition-colors',
                  isSelected
                    ? 'bg-burst-orange text-white font-semibold'
                    : isToday
                    ? 'border border-burst-orange/60 text-burst-orange-bright hover:bg-burst-orange/20'
                    : isOtherMonth
                    ? 'text-burst-muted/40 hover:bg-burst-orange/10'
                    : 'text-white hover:bg-burst-orange/20',
                ].join(' ')}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
        <div className="mt-2 pt-2 border-t border-burst-border flex justify-between gap-2">
          <button
            type="button"
            onClick={setToday}
            className="text-[10px] uppercase tracking-wider text-burst-orange-bright hover:text-burst-orange px-2 py-1 rounded"
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setText('');
              setOpen(false);
            }}
            className="text-[10px] uppercase tracking-wider text-burst-muted hover:text-red-400 px-2 py-1 rounded"
          >
            Limpar
          </button>
        </div>
      </div>
    </div>
  );

  if (alwaysOpen) return <div ref={containerRef}>{grid}</div>;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={text}
          onChange={(e) => onInputChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          maxLength={10}
          inputMode="numeric"
          className="w-full bg-black/30 border border-burst-border rounded-md pl-7 pr-2 py-1.5 text-sm text-white focus:outline-none focus:border-burst-orange"
        />
        <CalendarIcon
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-burst-muted pointer-events-none"
        />
      </div>
      {open && grid}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================
function generateDays(view: Date): Date[] {
  // 6 semanas = 42 dias, começando no domingo antes do dia 1 do mês
  const year = view.getFullYear();
  const month = view.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0 = domingo
  const days: Date[] = [];
  for (let i = firstWeekday; i > 0; i--) {
    days.push(new Date(year, month, 1 - i));
  }
  const lastDay = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    days.push(new Date(year, month, d));
  }
  while (days.length < 42) {
    const last = days[days.length - 1];
    days.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }
  return days;
}

function formatBR(d: Date | null): string {
  if (!d) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

function formatISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function applyMask(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let out = '';
  if (digits.length > 0) out = digits.slice(0, 2);
  if (digits.length > 2) out += '/' + digits.slice(2, 4);
  if (digits.length > 4) out += '/' + digits.slice(4, 8);
  return out;
}

function parseBR(s: string): Date | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const year = parseInt(m[3], 10);
  if (year < 2000 || year > 2100) return null;
  if (month < 0 || month > 11) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(year, month, day);
  // Valida (Date constructor não rejeita 31/02 — corrige sozinho)
  if (d.getDate() !== day || d.getMonth() !== month || d.getFullYear() !== year) return null;
  return d;
}

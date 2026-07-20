import { useState } from 'react';
import { CalendarRange, X } from 'lucide-react';
import type { DateRange } from '../../lib/metrics';
import { DatePicker } from '../DatePicker';

interface Props {
  range: DateRange;
  onChange: (r: DateRange) => void;
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

// === "Mês de faturamento" (Dia D mensal, a partir de jul/2026) ===
// O Dia D passou a ser MENSAL. O início do mês de faturamento é o dia 1 —
// EXCETO julho/2026, que começa no dia 12 (transição do antigo ciclo dia-12
// pro mensal). De agosto em diante começa no dia 1 normalmente.
export function billingMonthStart(year: number, month: number): Date {
  const dia = year === 2026 && month === 6 ? 12 : 1; // month 0-indexado: junho=5, julho=6
  return new Date(year, month, dia, 0, 0, 0, 0);
}

// Fim do mês (último dia às 23:59:59.999). `new Date(y, m+1, 0)` = último dia do mês m.
export function billingMonthEnd(year: number, month: number): Date {
  return new Date(year, month + 1, 0, 23, 59, 59, 999);
}

// Período Dia D: do início do mês de faturamento corrente até HOJE.
// Julho/2026 → 12/07 até hoje; agosto em diante → dia 1 até hoje.
// Exportada pra que outras abas (Gestor / CS / Programação) usem como filtro inicial.
export function diaDRange(): DateRange {
  const now = new Date();
  const start = billingMonthStart(now.getFullYear(), now.getMonth());
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Expande um range pra MÊS(ES) INTEIRO(S) de faturamento: início → começo do mês
// do `start`; fim → fim do mês do `end`. Aplicado nas seleções de calendário
// (personalizado) — assim, escolher datas dentro de 1 mês puxa o mês inteiro, e
// datas que cruzam 2 meses puxam os dois meses inteiros. Vale pra TODAS as
// métricas (leads, spend, transferência, atraso, churn).
export function expandRangeToBillingMonths(range: DateRange): DateRange {
  return {
    start: range.start ? billingMonthStart(range.start.getFullYear(), range.start.getMonth()) : null,
    end: range.end ? billingMonthEnd(range.end.getFullYear(), range.end.getMonth()) : null,
  };
}

// Este mês — do dia 1 do mês corrente até hoje.
// Exportado pra usar como default em telas que precisam abrir já filtradas.
export function esteMesRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

interface Preset {
  label: string;
  getRange: () => DateRange;
}

const PRESETS: Preset[] = [
  { label: 'Este mês', getRange: esteMesRange },
  { label: 'Dia D', getRange: diaDRange },
  { label: 'Hoje', getRange: () => presetRange(1) },
  { label: 'Ontem', getRange: ontemRange },
  { label: '7 dias', getRange: () => presetRange(7) },
  { label: '14 dias', getRange: () => presetRange(14) },
  { label: '30 dias', getRange: () => presetRange(30) },
  { label: '90 dias', getRange: () => presetRange(90) },
];

export function DateRangeFilter({ range, onChange }: Props) {
  const [open, setOpen] = useState(false);

  // Seleção personalizada (calendário/digitação) → expande pro(s) mês(es)
  // inteiro(s) de faturamento. Os atalhos curtos (Hoje/Ontem/N dias) NÃO passam
  // por aqui, então continuam literais. Se o usuário inverter (início > fim),
  // troca os dois antes de expandir pra não gerar um range vazio.
  const commitCustom = (r: DateRange) => {
    let normalized = r;
    if (r.start && r.end && r.start.getTime() > r.end.getTime()) {
      normalized = { start: r.end, end: r.start };
    }
    onChange(expandRangeToBillingMonths(normalized));
  };

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
          <div className="absolute right-0 top-full mt-2 z-40 w-96 bg-burst-card border border-burst-border rounded-xl p-4 shadow-card">
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
              Personalizado (clique pra abrir calendário ou digite dd/mm/aaaa)
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase text-burst-muted">Início</span>
                <DatePicker
                  value={range.start}
                  onChange={(d) => commitCustom({ ...range, start: d })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase text-burst-muted">Fim</span>
                <DatePicker
                  value={range.end}
                  endOfDay
                  onChange={(d) => commitCustom({ ...range, end: d })}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

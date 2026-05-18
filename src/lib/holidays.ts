import { supabase } from './supabase';

export const HOLIDAYS_TABLE = 'holidays';

export interface Holiday {
  date: string;             // 'YYYY-MM-DD'
  name: string;
  source: 'nacional' | 'custom';
  created_at: string;
}

export async function fetchAllHolidays(): Promise<Holiday[]> {
  const { data, error } = await supabase
    .from(HOLIDAYS_TABLE)
    .select('*')
    .order('date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Holiday[];
}

export async function addHoliday(date: string, name: string, source: 'nacional' | 'custom' = 'custom'): Promise<void> {
  const { error } = await supabase
    .from(HOLIDAYS_TABLE)
    .upsert({ date, name, source }, { onConflict: 'date' });
  if (error) throw error;
}

export async function removeHoliday(date: string): Promise<void> {
  const { error } = await supabase.from(HOLIDAYS_TABLE).delete().eq('date', date);
  if (error) throw error;
}

/** Converte Date local → 'YYYY-MM-DD' sem efeito de timezone. */
export function dateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Verifica se uma data é dia útil (seg-sex E não está no set de feriados). */
export function isWorkingDay(d: Date, holidaySet: Set<string>): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false; // Sun, Sat
  return !holidaySet.has(dateToISO(d));
}

/**
 * Conta dias úteis no intervalo [start, end] inclusivo.
 * Se holidaySet for vazio, equivale a "dias da semana" (seg-sex).
 */
export function countWorkingDays(start: Date, end: Date, holidaySet: Set<string>): number {
  let count = 0;
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  while (cur.getTime() <= stop) {
    if (isWorkingDay(cur, holidaySet)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

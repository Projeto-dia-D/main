import { supabase } from './supabase';
import { countWorkingDays } from './holidays';

export const ATESTADOS_TABLE = 'designer_atestados';

export interface Atestado {
  id: number;
  designer: string;
  data_inicio: string; // YYYY-MM-DD
  data_fim: string;
  motivo: string | null;
  created_at: string;
}

export async function fetchAllAtestados(): Promise<Atestado[]> {
  const { data, error } = await supabase
    .from(ATESTADOS_TABLE)
    .select('*')
    .order('data_inicio', { ascending: false });
  if (error) throw error;
  return (data as Atestado[]) ?? [];
}

export async function addAtestado(
  designer: string,
  data_inicio: string,
  data_fim: string,
  motivo: string | null = null,
): Promise<Atestado> {
  const { data, error } = await supabase
    .from(ATESTADOS_TABLE)
    .insert({ designer, data_inicio, data_fim, motivo })
    .select()
    .single();
  if (error) throw error;
  return data as Atestado;
}

export async function removeAtestado(id: number): Promise<void> {
  const { error } = await supabase.from(ATESTADOS_TABLE).delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
// Cálculo de dias de atestado dentro de um período
// ============================================================
function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map((v) => parseInt(v, 10));
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function normalizeDesigner(s: string | null | undefined): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Conta quantos DIAS ÚTEIS dentro do range [start..end] cabem em algum
 * atestado do designer. Esses dias devem ser SUBTRAÍDOS do total de
 * dias úteis na hora de calcular "demandas/dia" do designer.
 */
export function diasUteisAtestados(
  designerNome: string,
  atestados: Atestado[],
  rangeStart: Date,
  rangeEnd: Date,
  holidaySet: Set<string>,
): number {
  const alvo = normalizeDesigner(designerNome);
  if (!alvo) return 0;

  let total = 0;
  for (const a of atestados) {
    if (normalizeDesigner(a.designer) !== alvo) continue;
    const ai = parseISO(a.data_inicio);
    const af = parseISO(a.data_fim);
    af.setHours(23, 59, 59, 999);

    // Interseção do atestado com o range solicitado
    const inter_start = ai.getTime() > rangeStart.getTime() ? ai : rangeStart;
    const inter_end = af.getTime() < rangeEnd.getTime() ? af : rangeEnd;
    if (inter_start.getTime() > inter_end.getTime()) continue;

    total += countWorkingDays(inter_start, inter_end, holidaySet);
  }
  return total;
}

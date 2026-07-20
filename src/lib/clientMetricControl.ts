import { supabase } from './supabase';

// ============================================================================
// CONTROLE DE CLIENTES NAS MÉTRICAS
// ============================================================================
// Por cliente (monday_client_id), define em QUAIS setores/métricas ele conta.
// Padrão: conta em TUDO. Só existe linha no banco pra cliente com algum setor
// DESLIGADO — ausência de linha = todos os setores ligados.
//
// Camada ADITIVA: não substitui as exclusões fixas do código (chat incompleto,
// desconsiderados). Ela permite LIGAR/DESLIGAR qualquer cliente por setor.

export const CONTROLS_TABLE = 'client_metric_controls';

export type MetricSector = 'programacao' | 'gestor' | 'cs' | 'design';

export const METRIC_SECTORS: { key: MetricSector; label: string }[] = [
  { key: 'programacao', label: 'Programação' },
  { key: 'gestor', label: 'Gestor' },
  { key: 'cs', label: 'CS' },
  { key: 'design', label: 'Design' },
];

export interface ClientMetricControl {
  monday_client_id: string;
  monday_client_name: string | null;
  programacao: boolean;
  gestor: boolean;
  cs: boolean;
  design: boolean;
  updated_at?: string;
  updated_by?: string | null;
}

/** Controle "padrão" (conta em tudo) pra um cliente sem linha no banco. */
export function defaultControl(id: string, nome: string | null): ClientMetricControl {
  return {
    monday_client_id: id,
    monday_client_name: nome,
    programacao: true,
    gestor: true,
    cs: true,
    design: true,
  };
}

/** True se o cliente conta no setor. Sem controle (undefined) = conta (padrão). */
export function contaNoSetor(
  ctrl: ClientMetricControl | undefined | null,
  setor: MetricSector
): boolean {
  if (!ctrl) return true;
  return ctrl[setor] !== false;
}

/** True se o controle está no padrão (conta em tudo) — pode remover a linha. */
export function isPadrao(ctrl: ClientMetricControl): boolean {
  return ctrl.programacao && ctrl.gestor && ctrl.cs && ctrl.design;
}

/** Normaliza nome pra casar cliente (mesma regra do metrics.ts: sem acento,
 *  troca -/_ por espaço, lowercase). */
export function normalizeNome(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\-]+/g, ' ')
    .toLowerCase()
    .trim();
}

/** Set de monday_client_id DESLIGADOS num setor. */
export function idsExcluidosNoSetor(
  controls: ClientMetricControl[],
  setor: MetricSector
): Set<string> {
  const s = new Set<string>();
  for (const c of controls) if (c[setor] === false) s.add(c.monday_client_id);
  return s;
}

/**
 * Set de NOMES (normalizados) dos clientes desligados num setor, juntando TODAS
 * as fontes de nome disponíveis (nome do board principal, nome do Bia Soft) —
 * usado onde o match é por nome (Programação = nomeDoutor do lead; Design =
 * campo `clientes` do evento), já que os nomes variam entre boards.
 */
export function nomesExcluidosNoSetor(
  controls: ClientMetricControl[],
  setor: MetricSector,
  nameSources: Array<Map<string, string> | undefined>
): Set<string> {
  const nomes = new Set<string>();
  for (const c of controls) {
    if (c[setor] !== false) continue;
    // nome do próprio registro
    if (c.monday_client_name) {
      const n = normalizeNome(c.monday_client_name);
      if (n) nomes.add(n);
    }
    // nomes de outras fontes (mapa id → nome)
    for (const src of nameSources) {
      const nome = src?.get(c.monday_client_id);
      const n = normalizeNome(nome);
      if (n) nomes.add(n);
    }
  }
  return nomes;
}

/** True se `nome` casa (exato/substring nos dois sentidos) com algum nome
 *  excluído — mesma lógica de match usada no resto do app. */
export function nomeCasaExcluido(
  nome: string | null | undefined,
  nomesExcluidos: Set<string>
): boolean {
  if (nomesExcluidos.size === 0) return false;
  const n = normalizeNome(nome);
  if (!n) return false;
  for (const e of nomesExcluidos) {
    if (!e) continue;
    if (n === e || n.includes(e) || e.includes(n)) return true;
  }
  return false;
}

// ============================================================
// CRUD (Supabase)
// ============================================================

export async function fetchAllControls(): Promise<ClientMetricControl[]> {
  const { data, error } = await supabase.from(CONTROLS_TABLE).select('*');
  if (error) throw error;
  return (data ?? []) as ClientMetricControl[];
}

/** Grava o controle. Se voltou ao padrão (conta em tudo), REMOVE a linha. */
export async function saveControl(
  ctrl: ClientMetricControl,
  updatedBy?: string | null
): Promise<void> {
  if (isPadrao(ctrl)) {
    const { error } = await supabase
      .from(CONTROLS_TABLE)
      .delete()
      .eq('monday_client_id', ctrl.monday_client_id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from(CONTROLS_TABLE).upsert(
    {
      monday_client_id: ctrl.monday_client_id,
      monday_client_name: ctrl.monday_client_name,
      programacao: ctrl.programacao,
      gestor: ctrl.gestor,
      cs: ctrl.cs,
      design: ctrl.design,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy ?? null,
    },
    { onConflict: 'monday_client_id' }
  );
  if (error) throw error;
}

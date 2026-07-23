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
  /** Data (YYYY-MM-DD) a partir da qual o desligamento vale.
   *  NULL/ausente = vale SEMPRE (retroativo) — protege os Dia D já fechados. */
  excluido_desde?: string | null;
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
    excluido_desde: null,
  };
}

/**
 * REGRA DE NEGÓCIO CENTRAL — o cliente está DESLIGADO deste setor?
 *
 * Fixa (não depende de flags divergentes salvos no banco):
 *  - Excluído da **Programação** ⟹ excluído também de **Gestor** e **CS** (não
 *    conta nos "ativos" do Dia D). Gestor/CS SEMPRE herdam o desligamento da
 *    Programação — não dá pra tirar da Programação e manter no Gestor/CS.
 *  - **Design** NUNCA exclui ninguém — todo doutor conta no Design.
 *
 * Toda a lógica de exclusão passa por aqui, então as regras valem mesmo pra
 * linhas antigas gravadas com combinações que hoje não são mais permitidas.
 */
export function setorDesligado(c: ClientMetricControl, setor: MetricSector): boolean {
  if (setor === 'design') return false; // design conta todo mundo
  if (setor === 'programacao') return c.programacao === false;
  // gestor | cs — herdam sempre o desligamento da Programação
  return c.programacao === false || c[setor] === false;
}

/** True se o cliente conta no setor. Sem controle (undefined) = conta (padrão). */
export function contaNoSetor(
  ctrl: ClientMetricControl | undefined | null,
  setor: MetricSector
): boolean {
  if (!ctrl) return true;
  return !setorDesligado(ctrl, setor);
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
  for (const c of controls) if (setorDesligado(c, setor)) s.add(c.monday_client_id);
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
    if (!setorDesligado(c, setor)) continue;
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
// VERSÃO COM DATA ("vale a partir de")
// ============================================================
// As funções acima ignoram data (desligam retroativamente). As abaixo respeitam
// `excluido_desde`, para que os Dia D já fechados fiquem INTACTOS.

/** "YYYY-MM-DD" no fuso LOCAL (não usar toISOString — ele converte pra UTC e
 *  pode voltar 1 dia em horário de Brasília). */
export function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** O desligamento vale para um registro nesta data?
 *  Sem `desde` → vale sempre. Sem data no registro → aplica (conservador). */
function valeNaData(desde: string | null | undefined, dataISO: string | null | undefined): boolean {
  if (!desde) return true;
  if (!dataISO) return true;
  return dataISO.slice(0, 10) >= desde.slice(0, 10);
}

export interface ExclusaoNome {
  /** nome do cliente já normalizado */
  nome: string;
  /** data de corte (YYYY-MM-DD) ou null = sempre */
  desde: string | null;
}

/** Igual ao `nomesExcluidosNoSetor`, mas carregando a data de corte de cada um. */
export function exclusoesPorNomeNoSetor(
  controls: ClientMetricControl[],
  setor: MetricSector,
  nameSources: Array<Map<string, string> | undefined>
): ExclusaoNome[] {
  const out: ExclusaoNome[] = [];
  for (const c of controls) {
    if (!setorDesligado(c, setor)) continue;
    const desde = c.excluido_desde ?? null;
    const nomes = new Set<string>();
    const proprio = normalizeNome(c.monday_client_name);
    if (proprio) nomes.add(proprio);
    for (const src of nameSources) {
      const n = normalizeNome(src?.get(c.monday_client_id));
      if (n) nomes.add(n);
    }
    for (const n of nomes) out.push({ nome: n, desde });
  }
  return out;
}

/** True se o registro (lead/evento) deve ser excluído: o nome casa E a data do
 *  registro é >= a data de corte daquele cliente. */
export function nomeCasaExcluidoEm(
  nome: string | null | undefined,
  dataISO: string | null | undefined,
  exclusoes: ExclusaoNome[]
): boolean {
  if (exclusoes.length === 0) return false;
  const n = normalizeNome(nome);
  if (!n) return false;
  for (const ex of exclusoes) {
    if (!ex.nome) continue;
    if (n === ex.nome || n.includes(ex.nome) || ex.nome.includes(n)) {
      if (valeNaData(ex.desde, dataISO)) return true;
    }
  }
  return false;
}

/** IDs desligados no setor considerando o PERÍODO analisado. Usado onde a
 *  métrica é agregada por cliente/período (Gestor e CS): o cliente sai quando o
 *  período começa em/depois da data de corte. */
export function idsExcluidosNoSetorEm(
  controls: ClientMetricControl[],
  setor: MetricSector,
  inicioPeriodo: Date | null | undefined
): Set<string> {
  const s = new Set<string>();
  const ref = inicioPeriodo ? localISODate(inicioPeriodo) : null;
  for (const c of controls) {
    if (!setorDesligado(c, setor)) continue;
    const desde = c.excluido_desde ?? null;
    // sem corte → sempre; sem período → aplica (conservador)
    if (!desde || !ref || ref >= desde.slice(0, 10)) s.add(c.monday_client_id);
  }
  return s;
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
      excluido_desde: ctrl.excluido_desde ?? null,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy ?? null,
    },
    { onConflict: 'monday_client_id' }
  );
  if (error) throw error;
}

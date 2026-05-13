import { supabase } from './supabase';

export const LINKS_TABLE = 'client_meta_links';
export const DOUTOR_LINKS_TABLE = 'doutor_client_links';

export interface ClientMetaLink {
  monday_client_id: string;
  monday_client_name: string | null;
  meta_account_id: string;
  meta_account_name: string | null;
  gestor: string | null;
  updated_at: string;
}

// Erro customizado que preserva o code original do PostgREST/Supabase.
// Permite detectar "tabela inexistente" no consumer sem perder a mensagem.
export class StorageError extends Error {
  code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

function wrapError(err: { message?: string; code?: string } | null): never {
  const msg = err?.message ?? 'erro desconhecido do Supabase';
  const e = new StorageError(msg, err?.code);
  throw e;
}

export async function fetchAllLinks(): Promise<ClientMetaLink[]> {
  const { data, error } = await supabase.from(LINKS_TABLE).select('*');
  if (error) wrapError(error);
  return (data ?? []) as ClientMetaLink[];
}

export async function upsertLink(
  link: Omit<ClientMetaLink, 'updated_at'>
): Promise<void> {
  const { error } = await supabase
    .from(LINKS_TABLE)
    .upsert(
      { ...link, updated_at: new Date().toISOString() },
      { onConflict: 'monday_client_id' }
    );
  if (error) wrapError(error);
}

export async function deleteLink(monday_client_id: string): Promise<void> {
  const { error } = await supabase
    .from(LINKS_TABLE)
    .delete()
    .eq('monday_client_id', monday_client_id);
  if (error) wrapError(error);
}

// ============================================================
// Doutor (nomeDoutor) ↔ Cliente Monday — vínculo manual
// ============================================================

export interface DoutorClientLink {
  doutor_name: string;
  monday_client_id: string;
  monday_client_name: string | null;
  updated_at: string;
}

export async function fetchAllDoutorLinks(): Promise<DoutorClientLink[]> {
  const { data, error } = await supabase.from(DOUTOR_LINKS_TABLE).select('*');
  if (error) wrapError(error);
  return (data ?? []) as DoutorClientLink[];
}

export async function upsertDoutorLink(
  link: Omit<DoutorClientLink, 'updated_at'>
): Promise<void> {
  const { error } = await supabase
    .from(DOUTOR_LINKS_TABLE)
    .upsert(
      { ...link, updated_at: new Date().toISOString() },
      { onConflict: 'doutor_name' }
    );
  if (error) wrapError(error);
}

export async function deleteDoutorLink(doutor_name: string): Promise<void> {
  const { error } = await supabase
    .from(DOUTOR_LINKS_TABLE)
    .delete()
    .eq('doutor_name', doutor_name);
  if (error) wrapError(error);
}

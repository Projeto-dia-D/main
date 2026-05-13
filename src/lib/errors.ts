// Converte qualquer erro (Error, PostgrestError, string, objeto) em string legível.
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.error_description === 'string') return obj.error_description as string;
    if (typeof obj.error === 'string') return obj.error as string;
    if (typeof obj.hint === 'string') return obj.hint as string;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

// Detecta o erro específico de tabela inexistente do PostgREST/Supabase.
// Códigos: 42P01 (Postgres), PGRST106 (PostgREST), ou mensagem com "does not exist".
export function isMissingTableError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const obj = e as Record<string, unknown>;
  const code = String(obj.code ?? '').toLowerCase();
  if (code === '42p01' || code === 'pgrst106' || code === 'pgrst205') return true;
  const msg = String(obj.message ?? '').toLowerCase();
  if (msg.includes('does not exist') || msg.includes('not found')) return true;
  return false;
}

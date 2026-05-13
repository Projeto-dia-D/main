// Telefones cujos leads são DELETADOS do banco automaticamente.
// Qualquer registro em relatorio_bias com `telefone` casando um desses números
// é excluído pelo hook useLeads (no fetch inicial, no polling e via Realtime).
//
// Para adicionar: incluir o número aqui (só dígitos, com DDI 55 + DDD).
// Para remover: tirar daqui — registros já deletados NÃO voltam, são hard delete.
export const BLOCKED_PHONES = [
  '554998382122',
  '554999895011',
  '554999672621',
  '554999386746',
  '554999079063',
  '554991739073',
  '554998043950',
  '554998112865',
  '554999671923',
];

const blockedSet = new Set(BLOCKED_PHONES);

function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

/**
 * Retorna true se o telefone do lead casa com algum bloqueado.
 * Compara só os dígitos (ignora @s.whatsapp.net, traços, parênteses, etc).
 */
export function isPhoneBlocked(telefone: string | null | undefined): boolean {
  const d = digits(telefone);
  if (!d) return false;
  if (blockedSet.has(d)) return true;
  for (const b of BLOCKED_PHONES) {
    if (d.startsWith(b) || d.endsWith(b)) return true;
  }
  return false;
}

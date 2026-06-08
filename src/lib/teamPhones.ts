/**
 * Phone book hardcoded da equipe Burst.
 *
 * Por que existe: nos grupos WhatsApp, identificar quem é Burst (designer/
 * gestor/cs) por NOME é fragil — o display_name do WhatsApp varia muito
 * ("Paulo Burst", "Paulo Lentes", "Paulo Designer", emojis, etc) e o
 * sync Python errava role com frequencia.
 *
 * O telefone é estavel: quem manda mensagem no grupo é a pessoa, ponto.
 * Esse mapping resolve a identificacao definitiva.
 *
 * Match por ULTIMOS 8 DIGITOS:
 *   No Brasil, mobiles tem (DDD) 9 XXXX-XXXX (9 digitos apos DDD) desde 2014,
 *   mas contas antigas de WhatsApp podem ainda nao ter o "9" prefixo.
 *   Match por sufixo de 8 cobre os dois casos sem ambiguidade pra uma
 *   equipe pequena onde todos sao 49 DDD.
 *
 * Fonte: enviado pelo Renan em 2026-05-22 (numeros que ja mandaram msg
 * em algum grupo Burst).
 */
export type TeamRole = 'admin' | 'cs' | 'gestor' | 'designer' | 'programador';

export interface TeamMember {
  name: string;
  role: TeamRole;
}

const TEAM_PHONES: Record<string, TeamMember> = {
  // ---------- Designers ----------
  '91287493': { name: 'Paulo', role: 'designer' },
  '98325611': { name: 'Lais', role: 'designer' },
  '99868274': { name: 'Felipe', role: 'designer' },

  // ---------- Gestores de trafego ----------
  '92027739': { name: 'Gabriel Anacleto', role: 'gestor' },
  '99562859': { name: 'Ricardo', role: 'gestor' },
  '99164139': { name: 'Erick', role: 'gestor' },

  // ---------- CS ----------
  '98144940': { name: 'Hellen', role: 'cs' },
  '99948791': { name: 'Maria', role: 'cs' },
  '91178059': { name: 'Thuisa', role: 'cs' },
  '91739073': { name: 'Yasmin', role: 'cs' },
  '99079063': { name: 'Laura', role: 'cs' },
  '99671923': { name: 'Anne', role: 'cs' },
  '99386746': { name: 'Julia', role: 'cs' },
  '98112865': { name: 'Lilian', role: 'cs' },
  '99672621': { name: 'Paula', role: 'cs' },
};

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Identifica um membro Burst pelo telefone. Retorna null se nao for
 * da equipe (provavelmente cliente, ou ainda nao mapeado).
 *
 * Aceita qualquer formato: "+55 49 9128-7493", "5549912874193@s.whatsapp.net",
 * "554991287493", "91287493" — o que importa sao os ultimos 8 digitos.
 */
export function identifyTeamMember(phone: string | null | undefined): TeamMember | null {
  if (!phone) return null;
  const digits = normalizePhone(phone);
  if (digits.length < 8) return null;
  const suffix = digits.slice(-8);
  return TEAM_PHONES[suffix] ?? null;
}

/** Util pra debug/UI: lista todos os membros da equipe. */
export function listTeamMembers(): Array<TeamMember & { phoneSuffix: string }> {
  return Object.entries(TEAM_PHONES).map(([phoneSuffix, m]) => ({ ...m, phoneSuffix }));
}

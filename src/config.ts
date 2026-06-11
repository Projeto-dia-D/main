// Configuração centralizada — todas as variáveis vêm do .env
// Renomeie .env.example para .env e preencha os valores.

const env = import.meta.env;

// Trim defensivo: remove espaços, aspas e CRLF que podem ter sido coladas no .env
function clean(v: string | undefined): string {
  if (!v) return '';
  return v.replace(/^\s*["']?|["']?\s*$/g, '').trim();
}

function normalizeActId(id: string | undefined): string {
  const t = clean(id);
  if (!t) return '';
  return t.startsWith('act_') ? t : `act_${t}`;
}

export type GestorName = 'Renan' | 'Weslei' | 'André';

export interface MetaAccount {
  gestor: GestorName;
  token: string;
  accountId: string;
}

export const config = {
  SUPABASE_URL: clean(env.VITE_SUPABASE_URL),
  SUPABASE_SERVICE_ROLE_SECRET: clean(env.VITE_SUPABASE_SERVICE_ROLE_SECRET),
  UAZAPI_URL: clean(env.VITE_UAZAPI_URL).replace(/\/$/, ''),
  UAZAPI_TOKEN: clean(env.VITE_UAZAPI_TOKEN),

  META_ACCOUNTS: [
    {
      gestor: 'Renan',
      token: clean(env.VITE_META_TOKEN_RENAN),
      accountId: normalizeActId(env.VITE_META_ACCOUNT_RENAN),
    },
    {
      gestor: 'Weslei',
      token: clean(env.VITE_META_TOKEN_WESLEI),
      accountId: normalizeActId(env.VITE_META_ACCOUNT_WESLEI),
    },
    {
      gestor: 'André',
      // Aceita as duas grafias por robustez: VITE_META_TOKEN_ANDRE (sem acento, recomendado)
      // ou VITE_META_TOKEN_ANDRÉ (com acento).
      token: clean(
        env.VITE_META_TOKEN_ANDRE ||
          (env as Record<string, string | undefined>).VITE_META_TOKEN_ANDRÉ
      ),
      accountId: normalizeActId(
        env.VITE_META_ACCOUNT_ANDRE ||
          (env as Record<string, string | undefined>).VITE_META_ACCOUNT_ANDRÉ
      ),
    },
  ] as MetaAccount[],

  MONDAY_TOKEN: clean(env.VITE_MONDAY_TOKEN),
  MONDAY_BOARD_ID: clean(env.VITE_MONDAY_BOARD_ID),
};

// Gestores que NÃO estão mais como gestor de tráfego — filtrados em todos
// os pontos onde aparecem nomes vindos do Monday.
//   - roberta: saiu da empresa
//   - andrei: virou empacotador (não faz mais parte da equipe de tráfego)
// Obs: 'andrei' ≠ 'André' (com acento) — não conflita com a conta Meta do André.
export const GESTORES_EXCLUIDOS = ['roberta', 'andrei'];

// ============================================================================
// CUTOFFS MANUAIS DE CLIENTES
// ============================================================================
// Mapa { monday_client_id → data ISO } pra clientes que devem PARAR DE CONTAR
// nas métricas a partir de uma data específica, SEM precisar marcar churn no
// Monday. Útil quando o cliente está em manutenção/aviso prévio mas a equipe
// quer congelar o spend e leads dele nas métricas.
//
// Comportamento (igual ao churn cutoff):
//   - Leads com dataCadastro APÓS o cutoff são ignorados
//   - Spend dos dias APÓS o cutoff é ignorado (via timeline)
//   - Cliente vira `inactive=true` automaticamente
//   - Histórico ANTES do cutoff continua valendo normalmente
//
// Pra adicionar: pega o `monday_client_id` (10+ dígitos) e a data ISO.
export const CLIENT_CUTOFFS: Record<string, string> = {
  // Elevare Odontologia (Ana Neri) — encerrou nas métricas em 27/05/2026.
  // Histórico mantido, novos leads/spend NÃO entram.
  '11093674024': '2026-05-27T00:00:00.000Z',
  // Dr. Jarles Júnior — desconsiderado das métricas a partir de 01/06/2026.
  '9893019300': '2026-06-01T00:00:00-03:00',
};

/** Retorna a data de cutoff manual do cliente, ou null se não há. */
export function getClientCustomCutoff(mondayClientId: string): Date | null {
  const iso = CLIENT_CUTOFFS[mondayClientId];
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ============================================================================
// OVERRIDE DE CS (reatribuição que o time fez na coluna "CS" people do Monday,
// e NÃO na "CS do projeto" que o app lê — por isso esses ainda apareciam como
// Yasmin). Pros clientes abaixo, força o CS atual pro novo responsável (nome
// curto, igual às opções da coluna de status). Tira a Yasmin (que saiu).
// Esta lista é a dos LINKADOS-ATIVOS (com lead no Dia D) que precisam de PISO
// por data (reatribuição no meio do ciclo). Os DEMAIS clientes que estão como
// Yasmin são resolvidos automaticamente em monday.ts lendo a coluna "CS"
// (people) — ver resolveCsFromPeople/isCsOculto. Quando o time arrumar a "CS do
// projeto" no Monday, é só remover daqui.
//
// `since` = data em que o cliente DE FATO passou pro novo CS (mudança real na
// coluna "CS" people do Monday — confirmada via activity log: todas em
// MAIO/2026, em duas levas 25/05 e 28/05, + Diego Rocha em 01/06). A mudança
// de 2025 que aparecia no log era o novo CS entrando como SOMBRA, não o
// handover. Antes dessa data o cliente ainda era da Yasmin → NÃO conta pro novo
// CS (piso via getCsReassignFloor, na visão de CS). Como caem DENTRO do ciclo
// do Dia D atual, o novo CS só pega a métrica a partir de ~25-28/05 (o começo
// do ciclo, 12-24/05, era da Yasmin e some).
export interface CsOverrideEntry { cs: string; since: string }
export const CS_OVERRIDE: Record<string, CsOverrideEntry> = {
  '7962135952':  { cs: 'Laura',  since: '2026-05-25T00:00:00-03:00' }, // OdontoSin (Aline/Pedro)
  '9653474772':  { cs: 'Laura',  since: '2026-05-25T00:00:00-03:00' }, // Gabriela Ramos Brum
  '9831704063':  { cs: 'Laura',  since: '2026-05-25T00:00:00-03:00' }, // Dra. Michelly Mussi
  '9878881359':  { cs: 'Laura',  since: '2026-05-25T00:00:00-03:00' }, // Dra. Ethel Sfeir
  '10058495139': { cs: 'Julia',  since: '2026-06-01T00:00:00-03:00' }, // Dr. Diego Rocha (mudou 01/06)
  '10538365892': { cs: 'Lilian', since: '2026-05-28T00:00:00-03:00' }, // Dr. Rodrigo Rios
  '10551118176': { cs: 'Lilian', since: '2026-05-28T00:00:00-03:00' }, // Dra. Ádila Maciel
  '10660899597': { cs: 'Lilian', since: '2026-05-28T00:00:00-03:00' }, // Dr. Edmaro Alexandre
  '10954127967': { cs: 'Laura',  since: '2026-05-25T00:00:00-03:00' }, // Dr. João Antônio
  '11011478715': { cs: 'Laura',  since: '2026-05-25T00:00:00-03:00' }, // Dr. Alexandre Moreno
  '11075526119': { cs: 'Lilian', since: '2026-05-28T00:00:00-03:00' }, // Clínica NA Odontologia (Nicole)
  '11252440506': { cs: 'Lilian', since: '2026-05-28T00:00:00-03:00' }, // Oral Unic Lages
  '11367420200': { cs: 'Laura',  since: '2026-05-25T00:00:00-03:00' }, // Dra. Mayara Ventura
  '11407194012': { cs: 'Laura',  since: '2026-05-25T00:00:00-03:00' }, // Dr. Alexandre Dotto
  '11533443746': { cs: 'Laura',  since: '2026-05-25T00:00:00-03:00' }, // Dr. Tiago Augusto
  '18128625857': { cs: 'Laura',  since: '2026-05-25T00:00:00-03:00' }, // Dr. Rafael Oliveira - OrtoImplanT
  '18157282918': { cs: 'Lilian', since: '2026-05-28T00:00:00-03:00' }, // VitaPrime Clínica Odontológica
  '18233591362': { cs: 'Lilian', since: '2026-05-28T00:00:00-03:00' }, // Dra Jessica Barros
  '18302733942': { cs: 'Lilian', since: '2026-05-28T00:00:00-03:00' }, // Dra Shawana Mayer
  '10911960726': { cs: 'Lilian', since: '2026-05-28T00:00:00-03:00' }, // Dra. Júlia Nobre (linkada, inadimplente)
  '18110636874': { cs: 'Laura',  since: '2026-05-25T00:00:00-03:00' }, // Barros Odontologia (linkada, inadimplente)
};

/** CS forçado pro cliente (override da coluna "CS do projeto"), ou null. */
export function getCsOverride(mondayClientId: string): string | null {
  return CS_OVERRIDE[mondayClientId]?.cs ?? null;
}

// ============================================================================
// CS OCULTO (saiu da empresa, ex: Yasmin) — some de TODAS as visualizações.
// ============================================================================
// Não exclui métrica de ninguém: clientes que ainda estão marcados com um CS
// oculto são resolvidos pro NOVO CS lendo a coluna "CS" (people) do Monday
// (resolveCsFromPeople). Quem não tem novo CS (cliente morto/jurídico, sem lead
// no Dia D) simplesmente fica sem CS — não vira card de "Yasmin".
export const CS_OCULTOS = ['yasmin'];

/** True se o nome do CS é de alguém que saiu (não deve aparecer em lugar nenhum). */
export function isCsOculto(cs: string | null | undefined): boolean {
  if (!cs) return false;
  const n = cs.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return CS_OCULTOS.some((h) => n.includes(h));
}

// Nome-completo (coluna "CS" people) → nome curto (coluna de status). Só os CSs
// que receberam clientes da Yasmin. Fallback: primeiro nome capitalizado.
const CS_NOME_CANONICO: Record<string, string> = {
  'laura cordova de sa': 'Laura',
  'lilian tavares': 'Lilian',
  'julia branco': 'Julia',
};

/** Do texto da coluna "CS" people (ex: "Yasmin de Souza Xavier, Laura Cordova
 *  de Sá"), retorna o nome curto do 1º CS que NÃO é oculto (o novo
 *  responsável), ou null se só houver CS oculto/vazio. */
export function resolveCsFromPeople(peopleText: string | null | undefined): string | null {
  if (!peopleText) return null;
  for (const nome of peopleText.split(',').map((p) => p.trim()).filter(Boolean)) {
    if (isCsOculto(nome)) continue;
    const norm = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    if (CS_NOME_CANONICO[norm]) return CS_NOME_CANONICO[norm];
    const primeiro = nome.trim().split(/\s+/)[0];
    return primeiro.charAt(0).toUpperCase() + primeiro.slice(1);
  }
  return null;
}

// ============================================================================
// REATRIBUIÇÃO DE CS — CS que saiu da empresa (ex: Yasmin)
// ============================================================================
// Quando um CS sai e seus clientes são redistribuídos no Monday, o histórico
// dele NÃO pode ser jogado no novo CS. Solução: pros clientes listados, as
// MÉTRICAS DE CS só contam A PARTIR de `cutoff` — leads/spend anteriores somem
// (não entram no novo CS).
//
// IMPORTANTE: afeta SOMENTE a atribuição de CS (aba CS + Apresentação). O
// gestor de tráfego desses clientes mantém o histórico completo.
//
// Escopo: só os clientes ATIVOS no período que de fato foram reatribuídos —
// detectados nos activity logs da coluna "CS do projeto" (color4) saindo de
// "Yasmin". O novo CS vem automaticamente do valor atual do Monday.
// (Ex-clientes da Yasmin churned/sem vínculo Meta não impactam as métricas.)
export const CS_REATRIBUICAO_CUTOFF = '2026-06-01T00:00:00-03:00';

export const CS_REATRIBUICAO_CLIENT_IDS: string[] = [
  '10675453641', // TK Clinic — Yasmin → Paula (vínculo Meta ativo)
  '7329127133',  // Dra Bárbara Iglesias — Yasmin → Laura (ativo; sem vínculo Meta ainda)
];

/** Data-piso de reatribuição de CS do cliente: na visão de CS, leads/spend
 *  ANTES dela não contam. null se o cliente não foi reatribuído. */
export function getCsReassignFloor(mondayClientId: string): Date | null {
  // 1) Override de CS (Yasmin → novo CS): piso = data em que o cliente mudou
  //    (cada cliente tem a sua, vinda do Monday).
  const ov = CS_OVERRIDE[mondayClientId];
  if (ov?.since) {
    const d = new Date(ov.since);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // 2) Reatribuição clássica (color4 já trocado no Monday): cutoff único.
  if (CS_REATRIBUICAO_CLIENT_IDS.includes(mondayClientId)) {
    const d = new Date(CS_REATRIBUICAO_CUTOFF);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

// ============================================================================
// SPEND ZERADO ATÉ A DATA (por cliente)
// ============================================================================
// Pra clientes cujo GASTO histórico não deve contar (ex: conta Meta trocada,
// valor errado, gasto de outra fase). O spend ANTES do cutoff é ignorado em
// Gestor/CS/Apresentação; a partir do cutoff conta normal. NÃO afeta leads nem
// transferências — só o investido e o CPT.
export const CLIENT_SPEND_FLOORS: Record<string, string> = {
  // Dra. Melissa Chacon — spend zerado; conta a partir de 01/06/2026.
  '12016584809': '2026-06-01T00:00:00-03:00',
};

/** Data a partir da qual o spend do cliente passa a contar (gasto anterior é
 *  ignorado), ou null se não há piso de spend pra esse cliente. */
export function getClientSpendFloor(mondayClientId: string): Date | null {
  const iso = CLIENT_SPEND_FLOORS[mondayClientId];
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ============================================================================
// GOOGLE ADS — vínculo manual conta → cliente Monday
// ============================================================================
// O matching automático é por NOME (conta Google × cliente Monday). Quando o
// nome não casa (aparece em "googleOrfaos" no console / diagnóstico), adicione
// aqui: '<customer_id sem traços>': '<monday_client_id>'.
export const GOOGLE_ADS_LINKS: Record<string, string> = {
  // ex.: '5890334900': '11093674024',
};

/** monday_client_id vinculado manualmente à conta Google Ads, ou null. */
export function getGoogleAdsLink(googleAccountId: string): string | null {
  return GOOGLE_ADS_LINKS[googleAccountId] ?? null;
}

// ============================================================================
// OVERRIDE DE DOUTOR POR TOKEN (uazapi)
// ============================================================================
// Quando uma instância uazapi é renomeada/configurada com o doutor ERRADO no
// Bia Soft, os leads chegam com nomeDoutor errado (ex: token da Dra Íris
// enviando como "Dr. Breno"). O token é a verdade — este mapa força o
// nomeDoutor certo pra TODOS os leads do token, no carregamento (useLeads).
// Histórico no banco também foi corrigido; isto garante os leads FUTUROS até
// arrumarem o nome da instância na origem.
export const TOKEN_DOUTOR_OVERRIDES: Record<string, string> = {
  // Instância da Dra Íris Chesini — renomeada errado pra "Dr. Breno de Souza"
  // em 22/05/2026. O Breno real usa o token bdc7df29-….
  'dab0f451-dcd3-4876-9094-ed6f20fc749c': 'Dra Íris Chesini',
  // Instância do Dr. Daniel Sales — configurada errada como "Dr. Guilherme
  // Machado" nos 2 primeiros dias (20-22/05/2026). O Guilherme real usa o
  // token 4e68daa6-….
  'fb8851d2-209b-4430-bd4d-cd855a6e2bed': 'Dr. Daniel Sales',
};

/** nomeDoutor forçado pro token, ou null se não há override. */
export function getTokenDoutorOverride(token: string | null | undefined): string | null {
  if (!token) return null;
  return TOKEN_DOUTOR_OVERRIDES[token] ?? null;
}

// ============================================================================
// CAMPANHAS META EXCLUÍDAS DAS MÉTRICAS
// ============================================================================
// Lista de campanhas que NÃO devem contar no spend/CPT/conversão do gestor/CS.
// IMPORTANTE: a campanha NÃO é alterada no Meta — continua rodando normal lá.
// O app só ignora ela quando agrega métricas.
//
// Match: (accountId === act_id) AND (campaign_name contém substring).
// Use a substring mais distintiva possível pra evitar falso-positivo.
//
// Quando usar: campanha experimental, de teste, de curso/produto secundário,
// ou qualquer campanha que distorce as métricas do cliente principal.
export interface CampaignExclusion {
  /** account_id (act_xxx) onde a campanha vive. */
  accountId: string;
  /** Substring case-insensitive que identifica a campanha. */
  campaignNameContains: string;
  /** Nota livre pra documentar quem/por quê. */
  motivo?: string;
}

export const CAMPAIGN_EXCLUSIONS: CampaignExclusion[] = [
  {
    accountId: 'act_1351675795945538',
    campaignNameContains: '[CURSO-IMPLANTE]',
    motivo: 'Dr. Fabiano Miranzi — campanha de curso, não conta nas métricas',
  },
];

/** Retorna true se a campanha está na lista de exclusões. */
export function isCampaignExcluida(accountId: string, campaignName: string): boolean {
  if (!accountId || !campaignName) return false;
  const nameLower = campaignName.toLowerCase();
  return CAMPAIGN_EXCLUSIONS.some(
    (e) =>
      e.accountId === accountId &&
      nameLower.includes(e.campaignNameContains.toLowerCase()),
  );
}

export function isGestorExcluido(nome: string | null | undefined): boolean {
  if (!nome) return false;
  const n = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  return GESTORES_EXCLUIDOS.some((g) => n === g || n.includes(g));
}

// Designers ATIVOS no time. Outros nomes (ex-funcionários, freelas pontuais)
// não aparecem na aba Design. Adicione/remova quando o time mudar.
// O match é substring case-insensitive, sem acento.
export const DESIGNERS_ATIVOS = [
  'felipe moraes',
  'paulo henrique',
  'lais beisheim',
  'camile de oliveira',
];

export function isDesignerAtivo(nome: string | null | undefined): boolean {
  if (!nome) return false;
  const n = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  return DESIGNERS_ATIVOS.some((d) => n.includes(d));
}

// Mapeamento "fragmento canônico" → "label de exibição".
// Necessário porque o Monday pode trazer "Felipe Moraes, Jean Carlos Tigre"
// (designer dividido). Queremos atribuir essa demanda APENAS ao designer ativo
// (Felipe), nunca aparecer combo na UI.
export const DESIGNER_LABELS: Record<string, string> = {
  'felipe moraes': 'Felipe Moraes',
  'paulo henrique': 'Paulo Henrique Pires Da Silva',
  'lais beisheim': 'Lais Beisheim',
  'camile de oliveira': 'Camile',
};

// Foto "modo herói" — aparece com efeito de fogo verde quando o designer
// bate 1 salário. Salvar os arquivos em public/designers/<nome>.png
export const DESIGNER_FOTOS: Record<string, string> = {
  'felipe moraes': '/designers/felipe.png',
  'paulo henrique': '/designers/paulo.png',
  'lais beisheim': '/designers/lais.png',
};

/** Caminho da foto do designer (qualquer variação do nome). */
export function getDesignerFoto(nome: string | null | undefined): string | null {
  if (!nome) return null;
  const n = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  for (const [frag, path] of Object.entries(DESIGNER_FOTOS)) {
    if (n.includes(frag)) return path;
  }
  return null;
}

// Designer que entrou no meio do tempo: a métrica dele só conta A PARTIR desta
// data — eventos anteriores não contam e o denominador de "demandas/dia" começa
// aqui (o "Dia D" dele fica mais curto). Ele continua aparecendo normalmente nos
// filtros (Dia D / Hoje / etc.), só com o período interno encurtado.
export const DESIGNER_INICIO: Record<string, string> = {
  // Camile entrou em 01/06/2026. (chave 'camile' casa com o label curto "Camile")
  'camile': '2026-06-01T00:00:00-03:00',
};

/** Data de início do designer (quando entrou no meio do período), ou null. */
export function getDesignerInicio(nome: string | null | undefined): Date | null {
  if (!nome) return null;
  const n = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  for (const [frag, iso] of Object.entries(DESIGNER_INICIO)) {
    if (n.includes(frag)) {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/**
 * Pra um campo `designer_responsavel` que pode conter múltiplos nomes
 * (separados por vírgula, ex: "Felipe Moraes, Jean Carlos Tigre"), retorna
 * o LABEL canônico do PRIMEIRO designer ativo encontrado. Retorna null se
 * nenhum ativo casar (designer 100% inativo ou sem nome).
 */
export function primeiroDesignerAtivo(nome: string | null | undefined): string | null {
  if (!nome) return null;
  const partes = nome.split(',').map((p) => p.trim()).filter(Boolean);
  for (const parte of partes) {
    const n = parte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    for (const fragmento of DESIGNERS_ATIVOS) {
      if (n.includes(fragmento)) {
        return DESIGNER_LABELS[fragmento] ?? parte;
      }
    }
  }
  return null;
}

// Fingerprint do token (primeiros 6 chars + tamanho) pra diagnóstico no UI.
// Não expõe o token completo.
export function tokenFingerprint(token: string): string {
  if (!token) return '(vazio)';
  const head = token.slice(0, 6);
  return `${head}… (${token.length} chars)`;
}

export function assertConfig(): string[] {
  const missing: string[] = [];
  if (!config.SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
  if (!config.SUPABASE_SERVICE_ROLE_SECRET) missing.push('VITE_SUPABASE_SERVICE_ROLE_SECRET');
  if (!config.UAZAPI_URL) missing.push('VITE_UAZAPI_URL');
  if (!config.UAZAPI_TOKEN) missing.push('VITE_UAZAPI_TOKEN');
  return missing;
}

export function assertGestorConfig(): string[] {
  const missing: string[] = [];
  const hasAnyToken = config.META_ACCOUNTS.some((a) => a.token);
  if (!hasAnyToken) {
    missing.push('VITE_META_TOKEN_RENAN, VITE_META_TOKEN_WESLEI ou VITE_META_TOKEN_ANDRE');
  }
  if (!config.MONDAY_TOKEN) missing.push('VITE_MONDAY_TOKEN');
  if (!config.MONDAY_BOARD_ID) missing.push('VITE_MONDAY_BOARD_ID');
  return missing;
}

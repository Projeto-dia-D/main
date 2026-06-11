import { config, type MetaAccount } from '../config';
import { errorMessage } from './errors';

const GRAPH_VERSION = 'v23.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type GestorName = MetaAccount['gestor'];

export interface AdAccountInfo {
  id: string;        // ex: "act_1234567890"
  account_id: string; // ex: "1234567890"
  name: string;
  gestor: GestorName;
}

export interface CampaignInsight {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  gestor: GestorName;
  accountId: string;
  accountName: string;
  /** Data do registro quando vem em granularidade diária (time_increment=1).
   *  Vazio quando os insights vêm agregados (modo antigo). */
  date?: string; // YYYY-MM-DD
}

interface RawInsightRow {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  date_start?: string;
}

interface InsightsResponse {
  data?: RawInsightRow[];
  paging?: { next?: string };
  error?: { message?: string };
}

interface AdAccountsResponse {
  data?: Array<{ id?: string; account_id?: string; name?: string }>;
  paging?: { next?: string };
  error?: { message?: string };
}

const FIM_VENDA_RE = /\b(fim|fins|venda|vendas)\b/i;
// Captura tag [LEAD] ou [LEADS] em qualquer posição do nome
// (ex: "[LEAD] [WHATSAPP] [TJM]", "[CBO] [LEADS] [AGO25]", "🔵[LEAD] ...")
const LEADS_TAG_RE = /\[\s*leads?\s*\]/i;

export function isFimVenda(campaignName: string): boolean {
  return FIM_VENDA_RE.test(campaignName) || LEADS_TAG_RE.test(campaignName);
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface MetaFetchRange {
  start: Date | null;
  end: Date | null;
}

/** Remove acentos e baixa caixa pra comparações robustas. */
function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function getGestorConfig(gestor: string): MetaAccount {
  const target = normalizeName(gestor);
  const acc = config.META_ACCOUNTS.find((a) => normalizeName(a.gestor) === target);
  if (!acc) throw new Error(`Gestor "${gestor}" não está configurado no .env`);
  if (!acc.token) throw new Error(`Token do gestor "${gestor}" vazio no .env`);
  return acc;
}

/**
 * Retorna TODAS as contas configuradas que tem token. Usado pra fallback:
 * quando o gestor vinculado não tem token (ou nem é um dos 3 do .env),
 * tentamos puxar spend usando cada token disponível.
 */
export function getAllConfiguredAccounts(): MetaAccount[] {
  return config.META_ACCOUNTS.filter((a) => a.token);
}

/**
 * Lista todas as contas de anúncios acessíveis pelo token de UM gestor.
 * Cache externo (no hook) — esta função sempre busca.
 */
export async function fetchAdAccountsByGestor(
  gestor: GestorName
): Promise<AdAccountInfo[]> {
  const acc = getGestorConfig(gestor);

  // Se o usuário fixou um accountId específico no .env, retorna apenas ele
  if (acc.accountId) {
    try {
      const url = `${GRAPH_BASE}/${acc.accountId}?fields=name,account_id&access_token=${encodeURIComponent(
        acc.token
      )}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.error) {
        return [
          {
            id: acc.accountId,
            account_id: acc.accountId.replace(/^act_/, ''),
            name: acc.accountId,
            gestor: acc.gestor,
          },
        ];
      }
      return [
        {
          id: acc.accountId,
          account_id: data.account_id ?? acc.accountId.replace(/^act_/, ''),
          name: data.name ?? acc.accountId,
          gestor: acc.gestor,
        },
      ];
    } catch {
      return [
        {
          id: acc.accountId,
          account_id: acc.accountId.replace(/^act_/, ''),
          name: acc.accountId,
          gestor: acc.gestor,
        },
      ];
    }
  }

  const out: AdAccountInfo[] = [];
  let url: string | null = `${GRAPH_BASE}/me/adaccounts?fields=name,account_id&limit=200&access_token=${encodeURIComponent(
    acc.token
  )}`;

  for (let i = 0; i < 10 && url; i++) {
    const res = await fetch(url);
    const data: AdAccountsResponse = await res.json();
    if (!res.ok || data.error) {
      throw new Error(`[Meta ${acc.gestor}] ${data.error?.message ?? res.statusText}`);
    }
    for (const a of data.data ?? []) {
      if (!a.id) continue;
      out.push({
        id: a.id,
        account_id: a.account_id ?? a.id.replace(/^act_/, ''),
        name: a.name ?? a.id,
        gestor: acc.gestor,
      });
    }
    url = data.paging?.next ?? null;
  }

  return out;
}

function buildInsightsUrl(
  acc: MetaAccount,
  adAccountId: string,
  range: MetaFetchRange,
  daily: boolean = false
): string {
  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend',
    limit: '500',
    access_token: acc.token,
  });

  if (daily) {
    params.set('time_increment', '1');
  }

  if (range.start && range.end) {
    params.set(
      'time_range',
      JSON.stringify({ since: fmtDate(range.start), until: fmtDate(range.end) })
    );
  } else {
    params.set('date_preset', 'maximum');
  }

  return `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`;
}

async function fetchInsightsForAdAccount(
  acc: MetaAccount,
  adAccount: { id: string; name: string },
  range: MetaFetchRange,
  daily: boolean = false
): Promise<CampaignInsight[]> {
  const out: CampaignInsight[] = [];
  let url: string | null = buildInsightsUrl(acc, adAccount.id, range, daily);

  for (let i = 0; i < 20 && url; i++) {
    const res = await fetch(url);
    const data: InsightsResponse = await res.json();
    if (!res.ok || data.error) {
      throw new Error(
        `[Meta ${acc.gestor} / ${adAccount.name}] ${data.error?.message ?? res.statusText}`
      );
    }
    for (const row of data.data ?? []) {
      const spend = parseFloat(row.spend ?? '0') || 0;
      out.push({
        campaign_id: row.campaign_id ?? '',
        campaign_name: row.campaign_name ?? '',
        spend,
        gestor: acc.gestor,
        accountId: adAccount.id,
        accountName: adAccount.name,
        date: daily ? row.date_start : undefined,
      });
    }
    url = data.paging?.next ?? null;
  }

  return out;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface LinkForInsights {
  meta_account_id: string;
  meta_account_name: string | null;
  gestor: string | null;
}

export interface FetchInsightsResult {
  insights: CampaignInsight[];
  errors: string[];
  /** IDs (act_XXX) das contas Meta que **falharam nesta chamada** — seja
   *  por rate limit, timeout, BM desconectada, etc. Permite ao consumidor
   *  preservar os insights anteriores dessas contas em vez de substituir
   *  por array vazio (que causaria oscilação de valores entre refreshes). */
  failedAccountIds: Set<string>;
  /** IDs (act_XXX) das contas Meta que foram CONSULTADAS (sem erro).
   *  Usado pra saber quais contas têm insights "frescos" nesta chamada. */
  succeededAccountIds: Set<string>;
}

/**
 * Busca insights APENAS das contas listadas em `links`. Sem discovery.
 * Usa direto o account_id + gestor do link pra resolver token.
 *
 * @param daily se true, traz granularidade diária (time_increment=1) — usado
 *   para excluir spend de períodos em Manutenção via timeline do Bia Soft.
 */
// Blacklist de sessão: conta que falhou com TODOS os tokens fica fora por
// 15 min. Sem isso, CADA load re-tentava as ~10 contas mortas (dono revogou
// acesso) com 2 tokens cada — segundos perdidos em toda atualização.
const deadAccountUntil = new Map<string, number>();
const DEAD_ACCOUNT_TTL_MS = 15 * 60 * 1000;

export async function fetchInsightsForLinks(
  range: MetaFetchRange,
  links: LinkForInsights[],
  daily: boolean = false
): Promise<FetchInsightsResult> {
  const errors: string[] = [];
  const allInsights: CampaignInsight[] = [];
  const failedAccountIds = new Set<string>();
  const succeededAccountIds = new Set<string>();

  // Tokens disponíveis no .env, exclui Renan se vazio (verificado por has-token).
  // Usado como FALLBACK quando o gestor declarado no vínculo não consegue ler
  // a conta (403). Casos comuns: vínculo cadastrado com gestor errado, conta
  // migrada de BM entre gestores, etc.
  const availableTokens: MetaAccount[] = config.META_ACCOUNTS.filter((a) => a.token);

  const byGestor = new Map<string, LinkForInsights[]>();
  for (const l of links) {
    if (!l.gestor || !l.meta_account_id) continue;
    const arr = byGestor.get(l.gestor) ?? [];
    arr.push(l);
    byGestor.set(l.gestor, arr);
  }

  await Promise.all(
    Array.from(byGestor.entries()).map(async ([gestor, gestorLinks]) => {
      let primaryAcc: MetaAccount | null = null;
      try {
        primaryAcc = getGestorConfig(gestor);
      } catch (e) {
        // Sem token do gestor declarado — tenta direto os fallbacks. Só
        // reporta erro se TODOS os fallbacks também falharem (capturado por
        // conta abaixo).
        if (availableTokens.length === 0) {
          errors.push(errorMessage(e));
          for (const l of gestorLinks) failedAccountIds.add(l.meta_account_id);
          return;
        }
      }

      const targets = gestorLinks.map((l) => ({
        id: l.meta_account_id,
        name: l.meta_account_name ?? l.meta_account_id,
      }));

      const results = await mapWithConcurrency(targets, 5, async (ad) => {
        // Conta na blacklist (falhou com todos os tokens há <15 min): pula
        // direto — não desperdiça tempo re-tentando a cada load.
        const deadUntil = deadAccountUntil.get(ad.id);
        if (deadUntil && Date.now() < deadUntil) {
          failedAccountIds.add(ad.id);
          return [] as CampaignInsight[];
        }
        // Lista ordenada de tentativas: primário (declarado) primeiro, depois
        // os outros tokens disponíveis (sem duplicar o primário).
        const tries: MetaAccount[] = [];
        if (primaryAcc) tries.push(primaryAcc);
        for (const t of availableTokens) {
          if (!tries.find((x) => x.gestor === t.gestor)) tries.push(t);
        }

        let lastErr: unknown = null;
        for (let i = 0; i < tries.length; i++) {
          const acc = tries[i];
          try {
            const rows = await fetchInsightsForAdAccount(acc, ad, range, daily);
            succeededAccountIds.add(ad.id);
            deadAccountUntil.delete(ad.id);
            // Sucesso com um fallback (não foi o primário): registra aviso pra
            // o admin saber que o vínculo está com gestor errado no banco —
            // ajuda a fazer manutenção, mas não é fatal.
            if (i > 0 && primaryAcc) {
              errors.push(
                `[fallback] ${ad.name} (${ad.id}): declarado=${primaryAcc.gestor}, funcionou com ${acc.gestor}`,
              );
            }
            return rows;
          } catch (e) {
            lastErr = e;
            // Continua tentando os outros tokens
          }
        }

        // Todos os tokens falharam — registra erro, marca como falha e entra
        // na blacklist de sessão (15 min sem re-tentar).
        errors.push(errorMessage(lastErr));
        failedAccountIds.add(ad.id);
        deadAccountUntil.set(ad.id, Date.now() + DEAD_ACCOUNT_TTL_MS);
        return [] as CampaignInsight[];
      });
      for (const rows of results) allInsights.push(...rows);
    })
  );

  return { insights: allInsights, errors, failedAccountIds, succeededAccountIds };
}


// ============================================================================
// ADS / SAUDAÇÃO AUTOMÁTICA
// ============================================================================
//
// Pega a mensagem PRE-FILLED do click-to-WhatsApp/Messenger — aquele
// "Olá, vi seu anúncio sobre..." que JA VEM DIGITADO no WhatsApp quando o
// lead clica no anuncio. Util pros devs/admin auditarem o copy que cada
// doutor configurou.
//
// CUIDADO: NAO confundir com:
//   - creative.object_story_spec.link_data.message → POST TEXT (descricao no feed)
//   - creative.asset_feed_spec.bodies[].text       → variacoes do post text
//
// O prefill DE VERDADE mora no LINK de destino:
//   creative.object_story_spec.link_data.link  =
//      "https://wa.me/55XX?text=Ol%C3%A1%20vi%20seu%20an%C3%BAncio..."
//   creative.asset_feed_spec.link_urls[].whatsapp_url  =  idem (DCO)
//   creative.asset_feed_spec.link_urls[].website_url   =  fallback (alguns ads tem aqui)
//
// A gente parseia esse URL e pega o query param `text=`, URL-decoded.

export interface AdWithMessage {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  /** Mensagem pre-preenchida que o LEAD manda ao clicar
   *  ("Olá, vi seu anúncio sobre..."). Vem do `?text=` do link wa.me OU do
   *  template salvo no Configurador de Conversa (welcome_message_template). */
  prefill: string | null;
  /** Mensagem de BOAS-VINDAS que o BUSINESS manda ao lead ("Olá! Seja bem-vindo!").
   *  Configurada no Configurador de Conversa do ad. */
  welcomeMessage: string | null;
  /** Nome do template salvo ("LENTE EM RESINA - BURST"), se houver. */
  templateName: string | null;
  /** Numero de WhatsApp pro qual o ad direciona (sem formatacao). */
  whatsappPhone: string | null;
  /** URL completa do destino (wa.me ou m.me) — util pra debug. */
  destinationUrl: string | null;
  /** Texto do post (descricao do feed). E o que aparece embaixo da imagem
   *  na timeline — NAO e a prefill. Mantido pra contexto. */
  postText: string | null;
  /** Variacoes do post text (DCO/responsive). */
  postTextVariants: string[];
  /** CTA configurado (WHATSAPP_MESSAGE, MESSAGE_PAGE, LEARN_MORE, etc.). */
  ctaType: string | null;
  /** Permalink pra abrir o anuncio direto no Ads Manager. */
  adsManagerUrl: string;
  /** JSON cru do creative — pra debug quando o campo nao bate. */
  rawCreative: unknown;
}

interface RawAdLinkUrl {
  whatsapp_url?: string;
  website_url?: string;
  display_url?: string;
}

interface RawAd {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  creative?: {
    id?: string;
    name?: string;
    object_story_spec?: {
      link_data?: {
        message?: string;
        link?: string;
        call_to_action?: { type?: string; value?: { link?: string; app_link?: string } };
      };
    };
    asset_feed_spec?: {
      bodies?: Array<{ text?: string }>;
      link_urls?: RawAdLinkUrl[];
      call_to_action_types?: string[];
    };
  };
}

/**
 * Extrai o prefill (text=) de uma URL wa.me / api.whatsapp.com / m.me.
 * Tambem extrai o telefone do path.
 */
function parseWhatsappUrl(url: string | null | undefined): { prefill: string | null; phone: string | null } {
  if (!url) return { prefill: null, phone: null };
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // wa.me/55XX?text=...
    // api.whatsapp.com/send?phone=55XX&text=...
    // m.me/PAGE_ID?text=...
    let phone: string | null = null;
    if (host === 'wa.me' || host.endsWith('.wa.me')) {
      // Path = "/55XX"
      phone = u.pathname.replace(/^\//, '').replace(/\D/g, '') || null;
    } else if (host === 'api.whatsapp.com' || host.endsWith('.whatsapp.com')) {
      const p = u.searchParams.get('phone');
      if (p) phone = p.replace(/\D/g, '') || null;
    }
    const text = u.searchParams.get('text');
    return { prefill: text ? text.trim() : null, phone };
  } catch {
    return { prefill: null, phone: null };
  }
}

interface AdsResponse {
  data?: RawAd[];
  paging?: { next?: string };
  error?: { message?: string };
}

/**
 * Lista TODAS as contas Meta configuradas que tem token. Pra cada uma testa
 * se o token consegue acessar o account_id dado. Retorna a primeira que
 * funcionar. Usado quando a gente nao sabe (ou nao confia) em qual gestor
 * pode acessar a conta — caso comum quando o link no banco diz "Weslei" mas
 * o token do Weslei expirou, etc.
 */
async function findTokenForAccount(accountId: string): Promise<MetaAccount | null> {
  const tokens = getAllConfiguredAccounts();
  for (const acc of tokens) {
    try {
      const url = `${GRAPH_BASE}/${accountId}?fields=id&access_token=${encodeURIComponent(acc.token)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error) return acc;
      }
    } catch {
      /* tenta proximo */
    }
  }
  return null;
}

/**
 * Busca todos os ads (ACTIVE + PAUSED, exclui DELETED/ARCHIVED) de uma conta
 * Meta e extrai a mensagem pre-preenchida + CTA de cada um.
 *
 * Tenta o token preferido primeiro (se fornecido), senao varre todos os
 * tokens configurados ate achar um que acesse a conta.
 *
 * @param accountId  ex: "act_123456" ou "123456" — normaliza pros dois.
 * @param preferredGestor  se voce sabe quem provavelmente tem o token (ex:
 *                         link.gestor do client_meta_links), passa aqui pra
 *                         pular o probe.
 */
export async function fetchAdsWithMessage(
  accountId: string,
  preferredGestor?: string | null
): Promise<AdWithMessage[]> {
  const normalizedAct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

  // 1. Resolve token
  let acc: MetaAccount | null = null;
  if (preferredGestor) {
    try {
      acc = getGestorConfig(preferredGestor);
    } catch {
      /* gestor invalido — cai pro probe */
    }
  }
  if (!acc) {
    acc = await findTokenForAccount(normalizedAct);
  }
  if (!acc) {
    throw new Error('Nenhum token configurado consegue acessar essa conta.');
  }

  // 2. Pagina os ads. Pede o creative INTEIRO (varios sub-objetos) porque o
  //    template do "Configurador de Conversa" pode vir em multiplos lugares
  //    dependendo da versao do ad:
  //    - object_story_spec.link_data.message (post text)
  //    - object_story_spec.link_data.welcome_message (template salvo: boas-vindas)
  //    - object_story_spec.link_data.app_link_spec.* (template novo)
  //    - asset_feed_spec.* (DCO)
  //    - degrees_of_freedom_spec (DCO mais novo)
  //    - interactive_components_spec (novissimo)
  //    A gente extrai do primeiro lugar que tiver dados.
  const fields = [
    'id',
    'name',
    'status',
    'effective_status',
    'creative{id,name,object_story_spec,asset_feed_spec,degrees_of_freedom_spec,interactive_components_spec,template_url_spec,destination_set_id,product_set_id}',
  ].join(',');

  const out: AdWithMessage[] = [];
  let url =
    `${GRAPH_BASE}/${normalizedAct}/ads` +
    `?fields=${encodeURIComponent(fields)}` +
    `&limit=100` +
    `&effective_status=${encodeURIComponent('["ACTIVE","PAUSED","PENDING_REVIEW","DISAPPROVED","PREAPPROVED","PENDING_BILLING_INFO","CAMPAIGN_PAUSED","ADSET_PAUSED","IN_PROCESS","WITH_ISSUES"]')}` +
    `&access_token=${encodeURIComponent(acc.token)}`;

  while (url) {
    const res = await fetch(url);
    const data = (await res.json()) as AdsResponse;
    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? `HTTP ${res.status} ao buscar ads.`);
    }
    for (const ad of data.data ?? []) {
      const creative = ad.creative ?? {};
      const linkData = ad.creative?.object_story_spec?.link_data;
      const assetFeed = ad.creative?.asset_feed_spec;
      const feedBodies = assetFeed?.bodies ?? [];
      const feedUrls = assetFeed?.link_urls ?? [];

      // ===== PREFILL (lead → business) =====
      // 1. Procura primeiro nos campos com nome "prefill/whatsapp_message/etc"
      //    no link_data e em sub-objetos.
      const extracted = extractMessagesFromCreative(creative);

      // 2. Se nao achou prefill em campo nomeado, parseia URLs de destino
      //    (legado: prefill via ?text= no link wa.me).
      const candidateUrls: string[] = [];
      if (linkData?.link) candidateUrls.push(linkData.link);
      if (linkData?.call_to_action?.value?.link) candidateUrls.push(linkData.call_to_action.value.link);
      if (linkData?.call_to_action?.value?.app_link) candidateUrls.push(linkData.call_to_action.value.app_link);
      for (const lu of feedUrls) {
        if (lu.whatsapp_url) candidateUrls.push(lu.whatsapp_url);
        if (lu.website_url) candidateUrls.push(lu.website_url);
      }

      let prefill: string | null = extracted.prefill;
      let phone: string | null = null;
      let destinationUrl: string | null = null;
      for (const candidate of candidateUrls) {
        const parsed = parseWhatsappUrl(candidate);
        if (parsed.prefill || parsed.phone) {
          if (!destinationUrl) destinationUrl = candidate;
          if (parsed.prefill && !prefill) prefill = parsed.prefill;
          if (parsed.phone && !phone) phone = parsed.phone;
          if (prefill && phone) break;
        }
      }
      if (!destinationUrl && candidateUrls.length > 0) destinationUrl = candidateUrls[0];

      const postTextVariants = feedBodies
        .map((b) => (b.text ?? '').trim())
        .filter((s) => s.length > 0);
      const cta =
        linkData?.call_to_action?.type ??
        assetFeed?.call_to_action_types?.[0] ??
        null;

      out.push({
        id: ad.id,
        name: ad.name ?? '(sem nome)',
        status: ad.status ?? '?',
        effective_status: ad.effective_status ?? '?',
        prefill,
        welcomeMessage: extracted.welcomeMessage,
        templateName: extracted.templateName,
        whatsappPhone: phone,
        destinationUrl,
        postText: (linkData?.message ?? '').trim() || null,
        postTextVariants,
        ctaType: cta,
        adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${normalizedAct.replace(/^act_/, '')}&selected_ad_ids=${ad.id}`,
        rawCreative: creative,
      });
    }
    url = data.paging?.next ?? '';
  }

  return out;
}


/**
 * Varre RECURSIVAMENTE o objeto creative procurando os campos do template
 * do "Configurador de Conversa" do Meta (welcome message + prefill message).
 *
 * O Meta enterra esses dados em paths variaveis dependendo da versao do ad:
 *   - creative.object_story_spec.link_data.welcome_message
 *   - creative.object_story_spec.link_data.app_link_spec.welcome_message
 *   - creative.interactive_components_spec.components[].welcome_message
 *   - creative.degrees_of_freedom_spec.creative_features.*
 *
 * Em vez de tentar cada path manualmente, a gente faz uma busca recursiva
 * pelas CHAVES que sao tipicamente usadas pra essas mensagens. Mais resiliente
 * a mudanca na API.
 */
function extractMessagesFromCreative(creative: unknown): {
  prefill: string | null;
  welcomeMessage: string | null;
  templateName: string | null;
} {
  let prefill: string | null = null;
  let welcomeMessage: string | null = null;
  let templateName: string | null = null;

  function isLikelyString(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0;
  }

  // Tenta parsear strings que podem ser JSON encoded (Meta as vezes guarda
  // a config do Configurador de Conversa como string serializada).
  function tryParseJsonString(v: unknown): unknown {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return v;
    try {
      return JSON.parse(trimmed);
    } catch {
      return v;
    }
  }

  function walk(obj: unknown, parentKey: string = '', depth: number = 0): void {
    if (depth > 12) return;
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, parentKey, depth + 1);
      return;
    }
    if (typeof obj === 'string') {
      // Pode ser JSON encoded — tenta parsear e continuar
      const parsed = tryParseJsonString(obj);
      if (parsed !== obj && typeof parsed === 'object') walk(parsed, parentKey, depth + 1);
      return;
    }
    if (typeof obj !== 'object') return;

    const rec = obj as Record<string, unknown>;

    // === MATCH PRINCIPAL: text_format.message.autofill_message.content ===
    // E onde o "Configurador de Conversa" do Meta guarda o prefill ("Olá tenho
    // interesse em..."). Estrutura confirmada via inspecao real (template_id
    // 1445818483738633 do user).
    if (!prefill && rec.autofill_message && typeof rec.autofill_message === 'object') {
      const am = rec.autofill_message as Record<string, unknown>;
      if (isLikelyString(am.content)) {
        prefill = am.content.trim();
      }
    }

    // Welcome / text status ("🟢Online..." etc) — guardado em message.text
    // junto com o autofill_message. Pega so se ja achamos um autofill_message
    // no mesmo escopo, pra evitar pegar "text" de outro lugar.
    if (
      !welcomeMessage &&
      rec.autofill_message &&
      typeof rec.text === 'string' &&
      isLikelyString(rec.text)
    ) {
      welcomeMessage = rec.text.trim();
    }

    // Template id (1445818483738633) — guarda como "modelo X" no card
    if (!templateName && rec.template_id && isLikelyString(rec.template_id)) {
      templateName = `template ${rec.template_id}`;
    }

    // === FALLBACKS por chave nomeada (varias versoes da API) ===
    const PREFILL_KEYS = ['prefilled_message', 'whatsapp_message', 'wa_message', 'sample_message'];
    const WELCOME_KEYS = ['welcome_message', 'greeting_message', 'greeting', 'first_message'];

    for (const [k, v] of Object.entries(rec)) {
      const kLower = k.toLowerCase();
      if (!prefill && PREFILL_KEYS.includes(kLower) && isLikelyString(v)) {
        prefill = v.trim();
      }
      if (!welcomeMessage && WELCOME_KEYS.includes(kLower) && isLikelyString(v)) {
        welcomeMessage = v.trim();
      }
      walk(v, kLower, depth + 1);
    }
  }

  walk(creative);
  return { prefill, welcomeMessage, templateName };
}


/**
 * Tenta buscar a SAUDACAO AUTOMATICA do WhatsApp Business pela UAZAPI.
 * E aquele "Olá, como posso te ajudar?" que o doutor configura no WhatsApp
 * Business pra responder automaticamente o primeiro contato.
 *
 * UAZAPI expoe via endpoint que varia conforme versao — tentamos 2 caminhos:
 *   1. /instance/welcome  (algumas versoes)
 *   2. /chatbot          (mais recente — devolve config do chatbot ativo)
 *
 * Como o numero do anuncio nao necessariamente bate com a instancia UAZAPI
 * (o doutor pode ter WhatsApp pessoal recebendo os ads), retornar null e
 * normal — significa que a Burst nao tem instancia UAZAPI desse numero.
 */
export interface WhatsappGreeting {
  source: 'uazapi' | null;
  message: string | null;
  /** Numero da instancia que respondeu, se tiver. */
  phone: string | null;
}

export async function fetchWhatsappGreetingByPhone(
  whatsappPhone: string
): Promise<WhatsappGreeting> {
  const target = whatsappPhone.replace(/\D/g, '');
  if (!target) return { source: null, message: null, phone: null };

  const uazUrl = config.UAZAPI_URL;
  const uazAdmin = config.UAZAPI_TOKEN;
  if (!uazUrl || !uazAdmin) return { source: null, message: null, phone: null };

  try {
    // 1. Lista instancias e acha a que tem o numero alvo
    const r = await fetch(`${uazUrl}/instance/all`, {
      headers: { admintoken: uazAdmin, 'Content-Type': 'application/json' },
    });
    if (!r.ok) return { source: null, message: null, phone: null };
    const instances = (await r.json()) as Array<{
      token?: string;
      owner?: string;
      name?: string;
      welcome_message?: string;
      chatbot_message?: string;
    }>;
    const inst = instances.find((i) => {
      const owner = (i.owner ?? '').replace(/\D/g, '');
      return owner.endsWith(target.slice(-8)) || target.endsWith(owner.slice(-8));
    });
    if (!inst || !inst.token) return { source: null, message: null, phone: null };

    // 2. Tenta endpoints conhecidos de saudacao/welcome/chatbot
    for (const path of ['/chatbot', '/instance/welcome', '/welcome']) {
      try {
        const rr = await fetch(`${uazUrl}${path}`, {
          headers: { token: inst.token, 'Content-Type': 'application/json' },
        });
        if (rr.ok) {
          const data = await rr.json();
          // Tenta varios campos comuns
          const msg =
            data?.message ??
            data?.welcome_message ??
            data?.greeting ??
            data?.text ??
            data?.chatbot?.message ??
            null;
          if (msg && typeof msg === 'string' && msg.trim()) {
            return { source: 'uazapi', message: msg.trim(), phone: (inst.owner ?? '').replace(/\D/g, '') || null };
          }
        }
      } catch {
        /* tenta proximo */
      }
    }

    // 3. Fallback: a propria info da instancia ja vem com welcome_message
    if (inst.welcome_message) {
      return { source: 'uazapi', message: inst.welcome_message.trim(), phone: (inst.owner ?? '').replace(/\D/g, '') || null };
    }
    if (inst.chatbot_message) {
      return { source: 'uazapi', message: inst.chatbot_message.trim(), phone: (inst.owner ?? '').replace(/\D/g, '') || null };
    }
  } catch {
    /* engole */
  }
  return { source: null, message: null, phone: null };
}


// ============================================================================
// PRIMEIRA IMAGEM DE ANÚNCIO (pra ilustrar destaque do doutor)
// ============================================================================

interface RawAdImageOnly {
  id: string;
  effective_status?: string;
  creative?: {
    thumbnail_url?: string;
    object_story_spec?: {
      page_id?: string;
      link_data?: { picture?: string };
      video_data?: { image_url?: string };
    };
    asset_feed_spec?: {
      images?: Array<{ url?: string }>;
    };
  };
}

interface AdsImageResponse {
  data?: RawAdImageOnly[];
  error?: { message?: string };
}

/**
 * Pega a foto de PERFIL DA PAGINA do Facebook (geralmente o rosto do doutor)
 * via Graph API. Endpoint /{page-id}/picture?type=large retorna o CDN URL.
 */
async function fetchPageProfilePicture(
  pageId: string,
  token: string
): Promise<string | null> {
  try {
    const url = `${GRAPH_BASE}/${pageId}/picture?type=large&redirect=false&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const candidate = data?.data?.url;
    if (typeof candidate === 'string' && candidate.startsWith('http')) {
      return candidate;
    }
  } catch {
    /* engole */
  }
  return null;
}

/**
 * Busca uma foto pra representar o doutor — prioriza a FOTO DE PERFIL DA
 * PAGINA do Facebook ligada aos anuncios (que geralmente e o rosto do
 * doutor / consultorio). Cai pra primeira imagem de anuncio se a pagina
 * nao retornar foto.
 *
 * Fluxo:
 *  1. Pega 10 ads ACTIVE/PAUSED com page_id no creative
 *  2. Tenta a foto da pagina (rosto do doutor)
 *  3. Fallback: primeira imagem de anuncio (banner, etc)
 */
export async function fetchFirstAdImage(
  accountId: string,
  preferredGestor?: string | null
): Promise<string | null> {
  const normalizedAct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

  // Resolve token
  let acc: MetaAccount | null = null;
  if (preferredGestor) {
    try {
      acc = getGestorConfig(preferredGestor);
    } catch {
      /* gestor invalido — cai pro probe */
    }
  }
  if (!acc) {
    acc = await findTokenForAccount(normalizedAct);
  }
  if (!acc) return null;

  const fields = [
    'id',
    'effective_status',
    'creative{thumbnail_url,object_story_spec,asset_feed_spec}',
  ].join(',');

  const url =
    `${GRAPH_BASE}/${normalizedAct}/ads` +
    `?fields=${encodeURIComponent(fields)}` +
    `&limit=10` +
    `&effective_status=${encodeURIComponent('["ACTIVE","PAUSED"]')}` +
    `&access_token=${encodeURIComponent(acc.token)}`;

  try {
    const res = await fetch(url);
    const data = (await res.json()) as AdsImageResponse;
    if (!res.ok || data.error) return null;

    const ads = data.data ?? [];
    const sorted = [...ads].sort((a, b) => {
      if (a.effective_status === 'ACTIVE' && b.effective_status !== 'ACTIVE') return -1;
      if (b.effective_status === 'ACTIVE' && a.effective_status !== 'ACTIVE') return 1;
      return 0;
    });

    // === 1. Tenta FOTO DE PERFIL DA PAGINA (mais provavel ter o rosto) ===
    const pageIds = new Set<string>();
    for (const ad of sorted) {
      const pid = ad.creative?.object_story_spec?.page_id;
      if (pid) pageIds.add(pid);
    }
    for (const pid of pageIds) {
      const facePhoto = await fetchPageProfilePicture(pid, acc.token);
      if (facePhoto) return facePhoto;
    }

    // === 2. Fallback: primeira imagem do anuncio (pode ser banner/logo) ===
    for (const ad of sorted) {
      const candidatos: Array<string | undefined> = [
        ad.creative?.object_story_spec?.link_data?.picture,
        ad.creative?.thumbnail_url,
        ad.creative?.object_story_spec?.video_data?.image_url,
        ad.creative?.asset_feed_spec?.images?.[0]?.url,
      ];
      for (const c of candidatos) {
        if (c && typeof c === 'string' && c.startsWith('http')) {
          return c;
        }
      }
    }
  } catch {
    /* engole */
  }
  return null;
}

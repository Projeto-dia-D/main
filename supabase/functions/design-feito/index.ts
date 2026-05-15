// Edge Function: recebe webhook do Monday quando "Status do Designer" muda
// para "Feito" no board Central de Design e insere uma linha em design_demandas.
//
// Setup (resumo — instruções completas em supabase/functions/design-feito/README.md):
//   1. supabase functions deploy design-feito --no-verify-jwt
//   2. supabase secrets set MONDAY_TOKEN=... WEBHOOK_SECRET=... MONDAY_BOARD_ID=3519879202
//   3. Na Central de Design (Monday), criar Custom Automation:
//      Quando "Status do Designer" mudar para "Feito" → Send webhook to
//      https://<project>.supabase.co/functions/v1/design-feito?secret=<WEBHOOK_SECRET>

// @ts-expect-error Deno runtime imports
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// @ts-expect-error Deno runtime imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// @ts-expect-error Deno global
declare const Deno: { env: { get(key: string): string | undefined } };

const MONDAY_API = 'https://api.monday.com/v2';
const MONDAY_API_VERSION = '2024-01';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ColumnValue {
  id: string;
  title: string;
  text: string | null;
  value: string | null;
  type: string;
}

interface MondayItem {
  id: string;
  name: string;
  column_values: ColumnValue[];
}

// Título da coluna no Monday (normalizado) → coluna no Supabase
const COLUMN_MAP: Record<string, string> = {
  // Compartilhadas
  'link da demanda': 'link_demanda',
  'designer responsavel': 'designer_responsavel',
  'designer responsável': 'designer_responsavel',
  'padrao tarefa': 'padrao_tarefa',
  'padrão tarefa': 'padrao_tarefa',
  'tipo de edicao': 'tipo_edicao',
  'tipo de edição': 'tipo_edicao',
  'log de criacao': 'log_criacao',
  'log de criação': 'log_criacao',
  // Fluxo Feito
  'clientes': 'clientes',
  'prioridade': 'prioridade',
  'tempo atrasado!!!': 'tempo_atrasado',
  'tempo atrasado': 'tempo_atrasado',
  'status da tarefa': 'status_tarefa',
  'status do designer': 'status_designer',
  'priority': 'priority',
  // Fluxo Manutenção
  'status principal': 'status_principal',
  'status individual': 'status_individual',
  'gestor responsavel': 'gestor_responsavel',
  'gestor responsável': 'gestor_responsavel',
  'tipo de manutencao': 'tipo_manutencao',
  'tipo de manutenção': 'tipo_manutencao',
};

// A partir do label novo (event.value.label.text) decide o tipo de evento.
// "Feito" → 'feito'; "Manutenção C" → 'manutencao_c'; "Manutenção" (qualquer
// outra) → 'manutencao'. Qualquer outro valor cai no fallback 'feito' (não
// deve disparar a função de qualquer forma se a automation estiver certa).
function inferTipoEvento(newLabel: string | null): 'feito' | 'manutencao' | 'manutencao_c' {
  const n = (newLabel ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (n.startsWith('feito')) return 'feito';
  if (n.includes('manutencao c') || n.endsWith(' c') || n.endsWith(' c.')) return 'manutencao_c';
  if (n.includes('manutencao')) return 'manutencao';
  return 'feito';
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

async function fetchMondayItem(itemId: string, token: string): Promise<MondayItem | null> {
  const query = `query ($id: [ID!]) {
    items(ids: $id) {
      id
      name
      column_values {
        id
        title: column { title }
        text
        value
        type
      }
    }
  }`;
  // Nota: a sub-query column { title } depende de schema; se falhar, usa query mais simples
  let res = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': MONDAY_API_VERSION,
    },
    body: JSON.stringify({
      query: `query ($id: [ID!]) {
        items(ids: $id) {
          id
          name
          column_values { id text type }
        }
      }`,
      variables: { id: [itemId] },
    }),
  });

  if (!res.ok) {
    console.error('Monday API error', res.status, await res.text());
    return null;
  }

  const data = await res.json();
  if (data.errors) {
    console.error('Monday GraphQL errors', data.errors);
    return null;
  }

  const item = data?.data?.items?.[0];
  if (!item) return null;

  // Busca títulos das colunas do board pra mapear (cache simples por execução)
  const boardId = Deno.env.get('MONDAY_BOARD_ID') ?? '3519879202';
  const boardRes = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': MONDAY_API_VERSION,
    },
    body: JSON.stringify({
      query: `query ($id: ID!) {
        boards(ids: [$id]) { columns { id title } }
      }`,
      variables: { id: boardId },
    }),
  });
  const boardData = await boardRes.json();
  const columns: Array<{ id: string; title: string }> =
    boardData?.data?.boards?.[0]?.columns ?? [];
  const titleById = new Map(columns.map((c) => [c.id, c.title]));

  const cvs: ColumnValue[] = (item.column_values || []).map((cv: any) => ({
    id: cv.id,
    title: titleById.get(cv.id) ?? cv.id,
    text: cv.text ?? null,
    value: cv.value ?? null,
    type: cv.type ?? '',
  }));

  return { id: item.id, name: item.name, column_values: cvs };
}

function buildRecord(
  item: MondayItem,
  boardId: string,
  tipoEvento: 'feito' | 'manutencao' | 'manutencao_c',
  eventTimestamp: string,
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    nome: item.name,
    monday_item_id: String(item.id),
    origem: 'central',
    tipo_evento: tipoEvento,
    link_demanda: `${item.name} - https://burstmidia.monday.com/boards/${boardId}/pulses/${item.id}`,
    log_criacao: eventTimestamp,
  };

  // Pra demandas feitas, popula data_feito com o timestamp da transição.
  // Pra manutenções, deixa null (data_feito só faz sentido pra entregas).
  if (tipoEvento === 'feito') {
    record.data_feito = eventTimestamp;
  }

  for (const cv of item.column_values) {
    const key = COLUMN_MAP[normalize(cv.title)];
    if (key === 'log_criacao') continue;
    if (key && cv.text) {
      record[key] = cv.text;
    }
  }

  return record;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Validação simples: secret em query string ou header
  const url = new URL(req.url);
  const expectedSecret = Deno.env.get('WEBHOOK_SECRET');
  if (expectedSecret) {
    const got = url.searchParams.get('secret') ?? req.headers.get('x-webhook-secret');
    if (got !== expectedSecret) {
      return new Response('forbidden', { status: 403, headers: corsHeaders });
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response('invalid json', { status: 400, headers: corsHeaders });
  }

  // Handshake do Monday — eles mandam { challenge: "..." } no setup; precisa devolver
  if (body?.challenge) {
    return new Response(JSON.stringify({ challenge: body.challenge }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Evento real
  const event = body?.event;
  const pulseId = event?.pulseId ?? event?.itemId ?? event?.value?.pulseId;
  if (!pulseId) {
    console.warn('webhook sem pulseId/itemId', body);
    return new Response('no pulseId', { status: 400, headers: corsHeaders });
  }

  const mondayToken = Deno.env.get('MONDAY_TOKEN');
  if (!mondayToken) return new Response('no MONDAY_TOKEN configured', { status: 500, headers: corsHeaders });

  const item = await fetchMondayItem(String(pulseId), mondayToken);
  if (!item) return new Response('item not found in Monday', { status: 404, headers: corsHeaders });

  // Lê o NOVO valor do status direto do payload do webhook (mais confiável que
  // re-fetch — evita race conditions se status mudar de novo logo em seguida).
  const newLabel: string | null =
    event?.value?.label?.text ??
    event?.columnValue?.label?.text ??
    null;
  const tipoEvento = inferTipoEvento(newLabel);

  // Timestamp da transição (quando o status mudou). Monday usa formatos
  // diferentes dependendo do endpoint: activity_log dá 100ns ticks (17 dígitos),
  // webhook geralmente Unix ms (13) ou ISO. Detecta pela magnitude.
  function mondayTimeToIso(raw: unknown): string | null {
    if (raw == null) return null;
    let n: number;
    if (typeof raw === 'string') {
      if (!/^\d+(\.\d+)?$/.test(raw)) {
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d.toISOString();
      }
      n = Number(raw);
    } else if (typeof raw === 'number') {
      n = raw;
    } else {
      return null;
    }
    if (!isFinite(n) || n <= 0) return null;
    let ms: number;
    if (n > 1e16) ms = Math.floor(n / 10_000);    // 100ns ticks (activity_log)
    else if (n > 1e13) ms = Math.floor(n / 1_000); // microsegundos
    else if (n > 1e10) ms = n;                      // milissegundos
    else ms = n * 1000;                             // segundos
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  const changedAt = event?.changedAt ?? event?.pulseChangedAt ?? null;
  const eventTimestamp = mondayTimeToIso(changedAt) ?? new Date().toISOString();

  const boardId = Deno.env.get('MONDAY_BOARD_ID') ?? '3519879202';
  const record = buildRecord(item, boardId, tipoEvento, eventTimestamp);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { error } = await supabase.from('design_demandas').insert(record);
  if (error) {
    console.error('insert failed', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, monday_item_id: item.id, tipo_evento: tipoEvento }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

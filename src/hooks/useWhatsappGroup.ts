import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { identifyTeamMember } from '../lib/teamPhones';

/**
 * Hook que busca dados do grupo WhatsApp vinculado a um cliente Monday.
 *
 * Dados carregados:
 *  - Grupo (info, members count, last_message_at)
 *  - Membros (lista com papéis inferidos)
 *  - Eventos da timeline (últimos N)
 *  - Score atual + breakdown
 *  - Tempo de resposta médio
 *
 * REGRA CRÍTICA: Tudo READ-ONLY do Supabase. Sync alimentado pelo Python.
 */
export interface WhatsappGroup {
  chat_jid: string;
  name: string;
  monday_client_id: string | null;
  participants_count: number | null;
  last_message_at: string | null;
  group_created_at: string | null;
  is_burst_group: boolean;
}

export interface WhatsappMember {
  chat_jid: string;
  phone: string;
  display_name: string | null;
  inferred_role: string | null;
  inferred_name: string | null;
}

export interface WhatsappEvent {
  event_id: string;
  chat_jid: string;
  message_id: string | null;
  event_type: string;
  detail: string | null;
  ts: string;
  severity: string | null;
  triggered_by_phone: string | null;
  triggered_by_role: string | null;
}

export interface WhatsappScore {
  chat_jid: string;
  snapshot_at: string;
  period_start: string;
  period_end: string;
  total_messages: number;
  messages_from_client: number;
  messages_from_burst: number;
  avg_response_time_minutes: number | null;
  median_response_time_minutes: number | null;
  max_response_time_minutes: number | null;
  responses_under_30min: number;
  responses_over_2h: number;
  pct_responses_under_30min: number | null;
  count_reclamacoes: number;
  count_atrasos: number;
  count_erros_escrita: number;
  count_elogios: number;
  count_demora_resposta: number;
  score: number | null;
  score_breakdown: Record<string, number | null> | null;
}

export interface UseWhatsappGroupResult {
  group: WhatsappGroup | null;
  members: WhatsappMember[];
  events: WhatsappEvent[];
  latestScore: WhatsappScore | null;
  loading: boolean;
  error: string | null;
}

/** Acha o grupo Burst do cliente Monday por nome (substring match). */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

async function findGroupForClient(clientName: string): Promise<WhatsappGroup | null> {
  // 1. Tenta monday_client_id direto (caso o sync já tenha vinculado)
  // 2. Senão, busca por nome do grupo contendo o nome do cliente
  const target = normalize(clientName)
    // Remove prefixos comuns
    .replace(/^dr[a]?\.?\s+/i, '')
    .replace(/^clinica\s+/i, '')
    .replace(/^instituto\s+/i, '');

  // Carrega todos os grupos Burst e faz match client-side
  // (poderia usar ilike, mas client-side dá mais flexibilidade pra tokens)
  const { data, error } = await supabase
    .from('whatsapp_groups')
    .select('*')
    .eq('is_burst_group', true)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error || !data) return null;
  const tokens = new Set(target.split(/\s+/).filter((t) => t.length >= 4));
  if (tokens.size === 0) return null;
  let best: { group: WhatsappGroup; score: number } | null = null;
  for (const g of data as WhatsappGroup[]) {
    const groupName = normalize(g.name).replace(/[xX]\s*burst.*$/, '').trim();
    const groupTokens = groupName.split(/\s+/).filter((t) => t.length >= 4);
    let score = 0;
    for (const t of groupTokens) if (tokens.has(t)) score++;
    // Pelo menos 1 token longo em comum (≥6 chars)
    const hasLong = groupTokens.some((t) => tokens.has(t) && t.length >= 6);
    if ((hasLong || score >= 2) && (!best || score > best.score)) {
      best = { group: g, score };
    }
  }
  return best?.group ?? null;
}

export function useWhatsappGroup(clientName: string | null, clientId: string | null): UseWhatsappGroupResult {
  const [group, setGroup] = useState<WhatsappGroup | null>(null);
  const [members, setMembers] = useState<WhatsappMember[]>([]);
  const [events, setEvents] = useState<WhatsappEvent[]>([]);
  const [latestScore, setLatestScore] = useState<WhatsappScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;

    async function load() {
      if (!clientName) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        // 1. Tenta achar grupo pelo monday_client_id
        let g: WhatsappGroup | null = null;
        if (clientId) {
          const { data } = await supabase
            .from('whatsapp_groups')
            .select('*')
            .eq('monday_client_id', clientId)
            .maybeSingle();
          if (data) g = data as WhatsappGroup;
        }
        // 2. Fallback por nome
        if (!g) {
          g = await findGroupForClient(clientName);
        }
        if (!activeRef.current) return;
        setGroup(g);
        if (!g) {
          setMembers([]);
          setEvents([]);
          setLatestScore(null);
          setLoading(false);
          return;
        }

        // 3. Carrega membros, eventos e score em paralelo
        const [mRes, eRes, sRes] = await Promise.all([
          supabase
            .from('whatsapp_group_members')
            .select('*')
            .eq('chat_jid', g.chat_jid)
            .order('inferred_role'),
          supabase
            .from('whatsapp_group_events')
            .select('*')
            .eq('chat_jid', g.chat_jid)
            .order('ts', { ascending: false })
            .limit(300),
          supabase
            .from('whatsapp_group_scores')
            .select('*')
            .eq('chat_jid', g.chat_jid)
            .order('snapshot_at', { ascending: false })
            .limit(1),
        ]);
        if (!activeRef.current) return;

        // Override membros/eventos pelo phone book hardcoded da equipe.
        // O sync Python pode ter errado role/nome por name-matching fraco —
        // aqui a gente corrige em runtime baseado em telefone (estavel).
        // Quem nao bate com a equipe fica como o sync deixou (geralmente cliente).
        const rawMembers = (mRes.data ?? []) as WhatsappMember[];
        const members: WhatsappMember[] = rawMembers.map((m) => {
          const t = identifyTeamMember(m.phone);
          if (!t) return m;
          return { ...m, inferred_role: t.role, inferred_name: t.name };
        });

        const rawEvents = (eRes.data ?? []) as WhatsappEvent[];
        const events: WhatsappEvent[] = rawEvents.map((e) => {
          const t = identifyTeamMember(e.triggered_by_phone);
          if (!t) return e;
          return { ...e, triggered_by_role: t.role };
        });

        setMembers(members);
        setEvents(events);
        const scores = sRes.data ?? [];
        setLatestScore(scores.length > 0 ? (scores[0] as WhatsappScore) : null);
        setError(null);
      } catch (e) {
        if (!activeRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (activeRef.current) setLoading(false);
      }
    }

    load();

    // Realtime: events e score
    const channel = supabase
      .channel(`wa_group_${clientId ?? clientName}_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_group_events' }, () => {
        if (activeRef.current) load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_group_scores' }, () => {
        if (activeRef.current) load();
      })
      .subscribe();

    return () => {
      activeRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [clientName, clientId]);

  return { group, members, events, latestScore, loading, error };
}

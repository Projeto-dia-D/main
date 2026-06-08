import { useMemo, useEffect, useState } from 'react';
import { Bell, Clock4, AlertOctagon, Copy, Check, TrendingDown } from 'lucide-react';
import type { MetricsSummary, RelatorioBias } from '../../lib/types';
import type { MondayClient } from '../../lib/monday';
import type { DateRange } from '../../lib/metrics';
import { activeDaysInRange } from '../../lib/metrics';
import { AlertaLeadSemDoutor } from './AlertaLeadSemDoutor';
import { fetchAllInstances } from '../../lib/uazapi';
import { useMondayClients } from '../../hooks/useMondayClients';

/** Threshold: doutores com MENOS do que isso são considerados "poucos leads". */
const POUCOS_LEADS_THRESHOLD = 10;

/** Doutor só é considerado pros alertas se ficou MAIS DO QUE isso com a
 *  Bia ativa no período. Evita alertar sobre quem entrou ontem (sem chance
 *  ainda) ou sobre quem tá em churn/manutenção quase o período todo. */
const MIN_DIAS_BIA_ATIVA = 2;

const CS_STOPWORDS = new Set([
  'dr', 'dra', 'drs', 'sr', 'sra', 'doutor', 'doutora',
  'clinica', 'instituto', 'consultorio', 'odontologia',
]);

function normName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function nameTokens(s: string): string[] {
  return normName(s)
    .split(/[\s\-_(),.]+/)
    .filter((t) => t.length >= 3 && !CS_STOPWORDS.has(t));
}

/** Pra um nome de doutor (vindo do banco), procura nos clientes Monday qual
 *  é o melhor MATCH por tokens. Retorna o cliente inteiro (id, name, cs...)
 *  ou null.
 *
 *  Regras:
 *   1) Match mínimo: 1 token longo (5+ chars) compartilhado OU 2+ tokens
 *      em comum.
 *   2) Maior `score` (nº absoluto de tokens batendo) vence primeiro.
 *   3) Em EMPATE de score, vence quem tem maior `coverage` (proporção de
 *      tokens do cliente que casaram). Isso evita falso-positivo quando há
 *      um cliente com nome composto contendo o nome curto de outro:
 *
 *        Lead: "Dra. Maria Fernanda"     (tokens: maria, fernanda)
 *        vs   "Dra. Maria Fernanda"      → score=2, coverage 2/2 = 1.0  ← vence
 *        vs   "OdontoCentro - Dra. Íris e Dra. Maria Fernanda"
 *                                        → score=2, coverage 2/4 = 0.5
 *
 *   4) Em empate completo (score + coverage), mantém o primeiro encontrado.
 */
function bestClientForDoutor(doutorNome: string, clientsAll: MondayClient[]): MondayClient | null {
  const dTks = nameTokens(doutorNome);
  if (dTks.length === 0) return null;
  let best: { client: MondayClient; score: number; coverage: number } | null = null;
  for (const c of clientsAll) {
    const cTks = new Set(nameTokens(c.name));
    if (cTks.size === 0) continue;
    let score = 0;
    let hasLong = false;
    for (const t of dTks) {
      if (cTks.has(t)) {
        score++;
        if (t.length >= 5) hasLong = true;
      }
    }
    if (!(hasLong || score >= 2)) continue;
    const coverage = score / cTks.size;
    const isBetter =
      !best ||
      score > best.score ||
      (score === best.score && coverage > best.coverage);
    if (isBetter) {
      best = { client: c, score, coverage };
    }
  }
  return best?.client ?? null;
}

interface Props {
  summary: MetricsSummary;
  /** Intervalo atual do painel — usado pra calcular dias com Bia ativa
   *  via activeDaysInRange. Doutores com <= 2 dias ativos no período (ou
   *  com Bia inativa hoje) são filtrados das listas de alertas. */
  range: DateRange;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'nunca';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

interface TokenGroup {
  token: string;
  instanceName: string | null; // nome da instância UAZAPI (ex: "andreapeixoto")
  nomeDoutor: string | null;   // doutor identificado via cruzamento com outros leads
  leads: RelatorioBias[];
}

function GrupoInstancia({ group }: { group: TokenGroup }) {
  // Título principal: nome do doutor > nome da instância > token
  const titulo = group.nomeDoutor ?? group.instanceName;

  return (
    <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 animate-fade-in">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-red-500/15 text-red-400 flex items-center justify-center shrink-0">
          <AlertOctagon size={17} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {titulo ? (
              <span className="font-semibold text-white text-sm">{titulo}</span>
            ) : (
              <span className="font-mono text-xs text-burst-muted break-all">
                {group.token}
              </span>
            )}
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-bold shrink-0">
              {group.leads.length} lead{group.leads.length !== 1 ? 's' : ''}
            </span>
          </div>
          {titulo && (
            <div className="font-mono text-[10px] text-burst-muted/50 mt-0.5 truncate">
              {group.token}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col pl-12">
        {group.leads.map((l) => (
          <AlertaLeadSemDoutor key={l.id} lead={l} />
        ))}
      </div>
    </div>
  );
}

export function Alertas({ summary, range }: Props) {
  // Já tiveram alguma transferência mas estão há 5+ dias sem
  const semTransf = summary.doutores.filter(
    (d) => d.diasSemTransferencia >= 5 && d.ultimaTransferencia !== null
  );
  // Doutores que NUNCA tiveram transferência (ultimaTransferencia === null)
  const nuncaTransf = summary.doutores.filter((d) => d.ultimaTransferencia === null);
  // Doutores com poucos leads (< THRESHOLD) MAS que já receberam pelo menos
  // 1 transferência (os com 0 transferências caem na seção de "nunca", então
  // exclui-se aqui pra não duplicar).
  const poucosLeads = summary.doutores.filter(
    (d) =>
      d.totalLeads > 0 &&
      d.totalLeads < POUCOS_LEADS_THRESHOLD &&
      d.ultimaTransferencia !== null
  );
  const { clientsAll, biaActiveIds, biaTimelineByClientId, biaFaseByClientId } = useMondayClients();
  const [copiado, setCopiado] = useState(false);
  const [copiadoPoucos, setCopiadoPoucos] = useState(false);

  /** Para um doutor (nome): faz fuzzy match no Monday e devolve {cs, valido}.
   *  Doutor é VÁLIDO pra alertas só quando:
   *   - Bia ATIVA hoje (id está em biaActiveIds), E
   *   - ficou >2 dias com Bia ativa no `range` corrente (via activeDaysInRange).
   *  Doutor sem cliente Monday correspondente é tratado como "sem CS" e fica
   *  fora dos alertas (não dá pra avaliar). */
  function avaliarDoutor(nome: string): { valido: boolean; cs: string } {
    const client = bestClientForDoutor(nome, clientsAll);
    if (!client) return { valido: false, cs: 'Sem CS atribuído' };
    const cs = client.cs?.trim() || 'Sem CS atribuído';
    // 1) Bia precisa estar ativa AGORA
    if (!biaActiveIds.has(client.id)) return { valido: false, cs };
    // 2) Mais de MIN_DIAS_BIA_ATIVA dias ativos no período
    const ativoDias = activeDaysInRange(
      biaTimelineByClientId.get(client.id),
      biaFaseByClientId.get(client.id),
      range.start,
      range.end,
    );
    if (ativoDias <= MIN_DIAS_BIA_ATIVA) return { valido: false, cs };
    return { valido: true, cs };
  }

  // Agrupa nuncaTransf por CS — só inclui quem está com Bia ativa há >2 dias.
  const nuncaTransfPorCs = useMemo(() => {
    const grupos = new Map<string, string[]>();
    for (const d of nuncaTransf) {
      const { valido, cs } = avaliarDoutor(d.nome);
      if (!valido) continue;
      const arr = grupos.get(cs) ?? [];
      arr.push(d.nome);
      grupos.set(cs, arr);
    }
    return Array.from(grupos.entries()).sort((a, b) => {
      if (a[0] === 'Sem CS atribuído') return 1;
      if (b[0] === 'Sem CS atribuído') return -1;
      return a[0].localeCompare(b[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nuncaTransf, clientsAll, biaActiveIds, biaTimelineByClientId, biaFaseByClientId, range.start, range.end]);

  // Agrupa poucosLeads por CS — mesma regra de filtro Bia ativa + >2 dias.
  const poucosLeadsPorCs = useMemo(() => {
    const grupos = new Map<string, { nome: string; totalLeads: number; totalTransferidos: number }[]>();
    const ordenados = [...poucosLeads].sort((a, b) => a.totalLeads - b.totalLeads);
    for (const d of ordenados) {
      const { valido, cs } = avaliarDoutor(d.nome);
      if (!valido) continue;
      const arr = grupos.get(cs) ?? [];
      arr.push({ nome: d.nome, totalLeads: d.totalLeads, totalTransferidos: d.totalTransferidos });
      grupos.set(cs, arr);
    }
    return Array.from(grupos.entries()).sort((a, b) => {
      if (a[0] === 'Sem CS atribuído') return 1;
      if (b[0] === 'Sem CS atribuído') return -1;
      return a[0].localeCompare(b[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poucosLeads, clientsAll, biaActiveIds, biaTimelineByClientId, biaFaseByClientId, range.start, range.end]);

  /** Contagens finais (após o filtro Bia ativa) — usadas no header e na
   *  pílula "ativos". Sem isso, "8 ativos" mostraria 8 e a lista 0. */
  const nuncaTransfFiltradoCount = useMemo(
    () => nuncaTransfPorCs.reduce((acc, [, doutores]) => acc + doutores.length, 0),
    [nuncaTransfPorCs],
  );
  const poucosLeadsFiltradoCount = useMemo(
    () => poucosLeadsPorCs.reduce((acc, [, doutores]) => acc + doutores.length, 0),
    [poucosLeadsPorCs],
  );

  /** Util: copia texto pra área de transferência com fallback pra IP local. */
  async function copiarTexto(texto: string, onOk: () => void) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texto);
        onOk();
        return;
      }
    } catch {
      /* segue pro fallback */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, texto.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) onOk();
      else alert('Não consegui copiar automaticamente. Texto:\n\n' + texto);
    } catch (e) {
      console.error('Falha ao copiar:', e);
      alert('Erro ao copiar. Texto:\n\n' + texto);
    }
  }

  async function copiarLista() {
    const linhas: string[] = [];
    linhas.push('*Doutores que ainda não receberam transferência*');
    linhas.push('');
    for (const [cs, doutores] of nuncaTransfPorCs) {
      linhas.push(`*${cs}* (${doutores.length})`);
      for (const nome of doutores) {
        linhas.push(`• ${nome}`);
      }
      linhas.push('');
    }
    await copiarTexto(linhas.join('\n').trim(), () => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    });
  }

  async function copiarListaPoucos() {
    const linhas: string[] = [];
    linhas.push(`*Doutores com poucos leads (<${POUCOS_LEADS_THRESHOLD})*`);
    linhas.push('');
    for (const [cs, doutores] of poucosLeadsPorCs) {
      linhas.push(`*${cs}* (${doutores.length})`);
      for (const d of doutores) {
        linhas.push(`• ${d.nome} — ${d.totalLeads} lead(s), ${d.totalTransferidos} transf.`);
      }
      linhas.push('');
    }
    await copiarTexto(linhas.join('\n').trim(), () => {
      setCopiadoPoucos(true);
      setTimeout(() => setCopiadoPoucos(false), 2500);
    });
  }

  // Mapa token → nomeDoutor construído a partir dos leads que já têm doutor no DB
  const tokenParaDoutor = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const d of summary.doutores) {
      for (const l of d.leads) {
        if (l.token && !map.has(l.token)) {
          map.set(l.token, d.nome);
        }
      }
    }
    for (const l of summary.chatsInterrompidos) {
      if (l.token && l.nomeDoutor && !map.has(l.token)) {
        map.set(l.token, l.nomeDoutor);
      }
    }
    return map;
  }, [summary.doutores, summary.chatsInterrompidos]);

  // Mapa token → nome da instância UAZAPI (buscado uma vez via /instance/all)
  const [uazapiMap, setUazapiMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    fetchAllInstances().then(setUazapiMap).catch(console.warn);
  }, []);

  const tokenGroups = useMemo<TokenGroup[]>(() => {
    const map = new Map<string, RelatorioBias[]>();
    for (const l of summary.leadsSemDoutor) {
      const key = l.token ?? '__sem_token__';
      const arr = map.get(key) ?? [];
      arr.push(l);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([token, leads]) => ({
        token,
        instanceName: uazapiMap.get(token) ?? null,
        nomeDoutor: tokenParaDoutor.get(token) ?? null,
        leads,
      }))
      .sort((a, b) => b.leads.length - a.leads.length);
  }, [summary.leadsSemDoutor, tokenParaDoutor, uazapiMap]);

  const hasAlerts =
    summary.leadsSemDoutor.length > 0 ||
    semTransf.length > 0 ||
    nuncaTransfFiltradoCount > 0 ||
    poucosLeadsFiltradoCount > 0;

  return (
    <section className="rounded-2xl bg-burst-card border border-burst-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="text-burst-orange-bright" size={20} />
        <h3 className="font-display text-xl tracking-wider text-white">
          Alertas
        </h3>
        {hasAlerts && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-bold animate-pulse">
            {summary.leadsSemDoutor.length + semTransf.length + nuncaTransfFiltradoCount + poucosLeadsFiltradoCount} ativos
          </span>
        )}
      </div>

      {!hasAlerts && (
        <div className="text-burst-muted text-sm py-6 text-center border border-dashed border-burst-border rounded-lg">
          Nenhum alerta no momento. Tudo certo. 🔥
        </div>
      )}

      {tokenGroups.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-widest text-burst-muted mb-2">
            Leads sem doutor atribuído — {tokenGroups.length} instância{tokenGroups.length !== 1 ? 's' : ''}
          </div>
          <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto scrollbar-thin pr-1">
            {tokenGroups.map((g) => (
              <GrupoInstancia key={g.token} group={g} />
            ))}
          </div>
        </div>
      )}

      {nuncaTransfFiltradoCount > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-[11px] uppercase tracking-widest text-burst-muted">
              Doutores que NUNCA receberam transferência — {nuncaTransfFiltradoCount}
            </div>
            <button
              onClick={copiarLista}
              title="Copiar lista agrupada por CS pra WhatsApp"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-burst-orange/40 bg-burst-orange/10 text-burst-orange-bright hover:bg-burst-orange/20 hover:border-burst-orange transition-colors"
            >
              {copiado ? <Check size={12} /> : <Copy size={12} />}
              {copiado ? 'copiado!' : 'copiar lista'}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {nuncaTransfPorCs.map(([cs, doutores]) => (
              <div
                key={cs}
                className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 animate-fade-in"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] uppercase tracking-widest text-red-400 font-bold">
                    CS: {cs}
                  </span>
                  <span className="text-[10px] text-burst-muted">· {doutores.length} doutor(es)</span>
                </div>
                <ul className="flex flex-col gap-0.5 text-xs">
                  {doutores.map((nome) => (
                    <li key={nome} className="text-white/85">• {nome}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {poucosLeadsFiltradoCount > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-[11px] uppercase tracking-widest text-burst-muted flex items-center gap-1.5">
              <TrendingDown size={12} className="text-burst-warning" />
              Doutores com poucos leads (&lt;{POUCOS_LEADS_THRESHOLD}) — {poucosLeadsFiltradoCount}
            </div>
            <button
              onClick={copiarListaPoucos}
              title="Copiar lista agrupada por CS pra WhatsApp"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-burst-warning/40 bg-burst-warning/10 text-burst-warning hover:bg-burst-warning/20 hover:border-burst-warning transition-colors"
            >
              {copiadoPoucos ? <Check size={12} /> : <Copy size={12} />}
              {copiadoPoucos ? 'copiado!' : 'copiar lista'}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {poucosLeadsPorCs.map(([cs, doutores]) => (
              <div
                key={cs}
                className="rounded-xl border border-burst-warning/30 bg-burst-warning/5 p-3 animate-fade-in"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] uppercase tracking-widest text-burst-warning font-bold">
                    CS: {cs}
                  </span>
                  <span className="text-[10px] text-burst-muted">· {doutores.length} doutor(es)</span>
                </div>
                <ul className="flex flex-col gap-0.5 text-xs">
                  {doutores.map((d) => (
                    <li key={d.nome} className="text-white/85 flex items-center gap-1.5">
                      <span>• {d.nome}</span>
                      <span className="text-[10px] text-burst-muted">
                        {d.totalLeads} lead{d.totalLeads !== 1 ? 's' : ''}
                        {' · '}
                        {d.totalTransferidos} transf.
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {semTransf.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-widest text-burst-muted mb-2">
            Doutores sem transferência há 5+ dias
          </div>
          <div className="flex flex-col gap-2">
            {semTransf.map((d) => (
              <div
                key={d.nome}
                className="rounded-xl border border-burst-warning/40 bg-burst-warning/5 p-4 animate-fade-in"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-burst-warning/15 text-burst-warning flex items-center justify-center shrink-0">
                    <Clock4 size={18} />
                  </div>
                  <div className="flex-1">
                    <div className="font-display text-lg text-white">
                      {d.nome}
                    </div>
                    <div className="text-xs text-burst-muted">
                      Última transferência: {formatDate(d.ultimaTransferencia)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-3xl text-burst-warning">
                      {d.diasSemTransferencia >= 9999 ? '∞' : d.diasSemTransferencia}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-burst-muted">
                      dias sem transf.
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

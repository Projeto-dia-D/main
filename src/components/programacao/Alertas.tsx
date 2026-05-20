import { useMemo, useEffect, useState } from 'react';
import { Bell, Clock4, AlertOctagon, Copy, Check } from 'lucide-react';
import type { MetricsSummary, RelatorioBias } from '../../lib/types';
import { AlertaLeadSemDoutor } from './AlertaLeadSemDoutor';
import { fetchAllInstances } from '../../lib/uazapi';
import { useMondayClients } from '../../hooks/useMondayClients';

interface Props {
  summary: MetricsSummary;
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

export function Alertas({ summary }: Props) {
  // Já tiveram alguma transferência mas estão há 5+ dias sem
  const semTransf = summary.doutores.filter(
    (d) => d.diasSemTransferencia >= 5 && d.ultimaTransferencia !== null
  );
  // Doutores que NUNCA tiveram transferência (ultimaTransferencia === null)
  const nuncaTransf = summary.doutores.filter((d) => d.ultimaTransferencia === null);
  const { clientsAll } = useMondayClients();
  const [copiado, setCopiado] = useState(false);

  // Agrupa nuncaTransf por CS (match cliente Monday por TOKENS do nome)
  const nuncaTransfPorCs = useMemo(() => {
    const STOPWORDS = new Set([
      'dr', 'dra', 'drs', 'sr', 'sra', 'doutor', 'doutora',
      'clinica', 'instituto', 'consultorio', 'odontologia',
    ]);
    function norm(s: string): string {
      return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    }
    function tokens(s: string): string[] {
      return norm(s)
        .split(/[\s\-_(),.]+/)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    }

    // Pré-computa tokens dos clientes Monday
    const clientTokens = clientsAll.map((c) => ({
      cs: c.cs?.trim() ?? null,
      name: c.name,
      tks: new Set(tokens(c.name)),
    }));

    const grupos = new Map<string, string[]>();
    for (const d of nuncaTransf) {
      const dTks = tokens(d.nome);
      // Procura o cliente que melhor casa por tokens
      let best: { cs: string | null; score: number; hasLong: boolean } | null = null;
      for (const c of clientTokens) {
        if (c.tks.size === 0) continue;
        let score = 0;
        let hasLong = false;
        for (const t of dTks) {
          if (c.tks.has(t)) {
            score++;
            if (t.length >= 5) hasLong = true;
          }
        }
        // Match: 1 token longo (5+) OU 2 tokens em comum
        if ((hasLong || score >= 2) && (!best || score > best.score)) {
          best = { cs: c.cs, score, hasLong };
        }
      }
      const cs = best?.cs || 'Sem CS atribuído';
      const arr = grupos.get(cs) ?? [];
      arr.push(d.nome);
      grupos.set(cs, arr);
    }
    return Array.from(grupos.entries()).sort((a, b) => {
      if (a[0] === 'Sem CS atribuído') return 1;
      if (b[0] === 'Sem CS atribuído') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [nuncaTransf, clientsAll]);

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
    const texto = linhas.join('\n').trim();

    // Tenta API moderna primeiro (HTTPS/localhost)
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2500);
        return;
      }
    } catch {
      // segue pro fallback
    }

    // Fallback pra IP local / contexto não-seguro: textarea + execCommand
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
      if (ok) {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2500);
      } else {
        alert('Não consegui copiar automaticamente. Selecione e copie manualmente:\n\n' + texto);
      }
    } catch (e) {
      console.error('Falha ao copiar:', e);
      alert('Erro ao copiar. Texto:\n\n' + texto);
    }
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

  const hasAlerts = summary.leadsSemDoutor.length > 0 || semTransf.length > 0 || nuncaTransf.length > 0;

  return (
    <section className="rounded-2xl bg-burst-card border border-burst-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="text-burst-orange-bright" size={20} />
        <h3 className="font-display text-xl tracking-wider text-white">
          Alertas
        </h3>
        {hasAlerts && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-bold animate-pulse">
            {summary.leadsSemDoutor.length + semTransf.length + nuncaTransf.length} ativos
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

      {nuncaTransf.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-[11px] uppercase tracking-widest text-burst-muted">
              Doutores que NUNCA receberam transferência — {nuncaTransf.length}
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

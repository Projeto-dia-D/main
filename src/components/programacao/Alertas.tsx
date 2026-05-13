import { useMemo, useEffect, useState } from 'react';
import { Bell, Clock4, AlertOctagon } from 'lucide-react';
import type { MetricsSummary, RelatorioBias } from '../../lib/types';
import { AlertaLeadSemDoutor } from './AlertaLeadSemDoutor';
import { fetchAllInstances } from '../../lib/uazapi';

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
  const semTransf = summary.doutores.filter((d) => d.diasSemTransferencia >= 5);

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

  const hasAlerts = summary.leadsSemDoutor.length > 0 || semTransf.length > 0;

  return (
    <section className="rounded-2xl bg-burst-card border border-burst-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="text-burst-orange-bright" size={20} />
        <h3 className="font-display text-xl tracking-wider text-white">
          Alertas
        </h3>
        {hasAlerts && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-bold animate-pulse">
            {summary.leadsSemDoutor.length + semTransf.length} ativos
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

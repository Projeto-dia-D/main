import { useMemo, useState } from 'react';
import { ShieldAlert, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import type { RelatorioBias } from '../../lib/types';

interface Props {
  /** Todos os leads (sem filtro de período — queremos pegar qualquer divergência). */
  leads: RelatorioBias[];
  /** token da instância uazapi → nome da instância (fonte da verdade). */
  instanceMap: Map<string, string>;
}

/** Palavras genéricas que não identificam o doutor (não servem pra casar nomes). */
const STOP = new Set([
  'clinica', 'clinic', 'odontologia', 'odonto', 'dental', 'dentaria', 'ltda', 'me',
  'dr', 'dra', 'drs', 'dras', 'estetica', 'sorriso', 'sorrisos', 'centro', 'instituto',
  'consultorio', 'oral', 'face', 'smile', 'prime', 'lab',
]);

/** Só letras/números, minúsculo, sem acento. "Dr. Pedro Barbas" → "drpedrobarbas".
 *  O "&" vira "e" porque os slugs da uazapi escrevem assim
 *  ("Odonto & Estética" ≡ "odontoeestetica"). */
function flat(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, 'e')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Palavras significativas (≥4 chars, sem genéricas). */
function words(s: string | null | undefined): string[] {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

/**
 * Casamento CONSERVADOR entre o nome gravado no lead e o nome da instância.
 * Só acusa divergência quando NÃO há nenhuma sobreposição — assim o slug da
 * uazapi ("pedrobarbas", "andreapeixoto") e typos ("sevaltici") não viram
 * falso-positivo.
 */
function nomesCasam(leadName: string, instName: string): boolean {
  const a = flat(leadName);
  const b = flat(instName);
  if (!a || !b) return true; // sem dado suficiente → não acusa
  if (a === b || a.includes(b) || b.includes(a)) return true;
  for (const w of words(leadName)) if (b.includes(w)) return true;
  for (const w of words(instName)) if (a.includes(w)) return true;
  return false;
}

interface Divergencia {
  token: string;
  instancia: string;
  gravado: string;
  qtd: number;
  ultimo: string;
}

/**
 * AVISO (só programador): leads cujo `nomeDoutor` diverge do nome da instância
 * na uazapi. A uazapi é a FONTE DA VERDADE — quando o fluxo da Bia grava o
 * doutor errado, os leads entram na métrica do doutor errado. Este alerta pega
 * o problema cedo, antes de sujar o Dia D.
 *
 * Não renderiza nada quando está tudo certo.
 */
export function AlertaNomeDivergente({ leads, instanceMap }: Props) {
  const [aberto, setAberto] = useState(true);

  const divergencias = useMemo<Divergencia[]>(() => {
    if (instanceMap.size === 0) return [];
    // token → (nomeGravado → { qtd, ultimo })
    const porToken = new Map<string, Map<string, { qtd: number; ultimo: string }>>();
    for (const l of leads) {
      const tok = (l.token ?? '').trim();
      const nome = (l.nomeDoutor ?? '').trim();
      if (!tok || !nome) continue;
      let m = porToken.get(tok);
      if (!m) { m = new Map(); porToken.set(tok, m); }
      const cur = m.get(nome) ?? { qtd: 0, ultimo: '' };
      cur.qtd += 1;
      if ((l.dataCadastro ?? '') > cur.ultimo) cur.ultimo = l.dataCadastro ?? '';
      m.set(nome, cur);
    }

    const out: Divergencia[] = [];
    for (const [tok, nomes] of porToken) {
      const inst = instanceMap.get(tok);
      if (!inst) continue; // instância não encontrada → não dá pra comparar
      for (const [gravado, info] of nomes) {
        if (!nomesCasam(gravado, inst)) {
          out.push({ token: tok, instancia: inst, gravado, qtd: info.qtd, ultimo: info.ultimo });
        }
      }
    }
    // mais recentes primeiro (o que precisa de ação agora)
    return out.sort((a, b) => (b.ultimo || '').localeCompare(a.ultimo || ''));
  }, [leads, instanceMap]);

  if (divergencias.length === 0) return null;

  const totalLeads = divergencias.reduce((s, d) => s + d.qtd, 0);

  function fmt(d: string): string {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return d.slice(0, 10);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-red-500/50 bg-red-500/[0.06] p-5 flex flex-col gap-3 shadow-[0_0_24px_rgba(239,68,68,0.15)]">
      <div className="flex items-start gap-3 flex-wrap">
        <ShieldAlert size={22} className="text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-display text-xl text-white tracking-wide">
            Nome de doutor divergente da uazapi
            <span className="ml-2 text-red-400">{divergencias.length}</span>
          </div>
          <p className="text-sm text-burst-muted mt-1">
            A <strong className="text-white/90">uazapi é a fonte da verdade</strong>. Estes leads foram gravados com um
            nome diferente do nome da instância — ou seja, estão entrando na métrica do{' '}
            <strong className="text-white/90">doutor errado</strong>. Corrija no fluxo da Bia e renomeie os leads.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-2xl font-display text-red-400 leading-none">{totalLeads}</div>
            <div className="text-[10px] uppercase tracking-widest text-burst-muted mt-1">leads afetados</div>
          </div>
          <button
            onClick={() => setAberto((v) => !v)}
            className="flex items-center gap-1 text-xs text-burst-muted hover:text-white"
          >
            {aberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {aberto ? 'Ocultar' : 'Ver'}
          </button>
        </div>
      </div>

      {aberto && (
        <ul className="flex flex-col gap-2">
          {divergencias.map((d) => (
            <li
              key={`${d.token}|${d.gravado}`}
              className="rounded-xl bg-black/40 border border-burst-border px-4 py-3 flex flex-col gap-1"
            >
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="text-red-300 line-through">{d.gravado}</span>
                <ArrowRight size={14} className="text-burst-muted shrink-0" />
                <span className="text-green-400 font-semibold">{d.instancia}</span>
                <span className="text-[10px] uppercase tracking-wider text-burst-muted border border-burst-border rounded px-1.5 py-0.5">
                  uazapi
                </span>
              </div>
              <div className="text-[11px] text-burst-muted">
                {d.qtd} lead(s) · último em {fmt(d.ultimo)} · token{' '}
                <code className="font-mono text-white/60">{d.token.slice(0, 8)}…</code>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

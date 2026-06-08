import { Trophy } from 'lucide-react';
import type { SalaryTier } from '../../lib/types';
import { Avatar } from '../Avatar';

interface PessoaItem {
  /** Identificador único — usado como key do React. */
  id: string;
  /** Nome completo da pessoa (CS, Gestor, etc). */
  nome: string;
  /** URL da foto (lookupPhoto). Fallback pro avatar com iniciais. */
  photoUrl: string | null;
  /** Métrica principal formatada (ex: "R$ 142,50"). */
  metricaPrincipal: string;
  /** Label curto da métrica (ex: "CPT", "Custo/lead"). */
  metricaLabel: string;
  /** Tier salarial (0, 0.5 ou 1) — define cor do card. */
  tier: SalaryTier;
  /** Label do tier (ex: "1 SALÁRIO"). */
  tierLabel: string;
  /** Click callback opcional — abre drill da pessoa. */
  onClick?: () => void;
}

interface Props {
  pessoas: PessoaItem[];
  /** Título da seção. */
  titulo: string;
  /** Subtítulo (ex: "5 CSs ativos"). */
  subtitulo?: string;
}

/**
 * Ranking horizontal de pessoas (CSs, Gestores, Designers) — cards compactos
 * com foto à esquerda + métrica principal grande à direita. Inspirado no
 * PessoaCard da Apresentação, mas SEM dependência de container queries
 * (cqh) — funciona em qualquer container.
 *
 * Top 1 ganha troféu. Cor do card vem do tier:
 *  - tier 1   → verde
 *  - tier 0.5 → laranja
 *  - tier 0   → vermelho
 *
 * Pensado pra usar na visão admin de CS.tsx e GestorTrafego.tsx (entre o
 * PainelGeral e os PainelMini), pra dar uma comparação rápida do time.
 */
export function RankingPessoasCards({ pessoas, titulo, subtitulo }: Props) {
  if (pessoas.length === 0) return null;
  return (
    <section className="rounded-2xl bg-burst-card border border-burst-border p-5 animate-slide-up">
      <div className="flex items-start gap-3 mb-4">
        <Trophy size={18} className="text-burst-orange-bright" />
        <div className="min-w-0">
          <h3 className="font-display text-xl text-white tracking-wide">{titulo}</h3>
          {subtitulo && (
            <p className="text-xs text-burst-muted mt-0.5">{subtitulo}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {pessoas.map((p, idx) => (
          <PessoaCardCompact key={p.id} pessoa={p} rank={idx + 1} />
        ))}
      </div>
    </section>
  );
}

function PessoaCardCompact({ pessoa, rank }: { pessoa: PessoaItem; rank: number }) {
  const cor = tierStyle(pessoa.tier);
  const firstName = pessoa.nome.split(/\s+/)[0] ?? pessoa.nome;
  const isFirst = rank === 1;

  const inner = (
    <div
      className={`rounded-xl border-2 ${cor.border} ${cor.bg} ${cor.glow} flex items-stretch overflow-hidden transition-all`}
    >
      {/* Foto à esquerda */}
      <div className="shrink-0 flex items-center justify-center pl-3 py-3">
        <Avatar src={pessoa.photoUrl} name={pessoa.nome} size={64} className={`ring-2 ${cor.border}`} />
      </div>

      {/* Conteúdo à direita */}
      <div className="flex-1 min-w-0 flex flex-col justify-center px-3 py-2 gap-0.5">
        <div className="text-white font-display tracking-wide truncate text-base uppercase flex items-center gap-1.5">
          <span className="truncate" title={pessoa.nome}>{firstName}</span>
          {isFirst && (
            <Trophy size={14} className="text-yellow-400 shrink-0 drop-shadow-[0_0_6px_rgba(250,204,21,0.7)]" />
          )}
        </div>
        <div className={`font-display ${cor.text} tracking-tight leading-none text-3xl`}>
          {pessoa.metricaPrincipal}
        </div>
        <div className="text-[10px] text-burst-muted leading-none uppercase tracking-wider">
          {pessoa.metricaLabel}
        </div>
        <div className={`text-[10px] uppercase tracking-widest font-bold ${cor.text} mt-1 leading-none`}>
          {pessoa.tierLabel}
        </div>
      </div>
    </div>
  );

  if (pessoa.onClick) {
    return (
      <button
        type="button"
        onClick={pessoa.onClick}
        className="text-left hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-burst-orange/40 rounded-xl transition-transform"
      >
        {inner}
      </button>
    );
  }
  return inner;
}

function tierStyle(tier: SalaryTier) {
  if (tier === 1) {
    return {
      bg: 'bg-green-500/15',
      border: 'border-green-500/60',
      text: 'text-green-400',
      glow: 'shadow-[0_0_24px_rgba(34,197,94,0.25)]',
    };
  }
  if (tier === 0.5) {
    return {
      bg: 'bg-burst-orange/15',
      border: 'border-burst-orange/60',
      text: 'text-burst-orange-bright',
      glow: 'shadow-orange-glow',
    };
  }
  return {
    bg: 'bg-red-500/15',
    border: 'border-red-500/60',
    text: 'text-red-400',
    glow: 'shadow-[0_0_24px_rgba(239,68,68,0.25)]',
  };
}

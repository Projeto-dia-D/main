import type { SalaryTier } from '../../lib/types';

interface Props {
  tier: SalaryTier;
}

const TIER_CONFIG: Record<SalaryTier, {
  src: string;
  alt: string;
  borderColor: string;
  glowColor: string;
  message: string;
  subMessage: string;
  textClass: string;
  barClass: string;
}> = {
  1: {
    src: '/image.png',
    alt: 'Mandando muito bem',
    borderColor: 'rgba(34,197,94,0.5)',
    glowColor: 'rgba(34,197,94,0.35)',
    message: 'VOCÊ ESTÁ NO TOPO. MANTÉM O RITMO! 🔥',
    subMessage: 'Taxa máxima atingida — 1 salário garantido. Não para agora.',
    textClass: 'text-green-400',
    barClass: 'bg-green-500',
  },
  0.5: {
    src: '/img-meio.png',
    alt: 'No caminho certo',
    borderColor: 'rgba(255,107,0,0.5)',
    glowColor: 'rgba(255,107,0,0.35)',
    message: 'QUASE LÁ. MAIS UM EMPURRÃO!',
    subMessage: 'Você está no meio do caminho — cada transferência conta pra chegar no topo.',
    textClass: 'text-burst-orange-bright',
    barClass: 'bg-burst-orange',
  },
  0: {
    src: '/img-sem-bonus.png',
    alt: 'Bora virar o jogo',
    borderColor: 'rgba(239,68,68,0.5)',
    glowColor: 'rgba(239,68,68,0.35)',
    message: 'BORA VIRAR O JOGO!',
    subMessage: 'O dia ainda não acabou — cada lead transferido muda o resultado.',
    textClass: 'text-red-400',
    barClass: 'bg-red-500',
  },
};

export function TierImage({ tier }: Props) {
  const cfg = TIER_CONFIG[tier];

  return (
    <div
      key={tier}
      className="flex flex-col gap-0 animate-fade-in rounded-2xl overflow-hidden bg-burst-card w-full"
      style={{
        border: `1px solid ${cfg.borderColor}`,
        boxShadow: `0 0 48px ${cfg.glowColor}, 0 0 120px ${cfg.glowColor.replace('0.35', '0.12')}`,
      }}
    >
      {/*
        Quadrado da imagem: largura total do card (mesma dos painéis ao redor)
        e altura igual à largura — o que dá um QUADRADO GIGANTE.
      */}
      <div className="w-full aspect-square overflow-hidden">
        <img
          src={cfg.src}
          alt={cfg.alt}
          className="block w-full h-full object-cover"
          draggable={false}
        />
      </div>

      {/* Mensagem motivacional — barra inferior */}
      <div className="w-full px-8 py-6 flex items-center gap-5">
        <div
          className="w-1 self-stretch rounded-full shrink-0"
          style={{ background: cfg.glowColor.replace('0.35', '0.9') }}
        />
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className={`font-display text-3xl tracking-wider leading-tight ${cfg.textClass}`}>
            {cfg.message}
          </span>
          <span className="text-burst-muted text-base leading-snug">
            {cfg.subMessage}
          </span>
        </div>
      </div>
    </div>
  );
}

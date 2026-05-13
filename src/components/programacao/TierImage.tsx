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
    src: '/img-top.png',
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
    <div key={tier} className="flex flex-col gap-0 animate-fade-in rounded-2xl overflow-hidden"
      style={{
        border: `1px solid ${cfg.borderColor}`,
        boxShadow: `0 0 48px ${cfg.glowColor}, 0 0 120px ${cfg.glowColor.replace('0.35', '0.12')}`,
      }}
    >
      {/* Imagem — sem nada por cima */}
      <div className="relative" style={{ minHeight: 340 }}>
        <img
          src={cfg.src}
          alt={cfg.alt}
          className="absolute inset-0 w-full h-full object-cover object-center"
          draggable={false}
        />
      </div>

      {/* Mensagem motivacional — abaixo da imagem, dentro do mesmo card */}
      <div className="bg-burst-card px-8 py-5 flex items-center gap-5">
        <div
          className="w-1 self-stretch rounded-full shrink-0"
          style={{ background: cfg.glowColor.replace('0.35', '0.9') }}
        />
        <div className="flex flex-col gap-1 min-w-0">
          <span className={`font-display text-2xl tracking-wider leading-none ${cfg.textClass}`}>
            {cfg.message}
          </span>
          <span className="text-burst-muted text-sm">
            {cfg.subMessage}
          </span>
        </div>
      </div>
    </div>
  );
}

import { Logo } from './Logo';

interface Props {
  size?: 'sm' | 'lg';
  className?: string;
}

/**
 * Marca da empresa: logo + título "Dia D" com efeito de fogo + subtítulo
 * "Burst Mídia" discreto. Usado na sidebar e na barra de cima do site.
 */
export function BrandTitle({ size = 'lg', className = '' }: Props) {
  const isLarge = size === 'lg';
  const logoSize = isLarge ? 44 : 26;
  const titleClass = isLarge
    ? 'font-display text-3xl tracking-wider'
    : 'font-display text-lg tracking-wider';
  const subtitleClass = isLarge
    ? 'text-[10px] uppercase tracking-[0.35em]'
    : 'text-[9px] uppercase tracking-[0.3em]';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Logo size={logoSize} />
      <div className="flex flex-col leading-none">
        <span
          className={[
            titleClass,
            // Efeito "pegando fogo": gradiente vertical de amarelo → laranja brilhante
            // → laranja queimado, com glow externo
            'bg-gradient-to-b from-yellow-200 via-burst-orange-bright to-burst-orange',
            'bg-clip-text text-transparent',
            'drop-shadow-[0_0_8px_rgba(255,107,0,0.55)]',
            // animação sutil de flicker
            'animate-pulse-flame',
          ].join(' ')}
        >
          Dia D
        </span>
        <span className={`${subtitleClass} text-burst-muted mt-1`}>
          Burst Mídia
        </span>
      </div>
    </div>
  );
}

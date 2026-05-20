import { useState } from 'react';
import { getDesignerFoto } from '../../config';
import { usePhotoLightbox } from '../PhotoLightboxContext';

interface Props {
  /** Nome do designer (qualquer variação — normaliza internamente) */
  designerNome: string;
  /** Tamanho do círculo da foto (default 96px) */
  size?: number;
  className?: string;
  /** Quando true, clicar abre a foto em tela cheia via PhotoLightbox. */
  clickable?: boolean;
}

/**
 * Foto "modo herói" do designer com efeito de fogo verde piscando.
 * Mostra só se houver foto cadastrada em DESIGNER_FOTOS pra esse nome E
 * o arquivo existir em public/designers/<nome>.png. Em caso de erro de
 * load, esconde silenciosamente (não quebra o card).
 *
 * Quando `clickable`, clique no hero abre o lightbox em tela cheia.
 */
export function DesignerHeroImage({ designerNome, size = 96, className = '', clickable = true }: Props) {
  const fotoUrl = getDesignerFoto(designerNome);
  const [loadError, setLoadError] = useState(false);
  const { open: openLightbox } = usePhotoLightbox();

  if (!fotoUrl || loadError) return null;

  // URL absoluta pra alimentar o lightbox (que aceita uma URL final).
  const fullUrl = typeof window !== 'undefined' ? new URL(fotoUrl, window.location.origin).href : fotoUrl;

  function handleClick(e: React.MouseEvent) {
    if (!clickable) return;
    e.stopPropagation();
    openLightbox(fullUrl, designerNome);
  }

  return (
    <div
      className={`relative inline-block ${clickable ? 'cursor-zoom-in transition-transform hover:scale-105' : ''} ${className}`}
      style={{ width: size, height: size }}
      onClick={handleClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? `Ver foto de ${designerNome}` : undefined}
    >
      {/* Camada 1: glow outer (mais largo, mais lento) */}
      <span
        aria-hidden
        className="absolute inset-[-12px] rounded-full pointer-events-none animate-hero-fire-green"
      />
      {/* Camada 2: glow inner (offset pra simular flicker de chama) */}
      <span
        aria-hidden
        className="absolute inset-[-6px] rounded-full pointer-events-none animate-hero-fire-green-offset"
      />
      {/* Camada 3: radial gradient atrás da foto (chama acumulada nas bordas) */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(circle, transparent 55%, rgba(34,197,94,0.55) 78%, rgba(74,222,128,0.85) 100%)',
          filter: 'blur(4px)',
        }}
      />
      {/* Imagem em si */}
      <img
        src={fotoUrl}
        alt={designerNome}
        onError={() => setLoadError(true)}
        className="relative z-10 w-full h-full object-cover rounded-full border-2 border-green-500/80 animate-hero-flicker"
        style={{ boxShadow: '0 0 18px rgba(34,197,94,0.7) inset' }}
      />
    </div>
  );
}

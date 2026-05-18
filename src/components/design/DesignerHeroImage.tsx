import { useState } from 'react';
import { getDesignerFoto } from '../../config';

interface Props {
  /** Nome do designer (qualquer variação — normaliza internamente) */
  designerNome: string;
  /** Tamanho do círculo da foto (default 96px) */
  size?: number;
  className?: string;
}

/**
 * Foto "modo herói" do designer com efeito de fogo verde piscando.
 * Mostra só se houver foto cadastrada em DESIGNER_FOTOS pra esse nome E
 * o arquivo existir em public/designers/<nome>.png. Em caso de erro de
 * load, esconde silenciosamente (não quebra o card).
 */
export function DesignerHeroImage({ designerNome, size = 96, className = '' }: Props) {
  const fotoUrl = getDesignerFoto(designerNome);
  const [loadError, setLoadError] = useState(false);

  if (!fotoUrl || loadError) return null;

  return (
    <div
      className={`relative inline-block ${className}`}
      style={{ width: size, height: size }}
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

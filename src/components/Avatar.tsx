import { useState } from 'react';
import { usePhotoLightbox } from './PhotoLightboxContext';

interface Props {
  /** URL da foto. Quando null/falha, mostra iniciais. */
  src?: string | null;
  /** Nome usado pra gerar iniciais e gradient de fallback. */
  name: string;
  /** Tamanho em px (lado do quadrado). Default 32. */
  size?: number;
  /** Classe extra (ex: ring, border). */
  className?: string;
  title?: string;
  /** Quando true (default false), clicar abre o lightbox da foto.
   *  Só faz efeito se houver `src` válido. */
  clickable?: boolean;
}

/**
 * Avatar com foto do Monday + fallback elegante de iniciais.
 * Quando a URL falha (CORS, 404, etc.) ou não existe, gera iniciais com
 * gradient laranja burst.
 */
/** URL da versão alta resolução pra usar no lightbox. Monday só oferece
 *  thumb e original — original é 1MB então só vale pré-carregar no hover. */
function hiResUrl(src: string): string {
  return src.replace('/thumb/', '/original/');
}

/** Pré-carrega uma URL no cache do browser (sem renderizar nada).
 *  Returns a no-op cleanup pra cancelar caso o user saia rápido. */
function preloadImage(url: string) {
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.src = url;
}

export function Avatar({ src, name, size = 32, className = '', title, clickable = false }: Props) {
  const [errored, setErrored] = useState(false);
  const initials = getInitials(name);
  const showImage = src && !errored;
  const { open: openLightbox } = usePhotoLightbox();
  const canOpen = clickable && showImage;

  // Quando user passa mouse sobre um avatar clicável, pré-carrega a versão
  // /original/ em background. Como o tempo médio hover→click é ~500ms+,
  // geralmente quando clica já está em cache → lightbox abre instantâneo.
  const onMouseEnter = () => {
    if (canOpen && src) preloadImage(hiResUrl(src));
  };

  const inner = showImage ? (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
      className="w-full h-full object-cover"
    />
  ) : (
    <span
      className="font-display font-bold text-white"
      style={{ fontSize: Math.max(10, Math.floor(size * 0.38)) }}
    >
      {initials}
    </span>
  );

  const baseClasses = [
    'shrink-0 rounded-full overflow-hidden flex items-center justify-center',
    'bg-gradient-to-br from-burst-orange to-burst-orange-bright',
    'border border-burst-border/60',
    canOpen ? 'cursor-zoom-in transition-transform hover:scale-105 hover:ring-2 hover:ring-burst-orange-bright/60' : '',
    className,
  ].join(' ');

  if (canOpen) {
    return (
      <button
        type="button"
        title={title ?? `Ver foto de ${name}`}
        onMouseEnter={onMouseEnter}
        onFocus={onMouseEnter}
        onClick={(e) => {
          e.stopPropagation();
          openLightbox(src!, name);
        }}
        className={baseClasses}
        style={{ width: size, height: size }}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      title={title ?? name}
      className={baseClasses}
      style={{ width: size, height: size }}
    >
      {inner}
    </div>
  );
}

function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => !/^(dr|dra|sr|sra|de|da|do|dos|das)\.?$/i.test(p));
  if (parts.length === 0) return name[0]?.toUpperCase() ?? '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

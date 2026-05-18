import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  /** Quando não-null, abre o popup. */
  photo: { url: string; name: string } | null;
  onClose: () => void;
}

/**
 * Popup de foto em tela cheia. Estratégia:
 * - Renderiza a thumb (já em cache) IMEDIATAMENTE em tamanho grande (escala
 *   visual via CSS object-fit)
 * - Tenta carregar /big/ e /original/ em paralelo; quando carregar, troca pra
 *   a versão de maior resolução. Sem flicker porque a thumb continua atrás.
 * - Tamanho mínimo de 480px pra não ficar minúsculo mesmo se foto for pequena.
 *
 * Fecha com Esc, click fora ou botão X.
 */
export function PhotoLightbox({ photo, onClose }: Props) {
  // URL de alta resolução resolvida (null = ainda usando thumb)
  const [hiResUrl, setHiResUrl] = useState<string | null>(null);

  // Fechar com Escape
  useEffect(() => {
    if (!photo) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [photo, onClose]);

  // Pré-carrega /original/ em background. Se já tiver sido pré-carregado
  // via hover no avatar, o browser pega do cache instantaneamente.
  // Monday só tem 2 variantes: thumb (~18KB) e original (~1MB). Não existe
  // /big/, /medium/, etc — testei a API e todos retornam 403.
  useEffect(() => {
    if (!photo) {
      setHiResUrl(null);
      return;
    }
    setHiResUrl(null);
    const originalUrl = photo.url.replace('/thumb/', '/original/');
    if (originalUrl === photo.url) return; // já era original

    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setHiResUrl(originalUrl); };
    img.onerror = () => { /* mantém thumb */ };
    img.referrerPolicy = 'no-referrer';
    img.src = originalUrl;

    return () => { cancelled = true; };
  }, [photo]);

  if (!photo) return null;

  const displayUrl = hiResUrl ?? photo.url;
  // Cache-buster pra forçar o navegador a usar a imagem já carregada via Image()
  // (mesmo URL, mesma cache key — então não há request extra)

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] bg-black/85 backdrop-blur-md flex items-center justify-center p-6"
    >
      <button
        onClick={onClose}
        title="Fechar (Esc)"
        className="absolute top-6 right-6 z-10 p-2.5 rounded-lg bg-black/60 border border-burst-border text-white hover:bg-burst-orange/20 hover:text-burst-orange-bright hover:border-burst-orange transition-colors"
      >
        <X size={22} />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col items-center gap-5 max-w-[95vw] max-h-[95vh]"
      >
        <div
          className="rounded-3xl overflow-hidden border-2 border-burst-orange/40 shadow-orange-glow bg-burst-card relative"
          style={{
            width: 'min(80vmin, 640px)',
            height: 'min(80vmin, 640px)',
          }}
        >
          <img
            src={displayUrl}
            alt={photo.name}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
            style={{
              // Suavização melhor pra fotos pequenas escaladas
              imageRendering: 'auto',
            }}
          />
          {!hiResUrl && (
            <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm border border-burst-border rounded px-2 py-1 text-[10px] uppercase tracking-wider text-burst-muted">
              carregando alta resolução…
            </div>
          )}
        </div>
        <div className="text-white font-display text-3xl tracking-wide text-center">
          {photo.name}
        </div>
      </div>
    </div>
  );
}

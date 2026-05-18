import { createContext, useContext, useState, type ReactNode } from 'react';
import { PhotoLightbox } from './PhotoLightbox';

interface PhotoLightboxCtx {
  open: (url: string, name: string) => void;
}

const Ctx = createContext<PhotoLightboxCtx | null>(null);

/**
 * Provider global que disponibiliza um "openPhoto(url, name)" pra qualquer
 * filho da árvore. O Avatar (e outros) chama isso quando recebe click.
 * Mantém o popup renderizado em um único lugar.
 */
export function PhotoLightboxProvider({ children }: { children: ReactNode }) {
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null);

  return (
    <Ctx.Provider value={{ open: (url, name) => setPhoto({ url, name }) }}>
      {children}
      <PhotoLightbox photo={photo} onClose={() => setPhoto(null)} />
    </Ctx.Provider>
  );
}

/** Retorna `open(url, name)`. Quando não tem provider, vira no-op. */
export function usePhotoLightbox(): PhotoLightboxCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return { open: () => { /* no provider */ } };
  }
  return ctx;
}

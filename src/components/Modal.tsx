import { useEffect } from 'react';
import { X, ArrowLeft } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
  /** Se passado, mostra um botao "Voltar" no canto esquerdo do header
   *  que chama esse callback (em vez de fechar o modal direto).
   *  Util pra fluxos drill-down em camadas (lista → cliente individual). */
  onBack?: () => void;
}

export function Modal({ open, onClose, title, subtitle, children, maxWidth = 'max-w-5xl', onBack }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Se tem onBack, Esc volta em vez de fechar tudo
        if (onBack) onBack();
        else onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose, onBack]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onBack ?? onClose}
      />
      <div
        className={`relative bg-burst-card border border-burst-border rounded-2xl shadow-card w-full ${maxWidth} max-h-[85vh] flex flex-col animate-slide-up`}
      >
        <header className="flex items-start justify-between gap-4 p-6 border-b border-burst-border">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {onBack && (
              <button
                onClick={onBack}
                className="shrink-0 w-9 h-9 mt-1 rounded-lg bg-burst-border/40 hover:bg-burst-orange/20 hover:text-burst-orange-bright text-white flex items-center justify-center transition-colors"
                aria-label="Voltar"
                title="Voltar"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-3xl text-white tracking-wider truncate">{title}</h2>
              {subtitle && <div className="text-sm text-burst-muted mt-1">{subtitle}</div>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-9 h-9 rounded-lg bg-burst-border/40 hover:bg-red-500/20 hover:text-red-400 text-white flex items-center justify-center transition-colors"
            aria-label="Fechar"
            title="Fechar tudo"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">{children}</div>
      </div>
    </div>
  );
}

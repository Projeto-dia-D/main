import { useEffect } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, subtitle, children, maxWidth = 'max-w-5xl' }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`relative bg-burst-card border border-burst-border rounded-2xl shadow-card w-full ${maxWidth} max-h-[85vh] flex flex-col animate-slide-up`}
      >
        <header className="flex items-start justify-between gap-4 p-6 border-b border-burst-border">
          <div>
            <h2 className="font-display text-3xl text-white tracking-wider">{title}</h2>
            {subtitle && <div className="text-sm text-burst-muted mt-1">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-burst-border/40 hover:bg-red-500/20 hover:text-red-400 text-white flex items-center justify-center transition-colors"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">{children}</div>
      </div>
    </div>
  );
}

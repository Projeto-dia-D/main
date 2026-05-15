import { Code2, Palette, Headphones, Megaphone, CalendarDays, type LucideIcon } from 'lucide-react';
import { BrandTitle } from './BrandTitle';

export type TabKey = 'programacao' | 'design' | 'cs' | 'gestor' | 'calendario';

interface Props {
  active: TabKey;
  onChange: (k: TabKey) => void;
}

const ITEMS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'programacao', label: 'Programação', icon: Code2 },
  { key: 'design', label: 'Design', icon: Palette },
  { key: 'cs', label: 'CS', icon: Headphones },
  { key: 'gestor', label: 'Gestor de Tráfego', icon: Megaphone },
  { key: 'calendario', label: 'Calendário', icon: CalendarDays },
];

export function Sidebar({ active, onChange }: Props) {
  return (
    <aside className="w-60 shrink-0 bg-burst-panel border-r border-burst-border flex flex-col">
      <div className="px-5 py-5 border-b border-burst-border">
        <BrandTitle size="lg" />
      </div>

      <nav className="flex flex-col px-3 py-4 gap-1">
        {ITEMS.map((it) => {
          const Icon = it.icon;
          const isActive = active === it.key;
          return (
            <button
              key={it.key}
              onClick={() => onChange(it.key)}
              className={[
                'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                isActive
                  ? 'bg-burst-orange/15 text-burst-orange-bright shadow-orange-glow-sm'
                  : 'text-burst-muted hover:bg-white/5 hover:text-white',
              ].join(' ')}
            >
              <Icon
                size={18}
                className={
                  isActive ? 'text-burst-orange-bright' : 'text-burst-muted group-hover:text-white'
                }
              />
              <span>{it.label}</span>
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-burst-orange animate-pulse" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto px-5 py-4 border-t border-burst-border">
        <div className="text-[10px] uppercase tracking-widest text-burst-muted">
          versão
        </div>
        <div className="text-xs text-white/70 font-mono">v1.0.0</div>
      </div>
    </aside>
  );
}

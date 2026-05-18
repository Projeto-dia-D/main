import { Code2, Palette, Headphones, Megaphone, CalendarDays, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { BrandTitle } from './BrandTitle';

export type TabKey = 'programacao' | 'design' | 'cs' | 'gestor' | 'calendario';

interface Props {
  active: TabKey;
  onChange: (k: TabKey) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const ITEMS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'programacao', label: 'Programação', icon: Code2 },
  { key: 'design', label: 'Design', icon: Palette },
  { key: 'cs', label: 'CS', icon: Headphones },
  { key: 'gestor', label: 'Gestor de Tráfego', icon: Megaphone },
  { key: 'calendario', label: 'Calendário', icon: CalendarDays },
];

export function Sidebar({ active, onChange, collapsed, onToggleCollapsed }: Props) {
  return (
    <aside
      className={[
        'shrink-0 bg-burst-panel border-r border-burst-border flex flex-col transition-all duration-200',
        collapsed ? 'w-16' : 'w-60',
      ].join(' ')}
    >
      <div
        className={[
          'border-b border-burst-border flex items-center gap-2',
          collapsed ? 'px-2 py-4 justify-center' : 'px-5 py-5',
        ].join(' ')}
      >
        {!collapsed && <BrandTitle size="lg" />}
        <button
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          className={[
            'rounded-lg p-1.5 text-burst-muted hover:bg-white/5 hover:text-white transition-colors',
            collapsed ? '' : 'ml-auto',
          ].join(' ')}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className={['flex flex-col py-4 gap-1', collapsed ? 'px-2' : 'px-3'].join(' ')}>
        {ITEMS.map((it) => {
          const Icon = it.icon;
          const isActive = active === it.key;
          return (
            <button
              key={it.key}
              onClick={() => onChange(it.key)}
              title={collapsed ? it.label : undefined}
              className={[
                'group flex items-center gap-3 rounded-lg text-sm font-medium transition-all',
                collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5',
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
              {!collapsed && <span>{it.label}</span>}
              {!collapsed && isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-burst-orange animate-pulse" />
              )}
            </button>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="mt-auto px-5 py-4 border-t border-burst-border">
          <div className="text-[10px] uppercase tracking-widest text-burst-muted">
            versão
          </div>
          <div className="text-xs text-white/70 font-mono">v1.0.0</div>
        </div>
      )}
    </aside>
  );
}

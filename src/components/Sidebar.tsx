import { Code2, Palette, Headphones, Megaphone, CalendarDays, Bell, HeartPulse, ChevronLeft, ChevronRight, LayoutDashboard, MessageSquareText, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { BrandTitle } from './BrandTitle';
import { useUser, hasFullAccess } from '../lib/userContext';
import { useNotifications } from '../lib/notificationsContext';

export type TabKey = 'programacao' | 'design' | 'cs' | 'gestor' | 'calendario' | 'saude' | 'apresentacao' | 'notificacoes' | 'anuncios' | 'controle';

interface Props {
  active: TabKey;
  onChange: (k: TabKey) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const ITEMS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'apresentacao', label: 'Apresentação', icon: LayoutDashboard },
  { key: 'programacao', label: 'Programação', icon: Code2 },
  { key: 'design', label: 'Design', icon: Palette },
  { key: 'cs', label: 'CS', icon: Headphones },
  { key: 'gestor', label: 'Gestor de Tráfego', icon: Megaphone },
  { key: 'calendario', label: 'Calendário', icon: CalendarDays },
  { key: 'saude', label: 'Saúde do Cliente', icon: HeartPulse },
  { key: 'anuncios', label: 'Anúncios', icon: MessageSquareText },
  { key: 'controle', label: 'Controle de Clientes', icon: SlidersHorizontal },
  { key: 'notificacoes', label: 'Notificações', icon: Bell },
];

/**
 * Quais tabs cada papel pode ver. Admin vê tudo. CS e Gestor NÃO veem Design
 * nem Notificações. Programador vê tudo (programadores ajudam no design).
 *
 * "Programação" é EXCLUSIVA de programador + admin/super — expõe bônus, taxa e
 * performance de TODOS os doutores. CS, gestor, designer e papéis desconhecidos
 * NÃO podem vê-la.
 * "Notificações" é só pra hasFullAccess (admin + super programador).
 * "Anúncios" e ferramenta de dev — programador (qualquer) + admin/super.
 */
function visibleTabsForRole(role: string | null | undefined): Set<TabKey> {
  if (role === 'cs') return new Set(['cs', 'calendario']);
  if (role === 'gestor') return new Set(['gestor', 'calendario']);
  if (role === 'designer') return new Set(['design', 'calendario']);
  // programador comum (sem viewAll): vê o que faz sentido pra ele
  // — Saúde do Cliente é exclusivo pra admin/super programador
  // — Anúncios e dev-tool, todo programador ve
  if (role === 'programador') {
    return new Set(['programacao', 'design', 'cs', 'gestor', 'calendario', 'anuncios']);
  }
  // Papel desconhecido / sem role: mínimo seguro, NUNCA Programação.
  return new Set(['calendario']);
}

export function Sidebar({ active, onChange, collapsed, onToggleCollapsed }: Props) {
  const user = useUser();
  const { notifications } = useNotifications();
  const notifCount = notifications.length;
  // Admin/super programador: tudo + notificações. Outros: tabs limitados.
  const visible = hasFullAccess(user)
    ? new Set<TabKey>(['apresentacao', 'programacao', 'design', 'cs', 'gestor', 'calendario', 'saude', 'anuncios', 'controle', 'notificacoes'])
    : visibleTabsForRole(user.role);
  const items = ITEMS.filter((it) => visible.has(it.key));
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
        {items.map((it) => {
          const Icon = it.icon;
          const isActive = active === it.key;
          const showBadge = it.key === 'notificacoes' && notifCount > 0;
          return (
            <button
              key={it.key}
              onClick={() => onChange(it.key)}
              title={collapsed ? it.label : undefined}
              className={[
                'group flex items-center gap-3 rounded-lg text-sm font-medium transition-all relative',
                collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5',
                isActive
                  ? 'bg-burst-orange/15 text-burst-orange-bright shadow-orange-glow-sm'
                  : 'text-burst-muted hover:bg-white/5 hover:text-white',
              ].join(' ')}
            >
              <div className="relative">
                <Icon
                  size={18}
                  className={
                    isActive ? 'text-burst-orange-bright' : 'text-burst-muted group-hover:text-white'
                  }
                />
                {showBadge && collapsed && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1">
                    {notifCount > 9 ? '9+' : notifCount}
                  </span>
                )}
              </div>
              {!collapsed && <span>{it.label}</span>}
              {!collapsed && showBadge && (
                <span className="ml-auto min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1.5">
                  {notifCount > 99 ? '99+' : notifCount}
                </span>
              )}
              {!collapsed && isActive && !showBadge && (
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

import { useState, useEffect } from 'react';
import { LogOut } from 'lucide-react';
import { Sidebar, type TabKey } from './components/Sidebar';
import { Avatar } from './components/Avatar';
import { Login } from './components/Login';
import { Programacao } from './components/tabs/Programacao';
import { GestorTrafego } from './components/tabs/GestorTrafego';
import { CS } from './components/tabs/CS';
import { Design } from './components/tabs/Design';
import { Calendario } from './components/tabs/Calendario';
import { useMondayClients } from './hooks/useMondayClients';
import { readCurrentUser, writeCurrentUser, type AuthUser } from './lib/auth';
import { UserContext, hasFullAccess } from './lib/userContext';
import { PhotoLightboxProvider } from './components/PhotoLightboxContext';
import { NotificationsProvider } from './lib/notificationsContext';
import { Notificacoes } from './components/tabs/Notificacoes';
import { SaudeCliente } from './components/tabs/SaudeCliente';
import { Apresentacao } from './components/tabs/Apresentacao';

const TAB_TITLES: Record<TabKey, string> = {
  apresentacao: 'Apresentação',
  programacao: 'Programação',
  design: 'Design',
  cs: 'CS',
  gestor: 'Gestor de Tráfego',
  calendario: 'Calendário',
  saude: 'Saúde do Cliente',
  notificacoes: 'Notificações',
};

const ROLE_LABEL = {
  admin: 'Admin',
  cs: 'CS',
  gestor: 'Gestor',
  programador: 'Programador',
  designer: 'Designer',
} as const;

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => readCurrentUser());

  // Default da tab por role — cada um cai no painel mais util pra ele:
  //   admin / super programador → Apresentação (dashboard TV)
  //   gestor → Gestor de Tráfego
  //   cs → CS
  //   designer → Design
  //   programador → Programação
  //   outros / sem role → Programação (fallback seguro)
  const defaultTab: TabKey = (() => {
    if (!user) return 'programacao';
    if (hasFullAccess(user)) return 'apresentacao';
    if (user.role === 'gestor') return 'gestor';
    if (user.role === 'cs') return 'cs';
    if (user.role === 'designer') return 'design';
    return 'programacao';
  })();
  const [active, setActive] = useState<TabKey>(defaultTab);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sidebar:collapsed') === '1';
    } catch {
      return false;
    }
  });

  // Só carrega Monday se autenticado (pra evitar requisições no login screen)
  const monday = useMondayClients();

  // Quando emails do Monday chegam, atualiza o cache de auth (pra próxima sessão)
  // Não bloqueia o login. Login agora tem seu próprio fetch leve.

  const emailsForLogin = monday.csByEmail.size > 0 || monday.gestorByEmail.size > 0 || monday.programadorByEmail.size > 0
    ? {
        csByEmail: monday.csByEmail,
        gestorByEmail: monday.gestorByEmail,
        programadorByEmail: monday.programadorByEmail,
      }
    : null;

  // Atualiza o usuário em localStorage sempre que ele muda
  useEffect(() => {
    writeCurrentUser(user);
  }, [user]);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem('sidebar:collapsed', next ? '1' : '0');
      } catch {
        /* ignora */
      }
      return next;
    });
  }

  // Se não há usuário, mostra Login
  if (!user) {
    return (
      <Login
        preloadedEmails={emailsForLogin}
        onAuthenticated={setUser}
      />
    );
  }

  const roleLabel = user.role
    ? ROLE_LABEL[user.role as keyof typeof ROLE_LABEL] ?? user.role
    : '';

  // CS e Gestor NÃO podem acessar Design. Admin, Programador e Designer podem.
  const canAccessDesign = user.role !== 'cs' && user.role !== 'gestor';

  function handleLogout() {
    writeCurrentUser(null);
    setUser(null);
  }

  return (
    <UserContext.Provider value={user}>
      <NotificationsProvider>
      <PhotoLightboxProvider>
      <div className="flex min-h-screen">
        <Sidebar
          active={active}
          onChange={setActive}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
        <main className="flex-1 min-w-0 flex flex-col">
          <header className="border-b border-burst-border bg-burst-panel/60 backdrop-blur px-6 py-3 flex items-center gap-4">
            <h1 className="font-display text-2xl text-white tracking-wider">
              {TAB_TITLES[active]}
            </h1>
            <div className="ml-auto flex items-center gap-3 text-xs text-burst-muted">
              <span className="w-2 h-2 rounded-full bg-burst-orange animate-pulse" />
              <span>Realtime ativo</span>
              <div className="h-5 w-px bg-burst-border" />
              <div className="flex items-center gap-2.5">
                <Avatar
                  src={user.photoUrl}
                  name={user.displayName ?? user.email}
                  size={32}
                  clickable
                />
                <div className="flex flex-col">
                  <span className="text-white text-xs font-semibold leading-none">
                    {user.displayName ?? user.email}
                  </span>
                  <span className="text-[10px] text-burst-muted uppercase tracking-wider leading-tight">
                    {roleLabel}
                    {user.scope && user.role !== 'admin' && ` • ${user.scope}`}
                  </span>
                </div>
              </div>
              <button
                onClick={handleLogout}
                title="Sair"
                className="p-1.5 rounded-md text-burst-muted hover:bg-white/5 hover:text-red-400 transition-colors"
              >
                <LogOut size={15} />
              </button>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {active === 'programacao' && <Programacao />}
            {active === 'design' && canAccessDesign && <Design />}
            {active === 'cs' && <CS />}
            {active === 'gestor' && <GestorTrafego />}
            {active === 'calendario' && <Calendario />}
            {active === 'saude' && <SaudeCliente />}
            {active === 'apresentacao' && <Apresentacao />}
            {active === 'notificacoes' && <Notificacoes />}
          </div>
        </main>
      </div>
      </PhotoLightboxProvider>
      </NotificationsProvider>
    </UserContext.Provider>
  );
}

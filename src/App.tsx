import { useState } from 'react';
import { Sidebar, type TabKey } from './components/Sidebar';
import { Programacao } from './components/tabs/Programacao';
import { GestorTrafego } from './components/tabs/GestorTrafego';
import { CS } from './components/tabs/CS';
import { Design } from './components/tabs/Design';
import { Calendario } from './components/tabs/Calendario';

const TAB_TITLES: Record<TabKey, string> = {
  programacao: 'Programação',
  design: 'Design',
  cs: 'CS',
  gestor: 'Gestor de Tráfego',
  calendario: 'Calendário',
};

export default function App() {
  const [active, setActive] = useState<TabKey>('programacao');
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sidebar:collapsed') === '1';
    } catch {
      return false;
    }
  });

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

  return (
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
          <div className="ml-auto flex items-center gap-2 text-xs text-burst-muted">
            <span className="w-2 h-2 rounded-full bg-burst-orange animate-pulse" />
            Realtime ativo
          </div>
        </header>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {active === 'programacao' && <Programacao />}
          {active === 'design' && <Design />}
          {active === 'cs' && <CS />}
          {active === 'gestor' && <GestorTrafego />}
          {active === 'calendario' && <Calendario />}
        </div>
      </main>
    </div>
  );
}

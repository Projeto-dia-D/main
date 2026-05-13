import { useState } from 'react';
import { Sidebar, type TabKey } from './components/Sidebar';
import { BrandTitle } from './components/BrandTitle';
import { Programacao } from './components/tabs/Programacao';
import { GestorTrafego } from './components/tabs/GestorTrafego';
import { CS } from './components/tabs/CS';
import { Placeholder } from './components/tabs/Placeholder';

const TAB_TITLES: Record<TabKey, string> = {
  programacao: 'Programação',
  design: 'Design',
  cs: 'CS',
  gestor: 'Gestor de Tráfego',
};

export default function App() {
  const [active, setActive] = useState<TabKey>('programacao');

  return (
    <div className="flex min-h-screen">
      <Sidebar active={active} onChange={setActive} />
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="border-b border-burst-border bg-burst-panel/60 backdrop-blur px-6 py-3 flex items-center gap-4">
          <BrandTitle size="sm" />
          <div className="h-6 w-px bg-burst-border" />
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
          {active === 'design' && (
            <Placeholder
              title="Design"
              description="Aqui vão entrar as métricas da equipe de Design (demandas/dia, custo por entrega). Estrutura preparada — basta plugar os dados."
            />
          )}
          {active === 'cs' && <CS />}
          {active === 'gestor' && <GestorTrafego />}
        </div>
      </main>
    </div>
  );
}

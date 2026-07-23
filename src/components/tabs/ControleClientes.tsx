import { useMemo, useState } from 'react';
import { SlidersHorizontal, Search, X, Check, Ban, Database, AlertTriangle, Filter } from 'lucide-react';
import { useMondayClients } from '../../hooks/useMondayClients';
import { useClientMetricControls } from '../../hooks/useClientMetricControls';
import { type ClientMetricControl } from '../../lib/clientMetricControl';
import { useUser, hasFullAccess } from '../../lib/userContext';

export function ControleClientes() {
  const user = useUser();
  const { clientsAll, biaActiveIds, loading: loadingClients } = useMondayClients();
  const { controls, controlsList, missingTable, error, save } = useClientMetricControls();
  const [busca, setBusca] = useState('');
  const [soAtivos, setSoAtivos] = useState(true);

  const updatedBy = user.displayName ?? user.email ?? null;

  // Universo de clientes: únicos por id, ordenados por nome.
  const clientes = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    for (const c of clientsAll) if (c.id && !byId.has(c.id)) byId.set(c.id, { id: c.id, name: c.name });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [clientsAll]);

  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const termos = norm(busca).split(/\s+/).filter(Boolean);

  const visiveis = useMemo(() => {
    return clientes.filter((c) => {
      // Filtro de busca (tem prioridade — busca cobre TODOS os clientes)
      if (termos.length > 0) {
        const h = norm(c.name);
        return termos.every((t) => h.includes(t));
      }
      // Sem busca: mostra ativos + qualquer um que já tenha controle custom.
      if (controls.has(c.id)) return true;
      if (soAtivos) return biaActiveIds.has(c.id);
      return true;
    });
  }, [clientes, termos, controls, soAtivos, biaActiveIds]);

  function toggle(cliente: { id: string; name: string }, setor: MetricSector) {
    const atual: ClientMetricControl =
      controls.get(cliente.id) ?? defaultControl(cliente.id, cliente.name);
    const novo: ClientMetricControl = {
      ...atual,
      monday_client_name: cliente.name, // atualiza snapshot do nome
      [setor]: !atual[setor],
    };
    save(novo, updatedBy);
  }

  function setTudo(cliente: { id: string; name: string }, valor: boolean) {
    save(
      {
        monday_client_id: cliente.id,
        monday_client_name: cliente.name,
        programacao: valor,
        gestor: valor,
        cs: valor,
        design: valor,
      },
      updatedBy
    );
  }

  // Guard de acesso (defesa em profundidade — App/Sidebar já limitam).
  if (!hasFullAccess(user)) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-burst-orange/40 bg-burst-card p-8 max-w-2xl">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="text-burst-orange-bright" />
            <h2 className="font-display text-2xl text-white tracking-wider">Acesso restrito</h2>
          </div>
          <p className="text-sm text-burst-muted">Este módulo é exclusivo para administradores.</p>
        </div>
      </div>
    );
  }

  if (missingTable) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-burst-orange/40 bg-burst-card p-8 max-w-2xl">
          <div className="flex items-center gap-2 mb-4">
            <Database className="text-burst-orange-bright" />
            <h2 className="font-display text-2xl text-white tracking-wider">
              Tabela client_metric_controls não existe
            </h2>
          </div>
          <p className="text-burst-muted text-sm mb-3">
            Rode o SQL em{' '}
            <code className="text-burst-orange-bright">db/client_metric_controls.sql</code> no
            Supabase Dashboard → SQL Editor → Run. Depois recarregue esta página.
          </p>
          <p className="text-burst-muted text-xs">
            Enquanto a tabela não existe, todos os clientes contam em todas as métricas (padrão).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1400px] mx-auto">
      {/* Cabeçalho */}
      <section className="rounded-2xl border border-burst-border bg-burst-card p-6">
        <div className="flex items-center gap-3 mb-2">
          <SlidersHorizontal className="text-burst-orange-bright" size={22} />
          <h2 className="font-display text-3xl text-white tracking-wider">
            Controle de Clientes nas Métricas
          </h2>
        </div>
        <p className="text-sm text-burst-muted max-w-3xl">
          Escolha em quais métricas cada cliente conta. Por padrão, <span className="text-white">todos
          contam em todas</span>. Desligue um setor pra tirar o cliente das métricas daquela aba.
          Só clientes com algum setor desligado ficam salvos ({controlsList.length} configurado
          {controlsList.length === 1 ? '' : 's'}).
        </p>
        {error && (
          <div className="mt-3 text-xs text-red-400 flex items-center gap-1.5">
            <AlertTriangle size={13} /> {error}
          </div>
        )}
      </section>

      {/* Barra de filtro */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-black/30 border border-burst-border rounded-lg px-3 py-2 min-w-[240px] flex-1 max-w-md">
          <Search size={15} className="text-burst-muted shrink-0" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente..."
            className="bg-transparent border-none outline-none text-sm text-white flex-1 placeholder:text-burst-muted min-w-0"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="text-burst-muted hover:text-white shrink-0">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setSoAtivos((v) => !v)}
          className={[
            'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors',
            soAtivos
              ? 'border-burst-orange/50 bg-burst-orange/10 text-burst-orange-bright'
              : 'border-burst-border bg-black/30 text-burst-muted hover:text-white',
          ].join(' ')}
          title="Sem busca, mostra só clientes com Bia I.A ativa (+ os já configurados)"
        >
          <Filter size={13} /> {soAtivos ? 'Só ativos' : 'Todos'}
        </button>
        <span className="text-xs text-burst-muted ml-auto">
          {visiveis.length} cliente(s)
        </span>
      </div>

      {/* Legenda de setores */}
      <div className="flex items-center gap-2 text-[11px] text-burst-muted flex-wrap">
        <span className="uppercase tracking-wider">Setores:</span>
        {METRIC_SECTORS.map((s) => (
          <span key={s.key} className="px-2 py-0.5 rounded bg-black/30 border border-burst-border text-white/70">
            {s.label}
          </span>
        ))}
        <span className="ml-2">· verde = conta · vermelho = não conta</span>
      </div>

      {/* Lista */}
      {loadingClients && clientes.length === 0 ? (
        <div className="text-burst-muted text-sm py-10 text-center">Carregando clientes do Monday…</div>
      ) : visiveis.length === 0 ? (
        <div className="rounded-xl border border-dashed border-burst-border bg-burst-card/40 p-10 text-center text-sm text-burst-muted">
          {busca ? `Nenhum cliente casa com "${busca}"` : 'Nenhum cliente pra mostrar.'}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {visiveis.map((c) => {
            const ctrl = controls.get(c.id);
            const custom = !!ctrl;
            return (
              <div
                key={c.id}
                className={[
                  'flex items-center gap-3 rounded-xl border px-4 py-2.5 flex-wrap',
                  custom ? 'border-burst-orange/40 bg-burst-orange/[0.04]' : 'border-burst-border bg-black/20',
                ].join(' ')}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate flex items-center gap-2">
                    {c.name}
                    {biaActiveIds.has(c.id) && (
                      <span className="text-[9px] uppercase tracking-wider text-green-400/80 shrink-0">• ativo</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {METRIC_SECTORS.map((s) => {
                    const on = ctrl ? ctrl[s.key] !== false : true;
                    return (
                      <button
                        key={s.key}
                        onClick={() => toggle(c, s.key)}
                        title={`${on ? 'Desligar' : 'Ligar'} ${s.label}`}
                        className={[
                          'flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] font-semibold transition-colors',
                          on
                            ? 'border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500/20'
                            : 'border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20',
                        ].join(' ')}
                      >
                        {on ? <Check size={11} /> : <Ban size={11} />}
                        {s.label}
                      </button>
                    );
                  })}
                  <div className="w-px h-5 bg-burst-border mx-1" />
                  <button
                    onClick={() => setTudo(c, true)}
                    title="Ligar todos"
                    className="px-2 py-1 rounded-md border border-burst-border text-[10px] text-burst-muted hover:text-green-400 hover:border-green-500/40"
                  >
                    tudo
                  </button>
                  <button
                    onClick={() => setTudo(c, false)}
                    title="Desligar todos"
                    className="px-2 py-1 rounded-md border border-burst-border text-[10px] text-burst-muted hover:text-red-400 hover:border-red-500/40"
                  >
                    nada
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

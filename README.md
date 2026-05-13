# Dia D Burst 🔥

Dashboard em tempo real para acompanhamento da equipe Dia D. Consome dados do Supabase (`relatorio_bias`) e cruza com a uazapi para identificar instâncias.

## Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS
- Supabase Realtime (`@supabase/supabase-js`)
- Recharts
- lucide-react

## Setup

1. Instalar dependências:

   ```bash
   npm install
   ```

2. Copiar `.env.example` para `.env` e preencher as **4** variáveis:

   ```
   VITE_SUPABASE_URL=
   VITE_SUPABASE_SERVICE_ROLE_SECRET=
   VITE_UAZAPI_URL=
   VITE_UAZAPI_TOKEN=
   ```

3. Rodar em dev:

   ```bash
   npm run dev
   ```

4. Build de produção:

   ```bash
   npm run build && npm run preview
   ```

## Estrutura

```
src/
├── config.ts                    # 4 vars do .env
├── lib/
│   ├── supabase.ts              # client + nome da tabela
│   ├── uazapi.ts                # GET /status com cache 30min
│   ├── types.ts                 # RelatorioBias, DoutorMetrics...
│   └── metrics.ts               # detecção de agendamento + faixas
├── hooks/
│   ├── useLeads.ts              # carga + Realtime (INSERT/UPDATE/DELETE)
│   ├── useInstanceName.ts       # busca nome via uazapi
│   └── useAnimatedNumber.ts     # contador animado
├── components/
│   ├── Sidebar.tsx              # menu lateral (Monday-style)
│   ├── Logo.tsx                 # logo chama (SVG inline)
│   ├── AnimatedNumber.tsx
│   ├── tabs/
│   │   ├── Programacao.tsx      # ← aba completa
│   │   ├── Placeholder.tsx
│   │   └── (Design, CS, Gestor são placeholders renderizados em App.tsx)
│   └── programacao/
│       ├── PainelGeral.tsx
│       ├── RankingDoutores.tsx
│       ├── Alertas.tsx
│       ├── AlertaLeadSemDoutor.tsx
│       └── DoutorCard.tsx
└── App.tsx
```

## Lógica de métricas

**Agendamento detectado** quando `historico` OU `mensagemInicial` (case-insensitive, sem acentos) contém qualquer uma:

- agendar consulta
- agendar avaliação / avaliacao
- agendamento confirmado
- consulta agendada
- avaliação / avaliacao agendada
- vou agendar
- pode agendar

**Faixas salariais (Programação)**:

| Taxa | Custo |
| --- | --- |
| < 16% | 0 salário |
| 16% – 20% | 0,5 salário |
| > 20% | 1 salário |

## Comportamento

- **Tempo real:** assina `postgres_changes` na tabela `relatorio_bias`. Inserções, updates e deletes atualizam tudo automaticamente.
- **Doutores dinâmicos:** ao aparecer um novo valor em `nomeDoutor`, um card novo é criado no grid sem qualquer ajuste de código.
- **Cache uazapi:** chamadas `GET /status` por token são cacheadas em memória por 30min e deduplicadas (in-flight).
- **Alertas:**
  - Leads com `nomeDoutor` nulo/vazio → busca nome da instância via uazapi e exibe card vermelho pulsante.
  - Doutor sem `dataTransferencia` há 5+ dias → alerta amarelo.

## Notas de segurança

`SUPABASE_SERVICE_ROLE_SECRET` no front-end ignora RLS. Para uso interno isso é aceitável, mas se o app sair da intranet considere mover as queries para uma função serverless e expor só o `anon` key no client.

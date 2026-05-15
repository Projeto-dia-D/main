-- ============================================================
-- Tabela de demandas concluídas pelo Design
--
-- Espelha exatamente as 13 colunas dos quadros de backup do Monday:
--   - Backup atual (board 6900586110)
--   - Backup 2024-2026 (board 18412400257)
--   - Central de Design (board 3519879202) → ingest contínuo, só
--     quando "Status do Designer" = Feito
--
-- Extras de controle interno (não vêm dos backups):
--   monday_item_id  — extraído do `Link da demanda`, usado pra dedupe
--   origem          — 'backup_atual' | 'backup_2024' | 'central'
--   imported_at     — quando entrou nesta tabela
--
-- Cole no Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.design_demandas (
  id                   BIGSERIAL PRIMARY KEY,
  -- Colunas compartilhadas (Feito + Manutenção):
  nome                 TEXT,
  link_demanda         TEXT,
  designer_responsavel TEXT,
  padrao_tarefa        TEXT,
  tipo_edicao          TEXT,
  log_criacao          TEXT,
  -- Específicas do fluxo de FEITO (board Central de Design):
  clientes             TEXT,
  prioridade           TEXT,
  tempo_atrasado       TEXT,
  status_tarefa        TEXT,
  status_designer      TEXT,
  priority             TEXT,
  -- Específicas do fluxo de MANUTENÇÃO (board 6791838447):
  status_principal     TEXT,
  status_individual    TEXT,
  gestor_responsavel   TEXT,
  tipo_manutencao      TEXT,
  -- Controle interno:
  tipo_evento          TEXT NOT NULL DEFAULT 'feito'
                       CHECK (tipo_evento IN ('feito','manutencao','manutencao_c')),
  monday_item_id       TEXT,
  origem               TEXT NOT NULL
                       CHECK (origem IN (
                         'backup_atual',          -- board 6900586110 (Backup Demandas feitas)
                         'backup_2024',           -- xlsx 2024-2026 antigo
                         'backup_manutencao',     -- board 6791838447 grupo "Backup Manutenções"
                         'demandas_atual',        -- board 6900515649 (Demandas feitas ATIVAS)
                         'manutencao_atual',      -- board 6791838447 grupo "Manutenções" ATIVAS
                         'central',               -- via Edge Function (webhook do Monday)
                         'central_backfill'       -- via script scripts/backfill_manutencoes_central.py
                       )),
  imported_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index NÃO único em monday_item_id.
-- Cada linha = um evento "Status do Designer = Feito" (entrega original ou
-- manutenção). O mesmo item Monday pode aparecer várias vezes legitimamente.
-- Pra ver itens únicos: SELECT DISTINCT monday_item_id ...
-- Pra ver itens com manutenção: GROUP BY monday_item_id HAVING COUNT(*) > 1
CREATE INDEX IF NOT EXISTS idx_design_demandas_monday_item
  ON public.design_demandas (monday_item_id);

-- Index pra filtros comuns (por designer, por mês de criação)
CREATE INDEX IF NOT EXISTS idx_design_demandas_designer
  ON public.design_demandas (designer_responsavel);

CREATE INDEX IF NOT EXISTS idx_design_demandas_imported_at
  ON public.design_demandas (imported_at DESC);

CREATE INDEX IF NOT EXISTS idx_design_demandas_tipo_evento
  ON public.design_demandas (tipo_evento);

ALTER PUBLICATION supabase_realtime ADD TABLE public.design_demandas;

ALTER TABLE public.design_demandas DISABLE ROW LEVEL SECURITY;

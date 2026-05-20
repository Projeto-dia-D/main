-- ============================================================
-- Tabelas espelho do Monday — populadas pelo script de sync diário
-- (scripts/sync_monday_to_supabase.py, agendado pra meia-noite).
--
-- Objetivo: frontend lê TUDO do Supabase (rápido + realtime).
-- Monday é consultado APENAS pelo script de sync.
--
-- REGRA CRÍTICA: Monday é READ-ONLY do lado da aplicação.
-- Apenas o script Python escreve nas tabelas (via service_role).
--
-- Cole no Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. monday_design_activity
--    Activity logs dos boards de Design (Status da Tarefa,
--    Status do Designer, etc). 180+ dias retroativos.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monday_design_activity (
  log_id        TEXT PRIMARY KEY,         -- ID do log no Monday (único)
  board_id      TEXT NOT NULL,
  pulse_id      TEXT NOT NULL,            -- ID do item (a demanda)
  pulse_name    TEXT,
  column_id     TEXT NOT NULL,
  prev_label    TEXT,
  next_label    TEXT,
  ts            TIMESTAMPTZ NOT NULL,     -- quando o evento aconteceu
  user_id       TEXT,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_md_activity_pulse
  ON public.monday_design_activity (pulse_id);
CREATE INDEX IF NOT EXISTS idx_md_activity_board_ts
  ON public.monday_design_activity (board_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_md_activity_ts
  ON public.monday_design_activity (ts DESC);

ALTER TABLE public.monday_design_activity DISABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monday_design_activity;


-- ------------------------------------------------------------
-- 2. monday_design_demanda_links
--    board_relation "Clientes" dos 6 boards de Design.
--    Mapa pulse_id (demanda) → monday_client_ids[] (board principal).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monday_design_demanda_links (
  pulse_id            TEXT PRIMARY KEY,        -- ID do item no board de Design
  board_id            TEXT NOT NULL,
  monday_client_ids   TEXT[] NOT NULL DEFAULT '{}',  -- IDs do board principal
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_md_demanda_links_board
  ON public.monday_design_demanda_links (board_id);
-- GIN pra query "demandas deste cliente"
CREATE INDEX IF NOT EXISTS idx_md_demanda_links_clients
  ON public.monday_design_demanda_links USING GIN (monday_client_ids);

ALTER TABLE public.monday_design_demanda_links DISABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monday_design_demanda_links;


-- ------------------------------------------------------------
-- 3. monday_design_items
--    Datas de criação (created_at) de cada item dos boards de Design.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monday_design_items (
  pulse_id      TEXT PRIMARY KEY,
  board_id      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_md_items_board
  ON public.monday_design_items (board_id);
CREATE INDEX IF NOT EXISTS idx_md_items_created
  ON public.monday_design_items (created_at DESC);

ALTER TABLE public.monday_design_items DISABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monday_design_items;


-- ------------------------------------------------------------
-- 4. monday_otimizacao_events
--    Events do board "Otimização Clientes" (criação + status logs).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monday_otimizacao_events (
  -- Quando vier de log: log_id; quando vier de criação: 'created_' + pulse_id
  event_id      TEXT PRIMARY KEY,
  board_id      TEXT NOT NULL,
  pulse_id      TEXT NOT NULL,
  pulse_name    TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('criacao', 'status')),
  detail        TEXT,                     -- next_label (pra kind=status)
  ts            TIMESTAMPTZ NOT NULL,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_md_otim_pulse
  ON public.monday_otimizacao_events (pulse_id);
CREATE INDEX IF NOT EXISTS idx_md_otim_ts
  ON public.monday_otimizacao_events (ts DESC);

ALTER TABLE public.monday_otimizacao_events DISABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monday_otimizacao_events;


-- ------------------------------------------------------------
-- 5. monday_otimizacao_links
--    Mapa pulse_id (item de Otimização) → monday_client_ids[]
--    via board_relation "Clientes" do board Otimização.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monday_otimizacao_links (
  pulse_id            TEXT PRIMARY KEY,
  board_id            TEXT NOT NULL,
  monday_client_ids   TEXT[] NOT NULL DEFAULT '{}',
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_md_otim_links_clients
  ON public.monday_otimizacao_links USING GIN (monday_client_ids);

ALTER TABLE public.monday_otimizacao_links DISABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monday_otimizacao_links;


-- ------------------------------------------------------------
-- 6. monday_bia_fase_timeline
--    Activity log das mudanças de "Fase" no board Bia Soft.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monday_bia_fase_timeline (
  log_id            TEXT PRIMARY KEY,
  bia_item_id       TEXT NOT NULL,        -- pulse_id no board Bia Soft
  monday_client_ids TEXT[] NOT NULL DEFAULT '{}', -- IDs do board principal vinculados
  prev_label        TEXT,
  next_label        TEXT,
  ts                TIMESTAMPTZ NOT NULL,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_md_bia_fase_item
  ON public.monday_bia_fase_timeline (bia_item_id);
CREATE INDEX IF NOT EXISTS idx_md_bia_fase_ts
  ON public.monday_bia_fase_timeline (ts DESC);
CREATE INDEX IF NOT EXISTS idx_md_bia_fase_clients
  ON public.monday_bia_fase_timeline USING GIN (monday_client_ids);

ALTER TABLE public.monday_bia_fase_timeline DISABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monday_bia_fase_timeline;


-- ------------------------------------------------------------
-- 7. monday_sync_meta
--    Metadados de cada sync (boardId resolvido pra Otimização, etc).
--    Permite o frontend saber qual foi o último sync.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monday_sync_meta (
  key           TEXT PRIMARY KEY,
  value         JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.monday_sync_meta DISABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monday_sync_meta;

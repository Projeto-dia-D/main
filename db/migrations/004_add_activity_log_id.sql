-- ============================================================
-- Adiciona monday_activity_log_id em design_demandas pra idempotência
-- do backfill (scripts/backfill_manutencoes_central.py).
--
-- Cada evento no Monday Activity Log tem um id único. Armazenando esse
-- id permite que o backfill seja seguro pra rodar várias vezes sem
-- duplicar registros.
--
-- Cole no Supabase Dashboard → SQL Editor → Run.
-- ============================================================

ALTER TABLE public.design_demandas
  ADD COLUMN IF NOT EXISTS monday_activity_log_id TEXT;

CREATE INDEX IF NOT EXISTS idx_design_demandas_activity_log_id
  ON public.design_demandas (monday_activity_log_id)
  WHERE monday_activity_log_id IS NOT NULL;

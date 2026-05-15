-- ============================================================
-- Adiciona data_feito em design_demandas — timestamp REAL de quando
-- o item foi marcado como "Feito" no Monday (pego do Activity Log).
--
-- Necessário porque log_criacao é a DATA DE CRIAÇÃO do item, mas pra
-- métricas de "entregas/dia" precisamos da data de QUANDO FICOU FEITO.
--
-- Cole no Supabase Dashboard → SQL Editor → Run.
-- ============================================================

ALTER TABLE public.design_demandas
  ADD COLUMN IF NOT EXISTS data_feito TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_design_demandas_data_feito
  ON public.design_demandas (data_feito)
  WHERE data_feito IS NOT NULL;

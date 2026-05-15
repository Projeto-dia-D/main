-- ============================================================
-- Adiciona 'central_backfill' como origem permitida em design_demandas.
-- Usado pelo script scripts/backfill_manutencoes_central.py pra inserir
-- eventos históricos de manutenção que não foram capturados pelo webhook
-- nem pelos backups xlsx.
--
-- Cole no Supabase Dashboard → SQL Editor → Run.
-- ============================================================

ALTER TABLE public.design_demandas
  DROP CONSTRAINT IF EXISTS design_demandas_origem_check;

ALTER TABLE public.design_demandas
  ADD CONSTRAINT design_demandas_origem_check
  CHECK (origem IN (
    'backup_atual',
    'backup_2024',
    'backup_manutencao',
    'demandas_atual',
    'manutencao_atual',
    'central',
    'central_backfill'
  ));

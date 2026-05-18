-- ============================================================
-- Atestados de designers — dias que NÃO contam pro cálculo de
-- "demandas/dia" do designer.
--
-- Exemplo: Lais ficou de atestado de 13/05 a 15/05/2026 (3 dias úteis).
-- O dashboard, ao calcular "demandas/dia" da Lais, subtrai 3 do total
-- de dias úteis do período. Assim a métrica reflete a produtividade real.
--
-- Cole no Supabase Dashboard → SQL Editor → Run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.designer_atestados (
  id           BIGSERIAL PRIMARY KEY,
  designer     TEXT NOT NULL,
  data_inicio  DATE NOT NULL,
  data_fim     DATE NOT NULL,
  motivo       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS idx_atestados_designer
  ON public.designer_atestados (designer);
CREATE INDEX IF NOT EXISTS idx_atestados_dates
  ON public.designer_atestados (data_inicio, data_fim);

ALTER PUBLICATION supabase_realtime ADD TABLE public.designer_atestados;
ALTER TABLE public.designer_atestados DISABLE ROW LEVEL SECURITY;

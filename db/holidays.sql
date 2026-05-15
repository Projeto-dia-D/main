-- ============================================================
-- Feriados — usados pra contar dias úteis nas métricas
-- (principalmente "Demandas/dia" do design)
--
-- Cole no Supabase Dashboard → SQL Editor → Run.
-- Roda quantas vezes quiser (ON CONFLICT DO NOTHING).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.holidays (
  date       DATE PRIMARY KEY,
  name       TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'custom'
             CHECK (source IN ('nacional', 'custom')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holidays_source ON public.holidays (source);

ALTER PUBLICATION supabase_realtime ADD TABLE public.holidays;
ALTER TABLE public.holidays DISABLE ROW LEVEL SECURITY;

-- Seed: feriados nacionais 2026-2028
-- (federais + Carnaval seg-ter + Corpus Christi, todos observados nacionalmente)
INSERT INTO public.holidays (date, name, source) VALUES
-- 2026
('2026-01-01', 'Confraternização Universal',    'nacional'),
('2026-02-16', 'Carnaval (segunda)',            'nacional'),
('2026-02-17', 'Carnaval (terça)',              'nacional'),
('2026-04-03', 'Sexta-feira Santa',             'nacional'),
('2026-04-21', 'Tiradentes',                    'nacional'),
('2026-05-01', 'Dia do Trabalhador',            'nacional'),
('2026-06-04', 'Corpus Christi',                'nacional'),
('2026-09-07', 'Independência do Brasil',       'nacional'),
('2026-10-12', 'Nossa Senhora Aparecida',       'nacional'),
('2026-11-02', 'Finados',                       'nacional'),
('2026-11-15', 'Proclamação da República',      'nacional'),
('2026-11-20', 'Consciência Negra',             'nacional'),
('2026-12-25', 'Natal',                         'nacional'),
-- 2027
('2027-01-01', 'Confraternização Universal',    'nacional'),
('2027-02-08', 'Carnaval (segunda)',            'nacional'),
('2027-02-09', 'Carnaval (terça)',              'nacional'),
('2027-03-26', 'Sexta-feira Santa',             'nacional'),
('2027-04-21', 'Tiradentes',                    'nacional'),
('2027-05-01', 'Dia do Trabalhador',            'nacional'),
('2027-05-27', 'Corpus Christi',                'nacional'),
('2027-09-07', 'Independência do Brasil',       'nacional'),
('2027-10-12', 'Nossa Senhora Aparecida',       'nacional'),
('2027-11-02', 'Finados',                       'nacional'),
('2027-11-15', 'Proclamação da República',      'nacional'),
('2027-11-20', 'Consciência Negra',             'nacional'),
('2027-12-25', 'Natal',                         'nacional'),
-- 2028
('2028-01-01', 'Confraternização Universal',    'nacional'),
('2028-02-28', 'Carnaval (segunda)',            'nacional'),
('2028-02-29', 'Carnaval (terça)',              'nacional'),
('2028-04-14', 'Sexta-feira Santa',             'nacional'),
('2028-04-21', 'Tiradentes',                    'nacional'),
('2028-05-01', 'Dia do Trabalhador',            'nacional'),
('2028-06-15', 'Corpus Christi',                'nacional'),
('2028-09-07', 'Independência do Brasil',       'nacional'),
('2028-10-12', 'Nossa Senhora Aparecida',       'nacional'),
('2028-11-02', 'Finados',                       'nacional'),
('2028-11-15', 'Proclamação da República',      'nacional'),
('2028-11-20', 'Consciência Negra',             'nacional'),
('2028-12-25', 'Natal',                         'nacional')
ON CONFLICT (date) DO NOTHING;

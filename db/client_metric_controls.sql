-- ============================================================
-- Controle de Clientes nas Métricas
--
-- Por cliente (monday_client_id), define em QUAIS métricas ele conta:
-- Programação, Gestor de Tráfego, CS e Design. Ausência de linha = conta em
-- TUDO (padrão). Só existe linha pra cliente que teve algum setor DESLIGADO.
--
-- Cole este SQL no Supabase Dashboard → SQL Editor → Run.
-- Idempotente (CREATE IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.client_metric_controls (
  monday_client_id   TEXT PRIMARY KEY,
  monday_client_name TEXT,
  programacao        BOOLEAN NOT NULL DEFAULT TRUE,
  gestor             BOOLEAN NOT NULL DEFAULT TRUE,
  cs                 BOOLEAN NOT NULL DEFAULT TRUE,
  design             BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by         TEXT
);

-- Habilita Realtime (mudanças sincronizam entre abas/telas)
ALTER PUBLICATION supabase_realtime ADD TABLE public.client_metric_controls;

-- RLS desabilitada: o app usa service_role secret, que bypassa políticas.
ALTER TABLE public.client_metric_controls DISABLE ROW LEVEL SECURITY;

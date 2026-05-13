-- ============================================================
-- Tabela de vínculos: Cliente (Monday) ↔ Conta de Anúncios (Meta)
--
-- Cole este SQL no Supabase Dashboard → SQL Editor → Run.
-- Executar uma única vez. Idempotente (CREATE IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.client_meta_links (
  monday_client_id   TEXT PRIMARY KEY,
  monday_client_name TEXT,
  meta_account_id    TEXT NOT NULL,        -- formato "act_XXXXXXXXX"
  meta_account_name  TEXT,
  gestor             TEXT,                  -- Renan / Weslei / André
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_meta_links_account
  ON public.client_meta_links (meta_account_id);

-- Habilita Realtime na tabela (mudanças sincronizam entre abas)
ALTER PUBLICATION supabase_realtime ADD TABLE public.client_meta_links;

-- RLS desabilitada: o app usa service_role secret, que bypassa políticas.
ALTER TABLE public.client_meta_links DISABLE ROW LEVEL SECURITY;

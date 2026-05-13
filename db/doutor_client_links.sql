-- ============================================================
-- Vínculos manuais: Doutor (Supabase nomeDoutor) ↔ Cliente Monday
--
-- Quando o match automático por substring ou Token uazapi não pega
-- um doutor, você vincula manualmente no painel "Transferências sem
-- cliente Monday" da aba Gestor.
--
-- Cole este SQL no Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.doutor_client_links (
  doutor_name        TEXT PRIMARY KEY,
  monday_client_id   TEXT NOT NULL,
  monday_client_name TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doutor_client_links_monday
  ON public.doutor_client_links (monday_client_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.doutor_client_links;

ALTER TABLE public.doutor_client_links DISABLE ROW LEVEL SECURITY;

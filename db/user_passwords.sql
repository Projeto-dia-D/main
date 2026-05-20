-- ============================================================
-- Tabela de senhas dos usuários do app Dia D.
--
-- Cada usuário (CS, gestor, programador, admin, designer) cria
-- a sua senha individualmente na primeira vez que acessa.
-- O email é validado contra o Monday (csByEmail/gestorByEmail/...)
-- antes de permitir a criação — sem cadastro novo.
--
-- Hash: SHA-256 com email como salt (formato hex). Não é bcrypt,
-- mas é consistente com o nível de segurança do app que já expõe
-- service_role no browser.
--
-- Cole no Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_passwords (
  email          TEXT PRIMARY KEY,
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_passwords_updated_at
  ON public.user_passwords (updated_at DESC);

ALTER TABLE public.user_passwords DISABLE ROW LEVEL SECURITY;

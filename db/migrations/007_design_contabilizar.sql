-- ============================================================================
-- 007_design_contabilizar.sql
-- "Atribuir métricas" do Design: o Renan decide, por manutenção, se ela conta.
-- Conta por PADRÃO (contabilizar=true); o Renan desmarca as injustas na tela
-- "Atribuir métricas" (sub-aba de Design). Aditivo / idempotente / não-destrutivo.
--
-- Usado por:
--   - src/lib/designMetrics.ts  (numerador do % = manutencao + manutencao_c com contabilizar != false)
--   - src/components/design/AtribuirMetricas.tsx (tela de revisão)
-- ============================================================================

ALTER TABLE public.design_demandas
  -- true = a manutenção pesa no % (padrão). Renan põe false p/ não contar.
  --        (só faz sentido em linhas tipo_evento 'manutencao' / 'manutencao_c')
  ADD COLUMN IF NOT EXISTS contabilizar      BOOLEAN NOT NULL DEFAULT true,
  -- Renan já revisou esta manutenção? (separa "ninguém viu" de "Renan confirmou")
  ADD COLUMN IF NOT EXISTS revisado          BOOLEAN NOT NULL DEFAULT false,
  -- Justificativa que o DESIGNER escreve enquanto ainda não foi revisada
  ADD COLUMN IF NOT EXISTS justificativa     TEXT,
  -- Auditoria da decisão do Renan
  ADD COLUMN IF NOT EXISTS revisado_por      TEXT,
  ADD COLUMN IF NOT EXISTS revisado_em       TIMESTAMPTZ,
  -- Auditoria da justificativa do designer
  ADD COLUMN IF NOT EXISTS justificativa_por TEXT,
  ADD COLUMN IF NOT EXISTS justificativa_em  TIMESTAMPTZ;

-- Índice p/ a tela de revisão (manutenções ainda não revisadas)
CREATE INDEX IF NOT EXISTS idx_design_demandas_revisao
  ON public.design_demandas (tipo_evento, revisado);

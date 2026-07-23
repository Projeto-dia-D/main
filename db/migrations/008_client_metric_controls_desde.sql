-- ============================================================================
-- 008_client_metric_controls_desde.sql
-- "Vale a partir de" no Controle de Clientes.
--
-- Sem esta coluna o desligamento é RETROATIVO: o cliente some também dos Dia D
-- já fechados, mudando números de bônus que já foram pagos. Com ela, o
-- desligamento passa a valer só de uma data em diante.
--
--   excluido_desde = NULL  → vale SEMPRE (retroativo — comportamento antigo,
--                            preservado para todas as linhas já existentes)
--   excluido_desde = DATA  → só exclui registros/períodos a partir dessa data
--
-- Aditivo / idempotente / não-destrutivo.
-- ============================================================================

ALTER TABLE public.client_metric_controls
  ADD COLUMN IF NOT EXISTS excluido_desde DATE;

COMMENT ON COLUMN public.client_metric_controls.excluido_desde IS
  'Data a partir da qual o desligamento vale. NULL = sempre (retroativo).';

-- Verificação
SELECT monday_client_name, programacao, gestor, cs, design, excluido_desde
FROM public.client_metric_controls
ORDER BY monday_client_name;

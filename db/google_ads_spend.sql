-- Tabela de gasto diário do Google Ads (alimentada por
-- scripts/sync_google_ads_spend.mjs, agendado no Task Scheduler).
-- 1 linha por conta+dia. O frontend lê e injeta no Gestor/CS/Apresentação.
--
-- Rodar no SQL Editor do Supabase (uma vez).

create table if not exists public.google_ads_spend (
  account_id   text not null,            -- customer_id sem traços (ex: 5890334900)
  date         date not null,            -- dia do gasto
  account_name text,                     -- nome descritivo da conta
  currency     text,                     -- BRL etc.
  spend        numeric not null default 0, -- gasto do dia na moeda da conta
  synced_at    timestamptz not null default now(),
  primary key (account_id, date)
);

alter table public.google_ads_spend enable row level security;

-- Índice pra consulta por período (o frontend filtra por date)
create index if not exists google_ads_spend_date_idx
  on public.google_ads_spend (date);

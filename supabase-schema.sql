-- Finpepe — esquema para Supabase
-- Ejecutá este script una sola vez en tu proyecto:
--   Supabase → SQL Editor → New query → pegar todo → Run
--
-- Guarda el estado completo de la app como un documento JSON por usuario.
-- Row Level Security asegura que cada persona solo pueda ver y editar su
-- propia fila, aunque la "anon key" sea pública (por eso es seguro publicar
-- la app en GitHub Pages).

create table if not exists public.finance_state (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.finance_state enable row level security;

-- Cada usuario solo accede a su propia fila (auth.uid() = user_id).
drop policy if exists "finance_state_select_own" on public.finance_state;
create policy "finance_state_select_own"
  on public.finance_state for select
  using (auth.uid() = user_id);

drop policy if exists "finance_state_insert_own" on public.finance_state;
create policy "finance_state_insert_own"
  on public.finance_state for insert
  with check (auth.uid() = user_id);

drop policy if exists "finance_state_update_own" on public.finance_state;
create policy "finance_state_update_own"
  on public.finance_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "finance_state_delete_own" on public.finance_state;
create policy "finance_state_delete_own"
  on public.finance_state for delete
  using (auth.uid() = user_id);

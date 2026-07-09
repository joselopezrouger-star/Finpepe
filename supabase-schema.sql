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


-- ============================================================================
-- Gastos compartidos en pareja ("hogar" de 2 personas).
-- Si ya ejecutaste la parte de arriba antes, no hay problema: podés volver a
-- correr TODO este archivo de nuevo, es seguro (no borra datos existentes).
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Un "hogar" agrupa a dos personas que comparten gastos.
create table if not exists public.households (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null default 'Hogar',
  created_by uuid        not null references auth.users (id),
  created_at timestamptz not null default now()
);

-- Quién pertenece a cada hogar.
create table if not exists public.household_members (
  household_id uuid        not null references public.households (id) on delete cascade,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  email        text,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Códigos de invitación de un solo uso (para que tu pareja se una al hogar).
create table if not exists public.household_invites (
  code         text        primary key,
  household_id uuid        not null references public.households (id) on delete cascade,
  created_by   uuid        not null references auth.users (id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '7 days')
);

-- Gastos pagados por uno de los dos, a repartir entre ambos.
create table if not exists public.shared_expenses (
  id           uuid        primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  paid_by      uuid        not null references auth.users (id),
  payer_share  numeric     not null default 0.5 check (payer_share >= 0 and payer_share <= 1),
  amount       numeric     not null check (amount > 0),
  currency     text        not null default 'ARS',
  category     text,
  note         text,
  date         date        not null default current_date,
  created_by   uuid        not null references auth.users (id),
  created_at   timestamptz not null default now()
);

-- Pagos entre los dos para saldar la deuda acumulada.
create table if not exists public.shared_settlements (
  id           uuid        primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  from_user    uuid        not null references auth.users (id),
  to_user      uuid        not null references auth.users (id),
  amount       numeric     not null check (amount > 0),
  currency     text        not null default 'ARS',
  date         date        not null default current_date,
  note         text,
  created_at   timestamptz not null default now()
);

alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.household_invites  enable row level security;
alter table public.shared_expenses    enable row level security;
alter table public.shared_settlements enable row level security;

-- Función auxiliar: ¿el usuario actual pertenece a este hogar?
-- security definer para evitar que la política de household_members se
-- consulte a sí misma en un bucle infinito.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

-- "OR created_by = auth.uid()" es necesario para poder crear un hogar: al
-- insertar, el cliente pide de vuelta la fila creada (.select().single()),
-- y en ese momento todavía no existe la fila en household_members (se
-- inserta en un segundo paso) — sin este OR, esa relectura fallaría por RLS
-- aunque el INSERT en sí mismo esté permitido.
drop policy if exists "households_select" on public.households;
create policy "households_select" on public.households
  for select using (public.is_household_member(id) or created_by = auth.uid());

drop policy if exists "households_insert" on public.households;
create policy "households_insert" on public.households
  for insert with check (auth.uid() = created_by);

drop policy if exists "household_members_select" on public.household_members;
create policy "household_members_select" on public.household_members
  for select using (public.is_household_member(household_id));

drop policy if exists "household_members_insert_self" on public.household_members;
create policy "household_members_insert_self" on public.household_members
  for insert with check (user_id = auth.uid());

drop policy if exists "household_members_delete_self" on public.household_members;
create policy "household_members_delete_self" on public.household_members
  for delete using (user_id = auth.uid());

-- Los códigos de invitación solo los puede LISTAR quien los creó (así nadie
-- puede "listar" los códigos ajenos). Unirse a un hogar se hace con la
-- función redeem_household_invite de abajo, que sí puede validar cualquier
-- código porque corre con permisos elevados (security definer).
drop policy if exists "household_invites_select_own" on public.household_invites;
create policy "household_invites_select_own" on public.household_invites
  for select using (created_by = auth.uid());

drop policy if exists "household_invites_insert_own" on public.household_invites;
create policy "household_invites_insert_own" on public.household_invites
  for insert with check (created_by = auth.uid() and public.is_household_member(household_id));

drop policy if exists "household_invites_delete_own" on public.household_invites;
create policy "household_invites_delete_own" on public.household_invites
  for delete using (created_by = auth.uid());

drop policy if exists "shared_expenses_members" on public.shared_expenses;
create policy "shared_expenses_members" on public.shared_expenses
  for all
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "shared_settlements_members" on public.shared_settlements;
create policy "shared_settlements_members" on public.shared_settlements
  for all
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- Canjear un código de invitación: valida el código y te agrega como
-- miembro del hogar. Un hogar admite como máximo 2 personas.
create or replace function public.redeem_household_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
  member_count int;
begin
  select household_id into hid
  from household_invites
  where code = invite_code and expires_at > now();

  if hid is null then
    raise exception 'El código de invitación no existe o venció.';
  end if;

  select count(*) into member_count from household_members where household_id = hid;
  if member_count >= 2 and not exists (
    select 1 from household_members where household_id = hid and user_id = auth.uid()
  ) then
    raise exception 'Este hogar ya tiene dos integrantes.';
  end if;

  insert into household_members (household_id, user_id, email)
  values (hid, auth.uid(), (select email from auth.users where id = auth.uid()))
  on conflict (household_id, user_id) do nothing;

  delete from household_invites where code = invite_code;

  return hid;
end;
$$;

grant execute on function public.redeem_household_invite(text) to authenticated;

-- ============================================================================
-- Nombre a elección para la vista Compartido (en vez de mostrar el usuario
-- de tu email). Cada quien solo puede editar su propia fila.
-- ============================================================================

alter table public.household_members add column if not exists display_name text;

drop policy if exists "household_members_update_self" on public.household_members;
create policy "household_members_update_self" on public.household_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

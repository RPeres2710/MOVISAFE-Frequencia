create extension if not exists pgcrypto;

-- ====== POR USUÁRIO (login Supabase) ======
create table if not exists public.movisafe_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_key text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create unique index if not exists movisafe_state_user_key_idx
  on public.movisafe_state (user_id, storage_key);

alter table public.movisafe_state enable row level security;

drop policy if exists "movisafe_state_select_own" on public.movisafe_state;
create policy "movisafe_state_select_own"
on public.movisafe_state
for select
using (auth.uid() = user_id);

drop policy if exists "movisafe_state_insert_own" on public.movisafe_state;
create policy "movisafe_state_insert_own"
on public.movisafe_state
for insert
with check (auth.uid() = user_id);

drop policy if exists "movisafe_state_update_own" on public.movisafe_state;
create policy "movisafe_state_update_own"
on public.movisafe_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "movisafe_state_delete_own" on public.movisafe_state;
create policy "movisafe_state_delete_own"
on public.movisafe_state
for delete
using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists set_movisafe_state_updated_at on public.movisafe_state;
create trigger set_movisafe_state_updated_at
before update on public.movisafe_state
for each row execute function public.set_updated_at();

grant select, insert, update, delete on table public.movisafe_state to authenticated;

-- ====== CONTAS NO CÓDIGO (sem Supabase Auth) ======
create table if not exists public.movisafe_shared_state (
  storage_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.movisafe_shared_state enable row level security;

create or replace function public.set_updated_at_shared()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists set_movisafe_shared_state_updated_at on public.movisafe_shared_state;
create trigger set_movisafe_shared_state_updated_at
before update on public.movisafe_shared_state
for each row execute function public.set_updated_at_shared();

drop policy if exists "movisafe_shared_select_by_key" on public.movisafe_shared_state;
create policy "movisafe_shared_select_by_key"
on public.movisafe_shared_state
for select
using (
  storage_key = coalesce(
    nullif((current_setting('request.headers', true)::json ->> 'x-movisafe-key'), ''),
    '___invalid___'
  )
);

drop policy if exists "movisafe_shared_insert_by_key" on public.movisafe_shared_state;
create policy "movisafe_shared_insert_by_key"
on public.movisafe_shared_state
for insert
with check (
  storage_key = coalesce(
    nullif((current_setting('request.headers', true)::json ->> 'x-movisafe-key'), ''),
    '___invalid___'
  )
);

drop policy if exists "movisafe_shared_update_by_key" on public.movisafe_shared_state;
create policy "movisafe_shared_update_by_key"
on public.movisafe_shared_state
for update
using (
  storage_key = coalesce(
    nullif((current_setting('request.headers', true)::json ->> 'x-movisafe-key'), ''),
    '___invalid___'
  )
)
with check (
  storage_key = coalesce(
    nullif((current_setting('request.headers', true)::json ->> 'x-movisafe-key'), ''),
    '___invalid___'
  )
);

grant select, insert, update on table public.movisafe_shared_state to anon;

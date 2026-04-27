-- MOVISAFE - Frequência 2026
-- Persistência do estado do app (o mesmo JSON do localStorage) por usuário.

create extension if not exists pgcrypto;

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

create policy "movisafe_state_select_own"
on public.movisafe_state
for select
using (auth.uid() = user_id);

create policy "movisafe_state_insert_own"
on public.movisafe_state
for insert
with check (auth.uid() = user_id);

create policy "movisafe_state_update_own"
on public.movisafe_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "movisafe_state_delete_own"
on public.movisafe_state
for delete
using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_movisafe_state_updated_at on public.movisafe_state;
create trigger set_movisafe_state_updated_at
before update on public.movisafe_state
for each row
execute function public.set_updated_at();

-- Permissões para o cliente (supabase-js).
-- O app só acessa quando autenticado (role `authenticated`).
grant select, insert, update, delete on table public.movisafe_state to authenticated;

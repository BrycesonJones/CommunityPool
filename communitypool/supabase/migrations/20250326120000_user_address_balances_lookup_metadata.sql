-- Structured lookup metadata for user_address_balances (additive).
-- address_id remains the canonical stored user paste (legacy name; see app docs / TODO rename).

alter table public.user_address_balances
  add column if not exists input_type text,
  add column if not exists chain_family text,
  add column if not exists network text,
  add column if not exists provider text,
  add column if not exists native_balances jsonb,
  add column if not exists assets jsonb,
  add column if not exists transactions jsonb,
  add column if not exists status text not null default 'success',
  add column if not exists error_message text,
  add column if not exists last_fetched_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'user_address_balances'
      and c.conname = 'user_address_balances_status_check'
  ) then
    alter table public.user_address_balances
      add constraint user_address_balances_status_check
      check (status in ('success', 'partial', 'error', 'stale'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'user_address_balances'
      and c.conname = 'user_address_balances_input_type_check'
  ) then
    alter table public.user_address_balances
      add constraint user_address_balances_input_type_check
      check (input_type is null or input_type in ('address', 'tx_hash'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'user_address_balances'
      and c.conname = 'user_address_balances_chain_family_check'
  ) then
    alter table public.user_address_balances
      add constraint user_address_balances_chain_family_check
      check (
        chain_family is null
        or chain_family in ('evm', 'bitcoin', 'unknown')
      );
  end if;
end $$;

create index if not exists user_address_balances_user_id_idx
  on public.user_address_balances (user_id);

create index if not exists user_address_balances_input_type_idx
  on public.user_address_balances (input_type)
  where input_type is not null;

create index if not exists user_address_balances_chain_family_idx
  on public.user_address_balances (chain_family)
  where chain_family is not null;

create index if not exists user_address_balances_last_fetched_at_idx
  on public.user_address_balances (last_fetched_at);

-- Backfill input_type from legacy input_kind where missing
update public.user_address_balances
set input_type = input_kind
where input_type is null and input_kind is not null;

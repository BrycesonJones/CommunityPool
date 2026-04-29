-- Onchain lookup cache columns for user_address_balances.
-- Apply in Supabase SQL editor or via supabase db push.

alter table public.user_address_balances
  add column if not exists onchain_snapshot jsonb,
  add column if not exists snapshot_expires_at timestamptz,
  add column if not exists input_kind text,
  add column if not exists canonical_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'user_address_balances'
      and c.conname = 'user_address_balances_input_kind_check'
  ) then
    alter table public.user_address_balances
      add constraint user_address_balances_input_kind_check
      check (input_kind is null or input_kind in ('address', 'tx_hash'));
  end if;
end $$;

create unique index if not exists user_address_balances_user_id_canonical_key_key
  on public.user_address_balances (user_id, canonical_key)
  where canonical_key is not null;

create index if not exists user_address_balances_user_id_canonical_key_idx
  on public.user_address_balances (user_id, canonical_key)
  where canonical_key is not null;

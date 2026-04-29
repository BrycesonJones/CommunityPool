-- Drop the legacy capitalized RLS policies on user_address_balances. They
-- were created out-of-band in the Supabase dashboard before this repo
-- started tracking RLS in source. After 20260427130200 added the snake_case
-- equivalents, both sets are live and functionally identical (same predicate,
-- OR'd by Postgres). Removing the legacy set so the canonical policies
-- visible in source are the only policies on the table.

drop policy if exists "Users can select own address balances"
  on public.user_address_balances;
drop policy if exists "Users can insert own address balances"
  on public.user_address_balances;
drop policy if exists "Users can update own address balances"
  on public.user_address_balances;
drop policy if exists "Users can delete own address balances"
  on public.user_address_balances;

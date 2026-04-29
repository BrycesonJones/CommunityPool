-- Drop the unused user_pools table. It exists in database.types.ts but has no
-- creation migration in this repo and no app code reads or writes it. Its RLS
-- state is therefore unknown / unauditable. Removing it eliminates the risk
-- of someone later writing to a table whose policies no one has reviewed.

drop table if exists public.user_pools;

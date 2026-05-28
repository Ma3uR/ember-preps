# Supabase setup

Two supported paths: **local CLI** (default — `supabase start`) and **cloud
project** (`supabase link` + push).

## Path A — local CLI (Docker)

```sh
supabase start        # one-time: brings up Postgres, PostgREST, etc.
supabase db reset     # applies every file under supabase/migrations/
pnpm tsx --env-file=.env.local scripts/seed.ts
```

The migrations under `supabase/migrations/` are picked up automatically by
`db reset`:

1. `20260527000001_schema.sql` — `users`, `products`, `orders`,
   `order_items`, `events` plus indexes.
2. `20260527000002_llm_readonly_role.sql` — creates the `llm_readonly`
   Postgres role with the **local-only** password `local_dev_password`.
3. `20260527000003_run_sql_fn.sql` — `public.run_sql(text)` with the
   SELECT-only regex, semicolon rejection, pinned search_path, and
   `SECURITY INVOKER` so the caller's role applies inside the body.

Then copy `.env.local.example` to `.env.local`. The defaults already point
at the local stack; the only field you must fill is `SUPABASE_SERVICE_ROLE_KEY`
(seed-only, get it from `supabase status`) and `ANTHROPIC_API_KEY`.

## Path B — cloud Supabase project

1. **Replace the password.** Edit
   `supabase/migrations/20260527000002_llm_readonly_role.sql` and swap
   `local_dev_password` for the output of `openssl rand -base64 24`.
   Store the same value for use in `.env.local`.
2. **Link and push.**
   ```sh
   supabase link --project-ref <ref>
   supabase db push
   ```
   Or paste each file into Dashboard → SQL Editor in order if you'd rather
   not use the CLI for cloud.
3. **Fill `.env.local`** with the cloud `SUPABASE_URL`, the cloud
   `service_role` key, and a `SUPABASE_LLM_READONLY_DB_URL` whose host is
   the cloud pooler / direct host (not `127.0.0.1`) and whose password is
   the one you generated. `lib/supabase.ts` auto-enables TLS verification
   for non-localhost hosts.
4. **Seed.**
   ```sh
   pnpm tsx --env-file=.env.local scripts/seed.ts
   ```

## Seed details

The script is non-idempotent — re-running appends fresh rows. To start
clean:

```sql
truncate table public.order_items, public.orders, public.events,
               public.products,    public.users
  restart identity cascade;
```

Distributions are tuned so questions like *"top 5 products by revenue last
month"* return differentiated, non-zero answers: ~100 users, ~48 products
across 6 categories, ~500 orders with a recency bias toward the last 30
days, ~1,500 order_items with prices varied ±5% from the catalog price.

## Smoke test

```sql
-- Should return a JSON array of 3 product rows.
select public.run_sql('select id, name, unit_price from public.products limit 3');

-- Should raise "Only SELECT statements are allowed."
select public.run_sql('drop table public.users');

-- Should raise "Semicolons are not allowed in queries..."
select public.run_sql('select 1; drop table users');
```

Then, connecting as `llm_readonly` (e.g.,
`psql "$SUPABASE_LLM_READONLY_DB_URL"`):

```sql
-- Should succeed.
select public.run_sql('select count(*) from public.products');

-- Should fail with permission denied.
insert into public.products (name, category, unit_price) values ('x','y',1);
```

Once both succeed, U2 is verified end-to-end.

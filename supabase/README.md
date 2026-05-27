# Supabase setup

One-time bootstrap for U2. Apply the SQL files in order in the Supabase SQL
editor (Dashboard → SQL Editor → New query → paste → Run), then run the seed
script locally.

## 1. Apply SQL migrations in order

1. **`0001_schema.sql`** — creates `users`, `products`, `orders`, `order_items`,
   `events` plus indexes.
2. **`0002_llm_readonly_role.sql`** — creates the `llm_readonly` Postgres role.
   Before applying, generate a password and substitute it for `<REPLACE_ME>`:

   ```sh
   openssl rand -base64 24
   ```

   Keep the password — you'll put it in `.env.local`.
3. **`0003_run_sql_fn.sql`** — creates the `public.run_sql(text)` function and
   grants execute to `llm_readonly`.

## 2. Capture the llm_readonly connection string

In the Supabase dashboard, find your **Connection string** under
*Project Settings → Database*. You'll see two flavors:

- **Direct connection** (port 5432) — preferred for the MCP server child
  process, which is a long-lived single connection.
- **Pooler — Session mode** (port 5432 via the pooler hostname) — works too
  if the direct host is firewalled.

Swap the default `postgres` user for `llm_readonly`, and use the password
you generated in step 1. Put the full URL in `.env.local` as
`SUPABASE_LLM_READONLY_DB_URL`:

```
SUPABASE_LLM_READONLY_DB_URL=postgresql://llm_readonly:<password>@<host>:5432/postgres
```

## 3. Seed sample data

```sh
pnpm tsx scripts/seed.ts
```

Uses the service-role key (so it bypasses RLS and the SELECT-only role guard)
to insert ~100 users, ~50 products, ~500 orders, ~1,500 order_items, ~500
events. Distributions are tuned so questions like *"top 5 products by revenue
last month"* return differentiated, non-zero answers.

Re-running the script is non-idempotent — it appends fresh rows each run.
Truncate first if you need a clean slate:

```sql
truncate table public.order_items, public.orders, public.events, public.products, public.users restart identity cascade;
```

## 4. Smoke test

In the Supabase SQL editor, with the dropdown set to `service_role`:

```sql
-- Should return a JSON array of 3 product rows.
select public.run_sql('select id, name, unit_price from public.products limit 3');

-- Should raise "Only SELECT statements are allowed."
select public.run_sql('drop table public.users');

-- Should raise "Semicolons are not allowed in queries..."
select public.run_sql('select 1; drop table users');
```

Then, with the dropdown set to `llm_readonly` (or via `psql` using the
connection string):

```sql
-- Should succeed.
select 1;
select public.run_sql('select count(*) from public.products');

-- Should fail with permission denied.
insert into public.products (name, category, unit_price) values ('x','y',1);
```

Once these all match expectations, U2 is verified.

/**
 * Single source for database access in this repo.
 *
 * Two distinct paths, deliberately not merged behind one shape:
 *
 *  - `runSql(query)` — the **LLM data path**. Connects as `llm_readonly` via
 *    direct `pg`, then calls `public.run_sql($1)`. This is what the MCP
 *    server's `execute_query` tool (U3) and the LangChain agent's tool (U7)
 *    use. The role's `pg_read_all_data`-only grant is the primary defense;
 *    `run_sql`'s regex + semicolon check is defense-in-depth.
 *
 *  - `getSupabaseServiceClient()` — the **admin path**. Returns a supabase-js
 *    client wired with the service-role key. Used by `scripts/seed.ts` (and
 *    nowhere else in the current scope). Service-role bypasses RLS; never
 *    hand this to LLM-controlled code.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

// ---------------------------------------------------------------------------
// LLM-readonly pg pool (singleton, HMR-safe).
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __llmReadonlyPool: Pool | undefined;
}

function getReadonlyPool(): Pool {
  const url = process.env.SUPABASE_LLM_READONLY_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_LLM_READONLY_DB_URL is not set. See .env.local.example."
    );
  }
  if (!globalThis.__llmReadonlyPool) {
    globalThis.__llmReadonlyPool = new Pool({
      connectionString: url,
      max: 4,
      idleTimeoutMillis: 30_000,
      ssl: { rejectUnauthorized: false },
    });
  }
  return globalThis.__llmReadonlyPool;
}

/**
 * Execute a single SELECT through `public.run_sql`. Returns the JSON rows the
 * function emits, or throws if the function-level guard or the role-level
 * grant rejects the query.
 *
 * Notes:
 *  - The query is passed as a *parameter* to run_sql ($1), so the outer
 *    string interpolation in `run_sql` is bound at SQL-prepare time, not at
 *    text-concat time.
 *  - We do NOT pass the user query as the prepared statement itself — that
 *    would skip the function's SELECT-only / semicolon checks.
 */
export async function runSql<T = Record<string, unknown>>(
  query: string
): Promise<T[]> {
  const pool = getReadonlyPool();
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const res = await client.query<{ run_sql: T[] | null }>(
      "select public.run_sql($1) as run_sql",
      [query]
    );
    return res.rows[0]?.run_sql ?? [];
  } finally {
    client?.release();
  }
}

/**
 * Parametrized SELECT as `llm_readonly`, bypassing `run_sql`. Used by the
 * schema-introspection tools (`list_tables`, `describe_table`) where the SQL
 * is hardcoded and only a typed parameter varies. Role-level grant still
 * applies — the role only has `pg_read_all_data`, so writes are rejected
 * even if a future caller passes an INSERT here.
 */
export async function runReadonlyQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const pool = getReadonlyPool();
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const res = await client.query<T>(sql, params);
    return res.rows;
  } finally {
    client?.release();
  }
}

/**
 * Drain the pool. Call from a graceful-shutdown hook so process exit doesn't
 * leave dangling Postgres sessions.
 */
export async function closeReadonlyPool(): Promise<void> {
  if (globalThis.__llmReadonlyPool) {
    await globalThis.__llmReadonlyPool.end();
    globalThis.__llmReadonlyPool = undefined;
  }
}

// ---------------------------------------------------------------------------
// Service-role supabase-js client (for the seed script only).
// ---------------------------------------------------------------------------

let _serviceClient: SupabaseClient | undefined;

export function getSupabaseServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set. See .env.local.example."
    );
  }
  _serviceClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _serviceClient;
}

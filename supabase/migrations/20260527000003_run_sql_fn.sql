-- 0003_run_sql_fn.sql
-- `run_sql(query text) -> jsonb` is the single SQL entrypoint the MCP server's
-- `execute_query` tool uses. The community pattern for "raw SQL through
-- supabase-js" is an RPC into a Postgres function — supabase-js has no first-
-- class arbitrary-SQL method.
--
-- Security posture:
--   - SECURITY INVOKER (the default, made explicit). Means the SQL inside
--     `run_sql` runs as the *caller's* role. The caller is `llm_readonly`
--     (via pg-direct from the MCP server), so `pg_read_all_data`'s SELECT-
--     only grant actually applies inside the function body. A SECURITY
--     DEFINER design would elevate execution to the function owner and turn
--     `llm_readonly`'s grants into decorative defense.
--   - Explicit `set search_path = pg_catalog, public` defeats search-path
--     shadowing (an attacker creating a custom `public.format` etc).
--   - Regex check: query must start with optional whitespace then SELECT.
--   - Semicolon rejection: defeats `select 1; drop table users` style
--     multi-statement injection (Postgres EXECUTE accepts multi-statement
--     strings).
--
-- This function is *naive by design* for the interview-prep build — no AST
-- validation, no LIMIT clamping, no EXPLAIN-plan checks. Those are explicit
-- scope cuts; the role grant carries the safety contract.

create or replace function public.run_sql(query text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  -- Postgres POSIX regex: `\b` is the BACKSPACE character (ASCII 8), NOT
  -- a word boundary — the word-boundary escape is `\y`. `\b` is the Perl/
  -- JS convention. Using `\b` here makes the check never match a real
  -- SQL string, so every query gets rejected as "Only SELECT statements
  -- are allowed." even when it starts with SELECT. Be careful when
  -- porting regexes from sqlglot, python, or javascript guides.
  if query !~* '^\s*select\y' then
    raise exception 'Only SELECT statements are allowed.';
  end if;

  if query ~ ';' then
    raise exception 'Semicolons are not allowed in queries (multi-statement injection guard).';
  end if;

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t',
    query
  ) into result;

  return result;
end;
$$;

revoke all on function public.run_sql(text) from public;
grant execute on function public.run_sql(text) to llm_readonly;

-- 0002_llm_readonly_role.sql
-- Create the `llm_readonly` role and grant `pg_read_all_data` so that any SQL
-- executed through this role can only SELECT — never INSERT/UPDATE/DELETE/DDL.
-- This is the *primary* destructive-query defense; the function-level checks
-- in run_sql (0003) are defense-in-depth.
--
-- BEFORE APPLYING: replace <REPLACE_ME> with the output of:
--   openssl rand -base64 24
-- Then store the same password in .env.local under SUPABASE_LLM_READONLY_DB_URL.
--
-- llm_readonly is a real, internet-reachable Postgres credential (Supabase
-- exposes the database via the pooler) — a guessable password matters even
-- at sandbox scope.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'llm_readonly') then
    create role llm_readonly login password '<REPLACE_ME>';
  end if;
end$$;

grant pg_read_all_data           to llm_readonly;
grant connect on database postgres to llm_readonly;
grant usage  on schema   public    to llm_readonly;

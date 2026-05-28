-- 20260527000002_llm_readonly_role.sql
-- Create the `llm_readonly` role and grant `pg_read_all_data` so that any SQL
-- executed through this role can only SELECT — never INSERT/UPDATE/DELETE/DDL.
-- This is the *primary* destructive-query defense; the function-level checks
-- in run_sql (next migration) are defense-in-depth.
--
-- Password: `local_dev_password` is fine for `supabase start` (the local
-- stack only listens on 127.0.0.1) but is NEVER acceptable for a cloud
-- Supabase project — the database is internet-reachable through the pooler.
-- Before linking and pushing this migration to a remote project, change the
-- string below to the output of `openssl rand -base64 24`, and store the
-- same value in .env.local under SUPABASE_LLM_READONLY_DB_URL.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'llm_readonly') then
    create role llm_readonly login password 'local_dev_password';
  end if;
end$$;

grant pg_read_all_data           to llm_readonly;
grant connect on database postgres to llm_readonly;
grant usage  on schema   public    to llm_readonly;

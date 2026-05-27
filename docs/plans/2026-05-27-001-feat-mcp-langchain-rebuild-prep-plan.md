---
title: MCP + Supabase Chat → LangChain Rebuild Prep
type: feat
status: completed
date: 2026-05-27
origin: docs/brainstorms/mcp-langchain-rebuild-prep-requirements.md
---

# MCP + Supabase Chat → LangChain Rebuild Prep

## Summary

Single Next.js App Router app implementing a two-stage interview-prep learning lab. Stage 1 (hard requirement, days 1–4) builds a stdio MCP server in TypeScript exposing three naive tools over a small e-commerce Supabase schema, fronted by a server-side MCP host route handler with a hand-rolled Anthropic tool-use loop and a minimal React UI. Stage 2 (stretch, days 5–6) ships a parallel route handler that replaces MCP with `createAgent` from LangChain v1, selected by a `BACKEND_MODE` env var so the UI is single-source.

---

## Problem Frame

The candidate has strong fullstack + multi-agent context but has not personally built an MCP server, and the final-round interview's headline assignment is "rebuild a working MCP-based text-to-SQL chat in LangChain." Without first-hand experience of both shapes, the senior recommendation ("wrap, don't rebuild") would land as memorized advice. Plan execution is the path to lived experience. See origin `docs/brainstorms/mcp-langchain-rebuild-prep-requirements.md` for the full pain narrative and success criteria.

---

## Requirements

Carried forward from the origin requirements doc (R-IDs preserved):

- R1. E-commerce analytics schema in Supabase (`users`, `products`, `orders`, `order_items`, optional `events`), seeded so NL questions return non-empty answers.
- R2. TypeScript MCP server exposing `list_tables`, `describe_table`, `execute_query` — naive, no validation pipeline.
- R3. Stdio transport only.
- R4. Server connects to Supabase via env-var-supplied credentials.
- R5. TS chat backend acting as MCP host/client; spawns the MCP server as a single shared child process at module load; reuses across requests; exposes one HTTP endpoint for the UI.
- R6. LLM tool-use loop (Claude Sonnet 4.6) hard-capped at ~6 iterations.
- R7. Minimal React chat UI — input + history, no streaming, no tool-call visualization beyond what the developer keeps for learning.
- R8. **(Stretch)** Re-implement the same three tools as native LangChain.js tools wired into `createAgent` from `langchain` v1. If timeline does not permit a working build, downgrades to a written code-sketch.
- R9. **(Stretch, only if R8 builds)** Chat-backend HTTP shape unchanged so UI works against either path; toggle via `BACKEND_MODE` env var.
- R10. Stage-1 noticing journal in the repo capturing MCP affordances leaned on or noticed.
- R11. End-of-stage-2 comparison memo summarising differences (code volume, discoverability, error-handling, second-client portability). Honestly framed as extrapolated if R8 was not built.

**Origin actors:** developer-as-both-implementer-and-chat-user (no separate Actors section in origin)
**Origin flows:** F1 (stage-1 chat turn via MCP), F2 (stage-2 chat turn via LangChain.js — stretch)
**Origin acceptance examples:** AE1 (covers R1, R5, R6), AE2 (covers R3, R5), AE3 (covers R6), AE4 (covers R9 — **stretch-only**; exercisable only if U7 is built), AE5 (covers R10, R11)

---

## Scope Boundaries

Carried verbatim from origin Scope Boundaries — all of these remain deferred at plan time:

- Streamable HTTP transport, OAuth 2.1 / RFC 9728 / PKCE.
- `sqlglot` AST validation, server-level read-only role enforcement beyond Supabase role grants, LIMIT clamping, `EXPLAIN` plan checks.
- Schema RAG / pgvector / few-shot retrieval.
- LangSmith, Langfuse, or any structured production observability layer. Stage-1 traces live in console logs only.
- HITL middleware, supervisor / multi-agent orchestration, planner / validator / reflector splits.
- Fixed quantitative regression test set.
- The `langchain-mcp-adapters` wrap path (deliberately picking rip-and-replace for stage 2).
- Streaming chat responses; multi-turn memory beyond a single LLM tool-use loop.
- Production deployment, hosting, CI, monitoring, multi-tenancy, RBAC, audit logging.

### Deferred to Follow-Up Work

- A `langchain-mcp-adapters` wrap path as a third stage for the candidate's own follow-up after the interview — the lived-experience comparison is enough material for the interview; the wrap-path build is the natural next step but explicitly not in this plan.

---

## Context & Research

### Relevant Code and Patterns

Greenfield repo — no in-repo patterns to follow. Only `first-info.md` (prep notes) and the origin brainstorm exist before this plan.

### Institutional Learnings

No `docs/solutions/` exists in this repo.

### External References

- `@modelcontextprotocol/sdk` TypeScript SDK — v1.29.x stable line (March 2026). Idiomatic high-level API: `McpServer` (`/server/mcp.js`), `registerTool` (replaces the old `server.tool` short form), `StdioServerTransport`. Client: `Client` + `StdioClientTransport({ command, args })` which performs the child-process spawn internally. Deep ESM `.js` import suffixes required (NodeNext resolution).
- LangChain v1 (TypeScript, late-2025 stable) — `createReactAgent` from `@langchain/langgraph/prebuilt` is deprecated. Current idiom is `createAgent` from the umbrella `langchain` package; `prompt` param renamed to `systemPrompt`. Tool definition: `tool()` from `@langchain/core/tools` with a zod schema. Model wiring: `ChatAnthropic` from `@langchain/anthropic` with model id `claude-sonnet-4-6-20250929`.
- `@supabase/supabase-js` has no first-class "execute arbitrary SQL string" method. Idiomatic pattern: create a SECURITY DEFINER Postgres function `public.run_sql(query text)` that validates the statement is `SELECT`-only at the SQL layer, returns rows as `jsonb`, and call it via `supabase.rpc('run_sql', { query })`.
- MCP-host-in-Next.js pitfalls: stdout pollution from the server child process corrupts JSON-RPC framing — server must log to stderr only. Process death surfaces as `MCP error -32000: Connection closed` (issue #1049 on the TS SDK) and can crash Node if uncaught. Next.js dev HMR can orphan child processes — gate spawn behind `globalThis.__mcp ??= ...`.
- Supabase predefined `pg_read_all_data` role grants SELECT on all current and future tables without per-table grants — single SQL statement turns "LLM could DROP" into "auth-layer SELECT-only."

---

## Key Technical Decisions

- **Single Next.js App Router app over Next.js + standalone Hono.** Rationale: one repo, one `pnpm dev`, one set of env vars, one deploy unit. Community-converged 2026 default for "small React + TS backend + LLM sandbox" scope. The single chat endpoint is the textbook case where Next.js wins on integration cost.
- **`BACKEND_MODE` env var selects between two parallel API route handlers** for stage 1 (MCP) vs stage 2 (LangChain.js). Rationale: keeps the UI single-source so AE4 (toggle without UI code change) is mechanical to satisfy; lets stage-1 and stage-2 code coexist in the repo for the comparison memo.
- **MCP server is a sibling subdirectory (`mcp-server/`) inside the same repo and same `package.json`**, run via `tsx mcp-server/index.ts`. Rationale: simplest packaging at this scope; no separate workspaces; one `pnpm install`. Spawned as a single shared child process at module load via a `globalThis.__mcp` singleton so Next.js HMR does not orphan processes.
- **Include the Supabase `llm_readonly` role + `pg_read_all_data` grant despite the brainstorm's "naive" framing.** Rationale: brainstorm's "naive" was about not building the sqlglot / validation pipeline at the application layer; the role grant is one SQL statement (~20 min) at the *database* layer. Origin Section 4.6 of the prep doc names "DB-level read-only role" as the **primary** control. Omitting it would leave the demo at risk of catastrophic failure if the LLM happens to draft a `DROP TABLE` — which kills demo-day confidence. The role grant turns "I chose not to validate SQL" into a defensible scope cut rather than negligence.
- **Hand-rolled Anthropic tool-use loop over `anthropic.beta.messages.toolRunner()` + `mcpTools()` adapter.** Rationale: stage-1's goal is to *understand MCP primitives* — the helper hides the exact JSON-RPC envelope, tool-schema translation, and iteration mechanics that the noticing journal and interview talking points need. Time cost (~1–2 extra hours) is purchased in exchange for the lived knowledge the brainstorm was designed to produce. If days 1–3 over-run, the helper is the documented fallback.
- **`public.run_sql(query text)` SECURITY INVOKER function with `^\s*select\b` regex guard, a semicolon-rejection check, and `set search_path = pg_catalog, public`** at the SQL layer, called via `supabase.rpc('run_sql', { query })`. Rationale: `@supabase/supabase-js` has no clean "raw SQL string" path; this is the converged community pattern. `SECURITY INVOKER` (the default, made explicit) means SQL inside the function runs as the *caller's* role — so `llm_readonly`'s `pg_read_all_data`-only grant actually applies inside the function body, not just outside. (A `SECURITY DEFINER` design would silently elevate execution to the function owner and turn `llm_readonly` into decorative defense — the original sketch made this mistake.) Semicolon rejection prevents `select 1; drop table users` style multi-statement injection. Explicit `pg_catalog, public` search-path prevents catalog-shadowing escalation. The role grant is the **primary** control; the function-level guards are defense-in-depth.
- **Single shared MCP child process at backend module load**, not per-request. Rationale: matches real-world MCP host pattern (Claude Desktop, Cursor); avoids spawn-cost amortization; required by R5. Gate spawn behind a `globalThis.__mcp` singleton so Next.js dev HMR does not orphan processes.
- **Plain React + Tailwind UI, no state-management library, no shadcn, no streaming.** Rationale: 1-week budget; UI is ~80 LOC; anything more is yak-shaving.

---

## Open Questions

### Resolved During Planning

- **Backend toggle mechanism (origin question on R5/R9):** Resolved as `BACKEND_MODE` env var selecting between `app/api/chat-mcp/route.ts` and `app/api/chat-langchain/route.ts` (see Key Technical Decisions).
- **Next.js vs standalone Node/Hono (origin question on R7):** Resolved as Next.js App Router single app (see Key Technical Decisions).
- **MCP TypeScript SDK API shape (origin `[Needs research]` on R5):** Resolved against current docs — `McpServer` + `registerTool` + `StdioServerTransport`; client uses `StdioClientTransport({ command, args })` for child-process spawn (see External References).
- **LangChain.js API shape (origin `[Needs research]` on R8):** Resolved against current docs — `createAgent` from `langchain` (NOT deprecated `createReactAgent`), `tool()` from `@langchain/core/tools`, `ChatAnthropic` from `@langchain/anthropic` (see External References).
- **Journal/memo location (origin question on R10/R11):** Resolved as `docs/notes/stage-1-noticing.md` and `docs/notes/stage-2-comparison.md`.

### Deferred to Implementation

- Exact `tsconfig` shape for the MCP server subdirectory if it conflicts with Next.js's bundler-mode tsconfig — most likely solvable with a single tsconfig + `tsx`'s default ESM handling, but defer to the moment U3 starts if a conflict surfaces.
- Whether the React UI runs inside the same Next.js `app/` tree (single deployable) or as a standalone Vite app under `web/` — leaning single Next.js app per Key Technical Decisions, but defer the final call to U5 if it becomes friction.
- Exact seed-data volume per table — leaning ~100–500 rows per table — defer to U2's actual seeding to balance demo-question variety against schema-creation time.

---

## Output Structure

```text
ember-preps/
├── docs/
│   ├── brainstorms/
│   │   └── mcp-langchain-rebuild-prep-requirements.md      (existing)
│   ├── plans/
│   │   └── 2026-05-27-001-feat-mcp-langchain-rebuild-prep-plan.md   (this file)
│   └── notes/                                              # new (U6, U8)
│       ├── stage-1-noticing.md
│       └── stage-2-comparison.md
├── app/                                                    # Next.js app router (U1, U4, U5, U7)
│   ├── api/
│   │   ├── chat-mcp/route.ts                               # stage-1 chat handler (U4)
│   │   └── chat-langchain/route.ts                         # stage-2 chat handler (U7, stretch)
│   ├── layout.tsx
│   ├── page.tsx                                            # chat UI mount (U5)
│   └── globals.css
├── components/
│   └── Chat.tsx                                            # client component (U5)
├── lib/
│   ├── mcp-client.ts                                       # singleton MCP client (U4)
│   ├── tool-loop.ts                                        # hand-rolled Anthropic loop (U4)
│   ├── supabase.ts                                         # supabase clients keyed by role (U2)
│   ├── backend-mode.ts                                     # BACKEND_MODE resolution helper (U7, stretch)
│   └── langchain-agent.ts                                  # stage-2 agent (U7, stretch)
├── mcp-server/
│   ├── index.ts                                            # McpServer + StdioServerTransport (U3)
│   └── tools.ts                                            # registerTool definitions (U3)
├── supabase/
│   ├── 0001_schema.sql                                     # ecommerce tables (U2)
│   ├── 0002_seed.sql                                       # seed rows (U2)
│   ├── 0003_run_sql_fn.sql                                 # run_sql security definer fn (U2)
│   └── 0004_llm_readonly_role.sql                          # llm_readonly + pg_read_all_data (U2)
├── .env.local.example                                      # documents all required env vars
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
└── postcss.config.mjs
```

The implementer may consolidate or rename files if implementation reveals a better layout (e.g., merging `tool-loop.ts` into `chat-mcp/route.ts` if the loop turns out to be route-coupled). Per-unit `**Files:**` sections remain authoritative for what each unit creates or modifies.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Stage-1 chat-turn sequence (the MCP path, covering F1):**

```mermaid
sequenceDiagram
    actor User
    participant UI as React UI<br/>(components/Chat.tsx)
    participant API as Next.js route<br/>(app/api/chat-mcp)
    participant Loop as tool-loop.ts
    participant MCP as MCP Client<br/>(globalThis singleton)
    participant SRV as MCP Server<br/>(tsx child process)
    participant LLM as Anthropic API<br/>(Claude Sonnet 4.6)
    participant DB as Supabase Postgres<br/>(llm_readonly role)

    Note over MCP,SRV: spawned once at module load
    User->>UI: types question
    UI->>API: POST { question }
    API->>Loop: run(question)
    Loop->>MCP: listTools()
    MCP->>SRV: JSON-RPC tools/list
    SRV-->>MCP: tools[]
    MCP-->>Loop: tools[]
    loop ≤6 iterations
        Loop->>LLM: messages + tools (input_schema)
        LLM-->>Loop: assistant message
        alt tool_use block present
            Loop->>MCP: callTool(name, args)
            MCP->>SRV: JSON-RPC tools/call
            SRV->>DB: rpc('run_sql', { query })
            DB-->>SRV: rows (jsonb)
            SRV-->>MCP: tool_result
            MCP-->>Loop: tool_result
            Note over Loop: append tool_result message,<br/>continue loop
        else final text response
            Loop-->>API: { answer }
            API-->>UI: { answer }
            UI-->>User: render
        end
    end
```

**Stage-2 shape (the LangChain.js path, covering F2):** the same UI POSTs to a different API route (selected by `BACKEND_MODE`). That route holds a `createAgent`-built agent whose tools are local `tool()` definitions calling `supabase.rpc('run_sql', ...)` directly. The "MCP Client → MCP Server → JSON-RPC" lane in the diagram above collapses into "agent → native tool function." This collapse is the diff the comparison memo captures.

---

## Implementation Units

### U1. Project scaffolding (Next.js + deps + env)

**Goal:** Greenfield Next.js App Router project with all required dependencies installed, env-var scaffolding in place, and `pnpm dev` running an empty hello-world page.

**Requirements:** R7 (chat UI substrate), R5 (backend substrate), R4 (env var supply).

**Dependencies:** None.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.gitignore`, `.env.local.example`
- Create: `app/layout.tsx`, `app/page.tsx` (initial placeholder), `app/globals.css`

**Approach:**
- Bootstrap with `pnpm create next-app@latest . --typescript --tailwind --app --src-dir=false --eslint=false --import-alias='@/*'` then trim defaults. Use `--src-dir=false` so paths in this plan match.
- Install runtime deps: `@modelcontextprotocol/sdk@^1.29 zod @anthropic-ai/sdk @supabase/supabase-js`. Install dev deps: `tsx` (for spawning the MCP server child process). Defer `langchain @langchain/langgraph @langchain/core @langchain/anthropic` to U7 — stretch only.
- `.env.local.example` documents: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_LLM_READONLY_DB_URL` (Postgres connection string for the read-only role; used by the MCP server), `SUPABASE_SERVICE_ROLE_KEY` (only if the server needs `.rpc()` instead of direct `pg`), `BACKEND_MODE=mcp|langchain` (default `mcp`).
- Ensure `.gitignore` excludes `.env.local`, `node_modules/`, `.next/`.

**Patterns to follow:** Standard Next.js 15+ App Router scaffolding from `create-next-app`. No custom patterns.

**Test scenarios:**
- Happy path: `pnpm dev` boots without error; the default home route returns 200.

Test expectation: smoke test only — no automated tests for scaffolding. Verification is manual.

**Verification:**
- `pnpm dev` starts cleanly.
- Visiting `http://localhost:3000` renders a placeholder page.
- `.env.local.example` lists every env var any later unit will reference.
- Anthropic API smoke test: a single `curl https://api.anthropic.com/v1/messages` against the chosen `ANTHROPIC_API_KEY` with `claude-sonnet-4-6-20250929` returns 200 (verifies both key validity and model-id availability for this account before U4 commits to that snapshot).

---

### U2. Supabase schema, seed, `run_sql` function, and `llm_readonly` role

**Goal:** Supabase project has the e-commerce schema, seed data, the `run_sql` SECURITY DEFINER function, and the `llm_readonly` role granted `pg_read_all_data`. The MCP server's database access path (`llm_readonly` connection) returns rows for a sample question.

**Requirements:** R1, R4.

**Dependencies:** U1 (env vars need a place to live).

**Files:**
- Create: `supabase/0001_schema.sql` — tables `users`, `products`, `orders`, `order_items`, and optional `events`.
- Create: `supabase/0002_seed.sql` *or* `scripts/seed.ts` — ~100–500 rows per table; product names, plausible order dates spanning ~6 months, varied revenue per row so "top 5 products by revenue last month" yields differentiated answers. SQL-only seeding for ~2,500 rows with realistic distributions is fiddly; a one-off `tsx scripts/seed.ts` script using `@supabase/supabase-js` is the recommended path. Pick one and stick with it.
- Create: `supabase/0003_run_sql_fn.sql` — `create function public.run_sql(query text)` returning `jsonb`, with **`SECURITY INVOKER` (NOT `SECURITY DEFINER`)** so role grants on the caller actually apply, **`set search_path = pg_catalog, public`** to prevent search-path shadowing, a regex check rejecting non-`^\s*select\b` queries, **and a separate check rejecting any query containing a `;`** (defeats `select 1; drop table users` style multi-statement bypass). Grant execute to `llm_readonly`.
- Create: `supabase/0004_llm_readonly_role.sql` — `create role llm_readonly login password '<gen-via-openssl-rand-base64-24>'; grant pg_read_all_data to llm_readonly; grant connect on database postgres to llm_readonly;`.
- Create: `lib/supabase.ts` — exports a `getSupabaseClient(role: 'service' | 'llm_readonly')` factory. The MCP server (U3) and the LangChain agent (U7) both import from here so the client wiring is single-source.

**Approach:**
- Schema is intentionally small: `users(id, email, signup_date)`, `products(id, name, category, unit_price)`, `orders(id, user_id, created_at, status)`, `order_items(id, order_id, product_id, quantity, unit_price)`. `events(id, user_id, name, created_at, properties jsonb)` is optional; include if seed-data generation is cheap.
- Apply migrations in the Supabase SQL editor (or via the Supabase CLI if the user already has it set up — defer the choice). Capture the connection string for `llm_readonly` and store it in `.env.local` as `SUPABASE_LLM_READONLY_DB_URL`.
- Confirm `select * from public.run_sql('select count(*) from public.products')` works as `llm_readonly`, that `select public.run_sql('drop table users')` raises "only SELECT statements allowed", **and** that `select public.run_sql('select 1; drop table users')` is *also* rejected (multi-statement injection check).
- Generate the `llm_readonly` password with `openssl rand -base64 24` (or a password manager). Supabase Postgres is internet-reachable through the connection pooler — `llm_readonly` is not a localhost-only credential, so a guessable password matters even at sandbox scope.

**Patterns to follow:** Supabase's own `pg_read_all_data` documentation; the community `run_sql` SECURITY DEFINER pattern referenced in External References.

**Test scenarios:**
- Happy path: connecting as `llm_readonly` and executing `select 1` succeeds.
- Happy path: `select public.run_sql('select id, name from public.products limit 3')` returns a JSON array of 3 product rows.
- Error path: `select public.run_sql('drop table public.users')` raises the SELECT-only exception.
- Error path: connecting as `llm_readonly` and attempting `insert into products values (...)` is rejected by Postgres role permissions (defense in depth — the role can't write even if the function were bypassed).

Test expectation: SQL-only verification via the Supabase SQL editor; no automated test runner needed.

**Verification:**
- Schema exists with seed rows visible in Supabase dashboard.
- `run_sql` returns JSON for SELECTs, raises for non-SELECTs.
- `llm_readonly` connection string in `.env.local` works for `select`, fails for `insert`/`update`/`delete`.

---

### U3. MCP server with three tools

**Goal:** A standalone TypeScript MCP server (`mcp-server/index.ts`) that, when spawned with `tsx`, exposes `list_tables`, `describe_table`, and `execute_query` over the stdio transport. Each tool returns a JSON `content[]` block.

**Requirements:** R2, R3, R4.

**Dependencies:** U2 (needs Supabase + `run_sql` + `llm_readonly`).

**Files:**
- Create: `mcp-server/index.ts` — instantiates `McpServer`, registers the three tools via `tools.ts`, connects via `StdioServerTransport`, never logs to stdout (stderr only).
- Create: `mcp-server/tools.ts` — three `registerTool` definitions. Each handler uses the Supabase JS client (configured with the service-role key) to call `supabase.rpc('run_sql', { query })`. Alternative: use `pg` directly with the `llm_readonly` connection string. Choose `pg` if it removes the SECURITY DEFINER round-trip; defer the final choice to implementation.
- Modify: nothing outside `mcp-server/`.

**Approach:**
- `McpServer` with `name: "supabase-ecom"`, `version: "0.1.0"`.
- Tool schemas (raw Zod shape, not pre-wrapped):
  - `list_tables`: `{}` input; returns `select table_name from information_schema.tables where table_schema='public'`.
  - `describe_table`: `{ table_name: z.string() }` input; returns column name + data type + is_nullable from `information_schema.columns`.
  - `execute_query`: `{ sql: z.string() }` input; passes through to `run_sql`.
- Every `console.log` in this directory must be replaced with `console.error` — stdout pollution corrupts JSON-RPC framing.
- Wrap each handler's body in try/catch and return `{ content: [{ type: "text", text: "Error: " + err.message }], isError: true }` on failure rather than throwing.
- Add a top-level `process.on('uncaughtException')` / `process.on('unhandledRejection')` that logs to stderr and exits cleanly.

**Technical design:** *(directional)*

```ts
// mcp-server/index.ts — directional sketch, not copy-paste code
const server = new McpServer({ name: "supabase-ecom", version: "0.1.0" });
registerListTables(server);
registerDescribeTable(server);
registerExecuteQuery(server);
await server.connect(new StdioServerTransport());
// process stays alive while transport is open
```

**Patterns to follow:** The `@modelcontextprotocol/sdk` README server example; the `registerTool` API surface (NOT the deprecated `server.tool` short form).

**Test scenarios:**
- Happy path: spawning `tsx mcp-server/index.ts` and sending a `tools/list` JSON-RPC request returns all three tool definitions with correct JSON Schema (manually with `npx @modelcontextprotocol/inspector tsx mcp-server/index.ts` or a quick scratch client).
- Happy path: `tools/call` with `execute_query` and a valid SELECT returns a `text` content block with JSON rows.
- Edge case: `describe_table` with a non-existent `table_name` returns an empty column list (or an `isError: true` content block — pick one and document in the noticing journal).
- Error path: `execute_query` with a non-SELECT raises an error from the database; tool returns `isError: true` with a useful message.
- Integration: stdout from the server process contains only JSON-RPC framing — no `console.log` leaks.

Test expectation: manual via `@modelcontextprotocol/inspector` is sufficient at this scope; no automated tool tests. Capture the inspector session as evidence for the noticing journal (U6).

**Verification:**
- The inspector successfully connects via stdio, lists 3 tools, calls each, returns expected results.
- `stderr` contains the developer's debug logs; `stdout` contains only JSON-RPC frames.

---

### U4. MCP host singleton + chat API route + hand-rolled tool-use loop

**Goal:** A Next.js API route at `app/api/chat-mcp/route.ts` that accepts `POST { question }`, runs a hand-rolled Anthropic tool-use loop using the singleton MCP client from `lib/mcp-client.ts`, and returns `{ answer: string }`. The MCP server is spawned exactly once across all requests for the life of the Next.js dev server.

**Requirements:** R5, R6.

**Dependencies:** U3 (needs the MCP server entrypoint to spawn).

**Files:**
- Create: `lib/mcp-client.ts` — module-level singleton that lazily spawns the MCP server via `StdioClientTransport({ command: 'tsx', args: ['./mcp-server/index.ts'] })`, gated by `globalThis.__mcp ??= ...` so Next.js HMR reuses the instance. Exports `getMcpClient()` returning a `Client` instance.
- Create: `lib/tool-loop.ts` — exports `runMcpToolLoop(question: string): Promise<string>`. Calls `client.listTools()`, translates each `{ name, description, inputSchema }` into Anthropic's `{ name, description, input_schema }` (literal rename of `inputSchema` → `input_schema`). Runs the loop: send messages + tools to Claude Sonnet 4.6 via `@anthropic-ai/sdk`, inspect `response.content` for `tool_use` blocks, execute via `client.callTool({ name, arguments })`, append a `tool_result` user message, repeat. Hard cap at 6 iterations; on cap, return the last assistant text plus an "iteration cap reached" annotation.
- Create: `app/api/chat-mcp/route.ts` — exports `POST` handler; reads `{ question }` from JSON body; calls `runMcpToolLoop(question)`; returns `{ answer }`.

**Approach:**
- `lib/mcp-client.ts` pattern:
  - `const g = globalThis as { __mcp?: { client: Client; transport: StdioClientTransport } };`
  - `if (!g.__mcp) { /* spawn, connect, store */ }`
  - Spawn the MCP server using `command: process.execPath, args: ['--import', 'tsx', path.resolve(process.cwd(), 'mcp-server/index.ts')]` instead of a bare `command: 'tsx'` — relying on PATH-resolved `tsx` works in `pnpm dev` (because `node_modules/.bin` is on PATH for npm scripts) but breaks in `pnpm start`/serverless runtimes. Using `process.execPath` + `--import tsx` makes the spawn portable.
  - Mark the chat route handlers with `export const runtime = 'nodejs'` and add `@modelcontextprotocol/sdk` to `serverExternalPackages` in `next.config.ts` so Next.js doesn't try to bundle the SDK's deep-ESM imports.
  - Capture child-process stderr and forward to Node's `console.error` so MCP server logs surface in the dev console.
  - Register clean-shutdown handlers on `SIGINT` and `SIGTERM` (not just `beforeExit`) — `pnpm dev` exits on Ctrl-C via SIGINT and `beforeExit` never fires there, so without explicit signal handlers the child process orphans. `beforeExit` is kept as a third safety net.
- `lib/tool-loop.ts` pattern:
  - Use `Anthropic` from `@anthropic-ai/sdk`. Model id: `claude-sonnet-4-6-20250929` (or `claude-sonnet-4-6` for the moving alias).
  - System prompt: name the tools, describe the e-commerce schema at a high level, instruct the model to use tools to answer.
  - Translation: `inputSchema` → `input_schema` literally; tool name and description pass through unchanged. MCP `tool_result.content` array → Anthropic `tool_result` block with the same shape.
  - Iteration cap: after 6 LLM round-trips, break and return the last assistant text content with `[Iteration cap reached]` prefix so AE3 is satisfied.
- The route handler is thin: parse body, call loop, return JSON. Wrap in try/catch for 500 responses.

**Execution note:** Hand-rolled tool loop is the chosen path for *learning visibility*, not for speed. Implement it deliberately and log each loop iteration's `(model_request → tool_use? → tool_result → next_request)` transitions to stderr. These logs feed the noticing journal (U6).

**Technical design:** *(directional)*

```ts
// lib/tool-loop.ts — directional sketch
const tools = (await client.listTools()).tools.map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema,
}));
let messages = [{ role: "user", content: question }];
for (let i = 0; i < 6; i++) {
  const res = await anthropic.messages.create({ model, tools, messages, max_tokens: 1024 });
  const toolUses = res.content.filter(b => b.type === "tool_use");
  if (toolUses.length === 0) return textOf(res);
  const toolResults = await Promise.all(toolUses.map(async u => ({
    type: "tool_result", tool_use_id: u.id,
    content: (await client.callTool({ name: u.name, arguments: u.input })).content,
  })));
  messages = [...messages, { role: "assistant", content: res.content }, { role: "user", content: toolResults }];
}
return "[Iteration cap reached] " + textOf(messages.at(-1));
```

**Patterns to follow:** The `globalThis.__mcp ??= ...` singleton dodge for Next.js dev HMR. The `StdioClientTransport({ command, args })` pattern from the MCP SDK README — the transport spawns the child internally; no manual `child_process.spawn` needed.

**Test scenarios:**
- Happy path: POST to `/api/chat-mcp` with a question that maps to a single SELECT (e.g., "list all product categories"). Returns a non-empty `answer` containing category names. Logs show the loop made 1–2 LLM calls and 1 `execute_query` tool call.
- Happy path: POST with a question requiring multiple tools (e.g., "what columns does the orders table have, and how many rows does it have?"). Logs show `describe_table` and `execute_query` both fired.
- Edge case: POST with an empty `question` returns a graceful error (400) rather than 500.
- Error path: when the MCP child process is killed mid-request (manually `kill -9` between dev runs), the next request returns a 500 with a useful error message and the singleton respawns on the next request. *(Stretch — document the behavior in the noticing journal even if no automated test.)*
- Integration: AE1 — "top 5 products by revenue last month" against seeded data returns 5 products with non-zero revenue figures and the log trace shows `list_tables` (or `describe_table`) followed by `execute_query`.
- Integration: AE3 — when the LLM enters a repeated `describe_table` loop (force this by writing an intentionally ambiguous question), the cap fires at iteration 6 and the response contains the cap annotation.

Test expectation: manual exercise via `curl` or the chat UI (after U5). Capture transcripts for the noticing journal.

**Verification:**
- A POST to `/api/chat-mcp` with a real question returns a real answer grounded in the seeded data.
- The MCP child process is spawned exactly once per `pnpm dev` session (verify with `ps aux | grep mcp-server` after multiple requests).
- Stderr logs surface tool-call discovery, each loop iteration, and any errors.

---

### U5. React chat UI

**Goal:** Minimal React UI at `app/page.tsx` (or mounted via `components/Chat.tsx`) that accepts a question, POSTs to `/api/chat-mcp`, displays the conversation, and disables input while a request is in flight. No streaming, no tool-call visualization, no markdown rendering beyond plain text.

**Requirements:** R7.

**Dependencies:** U4 (needs the chat endpoint).

**Files:**
- Modify: `app/page.tsx` — render the `<Chat />` client component.
- Create: `components/Chat.tsx` — client component (`"use client"`) with the entire chat surface.

**Approach:**
- Single state: `messages: { role: "user" | "assistant", content: string }[]` and `input: string`, `loading: boolean`.
- One `<form onSubmit>`: optimistically append user message, POST `{ question }` to whichever endpoint `BACKEND_MODE` selects (initially hardcode `/api/chat-mcp`; U7 generalizes), await `{ answer }`, append assistant message.
- Scrollable conversation: `<div className="overflow-y-auto">` with auto-scroll-to-bottom on new messages via `useEffect` + ref.
- Disabled state during loading: input + button both `disabled` while `loading` is true; show "thinking..." placeholder where the assistant message will appear.
- Tailwind for spacing and the bare-minimum dark/light shape. No shadcn. No icons.

**Patterns to follow:** Standard React `useState` + `useEffect` chat-list pattern. Next.js client components.

**Test scenarios:**
- Happy path: typing a question and pressing Enter posts to the endpoint and renders the response. Conversation persists across multiple turns within one session (in-memory only).
- Edge case: pressing Enter on an empty input does not POST.
- Edge case: pressing Enter while a request is in flight is a no-op (input disabled).
- Error path: when `/api/chat-mcp` returns 500, the UI displays a "something went wrong" message rather than hanging.

Test expectation: manual UI exercise in the browser; no automated component tests at this scope.

**Verification:**
- End-to-end demo path works: open `http://localhost:3000`, type a question, see a real answer grounded in seeded data.
- This is the day-4 milestone — stage-1 working demo complete.

---

### U6. Stage-1 noticing journal (ongoing)

**Goal:** A markdown file at `docs/notes/stage-1-noticing.md` that the developer maintains while building U2 through U5, capturing concrete observations about MCP affordances they noticed, leaned on, or got bitten by. The journal is the substrate for the stage-2 comparison memo (U8) and for interview talking points.

**Requirements:** R10.

**Dependencies:** None structurally — but practically, U6 is *interleaved* with U2–U5 rather than sequential after them.

**Files:**
- Create: `docs/notes/stage-1-noticing.md` — initially empty with a section template; populated continuously through the stage-1 build.

**Approach:**
- Sections to include in the template:
  - **MCP primitives I touched** — bullet list, one per primitive (Tools, Resources, Prompts; Sampling, Roots, Elicitation, Tasks if encountered).
  - **JSON-RPC envelopes that surprised me** — anything about the wire format that wasn't obvious from reading the spec.
  - **Tool-schema translation** — what the MCP `inputSchema` → Anthropic `input_schema` rename did and didn't carry.
  - **Discovery moments** — every time `tools/list` saved a hard-coded translation step.
  - **Errors and pitfalls** — stdout pollution, child-process death, HMR orphans, anything else that bit.
  - **What I'd lose if I removed MCP** — running list to feed U8.
- Aim for ≥1 entry per implementation unit. Quality over volume; one specific, demonstrative entry beats five vague ones.

**Patterns to follow:** Engineering journal / dev log conventions. Markdown, no schema constraints.

**Test scenarios:**

Test expectation: none — this is documentation, not feature code.

**Verification:**
- At end of U5 (working stage-1 demo), the journal has at least 8–10 concrete entries spanning the categories above.
- The "What I'd lose if I removed MCP" section has at least 3 specific items.

---

### U7. (Stretch) LangChain.js stage-2 rebuild + `BACKEND_MODE` toggle

**Goal:** A parallel API route at `app/api/chat-langchain/route.ts` that runs a `createAgent`-built agent against the same Supabase, exposing functionally the same three tools as native `tool()` definitions — no MCP. The React UI POSTs to whichever route `BACKEND_MODE` selects.

**Requirements:** R8, R9.

**Dependencies:** U4 and U5 (need stage-1 working before this is meaningful). Triggered only if stage 1 lands under budget.

**Files:**
- Create: `lib/langchain-agent.ts` — module-level builder that returns a configured agent. Three `tool()` definitions (`list_tables`, `describe_table`, `execute_query`) that call `supabase.rpc('run_sql', ...)` directly. `createAgent` from `langchain` with `ChatAnthropic` from `@langchain/anthropic`. System prompt mirrors U4's.
- Create: `app/api/chat-langchain/route.ts` — POST handler shape identical to `app/api/chat-mcp/route.ts`; calls the agent's `invoke`, extracts the final assistant text, returns `{ answer }`.
- Create: `lib/backend-mode.ts` — tiny module exporting `BACKEND_MODE` (server-side, default `'mcp'`) and a `getChatEndpoint()` helper used by the UI. Keeps the toggle source-of-truth in one place.
- Modify: `components/Chat.tsx` — read `BACKEND_MODE` from a Next.js env var (`NEXT_PUBLIC_BACKEND_MODE`) and post to `/api/chat-${mode}`. Default to `mcp`.
- Modify: `.env.local.example` — document `NEXT_PUBLIC_BACKEND_MODE=mcp|langchain`.
- Modify: `package.json` — add `langchain`, `@langchain/langgraph`, `@langchain/core`, `@langchain/anthropic` deps. Run a quick `pnpm add` spike BEFORE writing code to verify versions install cleanly (the brainstorm's "1-hour LangChain.js spike" gate).

**Approach:**
- Tool functions are deliberately near-identical to the MCP server's handler bodies — same SQL, same row-to-JSON conversion. The difference lives in *how* they're declared (`tool({ name, description, schema, func })` vs `server.registerTool(name, config, handler)`) and *how* they're called (agent's tool selection vs `client.callTool`).
- `createAgent({ model: new ChatAnthropic({ model: "claude-sonnet-4-6-20250929" }), tools, systemPrompt })`. The agent's iteration cap is set via the agent's options if available; otherwise rely on default reasonable limits.
- `app/api/chat-langchain/route.ts` mirrors `chat-mcp/route.ts` in shape so the diff is mechanical to read.
- A `lib/backend-mode.ts` helper resolves the active mode server-side (for logs) and client-side (for which route to POST to). Keep this tiny — just a constant export.

**Technical design:** *(directional)*

```ts
// lib/langchain-agent.ts — directional sketch
const listTables = tool(async () => JSON.stringify(await runSql("select table_name from information_schema.tables where table_schema='public'")), {
  name: "list_tables", description: "...", schema: z.object({}),
});
// describeTable and executeQuery similarly defined
const agent = createAgent({
  model: new ChatAnthropic({ model: "claude-sonnet-4-6-20250929" }),
  tools: [listTables, describeTable, executeQuery],
  systemPrompt: "You answer questions about an e-commerce database. Use tools.",
});
```

**Patterns to follow:** The migration guide from `createReactAgent` to `createAgent` in LangChain v1 (External References). Do NOT pattern-match against `createReactAgent`-based blog posts from 2025.

**Test scenarios:**
- Happy path: POST to `/api/chat-langchain` with the same question used to verify U4 — answer is functionally equivalent (same products, same revenue figures, modulo LLM variance).
- Happy path: setting `NEXT_PUBLIC_BACKEND_MODE=langchain` and re-running the UI flow exercises the LangChain path end-to-end with zero UI changes.
- Integration: AE4 — toggling `BACKEND_MODE` from `mcp` to `langchain` returns a functionally equivalent answer for the same input question.

Test expectation: manual exercise mirroring U4's test approach. Compare answers side-by-side and note differences in the comparison memo (U8).

**Verification:**
- Both routes respond to the same input question with equivalent answers (within LLM variance).
- `NEXT_PUBLIC_BACKEND_MODE` toggle changes which route the UI hits.
- The `pnpm add` spike for LangChain v1 packages completed cleanly without version-resolution warnings.

---

### U8. Stage-2 comparison memo

**Goal:** A markdown file at `docs/notes/stage-2-comparison.md` summarising what was different between the MCP path (U3+U4) and the LangChain.js path (U7) — code volume, discoverability, error-handling shape, second-client portability, and the lived feeling of building each. Frame the memo honestly: lived experience if U7 was built, extrapolated from prep doc + sketch if not.

**Requirements:** R11.

**Dependencies:** U7 when built; otherwise U6 (the noticing journal becomes primary input).

**Files:**
- Create: `docs/notes/stage-2-comparison.md`.

**Approach:**
- Required sections:
  - **What I built (or didn't)** — honest framing of whether U7 shipped or downgraded.
  - **Code volume diff** — rough LOC count for `mcp-server/` + `lib/mcp-client.ts` + `lib/tool-loop.ts` vs `lib/langchain-agent.ts`. Skip if no fair comparison possible.
  - **Discoverability** — what `tools/list` gave the MCP path that the LangChain path had to hard-code at the agent definition site.
  - **Error-handling shape** — how a tool error surfaced in each path. MCP wraps in `isError: true` content; LangChain.js wraps via thrown exceptions.
  - **Vendor portability** — what would change if Claude Desktop, Cursor, or a future agent wanted to use these same tools.
  - **What I'd say in the interview** — 3 specific MCP affordances I noticed I was relying on, with the trade-off cost of giving each up.
- Keep it under 500 words. The interview value is in specificity, not volume.

**Patterns to follow:** None. This is a write-up artifact.

**Test scenarios:**

Test expectation: none — this is documentation, not feature code.

**Verification:**
- The memo names at least 3 specific MCP affordances the LangChain.js version did not preserve, with concrete examples drawn from U6's journal.
- If U7 was not built, the memo explicitly says so in the opening paragraph and frames the rest as extrapolation.
- The developer can read the memo cold a week later and reproduce the interview talking points without re-reading the brainstorm.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Stage-1 over-runs the day-4 milestone, leaving no time for stage 2. | U7 is explicitly scoped as a stretch with a documented downgrade path (R8 → written sketch, R11 → extrapolated memo). Day-4 milestone is the hard gate; stage 2 fires only if stage 1 is demo-ready. |
| `@modelcontextprotocol/sdk` v1.29 API differs from research findings. | The research was conducted via current docs (May 2026), but version drift in fast-moving SDKs is real. U3's first 30 minutes are a "verify the API surface" check — if anything in External References disagrees with what `pnpm i @modelcontextprotocol/sdk` ships, course-correct before writing tool definitions. |
| LangChain v1 `createAgent` API differs from research findings. | U7 begins with a `pnpm add` spike (explicitly called out in U7's Files section and in the brainstorm's synthesis). If the spike reveals API drift, stage 2 may degrade to written sketch and the comparison memo (U8) frames accordingly. |
| MCP server stdout pollution corrupts JSON-RPC framing. | Documented in External References and reinforced in U3's Approach section ("every `console.log` must be `console.error`"). Single most common MCP-server bug; surfaces immediately and visibly. |
| Next.js dev HMR orphans the MCP child process, leading to zombie processes during development. | `globalThis.__mcp ??= ...` singleton pattern explicitly called out in U4's Approach. Fallback: `pkill -f mcp-server` between dev sessions. |
| Supabase free-tier rate limits or connection caps interfere with rapid iteration. | Out of scope to engineer around. If hit, briefly add a 100ms `setTimeout` between iteration retries and document the hit in the noticing journal. |
| The hand-rolled tool-use loop has a subtle bug (e.g., missing `tool_use_id` correlation) that's invisible until a multi-tool question. | Test scenarios in U4 explicitly include multi-tool questions; the loop iteration logs (stderr) make the failure mode visible. If iteration count hits the cap with no answer, that's the symptom — inspect the message array. |

---

## Sources & References

- **Origin document:** `docs/brainstorms/mcp-langchain-rebuild-prep-requirements.md`
- **Interview prep notes:** `first-info.md` — sections 2 (MCP Deep Dive), 4 (Specific Project Architecture), 4.5 (Text-to-SQL), 4.6 (Preventing Destructive Queries) are direct inputs to several Key Technical Decisions
- MCP TypeScript SDK: `https://github.com/modelcontextprotocol/typescript-sdk` (server + client docs)
- MCP TypeScript SDK server docs: `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md`
- LangChain v1 migration guide (JS): `https://docs.langchain.com/oss/javascript/migrate/langchain-v1`
- Anthropic TypeScript SDK: `https://github.com/anthropics/anthropic-sdk-typescript`
- Anthropic SDK beta features (toolRunner reference, even though not used here): `https://deepwiki.com/anthropics/anthropic-sdk-typescript/4-beta-features`
- Supabase `pg_read_all_data` role documentation: `https://supabase.com/docs/guides/database/postgres/roles`
- Supabase running raw SQL pattern: `https://github.com/orgs/supabase/discussions/3458`
- MCP TS SDK issue #1049 (child-process death surfacing as -32000): `https://github.com/modelcontextprotocol/typescript-sdk/issues/1049`
- Nearform — MCP implementation tips, tricks, pitfalls: `https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/`

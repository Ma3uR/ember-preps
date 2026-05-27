---
date: 2026-05-27
topic: mcp-langchain-rebuild-prep
---

# MCP + Supabase Chat → LangChain Rebuild Prep

## Summary

A two-stage personal learning lab for the senior FullStack → GenAI final-round interview. Stage 1 builds a naive TypeScript MCP server over a small Supabase analytics schema, fronted by a TS chat backend and a React UI, so the lesson lands on MCP's primitives. Stage 2 rips the MCP layer out and rebuilds the same chat surface with native LangChain.js tools so the comparison can be spoken from experience, not theory.

---

## Problem Frame

The upcoming interview's headline assignment is "rebuild a working MCP-based text-to-SQL chat in LangChain." The candidate already has strong fullstack and multi-agent context (Vercel AI SDK, Claude Code, AgenticOS supervisor pattern) but **has not built an MCP server from scratch**, and has not personally lived the wrap-vs-replace trade-off the prep doc spends most of its time on.

Reading the spec is not the same as feeling the protocol. Without a small first-hand build, three risks compound in the interview:

- Talking about MCP's three primitives, JSON-RPC envelope, capability negotiation, and `tools/list` discoverability from book-knowledge only — easy to expose under follow-up questions.
- Recommending the senior-defensible "wrap with `langchain-mcp-adapters`, don't rebuild" without having personally felt what disappears when MCP goes away — the recommendation lands as memorized advice rather than lived opinion.
- Underestimating the carrying-cost of MCP's affordances (vendor portability, discovery, capability negotiation) because they are mostly invisible until you remove them.

The cost shape of arriving without hands-on experience is **interview-credibility cost**, not project cost — a senior is expected to have wrestled with the trade-offs they argue for.

---

## Key Flows

- F1. **Stage-1 chat turn (MCP path)**
  - **Trigger:** User types a natural-language question in the React UI (e.g., "top 5 products by revenue last month").
  - **Actors:** Developer (also playing the role of chat user during demo runs).
  - **Steps:**
    1. React UI POSTs the question to the TS chat backend over HTTP/JSON.
    2. Chat backend, acting as MCP host/client, talks to the stdio MCP server (single shared child Node process).
    3. LLM loop inside the backend: `tools/list` → reason → call `list_tables` / `describe_table` → draft SQL → call `execute_query` → summarise.
    4. Backend returns the natural-language answer to the React UI.
  - **Outcome:** UI displays the answer; the developer can inspect the JSON-RPC trace (logged) to see capability negotiation, tool discovery, and tool-result envelopes.
  - **Covered by:** R1, R2, R3, R4, R5, R6.

- F2. **Stage-2 chat turn (LangChain.js path)**
  - **Trigger:** Same user question as F1, after the rip-and-replace has happened.
  - **Actors:** Same.
  - **Steps:**
    1. React UI POSTs the same question to the same chat-backend endpoint shape.
    2. Backend runs a LangChain.js agent (`@langchain/langgraph` + `@langchain/anthropic`) whose tools (`list_tables`, `describe_table`, `execute_query`) are now native `tool`-decorated functions calling Supabase directly — no MCP layer.
    3. Backend returns the natural-language answer to the UI.
  - **Outcome:** Functionally same answer (within LLM variance); developer can compare side-by-side what code, infrastructure, and discoverability disappeared.
  - **Covered by:** R7, R8, R9.

---

## Stage architecture (visual)

```
STAGE 1 — MCP path                          STAGE 2 — LangChain.js path
─────────────────────                       ─────────────────────────────
                                            
   ┌───────────┐                               ┌───────────┐
   │ React UI  │                               │ React UI  │
   └─────┬─────┘                               └─────┬─────┘
         │ HTTP/JSON                                 │ HTTP/JSON
   ┌─────▼──────────┐                          ┌─────▼──────────┐
   │ TS chat backend│                          │ TS chat backend│
   │ (MCP host +    │                          │ (LangGraph     │
   │  MCP client)   │                          │  agent)        │
   └─────┬──────────┘                          └─────┬──────────┘
         │ stdio (JSON-RPC)                          │ direct fn calls
   ┌─────▼──────────┐                                │
   │ TS MCP server  │                                │
   │ list_tables    │                                │
   │ describe_table │                                │
   │ execute_query  │                                │
   └─────┬──────────┘                                │
         │ supabase-js                               │ supabase-js
   ┌─────▼──────────────────────────────────────────▼──┐
   │            Supabase (Postgres)                    │
   │   Small analytics schema (~3–5 tables)            │
   └───────────────────────────────────────────────────┘
```

Same UI, same backend shape, same Supabase, same chat-input contract — the MCP server box is the only thing that disappears.

---

## Requirements

**Supabase schema**
- R1. Create a small e-commerce-orders analytics schema in Supabase: `users`, `products`, `orders`, `order_items`, and (if cheap) `events`. Seed with enough rows (~100s per table) that natural-language questions like "top 5 products by revenue last month" or "which users placed more than 3 orders this quarter" return non-empty, varied answers.

**Stage 1 — MCP server**
- R2. Implement a TypeScript MCP server using `@modelcontextprotocol/sdk` that exposes three tools: `list_tables`, `describe_table(table_name)`, and `execute_query(sql)`. No validation pipeline; trust the LLM.
- R3. The server uses the stdio transport only.
- R4. The server connects to Supabase using `@supabase/supabase-js`; auth credentials come from environment variables.

**Stage 1 — Chat backend and UI**
- R5. Implement a TS chat backend that acts as the MCP host/client. It spawns the MCP server as a single shared child Node process at startup (Claude-Desktop-style), reuses the connection across requests, and exposes a single HTTP endpoint the React UI posts questions to.
- R6. The backend runs an LLM tool-use loop (Claude Sonnet 4.6 or equivalent) that issues MCP `tools/list`, calls the three MCP tools as needed, and returns a natural-language answer. Loop is hard-capped to ~6 iterations to prevent runaway tool-call loops.
- R7. Implement a minimal React chat UI: input box, conversation list, no streaming, no tool-call visualization beyond what the developer wants for their own learning.

**Stage 2 — LangChain.js rebuild (stretch goal given <1-week timeline)**
- R8. **Stretch.** Re-implement the same three tools (`list_tables`, `describe_table`, `execute_query`) as native LangChain.js tools (`tool(...)` from `@langchain/core`), calling Supabase directly. Wire them into a `@langchain/langgraph` agent (`createReactAgent` or equivalent) using the same LLM. If timeline does not permit a working build, R8 downgrades to a written code-sketch + extrapolated comparison (see R11).
- R9. **Stretch (only if R8 is built).** Keep the chat-backend HTTP shape unchanged so the same React UI works against either backend with no UI code changes. Switching between stage-1 and stage-2 backends should be a code-level toggle (env var, branch, or two backend entrypoints — implementation detail for `ce-plan`).

**Cross-stage observations**
- R10. During stage 1, keep a brief "noticing journal" (a markdown file in the repo) capturing what MCP affordances the developer leaned on or noticed: tool discovery, JSON-RPC errors, capability negotiation, etc. This is the substrate for the stage-2 comparison.
- R11. Write a short comparison memo (in the repo) summarising what was different between the MCP and LangChain.js implementations — code volume, discoverability, error-handling shape, and what would change if a second client (Claude Desktop, Cursor) wanted to use the same tools. If R8 was built, the memo is grounded in lived experience. If R8 was downgraded to a written sketch, the memo is explicitly framed as "extrapolated from the prep doc and a code outline" so the developer can speak honestly about the seam in the interview.

---

## Acceptance Examples

- AE1. **Covers R1, R5, R6.** Given the Supabase schema is seeded with orders data, when the developer asks "top 5 products by revenue last month" in the React UI, the stage-1 backend completes the MCP tool-use loop (visible in logs as `tools/list` → `describe_table` → `execute_query`) and the UI displays a natural-language answer naming five products with revenue figures.
- AE2. **Covers R3, R5.** Given the chat backend has just started, when it accepts its first request, the MCP server child process was spawned at backend startup (not per-request), and subsequent requests reuse the same JSON-RPC session.
- AE3. **Covers R6.** When the LLM enters a repeated tool-call pattern (e.g., calling `describe_table` on the same table more than twice in a single turn), the loop terminates at the iteration cap and surfaces a graceful "couldn't answer" message rather than running indefinitely.
- AE4. **Covers R9.** When the developer toggles from the stage-1 backend to the stage-2 backend (via the chosen switching mechanism), the React UI works against either with zero code changes, and the same input question returns a functionally-equivalent answer (modulo LLM variance).
- AE5. **Covers R10, R11.** At the end of stage 2, the repo contains a noticing journal from stage 1 and a comparison memo from stage 2; together they let the developer speak from lived experience about what MCP gives up when it is replaced.

---

## Success Criteria

- The developer can demo the stage-1 chat live in the interview if asked, and can show JSON-RPC traces, the `tools/list` response, and at least one inspectable tool call — i.e., can speak about MCP's primitives from a screen, not from memory.
- The developer can articulate the wrap-vs-replace trade-off from lived experience: "I built it both ways; here is the concrete thing I lost when I removed MCP — discovery, vendor portability, capability negotiation surface area."
- A downstream agent (or the developer themselves a week later) reading the comparison memo can identify at least three specific MCP affordances the LangChain.js version did not preserve, with examples.
- The developer can name, unprompted, every scope cut made for this prep (Streamable HTTP, OAuth 2.1, `sqlglot`, schema-RAG, LangSmith, eval suite, supervisor) and how they would add each in production — so each cut becomes a senior-signal talking point instead of a gap.

---

## Scope Boundaries

- Streamable HTTP transport — explicitly deferred; stdio is the only transport built.
- OAuth 2.1 / RFC 9728 / PKCE / dynamic client registration — deferred; not relevant for a local sandbox.
- `sqlglot` AST validation, read-only Postgres role enforcement at the server level, LIMIT clamping, `EXPLAIN` plan cost checks — deferred; talking-points only.
- Schema RAG / pgvector index of table descriptions / few-shot retrieval — deferred.
- LangSmith tracing, Langfuse, or any production observability layer — deferred. Stage-1 traces live in console logs only.
- HITL middleware, supervisor / multi-agent orchestration, planner / validator / reflector node split — deferred.
- A fixed quantitative regression test set (gold question-answer pairs, execution accuracy scoring, Ragas) — deferred; the comparison is qualitative via the noticing journal and comparison memo.
- The "wrap with `langchain-mcp-adapters`" alternative architecture — deferred; this prep deliberately picks rip-and-replace to feel the contrast, not to model the production-recommended path.
- Streaming chat responses, SSE/WebSocket, intermediate tool-call visibility in the UI — deferred. Non-streaming JSON response is sufficient for the learning goal.
- Multi-turn conversation memory beyond what the LLM gets in a single turn — deferred. Single-turn chat is enough for the learning goal.
- Production deployment, hosting, CI, monitoring, multi-tenancy, RBAC, audit logging — out of scope. Local dev only.

---

## Key Decisions

- **TypeScript end-to-end** for both stages (MCP server, chat backend, frontend). Despite the interview-prep doc noting Python is the dominant LangChain ecosystem, this is a personal learning sandbox — one-language velocity and zero context-switching beat ecosystem alignment with the specific employer. The CTO's "we cannot tell its secure" objection to Vercel AI SDK was almost certainly about deployment topology (LLM call origin), not about JS-vs-Python SDK security per se; both Anthropic SDKs ship from the same monorepo with comparable surfaces.
- **Stdio transport, naive tools** chosen on purpose. Stdio focuses the lesson on MCP's primitives (JSON-RPC envelope, capability negotiation, the three primitive types, `tools/list` discovery) without the session / resumption / OAuth complexity that Streamable HTTP introduces. The naive tool surface keeps the build small enough to actually finish before the interview.
- **Replace-not-wrap for stage 2.** The production-defensible move is to wrap MCP with `langchain-mcp-adapters` (Option A/C from the prep doc), not to rip it out (Option B). Deliberately choosing the rip-and-replace path here trades production-realism for *felt learning* — the developer will be able to speak to wrap-vs-replace from lived experience.
- **Single shared MCP subprocess** at backend startup, not per-request. Per-request spawning would be wasteful and would obscure the real-world MCP-host pattern (Claude Desktop, Cursor, Claude Code all spawn and reuse). Single shared subprocess matches that pattern at single-developer scale.
- **LLM provider: Claude Sonnet 4.6** (default) with the Anthropic SDK. Aligned with the prep doc's most-referenced model and the developer's existing familiarity from Claude Code / Vercel AI SDK work. Easy to swap later.
- **Qualitative comparison via noticing journal + memo**, not a quantitative regression suite. Matches the learning-lab framing; a 5–10 question test set was explicitly considered and declined as over-scoped for a prep project.
- **Schema topic: e-commerce orders.** Closest to the Spider / BIRD text-to-SQL benchmark territory; the interviewer's brain will already be in that domain, so cognitive load is on the MCP / LangChain mechanics rather than schema comprehension. Alternative topics (content / media, fitness, fictional company) considered and declined for the same reason.
- **Stage 1 is a hard requirement; stage 2 is a stretch goal.** Calendar budget is <1 week. If stage 2 is not built in time, R8 downgrades to a written code sketch and R11's comparison memo is honestly framed as extrapolated from prep + sketch rather than lived experience. Sequencing rationale: at least one concrete, demo-able stage must exist by interview day to anchor the talking points.

---

## Dependencies / Assumptions

- A Supabase project (free tier) with admin access for schema creation and seeding.
- An Anthropic API key with sufficient credits for development iteration and one interview-day demo run.
- Node.js 20+ runtime locally; package manager (pnpm / npm / bun — TBD in planning).
- The `@modelcontextprotocol/sdk` TypeScript SDK is assumed stable enough for a tutorial-shaped build at version current as of 2026-05-27 (unverified — flag for planning).
- LangChain.js packages (`@langchain/langgraph`, `@langchain/core`, `@langchain/anthropic`) are assumed to support `createReactAgent` or an equivalent prebuilt at version current as of 2026-05-27 (unverified — explicitly called out as a "1-hour spike before locking stage 2" in the synthesis).
- Calendar budget is **less than one week** between brainstorm finalization and interview day. Stage 1 must be done; stage 2 is treated as a stretch (see Key Decisions).

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5, R9][Technical] How exactly does the backend "toggle" between stage-1 (MCP) and stage-2 (native LangChain.js) implementations — env var + factory, two separate entrypoints, branch-per-stage, or something else? Decide during planning; depends on whether both backends should coexist or whether stage 2 overwrites stage 1.
- [Affects R7][Technical] Next.js vs a standalone Node/Hono backend for the TS chat backend. Both work; choice depends on whether the React UI is hosted in the same Next.js app or as a separate Vite/CRA frontend.
- [Affects R5][Needs research] Confirm the `@modelcontextprotocol/sdk` TypeScript SDK's current stdio API shape and any pitfalls around child-process lifecycle (signal handling, restart on crash). Likely a 30-minute read of the SDK README during planning.
- [Affects R8][Needs research] Confirm `@langchain/langgraph` + `@langchain/anthropic` agent-creation API is stable as of the build date (the synthesis flagged a 1-hour spike). Planner should verify against current docs (via context7 MCP) before committing to a specific API surface.
- [Affects R10, R11][User decision] Where do the noticing journal and comparison memo live — in `docs/`, in the repo root, or attached to the brainstorm doc? Planning decision, low-cost either way.

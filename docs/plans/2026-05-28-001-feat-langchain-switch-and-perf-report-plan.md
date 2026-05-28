---
title: LangChain Switch + UI Performance Comparison Report
type: feat
status: completed
date: 2026-05-28
origin: docs/brainstorms/mcp-langchain-rebuild-prep-requirements.md
predecessor: docs/plans/2026-05-27-001-feat-mcp-langchain-rebuild-prep-plan.md
---

# LangChain Switch + UI Performance Comparison Report

## Summary

Promote the LangChain v1 rebuild (R8/R9/R11 — stretch in the May 27 plan, not built) to first-class and add structured per-request instrumentation in both backends, exposed in the chat UI via a Compare Mode that runs both backends in parallel and shows answers + trace breakdowns side-by-side. The trace captures total wall ms, per-LLM-call ms + input/output/cache tokens, per-tool-call ms + tool name, and iteration count — symmetric across MCP and LangChain so the diff is the demo. Powers the interview question "is LangChain faster?" with lived measurements rather than vibes, and turns the deferred comparison memo (R11) into something written from real data.

---

## Problem Frame

The MCP side of the learning lab is built and working (see predecessor plan, `status: completed`). The brainstorm's stage-2 deliverables — the LangChain.js rebuild (R8), the `BACKEND_MODE` toggle (R9), and the comparison memo (R11) — were explicitly scoped as stretch and never executed. The candidate now needs (a) the lived experience of building the LangChain version so the interview talking points are first-hand, and (b) a UI-visible way to demonstrate the actual runtime difference between the two architectures: number of tool round-trips, per-call latency, total wall time, token usage. "Wrap, don't rebuild" lands as memorized advice if it isn't backed by measurements the interviewer can see on screen.

See origin `docs/brainstorms/mcp-langchain-rebuild-prep-requirements.md` for the original pain narrative; this plan extends that scope with the performance reporting layer.

---

## Requirements

Carried forward from the origin (now promoted from stretch to in-scope):

- **R8.** Re-implement the three tools (`list_tables`, `describe_table`, `execute_query`) as native LangChain.js `tool()` definitions wired into `createAgent` from `langchain` v1.
- **R9.** Chat-backend HTTP shape stays compatible across MCP and LangChain routes so a single UI works against either; selection via `BACKEND_MODE` (extended below).
- **R11.** End-of-stage comparison memo in `docs/notes/stage-2-comparison.md` summarising differences across code volume, discoverability, error-handling, second-client portability, and now performance.

New requirements introduced by this plan (numbered to continue the origin's sequence):

- **R12.** Both chat endpoints return a structured trace alongside the answer: `{ answer: string, trace: Trace }` where `Trace` captures `backend`, `totalMs`, `iterations`, `llmCalls: [{ ms, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }]`, `toolCalls: [{ name, ms, isError }]`, and `capReached: boolean`. Symmetric across both backends.
- **R13.** `BACKEND_MODE` (and its client mirror `NEXT_PUBLIC_BACKEND_MODE`) gains a third value `compare`. In `compare` mode the UI fires both backends in parallel for one question and renders both answers + both traces side-by-side. Failures in one backend do not block the other.
- **R14.** Compare Mode is single-shot per question — each question produces one comparison block; history is preserved as a list of blocks, not as two threaded conversations. The existing single-backend modes (`mcp`, `langchain`) preserve the current threaded chat behaviour.
- **R15.** Trace UI renders a compact summary by default (total ms, iteration count, tool count, total tokens) with an expandable detail view (per-LLM-call breakdown, per-tool-call breakdown). Tailwind tokens already in `app/globals.css` (`--color-surface`, `--color-border`) — no new design system.

**Origin actors carried forward:** developer-as-both-implementer-and-chat-user.
**Origin acceptance examples still in play:** AE4 (toggle between backends without UI code change — now exercisable for real), AE5 (memo with lived comparison material).

New acceptance examples:

- **AE6.** In Compare Mode, asking "top 5 products by revenue last month" fires both routes in parallel; both panels render an answer; each panel's trace shows ≥1 LLM call with non-zero token counts and ≥1 `execute_query` tool call; total wall ms is visible per panel.
- **AE7.** If one backend errors (e.g., MCP child process crashed), the other panel still completes and shows its trace; the failed panel shows the error message and which iteration it failed at.
- **AE8.** Toggling `NEXT_PUBLIC_BACKEND_MODE` between `mcp`, `langchain`, and `compare` requires no edits to `components/Chat.tsx` beyond reading the env var.

---

## Scope Boundaries

Carried verbatim from origin Scope Boundaries — all remain deferred at plan time:

- Streamable HTTP transport, OAuth 2.1 / RFC 9728 / PKCE.
- `sqlglot` AST validation, server-level read-only role enforcement beyond Supabase role grants, LIMIT clamping, `EXPLAIN` plan checks.
- Schema RAG / pgvector / few-shot retrieval.
- LangSmith, Langfuse, or any structured production observability layer. The trace this plan emits is in-memory, per-request, and rendered in the UI; it is not persisted, aggregated, or shipped anywhere.
- HITL middleware, supervisor / multi-agent orchestration, planner / validator / reflector splits.
- Fixed quantitative regression test set.
- The `langchain-mcp-adapters` wrap path (deliberately picking rip-and-replace for stage 2).
- Streaming chat responses; multi-turn memory beyond a single LLM tool-use loop.
- Production deployment, hosting, CI, monitoring, multi-tenancy, RBAC, audit logging.

### Deferred to Follow-Up Work

- **Multi-turn Compare Mode.** Each Compare turn is single-shot per the R14 decision; threading two divergent backend conversations together is messy state and not what the demo needs. If a future iteration wants it, it's a Chat.tsx-only change — both routes already accept stateless POSTs.
- **Persisted trace history.** Traces live only in component state in the current session. If a future demo wants per-question history across sessions or aggregate "MCP is on average X% slower" stats, add a small server-side `lib/trace-store.ts` (in-memory ring buffer or sqlite). Not in scope here.
- **Per-LLM-call cost in dollars.** The trace captures token counts but does not multiply by pricing. The brainstorm explicitly out-of-scopes pricing tables.
- **`langchain-mcp-adapters` wrap path** — still deferred from origin as the candidate's post-interview follow-up.
- **Back-fill of `docs/notes/stage-1-noticing.md`.** The journal scaffold exists but is TODO-only. Useful for the memo (U6) but not blocking — recommend back-filling opportunistically while building, not as a discrete unit.

---

## Context & Research

### Relevant Code and Patterns

The repo is the May 27 plan's output. Patterns discovered by repo research:

- **Singleton-on-globalThis with failed-promise-clear** is the architectural backbone for stateful resources across HMR. Examples: `globalThis.__mcp` (`lib/mcp-client.ts:28`), `globalThis.__llmReadonlyPool` (`lib/supabase.ts:27`), `globalThis.__mcpShutdownWired` (`lib/mcp-client.ts:30`). Failed promises clear themselves so the next request retries (`lib/mcp-client.ts:88-92`). **Any new shared resource — the LangChain agent instance especially — must follow this pattern.**
- **Two distinct DB paths in `lib/supabase.ts`**, intentionally not unified: `runSql()` for LLM-controlled queries (via `public.run_sql` SECURITY DEFINER + `llm_readonly` role) and `runReadonlyQuery()` for hardcoded introspection SQL. The LangChain `execute_query` tool reuses `runSql()` — do not invent a third path.
- **`next.config.ts:7`** marks `@modelcontextprotocol/sdk` as `serverExternalPackages`. If any LangChain package has the same deep-ESM bundling issue, mirror that treatment.
- **JSDoc file headers** explaining *why, not what* — see `lib/tool-loop.ts:1-17`, `lib/mcp-client.ts:1-18`, `lib/supabase.ts:1-16`. New `lib/` files match the convention.
- **Lazy env reading inside getter functions**, never at module top-level — see `lib/tool-loop.ts:56-64`, `lib/supabase.ts:39-60`, `:130-144`. Missing-env throws cite `.env.local.example`.
- **`[module-name]` stderr tagging** — every server-side log line uses `console.error` with a bracketed prefix (`[tool-loop]`, `[chat-mcp]`). Stdout is reserved for MCP JSON-RPC framing.
- **Route handler conventions** — `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"` are non-negotiable for both chat routes. Input validation is hand-rolled at the boundary (no zod); zod is reserved for tool input schemas.
- **Tailwind v4 setup** is config-less: `@import "tailwindcss";` and a `@theme { ... }` block in `app/globals.css` define `--color-background`, `--color-foreground`, `--color-surface`, `--color-border`. Consumption is the bracket form: `border-[var(--color-border)]`. Compare Mode panels reuse these tokens; no new design system.

### Instrumentation Seams (MCP loop)

Concrete hook points in `lib/tool-loop.ts` for the trace, identified by repo research:

- **Total wall ms** — wrap the body of `runMcpToolLoop()` (`lib/tool-loop.ts:85-170`). Change the signature from `Promise<string>` to `Promise<{ answer: string; trace: Trace }>`. Single caller updates: `app/api/chat-mcp/route.ts:43`.
- **Iteration count** — the `for` at `lib/tool-loop.ts:103`. Record `i + 1` of the iteration that produced the terminal text (early-return at `:119`) and a `capReached` flag (`:168-169`).
- **Per-LLM-call ms + tokens** — wrap `ai.messages.create({...})` at `lib/tool-loop.ts:105-111`. Pull `res.usage.input_tokens`, `res.usage.output_tokens`, `res.usage.cache_read_input_tokens`, `res.usage.cache_creation_input_tokens` (all available on `@anthropic-ai/sdk@^0.39.0`).
- **Per-tool-call ms + name** — wrap each `client.callTool({...})` inside `Promise.all(toolUses.map(...))` at `lib/tool-loop.ts:122-162`. Tool calls within one iteration run in parallel; record each independently. The existing `is_error` outcome at `:148` becomes `isError` on the trace entry.

The existing `console.error("[tool-loop] ...")` lines at `:96, :104, :118, :125, :142, :153, :168` are the structural beats where measurements naturally fit. Turn each `console.error` site into a `push` to the trace object; keep the stderr logging alongside (do not remove it — it is the noticing-journal substrate).

### Institutional Learnings

`docs/solutions/` does not exist in this repo — no prior learnings to draw on. `docs/notes/stage-1-noticing.md` exists as a scaffold but is TODO-only. The instrumentation design is first-principles. Post-build, capturing the LangChain v1 middleware setup + the parallel-fetch-with-partial-failure pattern under `docs/solutions/` is a strong candidate for `/ce-compound`.

### External References

- **LangChain v1 `createAgent` (TS):** Import from `langchain` (umbrella), NOT from `@langchain/langgraph/prebuilt`. `createReactAgent` is deprecated. Tool definitions via `tool()` from `@langchain/core/tools` with zod schema. Model via `ChatAnthropic` from `@langchain/anthropic`. Pre-bound models rejected — pass plain model + `tools` array. `prompt` param renamed to `systemPrompt`. Install line:
  `pnpm add langchain @langchain/core @langchain/anthropic @langchain/langgraph zod`.
  See [LangChain v1 migration guide (JS)](https://docs.langchain.com/oss/javascript/migrate/langchain-v1) and [createAgent reference](https://reference.langchain.com/javascript/langchain/index/createAgent).
- **LangChain v1 instrumentation = middleware system.** Six hooks: `beforeAgent`, `beforeModel`, `wrapModelCall`, `afterModel`, `wrapToolCall`, `afterAgent`. For per-LLM timing + tokens use `wrapModelCall(request, handler)` — bracket `await handler(request)` with `performance.now()`; the returned `AIMessage` has `usage_metadata: { input_tokens, output_tokens, total_tokens }` (LangChain normalises Anthropic's `usage` into this shape). For per-tool timing use `wrapToolCall` — `request.toolCall.name` gives the tool name. Iteration count = `wrapModelCall` invocations within one `agent.invoke`. `BaseCallbackHandler` still exists but is the legacy path. See [Middleware system overview](https://docs.langchain.com/oss/javascript/langchain/middleware) and [AgentMiddleware interface](https://reference.langchain.com/javascript/interfaces/langchain.index.AgentMiddleware.html).
- **Iteration cap mechanism.** `createAgent` does NOT accept `maxIterations`. Use LangGraph's `recursionLimit` passed to `.invoke()` as the second arg: `await agent.invoke({ messages: [...] }, { recursionLimit: 12 })`. `recursionLimit` counts graph node steps, not LLM calls — one model+tool round-trip ≈ 2 steps, so 12 ≈ the brainstorm's 6-iteration cap. Spike-verify the exact ratio at U3 start. On limit, LangGraph throws `GraphRecursionError`; catch in the route handler and return whatever partial trace exists.
- **Anthropic SDK `Usage`** on `@anthropic-ai/sdk@^0.39.0` exposes `input_tokens`, `output_tokens`, `cache_creation_input_tokens` (nullable), `cache_read_input_tokens` (nullable). All four fields populate the Trace's `llmCalls` entries on the MCP side.
- **Model id format clarification:** The existing code already uses `claude-sonnet-4-6` (the dateless 4.6 id, which IS the pinned snapshot — dated suffixes only applied to ≤4.5). The predecessor plan's External References had `claude-sonnet-4-6-20250929` as a snapshot id which was incorrect; the code itself was correct. No fix needed in `lib/tool-loop.ts:29`. LangChain agent uses the same id.
- **LangChain v1 breaking changes worth knowing:** legacy chains/indexing/community moved to `@langchain/classic` (none needed here); `.call()`, `.predict()`, `.predictMessages()` removed (use `.invoke()`); streaming node name changed `"agent"` → `"model"` (not relevant — not streaming); tracing APIs old standalone callback-handler tracing removed in favor of LangSmith (out of scope; middleware is the only in-tree path).

### Slack Context

Not gathered — personal pet project, no organizational context to consult.

---

## Key Technical Decisions

- **LangChain v1 instrumentation uses the new middleware system, not `BaseCallbackHandler`.** Rationale: `wrapModelCall` / `wrapToolCall` are the v1-canonical hooks, give symmetric measurement surfaces to the hand-rolled MCP loop (LLM call boundary + tool call boundary), and read `AIMessage.usage_metadata` directly without normalisation. `BaseCallbackHandler` works but is the legacy path; using it would lock the plan into the deprecation trajectory. The middleware design also matches the comparison memo's interview talking point that LangChain v1's primitives are different from v0/`createReactAgent`-era patterns.
- **Symmetric `Trace` shape across both backends, defined once in `lib/trace.ts`.** Rationale: the entire UI comparison story depends on apples-to-apples. Defining the shape once and having both backends produce identical objects means the rendering component is a single component fed by either backend, not two. The Trace's `LlmCall` uses camelCase field names (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`) — the trace builder normalises both sources: Anthropic SDK's snake_case `Usage` fields (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) on the MCP path, and LangChain's `usage_metadata` on the LangChain path. Cache fields are nullable because LangChain may not surface them.
- **Response shape becomes `{ answer, trace }` on BOTH routes.** Rationale: the UI needs the trace; sending it through a side-channel header is ugly; the response shape change is internal to this repo with one caller (the UI) so the "break" is mechanical. The MCP route currently returns `{ answer }`; updating it together with the loop refactor (U2) keeps the change atomic.
- **`BACKEND_MODE` gains a third value `compare`.** Rationale: extending the existing toggle is one line in `Chat.tsx` and keeps R9 from origin honest while delivering R13. The env var stays the single source of truth — no need for a UI radio button for the toggle itself (interview demo can switch by editing `.env.local` and refreshing). If the interviewer wants live toggling, a follow-up can add a radio — but the cost of building it now exceeds the demo value.
- **Compare Mode UX is single-shot Q→2A pairs, not multi-turn threaded.** Rationale: divergent backend conversation state across turns is messy and not what the demo question ("is it faster?") asks. Each question fires both backends in parallel via `Promise.allSettled`, renders one comparison block, and clears the input. History accumulates as a list of comparison blocks. Existing `mcp`-only and `langchain`-only modes preserve the current threaded chat behaviour unchanged.
- **`Promise.allSettled` for the parallel fan-out, not `Promise.all`.** Rationale: one backend erroring (MCP child died, LangChain rate-limited, etc.) must not block the other. The UI renders whatever each promise produced; failures show as the error message inside that backend's panel, with the partial trace if one was returned.
- **LangChain agent is a `globalThis.__langchainAgent`-cached singleton, built lazily.** Rationale: matches the existing `globalThis.__mcp` pattern from `lib/mcp-client.ts`. `createAgent` does graph compilation under the hood; rebuilding per request burns wall time and obscures the actual LLM/tool latency the trace is supposed to measure. Failed-build promises clear themselves so the next request retries (same pattern as `:88-92`).
- **`recursionLimit: 12` for the LangChain agent**, mirroring the MCP loop's 6-iteration cap. Rationale: spike-verify the step-to-iteration ratio at U3 start with a single-tool question; adjust ±2 if needed. On `GraphRecursionError`, the route handler catches and returns the partial trace with `capReached: true` so the UI shows the cap was hit — same UX as the MCP loop's `[Iteration cap reached ...]` annotation.
- **Trace detail view is collapsed by default; toggled per-comparison-block.** Rationale: the summary (total ms + iterations + tools + tokens) is what the interviewer scans first; the per-call breakdown is the "let me show you why" follow-up. Defaulting to collapsed keeps the screen scannable when history accumulates.
- **No new design system, no shadcn.** Rationale: the existing Tailwind v4 + CSS-variable design language in `Chat.tsx` is the entire visual budget. Comparison panels are two flex columns with the same border/surface tokens; trace detail rows are a monospace block. Anything more is yak-shaving (per origin's R7 framing).

---

## Open Questions

### Resolved During Planning

- **What metrics to capture (origin had no instrumentation requirement):** Resolved as the Trace shape in R12 — total wall ms, iteration count, per-LLM-call (ms + 4 token fields), per-tool-call (ms + name + isError), capReached flag (see Key Technical Decisions).
- **How to surface metrics in UI (new scope):** Resolved as Compare Mode with parallel fan-out and side-by-side panels; single-shot Q→2A pairs; collapsed-by-default detail (R13, R14, R15, see Key Technical Decisions).
- **LangChain v1 instrumentation mechanism:** Resolved as the middleware system (`wrapModelCall` + `wrapToolCall`), not `BaseCallbackHandler` (see External References + Key Technical Decisions).
- **LangChain iteration cap:** Resolved as `recursionLimit: 12` on `agent.invoke`'s config arg, with spike-verify in U3 (see External References).
- **Response shape change:** Resolved as `{ answer, trace }` on both routes; atomic with the loop refactor (see Key Technical Decisions).
- **Toggle mechanism for compare mode:** Resolved as extending `NEXT_PUBLIC_BACKEND_MODE` with a third value; no live UI radio (see Key Technical Decisions).

### Deferred to Implementation

- **Exact `recursionLimit` value.** Plan calls for 12 to mirror the 6-iter MCP cap. Spike at U3 start with one single-tool question; if iteration count comes back as 6 (not the expected ratio), `recursionLimit` is fine; if it's 3, double to 24 or set `recursionLimit: 12` and accept it caps at 6 LLM calls (close enough). Document the empirical ratio in the trace's iteration count vs the expected mapping.
- **Whether to map LangChain's `usage_metadata` cache fields.** `usage_metadata` is normalised across providers and may not include Anthropic's cache token fields; they may live on `response_metadata.usage` raw passthrough. At U3 start, `console.log` one `AIMessage` from `wrapModelCall` to confirm. If cache fields are not available via `usage_metadata`, fall back to `response_metadata.usage` (and document in the comparison memo as one of the asymmetries).
- **Whether to add a `BACKEND_MODE` server-side log line on route entry.** Optional — useful for stderr visibility when debugging which mode a request hit. Defer to taste at U4.

---

## Output Structure

```text
ember-preps/
├── docs/
│   ├── brainstorms/
│   │   └── mcp-langchain-rebuild-prep-requirements.md         (existing)
│   ├── plans/
│   │   ├── 2026-05-27-001-feat-mcp-langchain-rebuild-prep-plan.md   (existing, completed)
│   │   └── 2026-05-28-001-feat-langchain-switch-and-perf-report-plan.md   (this file)
│   └── notes/
│       ├── stage-1-noticing.md                                (existing scaffold; back-fill opportunistic)
│       └── stage-2-comparison.md                              (new — U6)
├── app/
│   ├── api/
│   │   ├── chat-mcp/route.ts                                  (modified — U2; returns { answer, trace })
│   │   └── chat-langchain/route.ts                            (new — U4)
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── Chat.tsx                                               (modified — U5; compare-mode aware)
│   └── TracePanel.tsx                                         (new — U5; trace renderer)
├── lib/
│   ├── trace.ts                                               (new — U2; shared Trace type + helpers)
│   ├── mcp-client.ts                                          (unchanged)
│   ├── tool-loop.ts                                           (modified — U2; emits trace)
│   ├── supabase.ts                                            (unchanged)
│   └── langchain-agent.ts                                     (new — U3; createAgent + trace middleware)
├── mcp-server/                                                (unchanged)
├── supabase/                                                  (unchanged)
├── .env.local.example                                         (modified — U4; documents compare)
├── package.json                                               (modified — U1; +langchain deps)
└── next.config.ts                                             (modified iff LangChain dep needs externalising — U1)
```

The implementer may merge `TracePanel.tsx` into `Chat.tsx` if the panel turns out to be small enough that a separate file is over-engineering. Per-unit `**Files:**` sections remain authoritative.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Compare Mode chat-turn sequence (covering AE6, AE7):**

```mermaid
sequenceDiagram
    actor User
    participant UI as React UI<br/>(components/Chat.tsx)
    participant TP as TracePanel
    participant MCP as /api/chat-mcp
    participant LC as /api/chat-langchain
    participant Loop as tool-loop.ts<br/>(instrumented)
    participant Agent as langchain-agent.ts<br/>(middleware)
    participant LLM as Anthropic API
    participant DB as Supabase Postgres

    User->>UI: types question, NEXT_PUBLIC_BACKEND_MODE=compare
    UI->>UI: Promise.allSettled
    par MCP path
        UI->>MCP: POST { question }
        MCP->>Loop: runMcpToolLoop(question)
        Note over Loop: start performance.now()<br/>iterations = 0
        loop ≤6 iterations
            Loop->>LLM: messages.create(...)
            Note over Loop: record llmCall: { ms, usage }
            LLM-->>Loop: response
            alt tool_use blocks
                Loop->>DB: callTool → run_sql via MCP
                Note over Loop: record toolCall: { name, ms, isError }
                DB-->>Loop: rows
            else terminal text
                Loop-->>MCP: { answer, trace }
            end
        end
        MCP-->>UI: { answer, trace }
    and LangChain path
        UI->>LC: POST { question }
        LC->>Agent: agent.invoke({...}, { recursionLimit: 12 })
        Note over Agent: wrapModelCall records<br/>{ ms, usage_metadata }
        Note over Agent: wrapToolCall records<br/>{ name, ms, isError }
        Agent->>LLM: ChatAnthropic invoke
        LLM-->>Agent: AIMessage
        Agent->>DB: tool() → run_sql direct rpc
        DB-->>Agent: rows
        Agent-->>LC: final state
        LC-->>UI: { answer, trace }
    end
    UI->>TP: render(mcpResult, langchainResult)
    TP-->>User: side-by-side comparison block
```

**Single-backend modes (`mcp` or `langchain`) skip the `Promise.allSettled` fan-out and use the existing threaded chat shape. The same Trace is returned on the response but rendered as a small per-message footer rather than a full comparison block.**

**Trace shape (directional, not the literal type definition):**

```ts
// lib/trace.ts — directional sketch
type LlmCall = {
  ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
};
type ToolCall = { name: string; ms: number; isError: boolean };
type Trace = {
  backend: "mcp" | "langchain";
  totalMs: number;
  iterations: number;
  llmCalls: LlmCall[];
  toolCalls: ToolCall[];
  capReached: boolean;
};
```

---

## Implementation Units

### U1. Install LangChain v1 deps + spike-verify install

**Goal:** `langchain`, `@langchain/core`, `@langchain/anthropic`, `@langchain/langgraph` installed cleanly with no peer-dep warnings on the existing Next.js 15 / React 19 / TS 5.7 stack. A 30-line scratch script confirms `createAgent` + `ChatAnthropic` round-trip works against the real Anthropic API with the existing `ANTHROPIC_API_KEY`, and that a sample `AIMessage` exposes `usage_metadata` with the expected fields (used to settle the deferred question about cache fields).

**Requirements:** R8 (substrate), R12 (token capture mechanism verification).

**Dependencies:** None — predecessor plan's U1–U6 already established the stack.

**Files:**
- Modify: `package.json` — add `langchain @langchain/core @langchain/anthropic @langchain/langgraph` to dependencies.
- Modify: `next.config.ts` — add any new LangChain package to `serverExternalPackages` ONLY if the spike reveals bundling errors (mirror the existing `@modelcontextprotocol/sdk` entry). Don't pre-emptively add — the LangChain JS packages are typically Next-bundle-friendly.
- Create (throwaway): `scripts/langchain-spike.ts` — one-shot scratch that imports `createAgent`, `tool`, `ChatAnthropic`, builds a no-op agent, invokes it once with a trivial question, and `console.log`s the resulting `AIMessage.usage_metadata`. Run via `tsx --env-file=.env.local scripts/langchain-spike.ts`. **Delete after the spike — not part of shipped code.**

**Approach:**
- Exact install: `pnpm add langchain @langchain/core @langchain/anthropic @langchain/langgraph`. Zod is already at `^3.24.0` — reuse, don't bump.
- Spike script confirms three things in order:
  1. Install resolves with no peer-dep warnings against Next 15 / React 19 / Node 20+.
  2. `ChatAnthropic({ model: "claude-sonnet-4-6" }).invoke([{ role: "user", content: "say hi" }])` returns an `AIMessage` whose `usage_metadata` has `input_tokens` and `output_tokens`. Log the full object — confirm whether Anthropic cache fields (`cache_read_input_tokens`, `cache_creation_input_tokens`) appear in `usage_metadata` or in `response_metadata.usage`.
  3. `recursionLimit` mapping: build a tiny `createAgent` with one trivial tool that returns `"ok"`, invoke with `{ recursionLimit: 4 }` on a question that should trigger one tool call, log the LLM-call count observed via a `wrapModelCall` middleware. This empirically settles the step-to-iteration ratio question and informs U3's exact `recursionLimit` value.
- If any peer-dep warning fires, document it in the spike script comment and adjust (downgrade `langchain` to the latest matching v1 release that pairs with current `@langchain/core`).

**Patterns to follow:** None — the spike is a scratch file. Cleanup is non-negotiable; do not let it linger in `scripts/`.

**Test scenarios:**
- Happy path: `pnpm install` completes without peer-dep warnings.
- Happy path: spike script runs and prints non-zero token counts for the trivial invocation.
- Happy path: spike script logs the observed step-to-iteration ratio (e.g., "recursionLimit=4 → observed 2 LLM calls" or "recursionLimit=4 → GraphRecursionError after 1 call").
- Edge case: if cache fields are absent from `usage_metadata`, spike logs `response_metadata.usage` and confirms whether they live there instead.

Test expectation: smoke verification only — no automated tests for dep install. Spike output is captured in plan-comments or pasted into U3's approach notes.

**Verification:**
- `pnpm install` exit code 0, no peer-dep warnings printed.
- Spike script's `AIMessage.usage_metadata` log shows the expected shape.
- Spike's `wrapModelCall` invocation count is non-zero and informs U3's `recursionLimit` choice.
- Spike file deleted before U3 starts (or kept until U3 if it's actively informing decisions there).

---

### U2. Shared `lib/trace.ts` + instrument MCP loop + update `/api/chat-mcp` to return `{ answer, trace }`

**Goal:** A `Trace` type defined once in `lib/trace.ts` and used everywhere downstream. `lib/tool-loop.ts` emits a fully-populated trace alongside its existing string answer (signature change: `Promise<string>` → `Promise<{ answer: string; trace: Trace }>`). `app/api/chat-mcp/route.ts` updates to respond with the new shape. All existing MCP behaviour preserved (no functional changes — just instrumentation added in parallel and the response shape extended).

**Requirements:** R12, partially R15 (the trace shape is what U5 renders).

**Dependencies:** U1 (the empirical findings on Anthropic SDK + middleware behaviour are useful; not strictly blocking since the MCP loop uses the Anthropic SDK directly).

**Files:**
- Create: `lib/trace.ts` — exports `Trace`, `LlmCall`, `ToolCall` types and `createTraceBuilder({ backend })` factory that returns a small mutable builder with `markLlmCall({ ms, usage })`, `markToolCall({ name, ms, isError })`, `markCapReached()`, `finalize({ iterations }): Trace`. Builder pattern keeps `tool-loop.ts` mechanically simple — no event emitters, no class instances.
- Modify: `lib/tool-loop.ts` — wrap the existing structure with builder calls. Do NOT remove the existing `console.error("[tool-loop] ...")` lines — they're the noticing-journal substrate (R10) and useful for stderr debugging. Change `runMcpToolLoop` return type. Keep the cap-reached prefix on the returned string (`[Iteration cap reached after ${MAX_ITERATIONS} loops] ...`) for AE3 — the trace's `capReached: true` plus the prefix are belt-and-braces.
- Modify: `app/api/chat-mcp/route.ts` — change the success response from `NextResponse.json({ answer })` to `NextResponse.json({ answer, trace })`. Error responses unchanged.

**Approach:**
- `lib/trace.ts` follows the existing `lib/` conventions: JSDoc header explaining *why* (a shared symmetric trace is the whole point of the demo), section separators with `// ---` lines, kebab-case filename, named-export types and factory.
- Builder pattern:
  - `createTraceBuilder({ backend: "mcp" })` → `{ markLlmCall, markToolCall, markCapReached, finalize }`. Internal state holds `llmCalls: []`, `toolCalls: []`, `capReached: false`, `t0: performance.now()`.
  - `markLlmCall({ ms, usage })` pushes one `LlmCall` from Anthropic's `Usage` object — handles `cache_creation_input_tokens` / `cache_read_input_tokens` being `null` cleanly.
  - `markToolCall({ name, ms, isError })` pushes one `ToolCall`.
  - `finalize({ iterations })` computes `totalMs = performance.now() - t0` and returns the immutable `Trace`.
- In `tool-loop.ts`:
  - Build the trace at the top of `runMcpToolLoop`.
  - Wrap the `ai.messages.create({...})` call with `performance.now()` brackets; on success, call `builder.markLlmCall({ ms, usage: res.usage })`.
  - Wrap each `client.callTool({...})` inside the `Promise.all(toolUses.map(...))` with `performance.now()` brackets; record `markToolCall({ name: u.name, ms, isError: result.isError === true })`. Wrap in try/catch so the catch branch also calls `markToolCall` with `isError: true` and rethrows-or-returns the existing error-shaped tool_result.
  - On the early-return at `:119` (terminal text), call `return { answer: textOf(res.content), trace: builder.finalize({ iterations: i + 1 }) }`.
  - On the cap-reached path at `:168-169`, call `builder.markCapReached()` then `return { answer: "[Iteration cap reached ...]", trace: builder.finalize({ iterations: MAX_ITERATIONS }) }`.
- In `app/api/chat-mcp/route.ts`:
  - Update the destructure of `runMcpToolLoop`'s result.
  - The 500 error path still returns `{ error }` without a trace (the trace isn't fully built when the loop throws unexpectedly — adding partial-trace recovery here is out of scope; if the trace becomes useful for debugging route errors, add later).

**Patterns to follow:** Existing `lib/tool-loop.ts` `[tool-loop]` stderr logging — don't remove. Existing JSDoc header style (`lib/tool-loop.ts:1-17`). Existing route-handler shape (`app/api/chat-mcp/route.ts:19-50`).

**Test scenarios:**
- Happy path: POST `/api/chat-mcp` with "list all product categories" → response shape is `{ answer: string, trace: { backend: "mcp", totalMs: number > 0, iterations: 1 | 2, llmCalls: [{ inputTokens > 0, outputTokens > 0 }], toolCalls: [{ name: "execute_query", ms: number > 0, isError: false }], capReached: false } }`.
- Happy path: multi-tool question ("what columns does the orders table have, and how many rows does it have?") returns a trace with `toolCalls` length ≥ 2 and `iterations` ≥ 2.
- Edge case: question that fits in a single LLM response without any tool use returns `iterations: 1`, `llmCalls.length === 1`, `toolCalls.length === 0`.
- Error path: deliberately force an iteration-cap hit (ambiguous question that loops) — `capReached: true`, `iterations: 6`, answer string contains `[Iteration cap reached`.
- Error path: when a tool call errors (force by sending a malformed query that bypasses the SELECT-only check trick, or by killing the MCP child between requests), the corresponding `toolCalls` entry has `isError: true` and `ms > 0`; the loop continues per existing behaviour.
- Integration: stderr still shows the existing `[tool-loop]` log lines (regression check that instrumentation didn't replace the noticing-journal substrate).

Test expectation: manual via `curl` against the running dev server, eyeballing the JSON response. No automated tests — the existing codebase has none. Capture one sample response JSON in the comparison memo (U6).

**Verification:**
- A `curl -X POST http://localhost:3000/api/chat-mcp -H 'Content-Type: application/json' -d '{"question":"how many users do we have?"}'` returns a JSON object matching the Trace shape.
- `performance.now()` deltas in `llmCalls[].ms` sum to less than `totalMs` (sanity: per-call time is a subset of total).
- Existing `[tool-loop]` stderr lines still print in the dev console.

---

### U3. LangChain agent (`lib/langchain-agent.ts`) with `wrapModelCall` + `wrapToolCall` trace middleware

**Goal:** A module-level `getLangchainAgent()` factory that lazily builds a `createAgent`-based agent with three local `tool()` definitions (`list_tables`, `describe_table`, `execute_query`) calling `supabase.rpc('run_sql', ...)` directly via `lib/supabase.ts`'s `runSql()`. Trace capture lives in a single middleware object. Singleton'd on `globalThis.__langchainAgent` mirroring the MCP client pattern.

**Requirements:** R8, R12, partially R13.

**Dependencies:** U1 (deps installed, model id confirmed, recursionLimit ratio known), U2 (`Trace` type to populate).

**Files:**
- Create: `lib/langchain-agent.ts` — exports `getLangchainAgent()` returning the cached agent and `runLangchainTurn(question, traceBuilder)` returning `Promise<string>` (the agent's final text). Trace mutation happens via the middleware closure over `traceBuilder`; the function signature mirrors `runMcpToolLoop` for symmetry.
- Modify: `.env.local.example` — note that `NEXT_PUBLIC_BACKEND_MODE` now also accepts `compare` (deferred to U4 if cleaner there — pick at implementation time).

**Approach:**
- File header (JSDoc, matching existing style): explain *why* — `createAgent` is v1-canonical; middleware is the v1-canonical instrumentation surface; the agent is singleton'd to avoid graph-compilation cost showing up in the trace.
- Singleton on `globalThis.__langchainAgent`. Apply the failed-promise-clear pattern from `lib/mcp-client.ts:88-92` so a transient build failure (e.g., bad env at first request) doesn't permanently poison the cache.
- Three `tool()` definitions in the file:
  - `list_tables`: empty zod schema. Body calls `runSql("select table_name from information_schema.tables where table_schema='public'")`. Return the JSON-stringified rows array.
  - `describe_table`: `z.object({ table_name: z.string() })`. Body builds the SELECT against `information_schema.columns` parameterised by `table_name` (be careful: `run_sql` doesn't accept parameters, so build the SQL by escaping the table name — use the same approach the MCP server's `describe_table` already uses; reading `mcp-server/tools.ts` is the safer source than re-inventing). Return JSON-stringified columns.
  - `execute_query`: `z.object({ sql: z.string() })`. Body calls `runSql(input.sql)`. Returns JSON-stringified rows. The SELECT-only and semicolon-rejection enforcement happens at the database layer via the existing `public.run_sql` function — the tool body is mechanical.
- Agent build:
  ```
  createAgent({
    model: new ChatAnthropic({ model: "claude-sonnet-4-6", maxTokens: 1024 }),
    tools: [listTables, describeTable, executeQuery],
    systemPrompt: <copy from lib/tool-loop.ts:33-53 with minimal edits>,
    middleware: [traceMiddleware(traceBuilder)],
  });
  ```
- `traceMiddleware(traceBuilder)`:
  - Returned by a factory closure so the builder is captured per-request.
  - `wrapModelCall: async (request, handler) => { const t0 = performance.now(); const res = await handler(request); builder.markLlmCall({ ms: performance.now() - t0, usage: extractUsage(res) }); return res; }` where `extractUsage(aiMessage)` reads `aiMessage.usage_metadata` (with fall-back to `aiMessage.response_metadata?.usage` if `usage_metadata` is missing — per U1's spike findings; document the result in the comparison memo as one of the asymmetries if cache fields don't map cleanly).
  - `wrapToolCall: async (request, handler) => { const t0 = performance.now(); try { const res = await handler(request); builder.markToolCall({ name: request.toolCall.name, ms: performance.now() - t0, isError: false }); return res; } catch (e) { builder.markToolCall({ name: request.toolCall.name, ms: performance.now() - t0, isError: true }); throw e; } }`
- `runLangchainTurn(question, traceBuilder)`:
  - Gets the singleton (which is built with the middleware that closes over the passed builder — wait, this means the agent can't actually be singleton'd against a per-request builder).
  - **Reconsidered singleton design:** the agent itself (graph, model, tools) is built once; the middleware that captures timing must be supplied per-request because it closes over per-request state. LangChain v1 supports passing middleware via the agent constructor OR via `.invoke()` config. **Verify at U3 start whether `invoke({ messages: [...] }, { configurable: { middleware: [...] } })` is supported.** If not, the cleanest fallback is to keep the agent as a partial closure: build the model + tools once on `globalThis.__langchainParts`, and `createAgent({ ..., middleware: [traceMiddleware(builder)] })` per request from those parts. Graph compilation per request is the cost — measure at the spike whether it's negligible (< 5ms) or material (> 50ms). If material, document in the trace itself ("agent build: 30ms") to keep the comparison honest.
- Catch `GraphRecursionError` at the boundary: in `runLangchainTurn`, wrap `agent.invoke(...)` in try/catch; on `GraphRecursionError`, call `builder.markCapReached()` and return `"[Recursion limit reached]"` as the answer string. The route's `app/api/chat-langchain/route.ts` reuses the trace from the builder via the same pattern as `runMcpToolLoop`.

**Execution note:** Start U3 with a 30-min spike: build the agent with no instrumentation, invoke once with a single-tool question, then add middleware and confirm `wrapModelCall` / `wrapToolCall` fire as expected and the AIMessage's usage_metadata shape matches U1's spike output. Only then start wiring into `lib/trace.ts`'s builder.

**Patterns to follow:**
- `globalThis.__name` singleton with failed-promise-clear (`lib/mcp-client.ts:88-92`).
- Lazy env reading inside getters (`lib/tool-loop.ts:56-64`).
- JSDoc file header (`lib/tool-loop.ts:1-17`).
- Tool schemas mirroring the MCP server's tool definitions in `mcp-server/tools.ts` (read it; copy the SQL idioms so the two backends are answering with the exact same query shapes).
- `[langchain-agent]` stderr tagging for parity with `[tool-loop]`.

**Test scenarios:**
- Happy path: a scratch `tsx` invocation of `runLangchainTurn("list all product categories", builder)` returns a string answer and `builder.finalize(...)` produces a trace with `backend: "langchain"`, `llmCalls.length ≥ 1`, `toolCalls.length ≥ 1`, token counts non-zero.
- Happy path: multi-tool question populates `toolCalls.length ≥ 2`.
- Edge case: question that doesn't need tools returns `toolCalls.length === 0`, `llmCalls.length === 1`.
- Error path: malformed SQL passed through `execute_query` → `runSql` throws → middleware records `isError: true` for that tool call; the agent continues per its own error-handling, eventually surfacing an error message in the answer.
- Error path: force `GraphRecursionError` by setting `recursionLimit: 1` on a question that needs at least one tool call. Verify `capReached: true` on the trace.
- Integration with AE6: the answer for "top 5 products by revenue last month" against seeded data is functionally equivalent to the MCP path's answer (within LLM variance — same numbers, possibly different prose). Compare side-by-side; if numbers differ materially, the tool implementations diverged — investigate.
- Integration with U1 spike findings: cache token fields populate from `usage_metadata` if U1 confirmed they're there; otherwise from `response_metadata.usage`. The trace's `cacheReadTokens` / `cacheCreationTokens` are non-null when Anthropic returned them.

Test expectation: manual exercise via a scratch script or the eventual U4 route handler. No automated tests.

**Verification:**
- A POST against U4's route (once built) returns `{ answer, trace }` matching the Trace shape.
- The trace's `backend` field is `"langchain"`.
- Existing MCP route still works unchanged (U2 didn't break by U3).
- Singleton respawn behaviour: kill the dev server, restart, first request rebuilds the agent (or its parts), subsequent requests reuse.

---

### U4. New API route `app/api/chat-langchain/route.ts` returning `{ answer, trace }`

**Goal:** A Next.js route at `app/api/chat-langchain/route.ts` that mirrors `app/api/chat-mcp/route.ts` in shape — same POST body validation, same response shape (`{ answer, trace }` on success, `{ error }` on failure), same `runtime = "nodejs"`, same `dynamic = "force-dynamic"`. Delegates to U3's `runLangchainTurn`. End-to-end working: a `curl` against this route returns a LangChain-produced answer with a populated trace.

**Requirements:** R8, R9 (the route is what makes the toggle real), R12.

**Dependencies:** U3.

**Files:**
- Create: `app/api/chat-langchain/route.ts` — body mirrors `app/api/chat-mcp/route.ts:13-50`. Imports `runLangchainTurn` and `createTraceBuilder` from `lib/`. Catches errors (including `GraphRecursionError` — though that's already handled in U3's `runLangchainTurn`).
- Modify: `.env.local.example` — document `NEXT_PUBLIC_BACKEND_MODE=mcp|langchain|compare`. (If U3 modified this, no-op here.)

**Approach:**
- Verbatim shape match with `chat-mcp/route.ts`:
  - `export const runtime = "nodejs"`, `export const dynamic = "force-dynamic"`.
  - Hand-rolled body parsing (no zod).
  - Question validation: non-empty trimmed string or 400.
  - Try/catch around the loop call; 500 on unhandled error with the existing `console.error("[chat-langchain] error:", err)` shape.
- The `[chat-langchain]` log tag mirrors `[chat-mcp]`.
- In the handler:
  ```
  const builder = createTraceBuilder({ backend: "langchain" });
  const answer = await runLangchainTurn(question.trim(), builder);
  // iterations may be supplied by the wrapModelCall middleware count, set inside runLangchainTurn before finalize
  return NextResponse.json({ answer, trace: builder.finalize({ iterations: ??? }) });
  ```
- **Iteration count source for LangChain:** since `wrapModelCall` fires once per LLM call, the simplest path is to increment a counter inside the middleware closure and expose it via `builder.iterationCount` (or have the builder track it from `markLlmCall` calls). Pick the simpler shape — adding an `iterations` field that increments on each `markLlmCall` push and reading `builder.iterationCount` at finalize is one option. Update `lib/trace.ts`'s builder accordingly (this is a small extension to U2's design; if U2 didn't include it, fold the change into U3 since LangChain is what surfaces the need).

**Patterns to follow:**
- `app/api/chat-mcp/route.ts:13-50` — copy the structure, change the imports and log tag.

**Test scenarios:**
- Happy path: `curl -X POST http://localhost:3000/api/chat-langchain -H 'Content-Type: application/json' -d '{"question":"list all product categories"}'` returns `{ answer: string, trace: { backend: "langchain", totalMs > 0, iterations ≥ 1, llmCalls.length ≥ 1, toolCalls.length ≥ 1, capReached: false } }`.
- Happy path: multi-tool question matches the MCP route's multi-tool happy-path shape (AE6 prep — symmetric responses).
- Edge case: empty question → 400 with `{ error: "`question` is required (non-empty string)" }` (mirrors MCP route exactly).
- Edge case: malformed JSON body → 400 `{ error: "Invalid JSON body" }`.
- Error path: forcing `GraphRecursionError` → 200 with `capReached: true` and a partial trace (not a 500; the cap is a normal outcome, not a failure).
- Integration: AE8 — setting `NEXT_PUBLIC_BACKEND_MODE=langchain` and refreshing the page (U5 wires this) hits this route end-to-end via the UI.

Test expectation: manual via `curl` first, then via the UI once U5 lands.

**Verification:**
- The route returns 200 on a valid question and 400 on the documented bad inputs.
- The response shape is identical to the MCP route's response shape — `JSON.stringify(mcp.trace)` and `JSON.stringify(lc.trace)` are structurally identical (same field names, same types) even when values differ.
- The MCP route remains unchanged in behaviour.

---

### U5. Compare Mode in `components/Chat.tsx` + new `components/TracePanel.tsx`

**Goal:** The chat UI renders one of three layouts based on `NEXT_PUBLIC_BACKEND_MODE`:
- `mcp` (default) → existing threaded chat against `/api/chat-mcp`, now with a small trace footer per assistant message.
- `langchain` → existing threaded chat against `/api/chat-langchain`, same trace footer per assistant message.
- `compare` → single-shot Q→2A pairs. Each question fires both routes in parallel via `Promise.allSettled`; renders one comparison block with two columns (MCP left, LangChain right); each column shows the answer + a TracePanel summary; clicking the summary expands per-LLM-call + per-tool-call detail. History accumulates as a list of comparison blocks.

The component handles partial failure (one backend errors, the other succeeds), shows the same error chip shape that exists today inside the failing column, and disables the input only while at least one request is in flight.

**Requirements:** R13, R14, R15. Also AE6, AE7, AE8.

**Dependencies:** U2 (chat-mcp returns trace), U4 (chat-langchain returns trace).

**Files:**
- Modify: `components/Chat.tsx` — extend `endpointForMode` to return `null` for `compare` (signalling the parallel path). Add new state: `compareBlocks: CompareBlock[]` where `CompareBlock = { question, mcp: { status: "pending" | "ok" | "error", answer?: string, trace?: Trace, error?: string }, langchain: {...} }`. In `onSubmit`, branch: when mode is `compare`, fire both endpoints with `Promise.allSettled` and push a comparison block; otherwise existing threaded behaviour.
- Create: `components/TracePanel.tsx` — `"use client"`; props: `{ trace: Trace, isExpanded: boolean, onToggle: () => void }`. Renders the summary row (totalMs, iterations, tools, total tokens summed across calls) and, when expanded, a `<details>`-style block listing per-LLM-call rows and per-tool-call rows. Uses existing Tailwind tokens; no new component library.
- Optional modify: `app/layout.tsx` or `app/page.tsx` — only if the layout needs widening for Compare Mode side-by-side. Existing `max-w-3xl` constraint (`Chat.tsx:160`) is probably too narrow for two columns; widen the comparison view to `max-w-6xl` or use full width when mode is `compare`.

**Approach:**
- Mode resolution at top of component:
  ```
  const mode = (process.env.NEXT_PUBLIC_BACKEND_MODE ?? "mcp") as "mcp" | "langchain" | "compare";
  ```
  Branch the entire JSX on `mode === "compare"`. Don't try to make one layout do both — the data shapes diverge (`Message[]` vs `CompareBlock[]`) and conditional rendering will tangle.
- Compare layout:
  - Container is wider (`max-w-6xl` or full screen) than the threaded chat (`max-w-3xl`).
  - Each comparison block is a `flex flex-col gap-3`: question on top (full width), then two columns underneath (`grid grid-cols-2 gap-4`).
  - Each column has the existing border/surface tokens. Header row: backend name ("MCP" / "LangChain") + TracePanel summary. Body: the answer rendered with the existing `ReactMarkdown` setup. Bottom: optional error chip if `status === "error"`.
  - While in flight (`status === "pending"`), the column shows a `thinking…` placeholder identical to today's loading state.
  - `Promise.allSettled` semantics: each backend's promise resolves to `{ status: "ok", answer, trace }` or `{ status: "error", error }`. Push the block immediately with both statuses `"pending"`, update each side independently as its promise settles. Use functional `setState` to avoid races between the two completions.
- TracePanel summary format (one row, compact):
  - `{totalMs}ms · {iterations} iter · {toolCalls.length} tools · {totalInputTokens} in / {totalOutputTokens} out`
  - Click to expand.
- TracePanel detail (expanded):
  - LLM calls section: ordered list, each row `LLM call N: {ms}ms (in: {inputTokens}, out: {outputTokens}, cache_read: {cacheReadTokens ?? "-"}, cache_creation: {cacheCreationTokens ?? "-"})`.
  - Tool calls section: ordered list, each row `tool: {name} — {ms}ms{isError ? " (error)" : ""}`.
  - Use monospace (`font-mono text-xs`) for the detail block to evoke a debug-trace look.
- Input is disabled while *any* in-flight request exists. `loading` becomes `inFlightCount > 0` — track per-block.
- Single-backend modes (`mcp`, `langchain`) keep the existing threaded chat. Add a small per-message trace footer (collapsed by default): once the assistant message lands, render a tiny `{totalMs}ms · {iterations} iter` line under the bubble. Click to expand into the full TracePanel detail.
- Backwards compatibility: when mode is `mcp` or `langchain` and the response unexpectedly lacks `trace` (e.g., older client cache during dev), fall back to today's no-footer behaviour gracefully — don't error.

**Patterns to follow:**
- Existing `Chat.tsx` ReactMarkdown setup + Tailwind token usage. The dark-mode-by-default colors (`--color-background: #0a0a0a`, etc.) carry across.
- Functional `setState((m) => ...)` updates already used at `Chat.tsx:125, 138, 146, 153` — Compare Mode adds more of the same.
- Use the existing `flex` + `gap` Tailwind primitives; do not pull in a grid library.

**Test scenarios:**
- Happy path (single-backend `mcp`): existing threaded chat behaviour unchanged. Type a question, see assistant message appear, see a small trace footer ("3.2s · 2 iter") under the bubble; clicking expands to per-LLM-call + per-tool-call detail.
- Happy path (single-backend `langchain`): same as above but pointing at `/api/chat-langchain`.
- Happy path (`compare`): type a question, see comparison block appear with both sides in `thinking…` state; both columns settle independently (faster backend renders first); each side shows answer + trace summary; clicking each side's summary expands its own detail block independently.
- Edge case (`compare`): pressing Enter while a previous comparison is still in flight is a no-op (input disabled).
- Edge case (`compare`): empty question is a no-op (input doesn't fire — matches existing single-backend behaviour).
- Error path (`compare`): force MCP backend to 500 (e.g., kill the MCP child process). LangChain side completes normally and shows answer + trace; MCP side shows the error chip with the message and no trace.
- Error path (`compare`): both backends error simultaneously. Both columns show their respective error chips. Input re-enables.
- Error path (`compare`): one backend is slow (e.g., LangChain takes 8s, MCP completes in 2s). MCP column renders fully while LangChain column still shows `thinking…`. No state corruption.
- Integration AE6: "top 5 products by revenue last month" in compare mode shows both panels with non-zero tokens, ≥1 execute_query tool call each, total ms visible on each.
- Integration AE7: kill the MCP server child; ask a question in compare mode; LangChain panel still renders; MCP panel shows the error.
- Integration AE8: changing `NEXT_PUBLIC_BACKEND_MODE` in `.env.local` from `mcp` → `compare` → `langchain` and refreshing changes which layout renders. Zero edits to `Chat.tsx` between these toggles.

Test expectation: manual exercise in the browser is the primary verification. No automated component tests at this scope (matches predecessor plan's U5 stance).

**Verification:**
- Set `NEXT_PUBLIC_BACKEND_MODE=compare` in `.env.local`, restart `pnpm dev`, ask "how many users do we have?" — both panels render with answers and trace summaries within ~10s.
- Each trace summary expands to show per-LLM-call rows and per-tool-call rows that match what the network panel shows for that request.
- Killing one backend (e.g., `pkill -f mcp-server`) and asking another question shows the partial-failure UX cleanly.
- The two existing single-backend modes still work — `Chat.tsx`'s threaded chat is intact.

---

### U6. Stage-2 comparison memo with lived data

**Goal:** A markdown file at `docs/notes/stage-2-comparison.md` summarising the actual differences between MCP and LangChain backends as observed via the Compare Mode runs. Frames the differences across code volume (LOC diff), discoverability (`tools/list` vs hard-coded `tools` array), error-handling shape, second-client portability, and now performance (trace measurements aggregated across at least 10 paired compare runs). Fulfills R11 and AE5; the new R12+R13+R15 instrumentation makes the performance section concrete rather than extrapolated.

**Requirements:** R11, AE5.

**Dependencies:** U5 (need Compare Mode working so paired traces can be captured).

**Files:**
- Create: `docs/notes/stage-2-comparison.md`.

**Approach:**
- Required sections (mostly carried from the predecessor plan's U8 with the performance section added):
  - **What I built and how** — single paragraph; honest framing.
  - **Code volume diff** — rough LOC count for `mcp-server/` + `lib/mcp-client.ts` + `lib/tool-loop.ts` vs `lib/langchain-agent.ts` (instrumentation excluded; both have it). Pure agent shape only.
  - **Discoverability** — what `tools/list` gave the MCP path that the LangChain path had to hard-code at the agent definition site.
  - **Error-handling shape** — how a tool error surfaced in each path. MCP wraps in `isError: true` content; LangChain wraps via thrown exceptions caught in middleware.
  - **Vendor portability** — what would change if Claude Desktop, Cursor, or a future agent wanted to use these same tools.
  - **Performance — lived measurements.** Pick 10 paired questions of varied complexity (single-tool, multi-tool, no-tool, multi-iteration). For each: MCP totalMs, LangChain totalMs, MCP iterations, LangChain iterations, MCP tokens (in+out), LangChain tokens (in+out). Compute averages and median. Call out where one backend is systematically faster/slower and the likely cause (graph-step overhead in LangChain; MCP child-process JSON-RPC round-trip latency; LangChain agent-build cost if it landed in the trace; etc.). Frame conclusions cautiously — N=10 is small; don't claim p-values.
  - **Was it faster?** — direct answer to the interview question. With evidence.
  - **What I'd say in the interview** — 3 specific MCP affordances I noticed I was relying on, with the trade-off cost of giving each up.
- Keep it under 700 words (slightly longer than predecessor's 500-word target because the performance section adds content). The interview value is in specificity, not volume.
- Capture the raw 10-pair data inline as a small markdown table — that's the receipts an interviewer would want to see.

**Patterns to follow:** None. Write-up artifact. Mirror the section structure of the predecessor plan's U8 description.

**Test scenarios:**

Test expectation: none — this is documentation, not feature code.

**Verification:**
- The memo names at least 3 specific MCP affordances the LangChain version did not preserve, with concrete examples drawn from compare runs.
- The performance section contains a table of ≥10 paired measurements with `totalMs` for each backend.
- The "Was it faster?" section answers the question with a number, not a vibe ("LangChain was ~12% faster on average across N=10 questions, driven mostly by skipping the MCP stdio round-trip; the gap shrank to near-zero on multi-tool questions where LLM time dominated.").
- A reader picking up the memo cold a week later can reproduce the interview talking points without re-reading the brainstorm.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| LangChain v1 middleware semantics differ from research findings (e.g., `wrapModelCall` doesn't fire as expected, or `usage_metadata` is missing fields). | U1 spike-verifies all three open questions (install cleanliness, `usage_metadata` shape, `recursionLimit` ratio) before U3 commits any code. If middleware misbehaves, fall back to `BaseCallbackHandler` and document the divergence in the comparison memo as an unexpected friction point. |
| `createAgent` can't be cleanly singleton'd because middleware closes over per-request state. | U3 explicitly addresses this — if middleware-on-invoke isn't supported, cache the model + tools on `globalThis.__langchainParts` and build the agent per-request. Measure the build cost; if it's < 5ms it's noise; if material, include it in the trace as an "agent build" pseudo-call so the comparison stays honest. |
| `Trace` shape divergence between backends (e.g., LangChain doesn't surface cache token fields). | Plan acknowledges this in Open Questions and Key Technical Decisions. Cache fields are nullable in the Trace type; the UI handles `null`. The asymmetry becomes a memo bullet point, not a blocker. |
| Compare Mode partial-failure edge cases (one backend hangs indefinitely). | `Promise.allSettled` doesn't have a built-in timeout. Add a per-request timeout in the UI (`AbortController` with a 30s wall clock) so a hung backend doesn't lock the input forever. Surface the timeout as an error chip in that backend's column. Defer if time is tight — degrade to "user refreshes the page" in worst case. |
| Anthropic API rate limits during back-to-back compare runs (2 calls per question now). | Out of scope to engineer around. If rate-limited, the failing backend shows the 429 error in its column; the user retries. Document if it hits during interview demo. |
| Iteration cap mapping in LangChain (`recursionLimit`) caps at the wrong number of LLM calls. | U1 spike empirically settles this. If the ratio is unexpected, adjust `recursionLimit` to match the 6-iter MCP cap as closely as possible and document the discrepancy in the comparison memo. |
| MCP `chat-mcp` route response shape change breaks any cached UI in dev. | Single caller (`Chat.tsx`); changes together with U2. The `force-dynamic` directive already prevents Next caching. Hard reload after deploy. No external consumers exist. |
| Singleton respawn races on first request after HMR. | Mirror `lib/mcp-client.ts:88-92` failed-promise-clear pattern in `lib/langchain-agent.ts`. Already a Key Technical Decision. |
| The trace's `totalMs` includes time spent JSON-encoding the response, biasing the comparison slightly. | Acceptable — both backends pay the same cost. Document in the memo as a known measurement noise floor (~ms). |
| The hand-rolled trace builder accumulates state that survives across awaits incorrectly (e.g., parallel tool calls within one MCP iteration push out-of-order entries). | `Promise.all(toolUses.map(...))` in `lib/tool-loop.ts:122` already runs tool calls in parallel; `markToolCall` ordering is by completion time, not by request. That's correct for trace measurement (the column shows actual concurrent timing) but the implementer should know this is what the data shows. |

---

## Sources & References

- **Origin document:** `docs/brainstorms/mcp-langchain-rebuild-prep-requirements.md`
- **Predecessor plan:** `docs/plans/2026-05-27-001-feat-mcp-langchain-rebuild-prep-plan.md` (status: completed)
- LangChain v1 migration guide (JS): `https://docs.langchain.com/oss/javascript/migrate/langchain-v1`
- LangChain v1 release notes (JS): `https://docs.langchain.com/oss/javascript/releases/langchain-v1`
- `createAgent` reference: `https://reference.langchain.com/javascript/langchain/index/createAgent`
- LangChain middleware overview: `https://docs.langchain.com/oss/javascript/langchain/middleware`
- AgentMiddleware interface reference: `https://reference.langchain.com/javascript/interfaces/langchain.index.AgentMiddleware.html`
- ChatAnthropic integration docs: `https://docs.langchain.com/oss/javascript/integrations/chat/anthropic`
- Anthropic model IDs and versioning: `https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions`
- Anthropic SDK TS Messages API: `https://deepwiki.com/anthropics/anthropic-sdk-typescript/3.2-messages-api`
- LangGraph JS `recursionLimit` discussion: `https://forum.langchain.com/t/how-to-set-recursion-limit-for-create-agent-v1/1905`
- `langgraphjs` issue #1524 (recursionLimit positional arg): `https://github.com/langchain-ai/langgraphjs/issues/1524`

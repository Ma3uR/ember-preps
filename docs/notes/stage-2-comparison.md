# Stage-2 comparison — MCP vs LangChain.js v1

## Bottom line

For a single-app deployment of this kind (one consumer, one team, one
deploy target), **LangChain v1 is the better default**. Half the code,
no extra process to manage, real stack traces on tool errors, type-safe
tool handlers. The cost: you give up the second-host portability that
makes MCP architecturally interesting in the first place. For a multi-
consumer tool surface (Claude Desktop + Cursor + your app), MCP is the
better default. The two are *answering different questions*.

Perf is a wash at this workload — LLM-call latency dominates everything
else, and the architectural overhead doesn't show up in the trace. The
runtime "is LangChain faster?" question is the wrong question; the
interesting comparison is on the structural axes below.

## What I built

Two backends, same database, same model, same three tools (`list_tables`,
`describe_table`, `execute_query`). Stage 1 routes through an MCP child
process and a hand-rolled Anthropic tool-use loop (`lib/tool-loop.ts`).
Stage 2 wires the tools straight into a LangChain v1 `createAgent`
(`lib/langchain-agent.ts`), reusing the same `runSql` /
`runReadonlyQuery` helpers. Both endpoints return `{ answer, trace }`;
the UI's Compare Mode fires them in parallel and renders side-by-side
so the trace diff is visible on screen.

## Where LangChain wins

**1. Code volume — roughly half.** Pure agent shape, instrumentation
excluded:

| Path | Files | LOC |
|------|-------|-----|
| MCP | server entry + server tools + mcp-client + tool-loop | ~458 |
| LangChain | `lib/langchain-agent.ts` | ~250 |

The LangChain delta isn't in the tools (those are line-for-line
equivalent — both use zod schemas and the same `runSql` calls). It's the
~200 LOC of *process plumbing* the MCP path forces: stdio framing, the
host singleton with HMR-safe failed-promise-clear, the env passthrough
to the child, the SIGINT/SIGTERM cleanup wiring. None of that exists in
the LangChain path because it's all in-process.

**2. One deployment artifact, not two.** The MCP path needs both
`pnpm dev` AND a child `tsx mcp-server/index.ts` process spawned per
host. The child has its own pg pool, its own heap, its own crash domain.
LangChain runs in the Next.js server's existing isolate — no extra
process, no extra pool, no extra thing to monitor in production.

**3. Real stack traces on tool errors.** LangChain tool errors come up
the call stack with file:line provenance — you see exactly which line
of `runSql` threw. MCP tool errors arrive as `{ isError: true, content:
[{ type: "text", text: "Error: ..." }] }` — the original stack trace
died inside the child process; the host sees only the stringified
message. When a query fails, "constraint violation at supabase.ts:84"
beats `"Error: constraint violation"` for debugging speed.

**4. Type-safe tool handlers, end-to-end.** The LangChain `tool()` call
infers the handler's args type from the zod schema, so `{ table_name }`
is a typed string inside the body. The MCP host (`lib/tool-loop.ts:130`)
has to cast `u.input as Record<string, unknown>` because it came over
the wire — the type contract dies at the JSON-RPC boundary even though
both sides know the schema. Small thing, real every-day cost.

## Where MCP wins (and why I'd pick it back)

**1. Process-boundary isolation.** MCP child crash doesn't take down
Next.js — `lib/mcp-client.ts:88-92` clears the cached promise and the
next request respawns. The LangChain agent shares an isolate with the
route; a top-level throw inside a tool propagates straight up the stack.
For a tool that touches a flaky external API, that matters.

**2. Runtime tool discovery.** Add a fourth tool to
`mcp-server/tools.ts` and the host picks it up on the next request via
`tools/list` — no agent change. The LangChain path requires editing the
`tools: [...]` array at the `createAgent` site.

**3. Host-agnostic transport.** Point Claude Desktop at
`mcp-server/index.ts` and it works. Cursor too. Any MCP host. The
LangChain agent only runs inside this Next.js app — a second consumer
means a rewrite.

Any one of these is enough to flip the decision. Two consumers wanting
the same SQL tools? MCP. Tools that crash often and you want process
isolation? MCP. Want a published tool surface that other people's agents
can use? MCP.

## Performance — receipts for the "perf is a wash" claim

10 paired questions via `scripts/compare-bench.ts` (raw table in
`scripts/compare-bench.ts` output; aggregates here):

- **Median totalMs:** MCP 6022 · LC 5387 — within noise.
- **Mean excluding one Anthropic API spike (Q9: 36s MCP / 5.4s LC, same
  iter, same tool, same tokens — variance is in the provider, not the
  agent):** MCP 6184 · LC 6515 — sign flipped, still within noise.
- **Input tokens, iterations, tool sequence:** identical on every
  question. Same model, same prompt, same trajectory.

LLM call latency (1.5–8s per call) is 50–100× larger than per-tool-call
stdio cost (~40–80ms), so the architectural overhead never surfaces.
At workloads with 10+ tool calls per question the MCP boundary would
start to show; at chat-with-DB density it does not.

## What I'd say in the interview

> *"They're answering different questions. LangChain v1 gave me half the
> code, one deployment artifact, real stack traces, and type-safe tool
> args — and that's what matters when one app owns one tool surface.
> MCP gave up zero of those gracefully and added process isolation,
> runtime discovery, and host portability — and that's what matters
> the moment a second consumer wants the same tools. Perf was a wash at
> this scale; the LLM call dwarfs everything else. The dimensions worth
> arguing about aren't milliseconds, they're the operational cost of
> the extra moving part vs the option value of swapping hosts."*

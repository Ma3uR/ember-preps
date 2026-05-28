# Stage-2 comparison — MCP vs LangChain.js v1

## What I built

Two backends, same database, same model, same three tools (`list_tables`,
`describe_table`, `execute_query`). Stage 1 routes through an MCP child
process and a hand-rolled Anthropic tool-use loop (`lib/tool-loop.ts`).
Stage 2 wires the tools straight into a LangChain v1 `createAgent`
(`lib/langchain-agent.ts`), reusing the same `runSql` / `runReadonlyQuery`
helpers. Both endpoints return `{ answer, trace }`; the UI's Compare Mode
fires them in parallel and renders side-by-side.

## Code volume

Pure agent shape, instrumentation excluded:

| Path | Files | LOC |
|------|-------|-----|
| MCP | server/index + server/tools + mcp-client + tool-loop | ~458 |
| LangChain | `lib/langchain-agent.ts` | ~250 |

LangChain is roughly half the lines, but most of MCP's overhead is the
**process boundary**: server entry, stdio framing, host singleton,
discovery RPC. The tools doing the work are equivalent line-for-line.

## Discoverability

MCP gives `tools/list` at runtime — the host asks the server what tools
exist. LangChain hard-codes the tool array at the `createAgent` call site.
Adding a tool: server-side file edit (auto-discovered) vs agent-side file
edit (requires the agent rebuild). Matters little for one app; matters a
lot the moment a second consumer wants the same tools.

## Error-handling shape

MCP tool errors come back as `{ isError: true, content: [{ type: "text",
text: "Error: …" }] }` — error is a first-class data type. The host
loop reads `isError` and pushes it into the next user turn. LangChain
tool errors are **thrown exceptions**: middleware records them, the
agent's internal handling surfaces messages into the model. Both
converge in behaviour, but the shape difference matters for tracing —
MCP's error is in the message stream; LangChain's lives in the stack.

## Vendor portability

MCP server is a process; any host (Claude Desktop, Cursor, custom Python
harness) can spawn it. LangChain agent is a TypeScript module bound to
the Next.js chat route. The SQL is portable; the agent isn't.

## Performance — lived measurements

10 paired questions, sequential per backend, via `scripts/compare-bench.ts`:

| # | Question | MCP ms | LC ms | iter (both) | Tools |
|---|----------|-------:|------:|:-----------:|-------|
| 1 | What can you answer? | 8769 | 10338 | 1 | — |
| 2 | How many users? | 3597 | 5378 | 2 | execute_query |
| 3 | Avg items/order? | 4494 | 4670 | 2 | execute_query |
| 4 | Orders per status? | 5423 | 5071 | 2 | execute_query |
| 5 | Top 5 products last 30d? | 7769 | 13598 | 2 | execute_query |
| 6 | Columns + count of events? | 6622 | 6270 | 2 | describe + execute |
| 7 | Signups last 90d? | 4187 | 4387 | 2 | execute_query |
| 8 | Top category by revenue? | 4578 | 5217 | 2 | execute_query |
| 9 | User with most orders? | **36403** | 5396 | 2 | execute_query |
| 10 | List tables + count largest? | 10213 | 9700 | 3 | list + execute |

Aggregates (totalMs):

- **Mean, all 10:** MCP 9206 · LC 7003 → LC ~24% faster — but Q9's 36s
  MCP outlier (same iter, same tool, identical token counts as LC) is an
  Anthropic API latency spike, not the architecture.
- **Mean excluding Q9 (N=9):** MCP 6184 · LC 6515 → LC ~5% **slower**.
- **Median:** MCP 6022 · LC 5387 → LC ~11% faster.
- **Input tokens:** identical (2526 avg both). The model sees the same
  context. **Output tokens:** MCP 237 · LC 240. **Iterations & tool
  sequence:** identical on every question (Q6 differs only in tool order
  within the iteration).

## Was it faster?

**No, not meaningfully.** End-to-end wall time is dominated by the
Anthropic API: per-LLM-call latencies of 1.5–8s in the trace dwarf the
architectural overhead (MCP stdio round-trip ~50–80ms per tool call vs
in-process function call ~5–10ms). Q9 is the smoking gun — same model
trajectory, 7× spread in totalMs. The variance is in the provider, not
in the agent. At higher tool-call density (10+ round-trips per question),
the MCP boundary cost would start to show; at this regime it's noise.

## Three things MCP gave me that LangChain didn't preserve

1. **Process-boundary isolation.** MCP child crash doesn't take down
   Next.js — `lib/mcp-client.ts:88-92` clears the cached promise and the
   next request respawns. The LangChain agent shares an isolate with the
   route; a top-level throw propagates up the stack.
2. **Runtime tool discovery.** Add a fourth tool to `mcp-server/tools.ts`
   and the host picks it up on the next request — no agent change. The
   LangChain path requires editing the `tools: […]` array.
3. **Host-agnostic transport.** I can point Claude Desktop at
   `mcp-server/index.ts` directly. The LangChain agent only lives inside
   this Next.js app — any second consumer means a port.

These are the trade-offs of choosing LangChain v1: less code, in-process
speed, one less moving part — at the cost of those three affordances.
Worth it for one app. Worth revisiting the moment a second consumer
wants the same tools.

# Stage 1 — Noticing Journal

> Maintained while building U2 → U5. The substrate for the stage-2 comparison
> memo (U8) and for the interview talking points the brainstorm was designed
> to produce. Quality over volume — one specific, demonstrative entry beats
> five vague ones. Aim for ≥1 entry per implementation unit, ≥8–10 total by
> the end of U5.

---

## MCP primitives I touched

One bullet per primitive — Tools, Resources, Prompts, Sampling, Roots,
Elicitation, Tasks — that I actually exercised (not just read about).

- _TODO: e.g._ Tools — registered three with `server.registerTool`,
  inputSchema is a zod object wrapped in z.object() (not a raw shape like
  the deprecated `server.tool` API took)
- _TODO: ..._

## JSON-RPC envelopes that surprised me

Anything about the wire format that wasn't obvious from reading the spec —
things you only see once you run `@modelcontextprotocol/inspector` against
your server and watch the actual messages.

- _TODO: ..._

## Tool-schema translation

What the MCP `inputSchema` → Anthropic `input_schema` rename did and didn't
carry. Anything zod-specific that didn't survive the JSON Schema round-trip.

- _TODO: ..._

## Discovery moments

Every time `tools/list` (or `resources/list`, etc.) saved a hard-coded
translation step that the LangChain rebuild would have to put back.

- _TODO: ..._

## Errors and pitfalls

Stdout pollution, child-process death, HMR orphans, anything else that bit.
What was the symptom? What was the actual cause?

- _TODO: ..._

## What I'd lose if I removed MCP

Running list to feed U8 — every "the MCP path did X for me automatically"
moment that the LangChain path would force me to do by hand.

- _TODO: ..._

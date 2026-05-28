/**
 * Run the same N questions against both /api/chat-mcp and /api/chat-langchain
 * and emit a markdown table of paired traces. Reads the dev server at
 * http://localhost:3000 by default.
 *
 *   tsx scripts/compare-bench.ts
 *   tsx scripts/compare-bench.ts > docs/notes/stage-2-bench.txt
 *
 * Used to back the lived-measurement section of docs/notes/stage-2-comparison.md.
 */

type Trace = {
  backend: "mcp" | "langchain";
  totalMs: number;
  iterations: number;
  llmCalls: { ms: number; inputTokens: number; outputTokens: number }[];
  toolCalls: { name: string; ms: number; isError: boolean }[];
  capReached: boolean;
};

type Outcome =
  | { status: "ok"; answer: string; trace: Trace }
  | { status: "error"; error: string };

const HOST = process.env.BENCH_HOST ?? "http://localhost:3000";

const QUESTIONS: string[] = [
  // q1: no-tool conversational
  "What kinds of questions can you answer?",
  // q2: single-tool simple count
  "How many users do we have?",
  // q3: single-tool aggregation
  "What is the average number of items per order?",
  // q4: single-tool group-by
  "How many orders are in each status?",
  // q5: single-tool top-N with date filter (the original "demo" question)
  "Top 5 products by revenue in the last 30 days?",
  // q6: multi-tool (describe + execute)
  "What columns are in the events table, and how many events are there in total?",
  // q7: multi-tool with conditional
  "How many users signed up in the last 90 days?",
  // q8: cross-table join
  "Which product category has the highest total revenue?",
  // q9: ranking question
  "Which user has placed the most orders?",
  // q10: list + describe + execute (likely 3 tool calls)
  "List the tables, then count rows in the largest-looking one.",
];

async function fetchOne(
  endpoint: string,
  question: string
): Promise<Outcome> {
  const res = await fetch(`${HOST}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const data = (await res.json()) as {
    answer?: string;
    trace?: Trace;
    error?: string;
  };
  if (!res.ok || data.error || !data.trace || !data.answer) {
    return { status: "error", error: data.error ?? `HTTP ${res.status}` };
  }
  return { status: "ok", answer: data.answer, trace: data.trace };
}

function sumTokens(trace: Trace): { input: number; output: number } {
  return trace.llmCalls.reduce(
    (s, c) => ({ input: s.input + c.inputTokens, output: s.output + c.outputTokens }),
    { input: 0, output: 0 }
  );
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function describe(outcome: Outcome): string {
  if (outcome.status === "error") return `ERROR: ${outcome.error}`;
  const tokens = sumTokens(outcome.trace);
  const tools = outcome.trace.toolCalls.map((t) => t.name).join(",") || "-";
  return `${fmtMs(outcome.trace.totalMs)} · iter:${outcome.trace.iterations} · tools:[${tools}] · tok:${tokens.input}/${tokens.output}`;
}

async function main() {
  const rows: {
    q: string;
    mcp: Outcome;
    lc: Outcome;
  }[] = [];

  for (const [i, q] of QUESTIONS.entries()) {
    console.error(`[${i + 1}/${QUESTIONS.length}] ${q}`);
    // Sequential per backend to keep the load fair (no shared concurrent
    // contention on the LLM or MCP child); two backends run sequentially.
    const mcp = await fetchOne("/api/chat-mcp", q);
    const lc = await fetchOne("/api/chat-langchain", q);
    rows.push({ q, mcp, lc });
    console.error(`    mcp:  ${describe(mcp)}`);
    console.error(`    lc:   ${describe(lc)}`);
  }

  // Markdown table for pasting into the memo.
  console.log("\n## Raw paired measurements (N=10)\n");
  console.log(
    "| # | Question | MCP totalMs | LC totalMs | MCP iter | LC iter | MCP tools | LC tools | MCP tok in/out | LC tok in/out |"
  );
  console.log(
    "|---|----------|-------------|------------|----------|---------|-----------|----------|----------------|---------------|"
  );

  let mcpSumMs = 0;
  let lcSumMs = 0;
  let mcpSumTokIn = 0;
  let lcSumTokIn = 0;
  let mcpSumTokOut = 0;
  let lcSumTokOut = 0;
  let okPairs = 0;

  rows.forEach((r, i) => {
    const mcpOk = r.mcp.status === "ok";
    const lcOk = r.lc.status === "ok";
    const mcpMs = mcpOk ? Math.round(r.mcp.trace.totalMs) : NaN;
    const lcMs = lcOk ? Math.round(r.lc.trace.totalMs) : NaN;
    const mcpIter = mcpOk ? r.mcp.trace.iterations : "—";
    const lcIter = lcOk ? r.lc.trace.iterations : "—";
    const mcpTools = mcpOk
      ? r.mcp.trace.toolCalls.map((t) => t.name).join(",") || "—"
      : "—";
    const lcTools = lcOk
      ? r.lc.trace.toolCalls.map((t) => t.name).join(",") || "—"
      : "—";
    const mcpTok = mcpOk ? sumTokens(r.mcp.trace) : { input: NaN, output: NaN };
    const lcTok = lcOk ? sumTokens(r.lc.trace) : { input: NaN, output: NaN };

    if (mcpOk && lcOk) {
      mcpSumMs += mcpMs;
      lcSumMs += lcMs;
      mcpSumTokIn += mcpTok.input;
      lcSumTokIn += lcTok.input;
      mcpSumTokOut += mcpTok.output;
      lcSumTokOut += lcTok.output;
      okPairs += 1;
    }

    console.log(
      `| ${i + 1} | ${r.q} | ${isFinite(mcpMs) ? mcpMs : "ERR"} | ${isFinite(lcMs) ? lcMs : "ERR"} | ${mcpIter} | ${lcIter} | ${mcpTools} | ${lcTools} | ${mcpTok.input}/${mcpTok.output} | ${lcTok.input}/${lcTok.output} |`
    );
  });

  if (okPairs > 0) {
    console.log("\n## Averages over fully-paired runs\n");
    console.log(`- okPairs: ${okPairs} of ${rows.length}`);
    console.log(`- avg totalMs: MCP ${Math.round(mcpSumMs / okPairs)} · LC ${Math.round(lcSumMs / okPairs)}`);
    console.log(`- avg input tokens: MCP ${Math.round(mcpSumTokIn / okPairs)} · LC ${Math.round(lcSumTokIn / okPairs)}`);
    console.log(`- avg output tokens: MCP ${Math.round(mcpSumTokOut / okPairs)} · LC ${Math.round(lcSumTokOut / okPairs)}`);
    const delta = ((lcSumMs - mcpSumMs) / mcpSumMs) * 100;
    console.log(`- LC vs MCP totalMs delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% (positive = LC slower)`);
  }
}

main().catch((err) => {
  console.error("bench failed:", err);
  process.exit(1);
});

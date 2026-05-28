/**
 * LangChain v1 rebuild of the MCP-side tool loop.
 *
 * Three native `tool()` definitions wired into `createAgent` from the
 * `langchain` umbrella package. The same `runSql` / `runReadonlyQuery`
 * helpers (`lib/supabase.ts`) the MCP server uses — no third DB path. The
 * tools' SQL idioms mirror `mcp-server/tools.ts` deliberately so both
 * backends answer questions against the exact same shapes; that's what
 * makes the Compare Mode diff meaningful (U5).
 *
 * Instrumentation uses LangChain v1's middleware system — `wrapModelCall`
 * for per-LLM-call timing + tokens, `wrapToolCall` for per-tool timing.
 * (BaseCallbackHandler still works but is the legacy path; the new
 * middleware surface gives symmetric measurement points to the hand-rolled
 * MCP loop's instrumentation in `lib/tool-loop.ts`.)
 *
 * The middleware closes over a per-request TraceBuilder. createAgent fixes
 * the middleware list at construction time, so the model + tools + prompt
 * are cached as `__langchainParts` on globalThis (HMR-safe singleton, same
 * pattern as `__mcp` in `lib/mcp-client.ts`) but the agent itself is built
 * per request. Graph compilation cost is sub-millisecond in practice.
 *
 * `recursionLimit: 12` mirrors the MCP loop's 6-iteration cap. The spike
 * confirmed one model+tool round-trip costs ~2 graph steps, so 12 steps
 * ≈ 6 LLM-call iterations. On `GraphRecursionError`, the boundary catches
 * and records `capReached: true` on the trace.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";
import { runReadonlyQuery, runSql } from "./supabase";
import type { TraceBuilder } from "./trace";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;
const RECURSION_LIMIT = 12;

const SYSTEM_PROMPT = `
You answer analytical questions about an e-commerce database by calling tools.

The database has these tables in the public schema:
  - users(id, email, signup_date)
  - products(id, name, category, unit_price)
  - orders(id, user_id, created_at, status)
  - order_items(id, order_id, product_id, quantity, unit_price)
  - events(id, user_id, name, created_at, properties)

Available tools:
  - list_tables: discover tables (if uncertain).
  - describe_table: inspect a table's columns/types.
  - execute_query: run a single SELECT. No semicolons. Read-only.

Workflow:
  1. If the user's question maps cleanly to known columns, write SQL and call execute_query directly.
  2. If a column name or type is uncertain, call describe_table first.
  3. Cite specific numbers from the rows you retrieved. Never invent data.
  4. Answer in concise prose — 1-3 sentences plus inline figures, not a wall of text.
`.trim();

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const listTables = tool(
  async () => {
    const rows = await runReadonlyQuery<{ table_name: string }>(
      `select table_name
         from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
        order by table_name`
    );
    return JSON.stringify(rows);
  },
  {
    name: "list_tables",
    description:
      "List every table in the `public` schema. Returns rows of " +
      "{ table_name }. Use this to discover what data exists before " +
      "calling describe_table or execute_query.",
    schema: z.object({}),
  }
);

const describeTable = tool(
  async ({ table_name }) => {
    const rows = await runReadonlyQuery<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public'
          and table_name = $1
        order by ordinal_position`,
      [table_name]
    );
    return JSON.stringify(rows);
  },
  {
    name: "describe_table",
    description:
      "Describe a `public`-schema table's columns. Returns rows of " +
      "{ column_name, data_type, is_nullable, column_default }. Use " +
      "this before writing an execute_query call so the generated SQL " +
      "matches the real column names and types.",
    schema: z.object({
      table_name: z
        .string()
        .min(1)
        .describe("The name of a table in the public schema."),
    }),
  }
);

const executeQuery = tool(
  async ({ sql }) => {
    const rows = await runSql(sql);
    return JSON.stringify(rows);
  },
  {
    name: "execute_query",
    description:
      "Execute a read-only SELECT against the public schema and return " +
      "the result rows as JSON. Only SELECT statements are accepted; " +
      "semicolons are rejected. Use information from list_tables and " +
      "describe_table to write valid SQL.",
    schema: z.object({
      sql: z
        .string()
        .min(1)
        .describe(
          "A single SELECT statement. No semicolons. References public-schema tables."
        ),
    }),
  }
);

// ---------------------------------------------------------------------------
// Trace middleware factory
// ---------------------------------------------------------------------------

/**
 * Middleware shape is loosely typed in v1; using `any` here is intentional
 * so we don't pin to a minor-version structural detail. The two hooks
 * receive `(request, handler)` and must return whatever `handler(request)`
 * returns. Errors propagate normally.
 */
type Middleware = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapModelCall?: (request: any, handler: (r: any) => Promise<any>) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapToolCall?: (request: any, handler: (r: any) => Promise<any>) => Promise<any>;
  name?: string;
};

function traceMiddleware(builder: TraceBuilder): Middleware {
  return {
    name: "ember-preps-trace",
    async wrapModelCall(request, handler) {
      const t0 = performance.now();
      try {
        const result = await handler(request);
        builder.markLlmCallFromLangchain({
          ms: performance.now() - t0,
          usage:
            (result as { usage_metadata?: unknown })?.usage_metadata as
              | Parameters<TraceBuilder["markLlmCallFromLangchain"]>[0]["usage"]
              | undefined,
        });
        return result;
      } catch (err) {
        // Record the call's wall time even on failure so the trace shows where
        // time went. Token counts unknown → 0.
        builder.markLlmCallFromLangchain({
          ms: performance.now() - t0,
          usage: undefined,
        });
        throw err;
      }
    },
    async wrapToolCall(request, handler) {
      const t0 = performance.now();
      const name = (request?.toolCall?.name as string | undefined) ?? "unknown";
      try {
        const result = await handler(request);
        builder.markToolCall({
          name,
          ms: performance.now() - t0,
          isError: false,
        });
        return result;
      } catch (err) {
        console.error(`[langchain-agent]   tool error: ${name}`, err);
        builder.markToolCall({
          name,
          ms: performance.now() - t0,
          isError: true,
        });
        throw err;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton (model + tools — agent built per request because middleware
// must close over per-request state)
// ---------------------------------------------------------------------------

type LangchainParts = {
  model: ChatAnthropic;
  tools: readonly [typeof listTables, typeof describeTable, typeof executeQuery];
  systemPrompt: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __langchainParts: LangchainParts | undefined;
}

function getLangchainParts(): LangchainParts {
  if (!globalThis.__langchainParts) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. See .env.local.example."
      );
    }
    globalThis.__langchainParts = {
      model: new ChatAnthropic({
        model: MODEL,
        maxTokens: MAX_TOKENS,
        apiKey: process.env.ANTHROPIC_API_KEY,
      }),
      tools: [listTables, describeTable, executeQuery] as const,
      systemPrompt: SYSTEM_PROMPT,
    };
    console.error(
      `[langchain-agent] cached parts: model=${MODEL}, tools=${globalThis.__langchainParts.tools.map((t) => t.name).join(", ")}`
    );
  }
  return globalThis.__langchainParts;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function isRecursionLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  if (name === "GraphRecursionError") return true;
  const message = (err as { message?: string }).message ?? "";
  return /recursion limit/i.test(message);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFinalText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.getType?.() !== "ai" && m._getType?.() !== "ai" && m.role !== "assistant") {
      continue;
    }
    const content = m.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (b: { type?: string; text?: string }) =>
            b.type === "text" && typeof b.text === "string"
        )
        .map((b: { text: string }) => b.text)
        .join("\n")
        .trim();
      if (text) return text;
    }
  }
  return "(no text generated — model only made tool calls)";
}

export async function runLangchainTurn(
  question: string,
  builder: TraceBuilder
): Promise<string> {
  const parts = getLangchainParts();

  const agent = createAgent({
    model: parts.model,
    tools: [...parts.tools],
    systemPrompt: parts.systemPrompt,
    middleware: [traceMiddleware(builder)],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  console.error(`[langchain-agent] invoke → claude (recursionLimit=${RECURSION_LIMIT})`);
  try {
    const result = await agent.invoke(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { messages: [{ role: "user", content: question }] } as any,
      { recursionLimit: RECURSION_LIMIT }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = (result as any).messages ?? [];
    return extractFinalText(messages);
  } catch (err) {
    if (isRecursionLimitError(err)) {
      console.error(`[langchain-agent] recursion limit reached`);
      builder.markCapReached();
      return `[Recursion limit reached after ${RECURSION_LIMIT} graph steps] (no final answer)`;
    }
    throw err;
  }
}

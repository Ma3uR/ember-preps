/**
 * Hand-rolled Anthropic tool-use loop over the MCP client.
 *
 * Stage 1's goal is to *understand MCP primitives* — using
 * `anthropic.beta.messages.toolRunner()` + the mcpTools() adapter would
 * hide the exact JSON-RPC envelope, schema translation, and iteration
 * mechanics that the noticing journal (u6) needs to record. The hand-
 * rolled version logs every iteration's transition to stderr.
 *
 * Schema translation is mechanical: MCP `tool.inputSchema` is already a
 * JSON Schema object, and Anthropic's `input_schema` is the same JSON
 * Schema shape — the only rename is the property key.
 *
 * The 6-iteration cap satisfies R6. On cap, returns the latest assistant
 * text (if any) prefixed with `[Iteration cap reached ...]` so AE3 is
 * exercisable by writing an intentionally ambiguous question.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { getMcpClient } from "./mcp-client";

const MODEL = "claude-sonnet-4-6";
const MAX_ITERATIONS = 6;
const MAX_TOKENS = 1024;

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

let anthropic: Anthropic | undefined;
function getAnthropic(): Anthropic {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function lastAssistantText(messages: MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "assistant" && Array.isArray(m.content)) {
      const t = textOf(m.content as ContentBlock[]);
      if (t) return t;
    }
  }
  return "(no text generated — model only made tool calls)";
}

export async function runMcpToolLoop(question: string): Promise<string> {
  const client = await getMcpClient();
  const { tools: mcpTools } = await client.listTools();

  // MCP `inputSchema` is already a JSON Schema; Anthropic `input_schema`
  // is the same JSON Schema shape — only the property name changes.
  const tools: Tool[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Tool.InputSchema,
  }));
  console.error(
    `[tool-loop] discovered ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`
  );

  const messages: MessageParam[] = [{ role: "user", content: question }];
  const ai = getAnthropic();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.error(`[tool-loop] iter ${i + 1}/${MAX_ITERATIONS} → claude`);
    const res = await ai.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    const toolUses = res.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use"
    );

    if (toolUses.length === 0) {
      console.error(`[tool-loop] iter ${i + 1} → terminal text response`);
      return textOf(res.content);
    }

    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (u) => {
        console.error(
          `[tool-loop]   tool: ${u.name}(${JSON.stringify(u.input)})`
        );
        try {
          const result = await client.callTool({
            name: u.name,
            arguments: u.input as Record<string, unknown>,
          });
          const text = Array.isArray(result.content)
            ? result.content
                .filter(
                  (b: { type?: string; text?: string }): b is { type: "text"; text: string } =>
                    b.type === "text" && typeof b.text === "string"
                )
                .map((b) => b.text)
                .join("\n")
            : "";
          if (result.isError) {
            console.error(`[tool-loop]   tool error: ${text}`);
          }
          return {
            type: "tool_result" as const,
            tool_use_id: u.id,
            content: text,
            is_error: result.isError === true,
          };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          console.error(`[tool-loop]   tool error: ${message}`);
          return {
            type: "tool_result" as const,
            tool_use_id: u.id,
            content: `Tool error: ${message}`,
            is_error: true,
          };
        }
      })
    );

    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: toolResults });
  }

  console.error(`[tool-loop] iteration cap reached`);
  return `[Iteration cap reached after ${MAX_ITERATIONS} loops] ${lastAssistantText(messages)}`;
}

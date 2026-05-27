/**
 * Three MCP tools over the e-commerce Supabase schema. Intentionally "naive"
 * (per the plan): no AST validation, no LIMIT clamping, no EXPLAIN checks.
 * Safety lives at the database layer — every call here runs as
 * `llm_readonly`, which only holds `pg_read_all_data`.
 *
 * Each handler returns the MCP `content[]` shape. Errors are wrapped into
 * `{ isError: true, content: [{ type: 'text', text: 'Error: ...' }] }`
 * instead of throwing, so the host loop (u4) keeps an audit log of failures
 * and can decide whether to retry.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runReadonlyQuery, runSql } from "../lib/supabase.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function fail(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

export function registerListTables(server: McpServer): void {
  server.registerTool(
    "list_tables",
    {
      description:
        "List every table in the `public` schema. Returns rows of " +
        "{ table_name }. Use this to discover what data exists before " +
        "calling describe_table or execute_query.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const rows = await runReadonlyQuery<{ table_name: string }>(
          `select table_name
             from information_schema.tables
            where table_schema = 'public'
              and table_type = 'BASE TABLE'
            order by table_name`
        );
        return ok(rows);
      } catch (err) {
        return fail(err);
      }
    }
  );
}

export function registerDescribeTable(server: McpServer): void {
  server.registerTool(
    "describe_table",
    {
      description:
        "Describe a `public`-schema table's columns. Returns rows of " +
        "{ column_name, data_type, is_nullable, column_default }. Use " +
        "this before writing an execute_query call so the generated SQL " +
        "matches the real column names and types.",
      inputSchema: z.object({
        table_name: z
          .string()
          .min(1)
          .describe("The name of a table in the public schema."),
      }),
    },
    async ({ table_name }) => {
      try {
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
        return ok(rows);
      } catch (err) {
        return fail(err);
      }
    }
  );
}

export function registerExecuteQuery(server: McpServer): void {
  server.registerTool(
    "execute_query",
    {
      description:
        "Execute a read-only SELECT against the public schema and return " +
        "the result rows as JSON. Only SELECT statements are accepted; " +
        "semicolons are rejected. Use information from list_tables and " +
        "describe_table to write valid SQL.",
      inputSchema: z.object({
        sql: z
          .string()
          .min(1)
          .describe(
            "A single SELECT statement. No semicolons. References public-schema tables."
          ),
      }),
    },
    async ({ sql }) => {
      try {
        const rows = await runSql(sql);
        return ok(rows);
      } catch (err) {
        return fail(err);
      }
    }
  );
}

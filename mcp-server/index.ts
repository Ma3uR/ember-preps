/**
 * MCP server over the e-commerce Supabase schema. Stdio transport only.
 *
 * Stdio-framing invariant: stdout is reserved for JSON-RPC frames. Every
 * log line in this directory must use `console.error` (stderr). A stray
 * `console.log` here would corrupt the client's framing and produce the
 * notorious `MCP error -32000: Connection closed` symptom.
 *
 * Spawned by:
 *   - `lib/mcp-client.ts` (u4) — Next.js dev server, single shared child.
 *   - `pnpm mcp-inspector` — manual exercise via the MCP Inspector UI.
 *   - `pnpm mcp-server` — standalone (debug only).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeReadonlyPool } from "../lib/supabase.js";
import {
  registerDescribeTable,
  registerExecuteQuery,
  registerListTables,
} from "./tools.js";

process.on("uncaughtException", (err) => {
  console.error("[mcp-server] uncaughtException:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[mcp-server] unhandledRejection:", reason);
  process.exit(1);
});

const server = new McpServer({ name: "supabase-ecom", version: "0.1.0" });

registerListTables(server);
registerDescribeTable(server);
registerExecuteQuery(server);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[mcp-server] received ${signal}, draining`);
  try {
    await server.close();
  } catch (err) {
    console.error("[mcp-server] server.close error:", err);
  }
  try {
    await closeReadonlyPool();
  } catch (err) {
    console.error("[mcp-server] pool.end error:", err);
  }
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp-server] ready (supabase-ecom 0.1.0, stdio transport)");
}

main().catch((err) => {
  console.error("[mcp-server] fatal:", err);
  process.exit(1);
});

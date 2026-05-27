/**
 * Singleton MCP client wired to the local `mcp-server/` child process.
 *
 * One shared child across all requests for the life of the Next.js dev
 * server. Matches the real-world MCP host pattern (Claude Desktop, Cursor)
 * and avoids per-request spawn cost. The singleton lives on `globalThis`
 * because Next.js dev HMR re-evaluates module scope on every save —
 * without the `globalThis` gate, every save would orphan a child process.
 *
 * The spawn uses `process.execPath` + `--import tsx` rather than a bare
 * `command: 'tsx'`. The PATH-resolved `tsx` only works because `pnpm dev`
 * happens to put `node_modules/.bin` on PATH; the `pnpm start` path and
 * any serverless runtime would break. Resolving Node + the tsx loader
 * explicitly makes the spawn portable.
 *
 * Cleanup is best-effort. SIGINT (Ctrl-C during `pnpm dev`) and SIGTERM
 * fire `beforeExit` only in some paths; we wire all three for safety.
 */

import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type McpHandle = { client: Client; transport: StdioClientTransport };

declare global {
  // eslint-disable-next-line no-var
  var __mcp: Promise<McpHandle> | undefined;
  // eslint-disable-next-line no-var
  var __mcpShutdownWired: boolean | undefined;
}

function spawnMcp(): Promise<McpHandle> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--import",
      "tsx",
      path.resolve(process.cwd(), "mcp-server/index.ts"),
    ],
    // Child inherits parent env by default (so SUPABASE_LLM_READONLY_DB_URL
    // flows through). `stderr: 'inherit'` means MCP server stderr lines
    // appear directly in the Next.js dev console — no manual pipe needed.
    stderr: "inherit",
  });
  const client = new Client(
    { name: "ember-preps-host", version: "0.1.0" },
    { capabilities: {} }
  );
  return client.connect(transport).then(() => ({ client, transport }));
}

function wireShutdown() {
  if (globalThis.__mcpShutdownWired) return;
  globalThis.__mcpShutdownWired = true;
  const close = async () => {
    const handle = globalThis.__mcp;
    if (!handle) return;
    try {
      const { client } = await handle;
      await client.close();
    } catch {
      // best-effort; we're shutting down anyway
    }
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  process.once("beforeExit", close);
}

export async function getMcpClient(): Promise<Client> {
  if (!globalThis.__mcp) {
    globalThis.__mcp = spawnMcp();
    wireShutdown();
  }
  return (await globalThis.__mcp).client;
}

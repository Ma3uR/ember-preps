/**
 * Stage-1 chat endpoint. POST { question } -> { answer }.
 *
 * Runs the hand-rolled Anthropic tool-use loop against the singleton MCP
 * client (which spawns and shares one MCP server child for the lifetime of
 * the Next.js process). See u4 in
 * docs/plans/2026-05-27-001-feat-mcp-langchain-rebuild-prep-plan.md.
 *
 * `runtime = "nodejs"` is non-optional — the MCP SDK uses `child_process`,
 * which isn't available on the Edge runtime.
 */

import { NextResponse } from "next/server";
import { runMcpToolLoop } from "@/lib/tool-loop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const question =
    body && typeof body === "object" && "question" in body
      ? (body as { question?: unknown }).question
      : undefined;

  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json(
      { error: "`question` is required (non-empty string)" },
      { status: 400 }
    );
  }

  try {
    const answer = await runMcpToolLoop(question.trim());
    return NextResponse.json({ answer });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[chat-mcp] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

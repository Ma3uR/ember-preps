/**
 * LangChain-backed chat endpoint. POST { question } -> { answer, trace }.
 *
 * Mirrors `app/api/chat-mcp/route.ts` in shape so the UI and any contract
 * test can treat the two endpoints identically. The only differences are
 * the loop implementation (`runLangchainTurn` instead of `runMcpToolLoop`)
 * and the trace's `backend` field.
 *
 * `runtime = "nodejs"` matches the MCP route for parity; LangChain itself
 * is bundler-friendly, but the shared `pg` pool in `lib/supabase.ts` and
 * the file-system reads inside LangChain's startup paths both expect Node.
 */

import { NextResponse } from "next/server";
import { runLangchainTurn } from "@/lib/langchain-agent";
import { createTraceBuilder } from "@/lib/trace";

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

  const builder = createTraceBuilder({ backend: "langchain" });
  try {
    const answer = await runLangchainTurn(question.trim(), builder);
    return NextResponse.json({ answer, trace: builder.finalize() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[chat-langchain] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

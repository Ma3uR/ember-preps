"use client";

import type { Trace } from "@/lib/trace";

/**
 * Compact trace summary + optional expanded detail. Used both inside
 * Compare-mode columns and as a per-assistant-message footer in the
 * single-backend threaded chat. Visual budget: existing Tailwind tokens
 * only — no new design system.
 */

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function totalIn(trace: Trace): number {
  return trace.llmCalls.reduce((sum, c) => sum + c.inputTokens, 0);
}

function totalOut(trace: Trace): number {
  return trace.llmCalls.reduce((sum, c) => sum + c.outputTokens, 0);
}

export type TracePanelProps = {
  trace: Trace;
  isExpanded: boolean;
  onToggle: () => void;
};

export default function TracePanel({ trace, isExpanded, onToggle }: TracePanelProps) {
  const summary = `${formatMs(trace.totalMs)} · ${trace.iterations} iter · ${trace.toolCalls.length} tools · ${totalIn(trace)} in / ${totalOut(trace)} out${trace.capReached ? " · cap" : ""}`;

  return (
    <div className="mt-1 text-[11px] opacity-70">
      <button
        type="button"
        onClick={onToggle}
        className="font-mono hover:opacity-100 focus:outline-none focus:underline"
        aria-expanded={isExpanded}
      >
        {isExpanded ? "▾" : "▸"} {summary}
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-[11px]">
          <div>
            <div className="mb-1 opacity-60">llm calls</div>
            {trace.llmCalls.length === 0 ? (
              <div className="opacity-50">(none)</div>
            ) : (
              <ol className="space-y-0.5">
                {trace.llmCalls.map((c, i) => (
                  <li key={i}>
                    {i + 1}. {formatMs(c.ms)} — in:{c.inputTokens} out:{c.outputTokens} cache_r:{c.cacheReadTokens ?? "-"} cache_c:{c.cacheCreationTokens ?? "-"}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <div className="mb-1 opacity-60">tool calls</div>
            {trace.toolCalls.length === 0 ? (
              <div className="opacity-50">(none)</div>
            ) : (
              <ol className="space-y-0.5">
                {trace.toolCalls.map((c, i) => (
                  <li key={i}>
                    {i + 1}. {c.name} — {formatMs(c.ms)}
                    {c.isError ? " (error)" : ""}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

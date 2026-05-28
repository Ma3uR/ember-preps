"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Trace } from "@/lib/trace";
import TracePanel from "./TracePanel";

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------

type Mode = "mcp" | "langchain" | "compare";

function resolveMode(): Mode {
  const raw = process.env.NEXT_PUBLIC_BACKEND_MODE;
  if (raw === "langchain" || raw === "compare") return raw;
  return "mcp";
}

const ENDPOINTS = {
  mcp: "/api/chat-mcp",
  langchain: "/api/chat-langchain",
} as const;

// ---------------------------------------------------------------------------
// Shared markdown rendering
// ---------------------------------------------------------------------------

const markdownComponents = {
  p: (props: React.ComponentProps<"p">) => (
    <p className="my-2 first:mt-0 last:mb-0" {...props} />
  ),
  strong: (props: React.ComponentProps<"strong">) => (
    <strong className="font-semibold" {...props} />
  ),
  em: (props: React.ComponentProps<"em">) => (
    <em className="italic" {...props} />
  ),
  ul: (props: React.ComponentProps<"ul">) => (
    <ul className="my-2 list-disc space-y-1 pl-5" {...props} />
  ),
  ol: (props: React.ComponentProps<"ol">) => (
    <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />
  ),
  li: (props: React.ComponentProps<"li">) => <li className="" {...props} />,
  h1: (props: React.ComponentProps<"h1">) => (
    <h1 className="my-3 text-base font-semibold" {...props} />
  ),
  h2: (props: React.ComponentProps<"h2">) => (
    <h2 className="my-3 text-base font-semibold" {...props} />
  ),
  h3: (props: React.ComponentProps<"h3">) => (
    <h3 className="my-2 text-sm font-semibold" {...props} />
  ),
  code: ({ className, children, ...rest }: React.ComponentProps<"code">) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code
          className="block overflow-x-auto rounded-md bg-[var(--color-surface)] p-3 font-mono text-xs"
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-[var(--color-surface)] px-1 py-0.5 font-mono text-[0.85em]"
        {...rest}
      >
        {children}
      </code>
    );
  },
  pre: (props: React.ComponentProps<"pre">) => (
    <pre className="my-2 overflow-x-auto" {...props} />
  ),
  table: (props: React.ComponentProps<"table">) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  thead: (props: React.ComponentProps<"thead">) => (
    <thead
      className="border-b border-[var(--color-border)] text-left"
      {...props}
    />
  ),
  th: (props: React.ComponentProps<"th">) => (
    <th className="px-2 py-1.5 font-semibold" {...props} />
  ),
  td: (props: React.ComponentProps<"td">) => (
    <td
      className="border-b border-[var(--color-border)]/50 px-2 py-1.5"
      {...props}
    />
  ),
  a: (props: React.ComponentProps<"a">) => (
    <a
      className="underline underline-offset-2 hover:opacity-80"
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  blockquote: (props: React.ComponentProps<"blockquote">) => (
    <blockquote
      className="my-2 border-l-2 border-[var(--color-border)] pl-3 opacity-80"
      {...props}
    />
  ),
  hr: (props: React.ComponentProps<"hr">) => (
    <hr className="my-3 border-[var(--color-border)]" {...props} />
  ),
};

function MarkdownAnswer({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {children}
    </ReactMarkdown>
  );
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export default function Chat() {
  const mode = resolveMode();
  if (mode === "compare") return <CompareChat />;
  return <ThreadedChat mode={mode} />;
}

function Header({ mode }: { mode: Mode }) {
  return (
    <header className="border-b border-[var(--color-border)] px-6 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold">Ember Preps</h1>
        <span className="font-mono text-[11px] uppercase opacity-50">
          mode: {mode}
        </span>
      </div>
      <p className="mt-0.5 text-xs opacity-60">
        MCP × LangChain learning lab — chat with the e-commerce database.
      </p>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Threaded chat (mode = "mcp" | "langchain")
// ---------------------------------------------------------------------------

type ThreadedMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; trace?: Trace }
  | { role: "error"; content: string };

function ThreadedChat({ mode }: { mode: "mcp" | "langchain" }) {
  const endpoint = ENDPOINTS[mode];
  const [messages, setMessages] = useState<ThreadedMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedTraces, setExpandedTraces] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = (await res.json()) as {
        answer?: string;
        trace?: Trace;
        error?: string;
      };

      if (!res.ok || data.error) {
        setMessages((m) => [
          ...m,
          {
            role: "error",
            content: data.error ?? `Request failed (${res.status})`,
          },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: data.answer ?? "",
            trace: data.trace,
          },
        ]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "network error";
      setMessages((m) => [...m, { role: "error", content: message }]);
    } finally {
      setLoading(false);
    }
  }

  function toggleTrace(index: number) {
    setExpandedTraces((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col">
      <Header mode={mode} />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && !loading && (
          <div className="mt-12 text-center text-sm opacity-50">
            Ask a question. Try:{" "}
            <span className="italic">
              top 5 products by revenue last month
            </span>
            .
          </div>
        )}

        <ul className="flex flex-col gap-4">
          {messages.map((m, i) => (
            <li key={i} className="flex flex-col">
              <div className="flex">
                <div
                  className={
                    m.role === "user"
                      ? "ml-auto max-w-[80%] rounded-2xl bg-[var(--color-surface)] px-4 py-2 text-sm"
                      : m.role === "assistant"
                        ? "mr-auto max-w-[80%] rounded-2xl border border-[var(--color-border)] px-4 py-2 text-sm"
                        : "mr-auto max-w-[80%] rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
                  }
                >
                  {m.role === "assistant" ? (
                    <MarkdownAnswer>{m.content}</MarkdownAnswer>
                  ) : (
                    m.content
                  )}
                </div>
              </div>
              {m.role === "assistant" && m.trace && (
                <div className="mr-auto max-w-[80%] pl-2">
                  <TracePanel
                    trace={m.trace}
                    isExpanded={expandedTraces.has(i)}
                    onToggle={() => toggleTrace(i)}
                  />
                </div>
              )}
            </li>
          ))}
          {loading && (
            <li className="flex">
              <div className="mr-auto max-w-[80%] rounded-2xl border border-[var(--color-border)] px-4 py-2 text-sm opacity-50">
                thinking…
              </div>
            </li>
          )}
        </ul>
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={onSubmit}
        className="flex gap-2 border-t border-[var(--color-border)] px-6 py-4"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={loading ? "waiting for answer…" : "ask a question"}
          disabled={loading}
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-white/30 disabled:opacity-50"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || input.trim().length === 0}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-30"
        >
          Send
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare chat (mode = "compare")
// ---------------------------------------------------------------------------

type BackendKey = "mcp" | "langchain";

type ColumnState =
  | { status: "pending" }
  | { status: "ok"; answer: string; trace: Trace }
  | { status: "error"; error: string };

type CompareBlock = {
  question: string;
  mcp: ColumnState;
  langchain: ColumnState;
};

function CompareChat() {
  const [blocks, setBlocks] = useState<CompareBlock[]>([]);
  const [input, setInput] = useState("");
  const [expandedTraces, setExpandedTraces] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const inFlight = blocks.some(
    (b) => b.mcp.status === "pending" || b.langchain.status === "pending"
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [blocks]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const question = input.trim();
    if (!question || inFlight) return;

    setInput("");
    const index = blocks.length;
    setBlocks((prev) => [
      ...prev,
      { question, mcp: { status: "pending" }, langchain: { status: "pending" } },
    ]);

    const fetchOne = (backend: BackendKey) =>
      fetch(ENDPOINTS[backend], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      }).then(async (res) => {
        const data = (await res.json()) as {
          answer?: string;
          trace?: Trace;
          error?: string;
        };
        if (!res.ok || data.error) {
          throw new Error(data.error ?? `Request failed (${res.status})`);
        }
        if (!data.trace || typeof data.answer !== "string") {
          throw new Error("Malformed response (missing answer or trace)");
        }
        return { answer: data.answer, trace: data.trace };
      });

    const updateColumn = (backend: BackendKey, next: ColumnState) => {
      setBlocks((prev) =>
        prev.map((b, i) => (i === index ? { ...b, [backend]: next } : b))
      );
    };

    const settle = async (backend: BackendKey) => {
      try {
        const { answer, trace } = await fetchOne(backend);
        updateColumn(backend, { status: "ok", answer, trace });
      } catch (err) {
        const message = err instanceof Error ? err.message : "network error";
        updateColumn(backend, { status: "error", error: message });
      }
    };

    // Fire both in parallel; settle independently. Promise.allSettled would
    // batch the awaits — we want each side to render the moment it lands.
    void settle("mcp");
    void settle("langchain");
  }

  function traceKey(blockIndex: number, backend: BackendKey): string {
    return `${blockIndex}:${backend}`;
  }

  function toggleTrace(key: string) {
    setExpandedTraces((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="mx-auto flex h-screen max-w-6xl flex-col">
      <Header mode="compare" />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {blocks.length === 0 && (
          <div className="mt-12 text-center text-sm opacity-50">
            Compare mode — each question fires both backends in parallel.
            <br />
            Try:{" "}
            <span className="italic">
              top 5 products by revenue last month
            </span>
            .
          </div>
        )}

        <ul className="flex flex-col gap-6">
          {blocks.map((b, i) => (
            <li key={i} className="flex flex-col gap-3">
              <div className="flex">
                <div className="ml-auto max-w-[80%] rounded-2xl bg-[var(--color-surface)] px-4 py-2 text-sm">
                  {b.question}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <BackendColumn
                  label="MCP"
                  state={b.mcp}
                  expanded={expandedTraces.has(traceKey(i, "mcp"))}
                  onToggle={() => toggleTrace(traceKey(i, "mcp"))}
                />
                <BackendColumn
                  label="LangChain"
                  state={b.langchain}
                  expanded={expandedTraces.has(traceKey(i, "langchain"))}
                  onToggle={() => toggleTrace(traceKey(i, "langchain"))}
                />
              </div>
            </li>
          ))}
        </ul>
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={onSubmit}
        className="flex gap-2 border-t border-[var(--color-border)] px-6 py-4"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={inFlight ? "waiting for both backends…" : "ask a question"}
          disabled={inFlight}
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-white/30 disabled:opacity-50"
          autoFocus
        />
        <button
          type="submit"
          disabled={inFlight || input.trim().length === 0}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-30"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function BackendColumn({
  label,
  state,
  expanded,
  onToggle,
}: {
  label: string;
  state: ColumnState;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wide opacity-70">
          {label}
        </span>
        {state.status === "ok" && (
          <TracePanel
            trace={state.trace}
            isExpanded={expanded}
            onToggle={onToggle}
          />
        )}
      </div>

      {state.status === "pending" && (
        <div className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm opacity-50">
          thinking…
        </div>
      )}
      {state.status === "ok" && (
        <div className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm">
          <MarkdownAnswer>{state.answer}</MarkdownAnswer>
        </div>
      )}
      {state.status === "error" && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {state.error}
        </div>
      )}
    </div>
  );
}

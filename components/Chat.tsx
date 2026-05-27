"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Message = { role: "user" | "assistant" | "error"; content: string };

/**
 * Reads the chat endpoint at runtime so u7's `NEXT_PUBLIC_BACKEND_MODE`
 * toggle works without editing this file. Defaults to `mcp`.
 */
function endpointForMode(): string {
  const mode = process.env.NEXT_PUBLIC_BACKEND_MODE ?? "mcp";
  return mode === "langchain" ? "/api/chat-langchain" : "/api/chat-mcp";
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
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
      const res = await fetch(endpointForMode(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = (await res.json()) as { answer?: string; error?: string };

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
          { role: "assistant", content: data.answer ?? "" },
        ]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "network error";
      setMessages((m) => [...m, { role: "error", content: message }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col">
      <header className="border-b border-[var(--color-border)] px-6 py-4">
        <h1 className="text-lg font-semibold">Ember Preps</h1>
        <p className="mt-0.5 text-xs opacity-60">
          MCP × LangChain learning lab — chat with the e-commerce database.
        </p>
      </header>

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
            <li key={i} className="flex">
              <div
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[80%] rounded-2xl bg-[var(--color-surface)] px-4 py-2 text-sm"
                    : m.role === "assistant"
                      ? "mr-auto max-w-[80%] rounded-2xl border border-[var(--color-border)] px-4 py-2 text-sm whitespace-pre-wrap"
                      : "mr-auto max-w-[80%] rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
                }
              >
                {m.content}
              </div>
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

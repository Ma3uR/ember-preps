"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = { role: "user" | "assistant" | "error"; content: string };

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
      <table
        className="w-full border-collapse text-xs"
        {...props}
      />
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
                      ? "mr-auto max-w-[80%] rounded-2xl border border-[var(--color-border)] px-4 py-2 text-sm"
                      : "mr-auto max-w-[80%] rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
                }
              >
                {m.role === "assistant" ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {m.content}
                  </ReactMarkdown>
                ) : (
                  m.content
                )}
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

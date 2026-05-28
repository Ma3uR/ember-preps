/**
 * Shared per-request trace shape, populated symmetrically by both backends.
 *
 * The entire Compare Mode story (R12/R13/R15) depends on apples-to-apples
 * data. Defining the trace shape once here, and having both `lib/tool-loop.ts`
 * (MCP) and `lib/langchain-agent.ts` (LangChain) feed an identical builder,
 * means the UI gets one rendering surface — not two parallel formatters.
 *
 * Token fields use camelCase. The MCP path's Anthropic SDK exposes
 * snake_case `input_tokens` / `cache_read_input_tokens`; the LangChain
 * path's `AIMessage.usage_metadata` exposes `input_tokens` plus
 * `input_token_details.{cache_creation,cache_read}` (LangChain-normalized).
 * Both flows are mapped here, in one place.
 *
 * Cache fields are nullable because not every model response surfaces them
 * (e.g., no cache hit on the first request of a session).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Backend = "mcp" | "langchain";

export type LlmCall = {
  ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
};

export type ToolCall = {
  name: string;
  ms: number;
  isError: boolean;
};

export type Trace = {
  backend: Backend;
  totalMs: number;
  iterations: number;
  llmCalls: LlmCall[];
  toolCalls: ToolCall[];
  capReached: boolean;
};

// ---------------------------------------------------------------------------
// Anthropic SDK `Usage` mapping (MCP path)
// ---------------------------------------------------------------------------

/**
 * Shape of `Anthropic.Messages.Usage` (subset we care about). Defined locally
 * so this module doesn't pull a transitive type dependency on the SDK — the
 * MCP loop passes whatever it gets and we read the snake_case fields.
 */
type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

function llmCallFromAnthropicUsage(ms: number, usage: AnthropicUsage): LlmCall {
  return {
    ms,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? null,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? null,
  };
}

// ---------------------------------------------------------------------------
// LangChain `AIMessage.usage_metadata` mapping (LangChain path)
// ---------------------------------------------------------------------------

/**
 * Subset of LangChain's normalized `UsageMetadata`. The spike (U1) confirmed
 * cache fields surface under `input_token_details` for the Anthropic provider.
 */
type LangchainUsageMetadata = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: {
    cache_creation?: number;
    cache_read?: number;
  };
};

function llmCallFromLangchainUsage(
  ms: number,
  usage: LangchainUsageMetadata | undefined
): LlmCall {
  const details = usage?.input_token_details;
  return {
    ms,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: details?.cache_read ?? null,
    cacheCreationTokens: details?.cache_creation ?? null,
  };
}

// ---------------------------------------------------------------------------
// Trace builder
// ---------------------------------------------------------------------------

export type TraceBuilder = {
  markLlmCallFromAnthropic: (args: { ms: number; usage: AnthropicUsage }) => void;
  markLlmCallFromLangchain: (args: {
    ms: number;
    usage: LangchainUsageMetadata | undefined;
  }) => void;
  markToolCall: (args: { name: string; ms: number; isError: boolean }) => void;
  markCapReached: () => void;
  llmCallCount: () => number;
  finalize: (args?: { iterations?: number }) => Trace;
};

/**
 * Returns a mutable builder. One builder per request — never shared across
 * concurrent requests, because timing state is per-request.
 *
 * `finalize({ iterations })` computes `totalMs` and emits the immutable
 * Trace. If `iterations` is omitted (LangChain path, where iteration count
 * derives from middleware fire-count), the builder falls back to
 * `llmCalls.length`.
 */
export function createTraceBuilder(args: { backend: Backend }): TraceBuilder {
  const { backend } = args;
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const llmCalls: LlmCall[] = [];
  const toolCalls: ToolCall[] = [];
  let capReached = false;

  return {
    markLlmCallFromAnthropic({ ms, usage }) {
      llmCalls.push(llmCallFromAnthropicUsage(ms, usage));
    },
    markLlmCallFromLangchain({ ms, usage }) {
      llmCalls.push(llmCallFromLangchainUsage(ms, usage));
    },
    markToolCall({ name, ms, isError }) {
      toolCalls.push({ name, ms, isError });
    },
    markCapReached() {
      capReached = true;
    },
    llmCallCount() {
      return llmCalls.length;
    },
    finalize(args) {
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      return {
        backend,
        totalMs: now - t0,
        iterations: args?.iterations ?? llmCalls.length,
        llmCalls: [...llmCalls],
        toolCalls: [...toolCalls],
        capReached,
      };
    },
  };
}

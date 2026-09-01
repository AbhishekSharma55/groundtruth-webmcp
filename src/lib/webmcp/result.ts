import type { ToolResult } from "./types";

/** Hard ceiling on a single tool result, per the tool-surface budget. */
export const MAX_RESULT_BYTES = 1536;

function truncate(text: string): string {
  if (text.length <= MAX_RESULT_BYTES) return text;
  return (
    text.slice(0, MAX_RESULT_BYTES - 80).trimEnd() +
    "\n\n[truncated — narrow the viewport or pass a smaller `limit` to see less]"
  );
}

/** A successful result. Always a bounded string. */
export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text: truncate(text) }] };
}

/**
 * A failed result. `isError` is set so the agent cannot mistake a serialised
 * error for a successful payload, and the message is written to be
 * self-correcting — it names the tool to call next wherever one exists.
 */
export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: truncate(message) }], isError: true };
}

/** Rejects as soon as the agent cancels, so long work does not outlive the call. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Tool call was cancelled by the agent.", "AbortError");
  }
}

/** Wraps an unknown throw into a failure result, preserving cancellation. */
export function toFailure(error: unknown): ToolResult {
  if (error instanceof DOMException && error.name === "AbortError") {
    return fail("Cancelled.");
  }
  const message = error instanceof Error ? error.message : String(error);
  return fail(`Tool failed: ${message}`);
}

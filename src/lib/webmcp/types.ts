/**
 * Minimal typings for the WebMCP browser API (`document.modelContext`).
 *
 * Only the two hints that actually ship in the IDL are modelled here.
 * `destructiveHint` / `idempotentHint` appear in older drafts and in the
 * server-side MCP spec but are NOT part of the shipping browser surface, so
 * they are deliberately absent — declaring them would be documentation that
 * lies about what the browser reads.
 */

export type JSONSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolAnnotations = {
  /** Tool does not mutate page state. */
  readOnlyHint?: boolean;
  /** Output may contain text this origin does not control. */
  untrustedContentHint?: boolean;
};

export type ToolContent = { type: "text"; text: string };

export type ToolResult = {
  content: ToolContent[];
  /** Set on failure so the agent sees a failure, not a successful-looking object. */
  isError?: boolean;
};

export type ExecuteOptions = {
  /** Aborted when the agent cancels the call. Plumb this into every await. */
  signal?: AbortSignal;
};

export type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  annotations?: ToolAnnotations;
  execute: (
    input: Record<string, unknown>,
    options?: ExecuteOptions,
  ) => Promise<ToolResult>;
};

export interface ModelContext {
  registerTool(descriptor: ToolDescriptor): void | Promise<void>;
  unregisterTool?(name: string): void | Promise<void>;
  provideContext?(context: { tools: ToolDescriptor[] }): void | Promise<void>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

export function getModelContext(): ModelContext | null {
  if (typeof document === "undefined") return null;
  return document.modelContext ?? null;
}

export function hasWebMCP(): boolean {
  return typeof getModelContext()?.registerTool === "function";
}

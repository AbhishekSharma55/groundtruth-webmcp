/**
 * Typings for the WebMCP browser API (`document.modelContext`), written against
 * the surface that actually ships in Chrome 151 rather than against the spec.
 *
 * Verified empirically on Chrome 151 with #enable-webmcp-testing:
 *
 *   ModelContext { ontoolchange, executeTool(tool, argsJson), getTools(),
 *                  registerTool(descriptor) }
 *
 * Three consequences drive the whole registration design:
 *   1. There is NO `unregisterTool` and no `provideContext`. A tool registered
 *      on a document cannot be taken back.
 *   2. Registering a name twice rejects with InvalidStateError "Duplicate tool
 *      name", so registration must be idempotent across StrictMode remounts,
 *      Fast Refresh and route changes.
 *   3. An AbortSignal on the descriptor is accepted and then ignored — it does
 *      not remove the tool. Only `options.signal` inside execute is real.
 *
 * Only the two annotations in the shipping IDL are modelled. `destructiveHint`
 * and `idempotentHint` exist in older drafts and in server-side MCP but are not
 * read by the browser, so declaring them would be documentation that lies.
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
  /** Aborted when the agent cancels the call. This one is real — plumb it through. */
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

/** What `getTools()` hands back. Opaque — `executeTool` requires this object. */
export type RegisteredTool = { name: string; description: string };

export interface ModelContext extends EventTarget {
  /** Rejects with InvalidStateError if `descriptor.name` is already registered. */
  registerTool(descriptor: ToolDescriptor): Promise<void>;
  getTools(): Promise<RegisteredTool[]>;
  /** Second argument is a JSON *string*, not an object. */
  executeTool(tool: RegisteredTool, argsJson: string): Promise<ToolResult>;
  ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null;
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

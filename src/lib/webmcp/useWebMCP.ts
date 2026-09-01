"use client";

import { useEffect, useRef, useState } from "react";
import { getModelContext, hasWebMCP, type ExecuteOptions, type ToolResult } from "./types";
import { fail } from "./result";

/**
 * A tool plus the on-page affordances derived from it. Prompt chips live on the
 * tool itself so the suggestions rendered in the UI cannot drift from the tool
 * surface the agent actually sees — both read this one object.
 */
export type GroundtruthTool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: Record<string, unknown>, options?: ExecuteOptions) => Promise<ToolResult>;
  /** Suggested prompts shown on-page. Copy-to-clipboard, not auto-sent. */
  chips?: string[];
  /**
   * False until this tool's precondition holds. Because the browser has no
   * unregisterTool, this gates *first* registration only; once a tool is live
   * it stays live and `unavailableReason` is what the agent gets instead.
   */
  available?: boolean;
  /** Why the tool cannot do its job right now. Written for the agent to act on. */
  unavailableReason?: string;
};

export type RegistrationState = {
  supported: boolean;
  registered: string[];
};

/**
 * Registration is per-document and irreversible, so the bookkeeping lives at
 * module scope: StrictMode's double mount, Fast Refresh and any remount must
 * not attempt a second registerTool for a name the document already has.
 */
const registeredNames = new Set<string>();

/**
 * The tool objects registration closed over would go stale as state changes.
 * Every registered tool therefore dispatches through this, which always resolves
 * the *current* object for that name.
 */
let currentTools: GroundtruthTool[] = [];

function dispatch(
  name: string,
  input: Record<string, unknown>,
  options?: ExecuteOptions,
): Promise<ToolResult> {
  const tool = currentTools.find((t) => t.name === name);
  if (!tool) {
    return Promise.resolve(fail(`"${name}" is no longer available on this page.`));
  }
  // A tool cannot be withdrawn once registered, so a precondition that has since
  // gone false is reported as a self-correcting failure rather than a silent lie.
  if (tool.available === false) {
    return Promise.resolve(
      fail(tool.unavailableReason ?? `"${name}" cannot run in the current view.`),
    );
  }
  return tool.execute(input, options);
}

export function useWebMCP(tools: GroundtruthTool[]): RegistrationState {
  const [supported, setSupported] = useState(false);
  const [registered, setRegistered] = useState<string[]>([]);
  const latest = useRef(tools);
  latest.current = tools;
  currentTools = tools;

  useEffect(() => {
    const modelContext = getModelContext();
    setSupported(hasWebMCP());
    if (!modelContext?.registerTool) return;

    let cancelled = false;

    void (async () => {
      for (const tool of latest.current) {
        // Tools whose precondition has never held are held back, so that the
        // moment one becomes available the browser fires a real `toolchange`.
        if (tool.available === false) continue;
        if (registeredNames.has(tool.name)) continue;

        // Claim the name before awaiting: two effects racing would otherwise
        // both pass the check and the second would hit InvalidStateError.
        registeredNames.add(tool.name);
        try {
          if (!document.modelContext) break;
          await document.modelContext.registerTool({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
            execute: (input, options) => dispatch(tool.name, input, options),
          });
        } catch (error) {
          registeredNames.delete(tool.name);
          console.error(`[webmcp] registerTool(${tool.name}) failed`, error);
        }
      }
      if (!cancelled) setRegistered([...registeredNames].sort());
    })();

    return () => {
      cancelled = true;
    };
  }, [tools]);

  return { supported, registered };
}

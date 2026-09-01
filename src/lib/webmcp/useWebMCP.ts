"use client";

import { useEffect, useRef, useState } from "react";
import { getModelContext, hasWebMCP, type ToolDescriptor } from "./types";

/**
 * A tool plus the on-page affordances derived from it. Prompt chips live on the
 * tool itself so the suggestions rendered in the UI cannot drift from the tool
 * surface the agent actually sees — both read this one object.
 */
export type GroundtruthTool = ToolDescriptor & {
  /** Suggested prompts shown on-page. Copy-to-clipboard, not auto-sent. */
  chips?: string[];
  /**
   * State-scoped tools return false until their precondition holds. Flipping
   * this registers/unregisters the tool, which is what fires `toolchange`.
   */
  available?: boolean;
};

export type RegistrationState = {
  supported: boolean;
  /** Names currently registered with the browser. */
  registered: string[];
};

/**
 * Registers tools against `document.modelContext` for the lifetime of the
 * calling component.
 *
 * Lifecycle rules this enforces:
 *  - one AbortController per mount; aborting removes every tool it added
 *  - React 18/19 StrictMode double-invoke must not leave duplicates behind
 *  - tools whose `available` flips are added/removed in place, so the agent
 *    sees a `toolchange` rather than a stale tool that errors when called
 */
export function useWebMCP(tools: GroundtruthTool[]): RegistrationState {
  const [supported, setSupported] = useState(false);
  const [registered, setRegistered] = useState<string[]>([]);
  const liveRef = useRef<Map<string, GroundtruthTool>>(new Map());

  useEffect(() => {
    setSupported(hasWebMCP());
  }, []);

  useEffect(() => {
    const modelContext = getModelContext();
    if (!modelContext?.registerTool) return;

    const controller = new AbortController();
    const live = liveRef.current;

    const unregister = (name: string) => {
      try {
        modelContext.unregisterTool?.(name);
      } catch {
        // Removal is best-effort; a browser without unregisterTool still gets
        // a correct surface because provideContext-style replacement is a no-op
        // here and duplicate registration is guarded by `live`.
      }
      live.delete(name);
    };

    const desired = new Map(
      tools.filter((tool) => tool.available !== false).map((tool) => [tool.name, tool]),
    );

    for (const name of [...live.keys()]) {
      if (!desired.has(name)) unregister(name);
    }

    for (const [name, tool] of desired) {
      if (live.has(name)) continue;
      const { chips: _chips, available: _available, ...descriptor } = tool;
      void _chips;
      void _available;
      document.modelContext!.registerTool({
        ...descriptor,
        execute: (input, options) => {
          // Chain the agent's per-call signal to the component lifetime, so an
          // unmount cancels work the agent is still awaiting.
          const signal = options?.signal
            ? AbortSignal.any([options.signal, controller.signal])
            : controller.signal;
          return tool.execute(input, { signal });
        },
      });
      live.set(name, tool);
    }

    setRegistered([...live.keys()].sort());

    controller.signal.addEventListener("abort", () => {
      for (const name of [...live.keys()]) unregister(name);
    });

    return () => controller.abort();
  }, [tools]);

  return { supported, registered };
}

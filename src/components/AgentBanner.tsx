"use client";

import { useEffect, useState } from "react";
import type { GroundtruthTool } from "@/lib/webmcp/useWebMCP";
import { useStore } from "@/lib/store";

type Env = "chatgpt" | "chrome-webmcp" | "none";

function detectEnv(supported: boolean): Env {
  if (!supported) return "none";
  const ua = navigator.userAgent;
  if (/ChatGPT/i.test(ua)) return "chatgpt";
  return "chrome-webmcp";
}

/**
 * Prompt chips come from the tool objects themselves, so a suggestion can never
 * advertise a tool that is not currently registered.
 */
export default function AgentBanner({
  tools,
  supported,
  registered,
}: {
  tools: GroundtruthTool[];
  supported: boolean;
  registered: string[];
}) {
  const [env, setEnv] = useState<Env>("none");
  const [copied, setCopied] = useState<string | null>(null);
  const selectedId = useStore((s) => s.selectedId);

  useEffect(() => setEnv(detectEnv(supported)), [supported]);

  const live = new Set(registered);
  const chips = tools
    .filter((t) => live.has(t.name))
    .flatMap((t) => t.chips ?? [])
    .slice(0, 5);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="pointer-events-auto rounded-lg border border-slate-700/70 bg-slate-950/90 p-3 backdrop-blur">
      <div className="flex items-center gap-2 text-[11px]">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            env === "none" ? "bg-amber-400" : "bg-emerald-400"
          }`}
        />
        {env === "chatgpt" && (
          <span className="text-emerald-300">
            ChatGPT in-app browser detected · {registered.length} tools registered
          </span>
        )}
        {env === "chrome-webmcp" && (
          <span className="text-emerald-300">
            WebMCP available in this browser · {registered.length} tools registered
          </span>
        )}
        {env === "none" && (
          <span className="text-amber-300">
            No agent attached — the console works fully on its own. For tools, open it in the
            ChatGPT in-app browser, or in Chrome 149+ with{" "}
            <code className="text-amber-200">chrome://flags#enable-webmcp-testing</code> enabled.
          </span>
        )}
      </div>

      {chips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const text = selectedId ? c.replace(/\bthis block\b/, `building ${selectedId}`) : c;
            return (
              <button
                key={c}
                onClick={() => copy(text)}
                className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-cyan-500/70 hover:text-cyan-200"
                title="Copy this prompt"
              >
                {copied === text ? "copied ✓" : text}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

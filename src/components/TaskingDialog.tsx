"use client";

import { store, useStore } from "@/lib/store";

/**
 * The consequential gate. `create_tasking` blocks on this dialog: nothing is
 * dispatched until a human clicks, and the agent's own stop button resolves it
 * as a withdrawal rather than leaving the call hanging.
 */
export default function TaskingDialog() {
  const pending = useStore((s) => s.pendingTasking);
  const byId = useStore((s) => s.byId);

  if (!pending) return null;

  const buildings = pending.buildingIds.map((id) => byId.get(id)).filter(Boolean);
  const pop = buildings.reduce((n, b) => n + (b?.occupancy_est ?? 0), 0);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-amber-500/40 bg-slate-950 shadow-2xl">
        <div className="border-b border-slate-800 px-5 py-3">
          <div className="text-[11px] uppercase tracking-wider text-amber-400">
            Agent is requesting a dispatch
          </div>
          <div className="mt-1 text-sm text-slate-200">
            Send {buildings.length} building{buildings.length === 1 ? "" : "s"} to{" "}
            <span className="text-slate-100">{pending.crew}</span>
          </div>
        </div>

        <div className="px-5 py-3 text-[12px] text-slate-400">
          <div className="flex justify-between py-0.5">
            <span>Priority</span>
            <span
              className={
                pending.priority === "Immediate" ? "text-red-400" : "text-slate-200"
              }
            >
              {pending.priority}
            </span>
          </div>
          <div className="flex justify-between py-0.5">
            <span>Est. people affected</span>
            <span className="text-slate-200">~{pop.toLocaleString()}</span>
          </div>
          <div className="mt-2 max-h-40 overflow-auto rounded border border-slate-800 bg-slate-900/60 p-2">
            {buildings.map((b) => (
              <div key={b!.id} className="py-0.5 text-[11px] text-slate-400">
                {b!.id} · {b!.kind} · exposure {b!.exposure}
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            Nothing has been dispatched. This is the agent&apos;s proposal, waiting on you.
          </div>
        </div>

        <div className="flex gap-2 border-t border-slate-800 px-5 py-3">
          <button
            onClick={() => store.resolveTasking(pending.id, "dispatched")}
            className="flex-1 rounded bg-amber-500 px-3 py-2 text-[12px] font-medium text-slate-950 transition hover:bg-amber-400"
          >
            Approve dispatch
          </button>
          <button
            onClick={() => store.resolveTasking(pending.id, "rejected")}
            className="flex-1 rounded border border-slate-700 px-3 py-2 text-[12px] text-slate-300 transition hover:border-slate-500"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

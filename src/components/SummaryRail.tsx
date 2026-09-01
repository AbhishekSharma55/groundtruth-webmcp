"use client";

import { inViewport, store, useStore } from "@/lib/store";
import { IMAGERY } from "@/lib/imagery";
import { GRADE_COLOR } from "./MapCanvas";

export default function SummaryRail() {
  const state = useStore((s) => s);
  const visible = inViewport(state);
  const graded = visible.filter((b) => state.assessments.has(b.id));
  const pop = visible.reduce((n, b) => n + b.occupancy_est, 0);
  const severe = visible.filter((b) => b.exposure === "Severe").length;
  const meta = IMAGERY[state.imagery];

  const byGrade = new Map<string, number>();
  for (const a of state.assessments.values()) {
    byGrade.set(a.grade, (byGrade.get(a.grade) ?? 0) + 1);
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-slate-800 px-4 py-3">
        <div className="text-sm font-semibold tracking-tight text-slate-100">Groundtruth</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
          You read the imagery. Your agent reads everything else.
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          Fort Myers Beach, FL · Hurricane Ian, 28 Sep 2022
        </div>
      </div>

      <div className="border-b border-slate-800 px-4 py-3">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">Imagery</div>
        <div className="mt-1.5 flex gap-1.5">
          {(["storm-day", "reference"] as const).map((id) => (
            <button
              key={id}
              onClick={() => store.setImagery(id)}
              className={`flex-1 rounded border px-2 py-1.5 text-[11px] transition ${
                state.imagery === id
                  ? "border-cyan-500/70 bg-cyan-500/10 text-cyan-200"
                  : "border-slate-700 text-slate-400 hover:border-slate-500"
              }`}
            >
              {IMAGERY[id].label}
            </button>
          ))}
        </div>
        <div className="mt-1.5 text-[10px] leading-relaxed text-slate-600">
          {meta.date} — {meta.provenance}
        </div>
      </div>

      <div className="border-b border-slate-800 px-4 py-3">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">In this view</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stat value={visible.length.toLocaleString()} label="buildings" />
          <Stat value={severe.toLocaleString()} label="severe exposure" tone="text-red-400" />
          <Stat value={`~${pop.toLocaleString()}`} label="people (est.)" />
          <Stat value={graded.length.toLocaleString()} label="graded" tone="text-cyan-300" />
        </div>
      </div>

      {state.eventContext && (
        <div className="border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-400" />
            <div className="text-[11px] uppercase tracking-wider text-violet-300">
              Event context — from the agent
            </div>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
            {state.eventContext.summary}
          </p>
          <div className="mt-1.5 text-[10px] text-slate-600">
            Agent-supplied, not from this site&apos;s data. Source: {state.eventContext.attribution}
          </div>
        </div>
      )}

      {byGrade.size > 0 && (
        <div className="border-b border-slate-800 px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            Assessments ({state.assessments.size})
          </div>
          <div className="mt-2 space-y-1">
            {[...byGrade].map(([g, n]) => (
              <div key={g} className="flex items-center gap-2 text-[11px]">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: GRADE_COLOR[g] }}
                />
                <span className="flex-1 text-slate-400">{g}</span>
                <span className="text-slate-200">{n}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-3 text-[10px] text-slate-600">
            <span>
              {[...state.assessments.values()].filter((a) => a.source === "you").length} yours
            </span>
            <span>
              {[...state.assessments.values()].filter((a) => a.source === "agent").length} agent
            </span>
            <span>{[...state.assessments.values()].filter((a) => a.locked).length} locked</span>
          </div>
        </div>
      )}

      {state.taskings.length > 0 && (
        <div className="border-b border-slate-800 px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Dispatch log</div>
          {state.taskings.map((t) => (
            <div key={t.id} className="mt-1.5 text-[11px]">
              <span className={t.status === "dispatched" ? "text-emerald-400" : "text-slate-500"}>
                {t.status === "dispatched" ? "✓ dispatched" : "✕ rejected"}
              </span>
              <span className="text-slate-400">
                {" "}
                · {t.buildingIds.length} buildings → {t.crew} ({t.priority})
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto px-4 py-3">
        <button
          onClick={() => store.reset()}
          className="w-full rounded border border-slate-800 px-2 py-1.5 text-[11px] text-slate-500 transition hover:border-slate-600 hover:text-slate-300"
        >
          Reset demo
        </button>
      </div>
    </div>
  );
}

function Stat({ value, label, tone = "text-slate-100" }: { value: string; label: string; tone?: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/50 px-2 py-1.5">
      <div className={`text-sm font-medium ${tone}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}

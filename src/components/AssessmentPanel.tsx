"use client";

import { store, useStore } from "@/lib/store";
import { DAMAGE_GRADES } from "@/lib/types";
import { GRADE_COLOR } from "./MapCanvas";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-[12px]">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-200">{value}</span>
    </div>
  );
}

export default function AssessmentPanel() {
  const selectedId = useStore((s) => s.selectedId);
  const building = useStore((s) => (s.selectedId ? s.byId.get(s.selectedId) : null));
  const assessment = useStore((s) => (s.selectedId ? s.assessments.get(s.selectedId) : null));
  const notes = useStore((s) => s.notes.filter((n) => n.buildingId === s.selectedId));

  if (!selectedId || !building) {
    return (
      <div className="p-4 text-[12px] leading-relaxed text-slate-500">
        Click any building on the imagery to assess it.
        <div className="mt-2 text-slate-600">
          Your grades lock automatically — the agent can propose, but it cannot overwrite
          a call you have made.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-4 py-3">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">Selected</div>
        <div className="mt-0.5 truncate text-sm font-medium text-slate-100">
          {building.name ?? building.addr ?? building.id}
        </div>
        <div className="text-[11px] text-slate-500">
          {building.kind} · {building.id}
        </div>
      </div>

      <div className="border-b border-slate-800 px-4 py-2">
        <Row label="Footprint" value={`${building.area_m2.toLocaleString()} m²`} />
        <Row label="Floors" value={building.floors ?? 1} />
        <Row label="Ground elevation" value={building.elev_m == null ? "—" : `${building.elev_m} m`} />
        <Row
          label="Modelled surge depth"
          value={building.surge_depth_m == null ? "—" : `${building.surge_depth_m} m`}
        />
        <Row
          label="Exposure"
          value={
            <span
              className={
                building.exposure === "Severe"
                  ? "text-red-400"
                  : building.exposure === "High"
                    ? "text-orange-400"
                    : "text-slate-300"
              }
            >
              {building.exposure}
            </span>
          }
        />
        <Row
          label="Est. occupancy"
          value={
            <>
              ~{building.occupancy_est}
              {building.occupancy_inferred && (
                <span className="ml-1 text-slate-500" title="No OSM use tag; use inferred from footprint">
                  (inferred)
                </span>
              )}
            </>
          }
        />
      </div>

      <div className="px-4 py-3">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">Your damage call</div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {DAMAGE_GRADES.map((g) => {
            const active = assessment?.grade === g;
            return (
              <button
                key={g}
                onClick={() =>
                  store.writeAssessment(building.id, g, "Assessed from imagery by the operator.", "you")
                }
                className={`rounded border px-2 py-1.5 text-left text-[11px] transition ${
                  active
                    ? "border-transparent text-slate-950"
                    : "border-slate-700 text-slate-300 hover:border-slate-500"
                }`}
                style={active ? { backgroundColor: GRADE_COLOR[g] } : undefined}
              >
                {g}
              </button>
            );
          })}
        </div>

        {assessment && (
          <div className="mt-3 rounded border border-slate-800 bg-slate-900/60 p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className={assessment.source === "you" ? "text-cyan-300" : "text-violet-300"}>
                {assessment.source === "you" ? "Your call" : "Agent proposal"}
              </span>
              <button
                onClick={() => store.setLocked(building.id, !assessment.locked)}
                className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-slate-500"
              >
                {assessment.locked ? "🔒 locked" : "unlocked"}
              </button>
            </div>
            <div className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              {assessment.rationale}
            </div>
            {assessment.locked && assessment.source === "you" && (
              <div className="mt-1.5 text-[10px] text-slate-600">
                Agent writes to this building will be refused.
              </div>
            )}
          </div>
        )}

        {notes.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Notes</div>
            {notes.map((n) => (
              <div key={n.id} className="mt-1.5 rounded border border-slate-800 bg-slate-900/60 p-2">
                <div className={`text-[10px] ${n.source === "agent" ? "text-violet-300" : "text-cyan-300"}`}>
                  {n.source === "agent" ? "agent" : "you"}
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-slate-300">{n.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

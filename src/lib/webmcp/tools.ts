"use client";

import { inViewport, store, type State } from "../store";
import { mapBus, PLACES } from "../mapBus";
import { DAMAGE_GRADES, type Building, type DamageGrade } from "../types";
import { IMAGERY } from "../imagery";
import { fail, ok, throwIfAborted, toFailure } from "./result";
import type { GroundtruthTool } from "./useWebMCP";

const str = (description: string, extra: Record<string, unknown> = {}) => ({
  type: "string", description, ...extra,
});

/** Page size for every listing tool. Keeps results inside the 1.5K budget. */
const PAGE = 25;

function fmtBuilding(b: Building, s: State): string {
  const a = s.assessments.get(b.id);
  const bits = [
    `${b.id} — ${b.kind}`,
    b.name ?? b.addr ?? null,
    `${b.area_m2} m²`,
    b.floors ? `${b.floors} floor${b.floors > 1 ? "s" : ""}` : null,
    b.elev_m == null ? null : `ground ${b.elev_m} m`,
    `exposure ${b.exposure}`,
    b.occupancy_est ? `~${b.occupancy_est} people${b.occupancy_inferred ? " (inferred)" : ""}` : null,
    a ? `graded "${a.grade}" by ${a.source}${a.locked ? ", LOCKED" : ""}` : "ungraded",
  ].filter(Boolean);
  return bits.join(" · ");
}

function requireViewport(s: State) {
  if (!s.viewport) throw new Error("The map has not finished loading. Try again in a moment.");
  return s.viewport;
}

/** Never trust an id from tool input — re-derive it against real state. */
function resolveBuilding(s: State, raw: unknown): Building {
  const id = String(raw ?? "").trim();
  const b = s.byId.get(id);
  if (!b) {
    throw new Error(
      `No building with id "${id}". Ids come from list_in_view — call that first and use an id exactly as returned.`,
    );
  }
  return b;
}

function resolveGrade(raw: unknown): DamageGrade {
  const want = String(raw ?? "").trim().toLowerCase();
  const match = DAMAGE_GRADES.find((g) => g.toLowerCase() === want);
  if (!match) {
    throw new Error(
      `"${raw}" is not a damage grade. Use exactly one of: ${DAMAGE_GRADES.join(", ")}.`,
    );
  }
  return match;
}

function decodeCursor(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type ToolAvailability = {
  /** compare_imagery only exists when both layers cover the current view. */
  bothImagery: boolean;
  /** export_report only exists once there is something to export. */
  hasAssessments: boolean;
};

export function createTools(availability: ToolAvailability): GroundtruthTool[] {
  const readOnly = { readOnlyHint: true, untrustedContentHint: true };

  return [
    // ---- READ ---------------------------------------------------------------
    {
      name: "get_view",
      description:
        "What the assessor is looking at RIGHT NOW: map bounding box, zoom, which imagery layer and capture date is displayed, how many buildings are in frame, and which building is selected. Call this first — every other tool is scoped to this view.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: readOnly,
      chips: ["What am I looking at right now?"],
      execute: async (_input, options) => {
        try {
          throwIfAborted(options?.signal);
          const s = store.get();
          const v = requireViewport(s);
          const visible = inViewport(s);
          const sel = s.selectedId ? s.byId.get(s.selectedId) : null;
          const graded = visible.filter((b) => s.assessments.has(b.id)).length;
          return ok(
            [
              `Area: Fort Myers Beach / Estero Island, Lee County, FL`,
              `Event: Hurricane Ian, 28 September 2022`,
              `Imagery layer: ${IMAGERY[s.imagery].label} — ${IMAGERY[s.imagery].date}. ${IMAGERY[s.imagery].provenance}`,
              `Viewport bbox: W ${v.west.toFixed(4)}, S ${v.south.toFixed(4)}, E ${v.east.toFixed(4)}, N ${v.north.toFixed(4)} at zoom ${v.zoom.toFixed(1)}`,
              `Buildings in frame: ${visible.length} (${graded} graded, ${visible.length - graded} ungraded)`,
              sel ? `Selected: ${fmtBuilding(sel, s)}` : `Selected: nothing`,
              s.eventContext ? `Event context on page: yes (set by agent)` : `Event context on page: not yet set`,
            ].join("\n"),
          );
        } catch (e) {
          return toFailure(e);
        }
      },
    },

    {
      name: "list_in_view",
      description:
        "List buildings inside the current viewport, newest-first by exposure. Returns a bounded page with a cursor plus summary statistics for the whole view. Filter by exposure band, damage grade, or whether a building has been graded yet. Use this to find candidates, then get_feature for detail.",
      inputSchema: {
        type: "object",
        properties: {
          exposure: str("Only this surge-exposure band: Severe, High, Moderate, Low or Unknown.", {
            enum: ["Severe", "High", "Moderate", "Low", "Unknown"],
          }),
          status: str("Filter by assessment status.", { enum: ["graded", "ungraded", "locked"] }),
          limit: { type: "integer", description: `Max rows to return, 1-${PAGE}.`, minimum: 1, maximum: PAGE },
          cursor: str("Opaque cursor from a previous call's `next cursor` line."),
        },
        additionalProperties: false,
      },
      annotations: readOnly,
      chips: [
        "List the ungraded buildings in view with severe surge exposure",
        "How many people are in the buildings I'm looking at?",
      ],
      execute: async (input, options) => {
        try {
          throwIfAborted(options?.signal);
          const s = store.get();
          requireViewport(s);
          let rows = inViewport(s);
          if (rows.length === 0) {
            return fail(
              "No buildings in the current view. The map may be panned off the island — call set_view with place \"Estero Island\" to get back.",
            );
          }

          const totalPop = rows.reduce((n, b) => n + b.occupancy_est, 0);
          const bands: Record<string, number> = {};
          for (const b of rows) bands[b.exposure] = (bands[b.exposure] ?? 0) + 1;

          const exposure = input.exposure ? String(input.exposure) : null;
          if (exposure) rows = rows.filter((b) => b.exposure === exposure);
          const status = input.status ? String(input.status) : null;
          if (status === "graded") rows = rows.filter((b) => s.assessments.has(b.id));
          if (status === "ungraded") rows = rows.filter((b) => !s.assessments.has(b.id));
          if (status === "locked") rows = rows.filter((b) => s.assessments.get(b.id)?.locked);

          if (rows.length === 0) {
            return ok(
              `0 buildings in view match that filter. In view overall: ${Object.entries(bands).map(([k, v]) => `${v} ${k}`).join(", ")}. Relax the filter or call set_view to move.`,
            );
          }

          const order = { Severe: 0, High: 1, Moderate: 2, Low: 3, Unknown: 4 } as const;
          rows.sort((a, b) => order[a.exposure] - order[b.exposure] || b.occupancy_est - a.occupancy_est);

          const limit = Math.min(PAGE, Math.max(1, Number(input.limit ?? PAGE)));
          const start = decodeCursor(input.cursor);
          const page = rows.slice(start, start + limit);
          const next = start + limit < rows.length ? start + limit : null;

          return ok(
            [
              `${rows.length} match${rows.length === 1 ? "" : "es"} · showing ${start + 1}-${start + page.length}`,
              `View totals: ${Object.entries(bands).map(([k, v]) => `${v} ${k}`).join(", ")} · ~${totalPop.toLocaleString()} people (estimate)`,
              "",
              ...page.map((b) => fmtBuilding(b, s)),
              next == null ? "" : `\nnext cursor: ${next}`,
            ].join("\n"),
          );
        } catch (e) {
          return toFailure(e);
        }
      },
    },

    {
      name: "get_feature",
      description:
        "Full detail for one building: use, footprint area, floors, ground elevation, modelled surge depth, estimated occupancy, distance to the nearest shelter and fire station, and any assessment or notes already recorded against it.",
      inputSchema: {
        type: "object",
        properties: { id: str("Building id exactly as returned by list_in_view, e.g. b95954642.") },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: readOnly,
      chips: [],
      execute: async (input, options) => {
        try {
          throwIfAborted(options?.signal);
          const s = store.get();
          const b = resolveBuilding(s, input.id);
          const a = s.assessments.get(b.id);
          const notes = s.notes.filter((n) => n.buildingId === b.id);
          const near = (cat: (c: string) => boolean) => {
            const pts = s.infrastructure.filter((i) => cat(i.category));
            if (!pts.length) return null;
            const d = pts
              .map((i) => ({ i, km: haversineKm(b.lat, b.lon, i.lat, i.lon) }))
              .sort((x, y) => x.km - y.km)[0];
            return `${d.i.name} (${d.km.toFixed(2)} km)`;
          };
          return ok(
            [
              `${b.id} — ${b.kind}${b.name ? ` "${b.name}"` : ""}`,
              b.addr ? `Address: ${b.addr}` : `Address: not in OSM`,
              `Footprint ${b.area_m2} m², ${b.floors ?? 1} floor(s)`,
              `Ground elevation ${b.elev_m ?? "unknown"} m (USGS 3DEP 10m)`,
              `Modelled surge depth at peak: ${b.surge_depth_m ?? "unknown"} m — exposure ${b.exposure}`,
              `Estimated occupancy ~${b.occupancy_est}${b.occupancy_inferred ? " (use inferred from footprint, no OSM tag)" : ""}`,
              `Nearest shelter: ${near((c) => c === "Shelter") ?? "none mapped"}`,
              `Nearest fire station: ${near((c) => c === "Fire station") ?? "none mapped"}`,
              a
                ? `Assessment: "${a.grade}" by ${a.source}${a.locked ? " (LOCKED — agent writes refused)" : ""} — ${a.rationale}`
                : `Assessment: none yet`,
              notes.length ? `Notes:\n${notes.map((n) => `  [${n.source}] ${n.text}`).join("\n")}` : `Notes: none`,
            ].join("\n"),
          );
        } catch (e) {
          return toFailure(e);
        }
      },
    },

    {
      name: "get_assessments",
      description:
        "Every damage assessment recorded so far in this session, with who wrote each one and whether the human has locked it. Use before proposing grades so you do not duplicate or contradict work the assessor has already done.",
      inputSchema: {
        type: "object",
        properties: {
          author: str("Only records written by this author.", { enum: ["you", "agent"] }),
          limit: { type: "integer", description: `Max rows, 1-${PAGE}.`, minimum: 1, maximum: PAGE },
          cursor: str("Opaque cursor from a previous call."),
        },
        additionalProperties: false,
      },
      annotations: readOnly,
      chips: ["Summarise the assessments recorded so far"],
      execute: async (input, options) => {
        try {
          throwIfAborted(options?.signal);
          const s = store.get();
          let rows = [...s.assessments.values()].sort((a, b) => b.at - a.at);
          const author = input.author ? String(input.author) : null;
          if (author) rows = rows.filter((r) => r.source === author);
          if (!rows.length) {
            return ok("No assessments recorded yet. Grade something with propose_grade, or ask the assessor to.");
          }
          const byGrade: Record<string, number> = {};
          for (const r of rows) byGrade[r.grade] = (byGrade[r.grade] ?? 0) + 1;
          const limit = Math.min(PAGE, Math.max(1, Number(input.limit ?? PAGE)));
          const start = decodeCursor(input.cursor);
          const page = rows.slice(start, start + limit);
          const next = start + limit < rows.length ? start + limit : null;
          return ok(
            [
              `${rows.length} assessment(s): ${Object.entries(byGrade).map(([k, v]) => `${v} ${k}`).join(", ")}`,
              `${rows.filter((r) => r.locked).length} locked by the assessor.`,
              "",
              ...page.map(
                (r) => `${r.buildingId} — "${r.grade}" by ${r.source}${r.locked ? " [LOCKED]" : ""} — ${r.rationale}`,
              ),
              next == null ? "" : `\nnext cursor: ${next}`,
            ].join("\n"),
          );
        } catch (e) {
          return toFailure(e);
        }
      },
    },

    // ---- NAVIGATION ---------------------------------------------------------
    {
      name: "set_view",
      description:
        "Move the assessor's map. Give either a named place on Estero Island or an explicit bounding box. This changes what the human sees, so say why you are moving them. Named places: Estero Island, Times Square, north end, mid island, south end, Matanzas Pass Bridge, Big Carlos Pass, Santini Plaza.",
      inputSchema: {
        type: "object",
        properties: {
          place: str("A named place on Estero Island, e.g. \"Matanzas Pass Bridge\"."),
          bbox: {
            type: "array",
            description: "Explicit bounds as [west, south, east, north] in WGS84 degrees.",
            items: { type: "number" },
            minItems: 4,
            maxItems: 4,
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      chips: ["Take me to the Matanzas Pass Bridge and tell me what's there"],
      execute: async (input, options) => {
        try {
          throwIfAborted(options?.signal);
          const cmds = mapBus.get();
          if (!cmds) return fail("The map is not ready yet. Try again in a moment.");

          let bounds: { west: number; south: number; east: number; north: number } | null = null;
          if (input.place != null) {
            const key = String(input.place).trim().toLowerCase();
            bounds = PLACES[key] ?? null;
            if (!bounds) {
              return fail(
                `Unknown place "${input.place}". Known places: ${Object.keys(PLACES).join(", ")}. Or pass an explicit bbox.`,
              );
            }
          } else if (Array.isArray(input.bbox)) {
            const [w, s2, e, n] = (input.bbox as unknown[]).map(Number);
            if ([w, s2, e, n].some((v) => !Number.isFinite(v)) || w >= e || s2 >= n) {
              return fail("bbox must be four finite numbers [west, south, east, north] with west<east and south<north.");
            }
            bounds = { west: w, south: s2, east: e, north: n };
          } else {
            return fail("Pass either `place` or `bbox`. Neither was given.");
          }

          cmds.fitBounds(bounds);
          await new Promise((r) => setTimeout(r, 550));
          throwIfAborted(options?.signal);
          const s = store.get();
          const visible = inViewport(s);
          return ok(
            `Moved the map to ${input.place ?? "the given bounds"}. ${visible.length} buildings now in frame (${visible.filter((b) => b.exposure === "Severe").length} severe exposure). The assessor can see this.`,
          );
        } catch (e) {
          return toFailure(e);
        }
      },
    },

    {
      name: "select_feature",
      description:
        "Highlight one building on the assessor's map and open its detail panel. Use this to point at what you are talking about instead of describing coordinates.",
      inputSchema: {
        type: "object",
        properties: { id: str("Building id from list_in_view.") },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      chips: [],
      execute: async (input, options) => {
        try {
          throwIfAborted(options?.signal);
          const s = store.get();
          const b = resolveBuilding(s, input.id);
          store.select(b.id);
          mapBus.get()?.flyTo(b.lat, b.lon, Math.max(17, s.viewport?.zoom ?? 17));
          return ok(`Selected ${b.id} (${b.kind}) and centred the map on it. The assessor is now looking at it.`);
        } catch (e) {
          return toFailure(e);
        }
      },
    },

    // ---- WRITE (proposal model) --------------------------------------------
    {
      name: "propose_grade",
      description:
        "Record a proposed damage grade for one building, attributed to the agent. Refused if the assessor has locked that building — human judgement always wins. Always give a rationale that cites what you actually used (exposure band, elevation, occupancy, imagery).",
      inputSchema: {
        type: "object",
        properties: {
          id: str("Building id from list_in_view."),
          grade: str(`One of: ${DAMAGE_GRADES.join(", ")}.`, { enum: [...DAMAGE_GRADES] }),
          rationale: str("Why this grade, in one sentence. Cite the evidence you used.", { maxLength: 300 }),
        },
        required: ["id", "grade", "rationale"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      chips: [],
      execute: async (input, options) => {
        try {
          throwIfAborted(options?.signal);
          const s = store.get();
          const b = resolveBuilding(s, input.id);
          const grade = resolveGrade(input.grade);
          const rationale = String(input.rationale ?? "").trim().slice(0, 300);
          if (!rationale) return fail("`rationale` is required and cannot be empty.");
          const res = store.writeAssessment(b.id, grade, rationale, "agent");
          if (!res.ok) return fail(res.reason);
          return ok(`Recorded "${grade}" against ${b.id} as an agent proposal. It is now visible in the assessor's panel and unlocked, so they can override it.`);
        } catch (e) {
          return toFailure(e);
        }
      },
    },

    {
      name: "propose_batch",
      description:
        "Apply one damage grade to several buildings at once. Atomic: if ANY building in the list is locked by the assessor, nothing is written and the locked ids are returned. Use for sweeps like grading every severe-exposure structure on one block.",
      inputSchema: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            description: "Building ids from list_in_view. Max 40.",
            items: { type: "string" },
            maxItems: 40,
          },
          grade: str(`One of: ${DAMAGE_GRADES.join(", ")}.`, { enum: [...DAMAGE_GRADES] }),
          rationale: str("Why this grade applies to the whole set, in one sentence.", { maxLength: 300 }),
        },
        required: ["ids", "grade", "rationale"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      chips: [],
      execute: async (input, options) => {
        try {
          throwIfAborted(options?.signal);
          const s = store.get();
          const raw = Array.isArray(input.ids) ? (input.ids as unknown[]) : [];
          if (!raw.length) return fail("`ids` was empty. Call list_in_view to get ids first.");
          if (raw.length > 40) return fail(`${raw.length} ids is over the 40-id limit. Split the sweep.`);
          const grade = resolveGrade(input.grade);
          const rationale = String(input.rationale ?? "").trim().slice(0, 300);
          if (!rationale) return fail("`rationale` is required and cannot be empty.");

          const buildings = raw.map((id) => resolveBuilding(s, id));
          const locked = buildings.filter((b) => s.assessments.get(b.id)?.locked);
          if (locked.length) {
            return fail(
              `Refused — nothing was written. ${locked.length} of ${buildings.length} are locked by the assessor: ${locked.map((b) => b.id).join(", ")}. Re-run without them.`,
            );
          }
          for (const b of buildings) store.writeAssessment(b.id, grade, rationale, "agent");
          return ok(`Recorded "${grade}" against ${buildings.length} buildings as agent proposals. All are unlocked and visible for the assessor to override.`);
        } catch (e) {
          return toFailure(e);
        }
      },
    },

    {
      name: "add_note",
      description:
        "Attach a short note to one building under the agent's own identity. Notes are advisory context for the human assessor — observations, caveats, things worth checking on the ground. They are never presented as the assessor's own words.",
      inputSchema: {
        type: "object",
        properties: {
          id: str("Building id from list_in_view."),
          text: str("The note. One or two sentences.", { maxLength: 280 }),
        },
        required: ["id", "text"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      chips: [],
      execute: async (input, options) => {
        try {
          throwIfAborted(options?.signal);
          const s = store.get();
          const b = resolveBuilding(s, input.id);
          const text = String(input.text ?? "").trim().slice(0, 280);
          if (!text) return fail("`text` is required and cannot be empty.");
          store.addNote(b.id, text, "agent");
          return ok(`Note added to ${b.id}, attributed to the agent. It is visible in the assessor's detail panel.`);
        } catch (e) {
          return toFailure(e);
        }
      },
    },

    {
      name: "set_event_context",
      description:
        "Write what YOU know about this event into the page — storm track, surge behaviour, comparable historical events, anything the site itself has no way to know. This is the one tool where your own world knowledge, not the page's data, is the payload. Say where it came from.",
      inputSchema: {
        type: "object",
        properties: {
          summary: str("What the assessor should know about this event. 2-5 sentences.", { maxLength: 900 }),
          attribution: str("Where this came from, e.g. \"model knowledge, NHC TCR AL092022\".", { maxLength: 120 }),
        },
        required: ["summary", "attribution"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      chips: ["Tell me what you know about how Ian's surge hit this island, and put it on the page"],
      execute: async (input, options) => {
        try {
          throwIfAborted(options?.signal);
          const summary = String(input.summary ?? "").trim().slice(0, 900);
          const attribution = String(input.attribution ?? "").trim().slice(0, 120);
          if (!summary) return fail("`summary` is required and cannot be empty.");
          if (!attribution) return fail("`attribution` is required — the assessor must be able to see where this claim came from.");
          store.setEventContext({ summary, attribution, at: Date.now() });
          return ok(`Event context is now on the page, labelled as agent-supplied and attributed to "${attribution}". The assessor can read it alongside the map.`);
        } catch (e) {
          return toFailure(e);
        }
      },
    },

    // ---- CONSEQUENTIAL (hard in-page human gate) ----------------------------
    {
      name: "create_tasking",
      description:
        "Build a field crew dispatch list from graded buildings and send it for the assessor's review. This does NOT dispatch anyone: it opens a review dialog and this call blocks until a human clicks approve or reject. Expect to wait. If the assessor rejects, respect it and do not retry with the same list.",
      inputSchema: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            description: "Buildings the crew should visit. Max 25.",
            items: { type: "string" },
            maxItems: 25,
          },
          crew: str("Which crew or capability is needed, e.g. \"USAR team 2\", \"structural engineer\".", { maxLength: 80 }),
          priority: str("Dispatch urgency.", { enum: ["Immediate", "Same day", "Routine"] }),
        },
        required: ["ids", "crew", "priority"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      chips: ["Draft a tasking for the worst-hit buildings in view and send it for my review"],
      execute: async (input, options) => {
        try {
          throwIfAborted(options?.signal);
          const s = store.get();
          const raw = Array.isArray(input.ids) ? (input.ids as unknown[]) : [];
          if (!raw.length) return fail("`ids` was empty. A tasking needs at least one building.");
          if (raw.length > 25) return fail(`${raw.length} ids is over the 25-building limit for one tasking.`);
          const buildings = raw.map((id) => resolveBuilding(s, id));
          const crew = String(input.crew ?? "").trim().slice(0, 80);
          if (!crew) return fail("`crew` is required.");
          const priority = String(input.priority ?? "");
          if (!["Immediate", "Same day", "Routine"].includes(priority)) {
            return fail(`"${priority}" is not a priority. Use Immediate, Same day or Routine.`);
          }
          if (s.pendingTasking) {
            return fail("A tasking is already awaiting the assessor's review. Wait for them to clear it before proposing another.");
          }

          const id = `t${Date.now().toString(36)}`;
          store.proposeTasking({
            id,
            buildingIds: buildings.map((b) => b.id),
            crew,
            priority: priority as "Immediate" | "Same day" | "Routine",
            status: "awaiting review",
            at: Date.now(),
          });

          // Block on the human. The agent's stop button must cancel this too,
          // so the signal races the click rather than being checked after it.
          const decision = await new Promise<"dispatched" | "rejected" | "cancelled">((resolve) => {
            const unsubscribe = store.subscribe(() => {
              const now = store.get();
              if (now.pendingTasking?.id === id) return;
              const settled = now.taskings.find((t) => t.id === id);
              unsubscribe();
              resolve(settled?.status === "dispatched" || settled?.status === "rejected"
                ? settled.status
                : "cancelled");
            });
            options?.signal?.addEventListener("abort", () => {
              unsubscribe();
              store.resolveTasking(id, "rejected");
              resolve("cancelled");
            }, { once: true });
          });

          if (decision === "cancelled") return fail("Cancelled before the assessor decided. The tasking was withdrawn.");
          if (decision === "rejected") {
            return fail(`The assessor REJECTED this tasking. Do not re-send the same list — ask them what to change.`);
          }
          const pop = buildings.reduce((n, b) => n + b.occupancy_est, 0);
          return ok(`The assessor APPROVED the tasking. ${buildings.length} buildings dispatched to ${crew} at ${priority} priority (~${pop} people affected). It is now in the dispatch log.`);
        } catch (e) {
          return toFailure(e);
        }
      },
    },

    // ---- STATE-SCOPED (registered/unregistered -> fires toolchange) ----------
    {
      name: "compare_imagery",
      description:
        "Switch the assessor's map between NOAA's storm-day aerial imagery (30 Sep 2022, two days after Ian made landfall) and an undated Esri reference image showing the neighbourhood intact. Only available while both layers cover the visible area. The reference layer has no published capture date — do not describe it as a dated 'before' image.",
      inputSchema: {
        type: "object",
        properties: {
          layer: str("Which layer to show.", { enum: ["storm-day", "reference"] }),
        },
        required: ["layer"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      available: availability.bothImagery,
      chips: ["Show me the before imagery for this block"],
      execute: async (input, options) => {
        try {
          throwIfAborted(options?.signal);
          const layer = String(input.layer ?? "");
          if (layer !== "storm-day" && layer !== "reference") {
            return fail(`"${layer}" is not a layer. Use "storm-day" or "reference".`);
          }
          store.setImagery(layer);
          const meta = IMAGERY[layer];
          return ok(`The assessor's map is now showing the ${meta.label} layer (${meta.date}). ${meta.provenance}`);
        } catch (e) {
          return toFailure(e);
        }
      },
    },

    {
      name: "export_report",
      description:
        "Produce a plain-text rapid damage assessment summary of everything recorded in this session, ready to paste into a situation report. Only available once at least one assessment exists.",
      inputSchema: {
        type: "object",
        properties: {
          scope: str("Whole island or just what is on screen.", { enum: ["all", "current view"] }),
        },
        additionalProperties: false,
      },
      annotations: readOnly,
      available: availability.hasAssessments,
      chips: ["Write up a situation report from what we've assessed"],
      execute: async (input, options) => {
        try {
          throwIfAborted(options?.signal);
          const s = store.get();
          const scope = String(input.scope ?? "all");
          const ids =
            scope === "current view" ? new Set(inViewport(s).map((b) => b.id)) : null;
          const rows = [...s.assessments.values()].filter((a) => !ids || ids.has(a.buildingId));
          if (!rows.length) return fail("Nothing assessed in that scope yet.");
          const byGrade: Record<string, number> = {};
          let pop = 0;
          for (const r of rows) {
            byGrade[r.grade] = (byGrade[r.grade] ?? 0) + 1;
            pop += s.byId.get(r.buildingId)?.occupancy_est ?? 0;
          }
          return ok(
            [
              `RAPID DAMAGE ASSESSMENT — Fort Myers Beach / Estero Island`,
              `Event: Hurricane Ian, 28 Sep 2022 · Scope: ${scope}`,
              `Structures assessed: ${rows.length} · est. population affected ~${pop.toLocaleString()}`,
              ...Object.entries(byGrade).map(([g, n]) => `  ${g}: ${n}`),
              `Human-locked: ${rows.filter((r) => r.locked).length} · agent-proposed: ${rows.filter((r) => r.source === "agent").length}`,
              s.taskings.length ? `Taskings dispatched: ${s.taskings.filter((t) => t.status === "dispatched").length}` : `Taskings dispatched: 0`,
              ``,
              `Elevation: USGS 3DEP 10m. Footprints: OpenStreetMap (ODbL). Occupancy figures are planning estimates.`,
            ].join("\n"),
          );
        } catch (e) {
          return toFailure(e);
        }
      },
    },
  ];
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

"use client";

import { useSyncExternalStore } from "react";
import type {
  Assessment, Building, DamageGrade, EventContext, ImageryLayer,
  Infrastructure, Note, Road, Tasking, Viewport,
} from "./types";

export type PendingTasking = Omit<Tasking, "status"> & { status: "awaiting review" };

export type State = {
  loaded: boolean;
  buildings: Building[];
  byId: Map<string, Building>;
  infrastructure: Infrastructure[];
  roads: Road[];
  viewport: Viewport | null;
  imagery: ImageryLayer;
  imageryAvailable: ImageryLayer[];
  selectedId: string | null;
  assessments: Map<string, Assessment>;
  notes: Note[];
  eventContext: EventContext | null;
  /** At most one tasking can await review; it blocks until a human clicks. */
  pendingTasking: PendingTasking | null;
  taskings: Tasking[];
};

const initial: State = {
  loaded: false,
  buildings: [],
  byId: new Map(),
  infrastructure: [],
  roads: [],
  viewport: null,
  imagery: "post-event",
  imageryAvailable: ["pre-event", "post-event"],
  selectedId: null,
  assessments: new Map(),
  notes: [],
  eventContext: null,
  pendingTasking: null,
  taskings: [],
};

let state: State = initial;
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  hydrate(buildings: Building[], infrastructure: Infrastructure[], roads: Road[]) {
    set({
      loaded: true,
      buildings,
      byId: new Map(buildings.map((b) => [b.id, b])),
      infrastructure,
      roads,
    });
  },

  setViewport: (viewport: Viewport) => set({ viewport }),
  setImagery: (imagery: ImageryLayer) => set({ imagery }),
  select: (selectedId: string | null) => set({ selectedId }),

  /**
   * The one write path for assessments. `source` decides the rules:
   * a human write always wins and may lock; an agent write is refused
   * against a locked record. Returns why it was refused, for the tool result.
   */
  writeAssessment(
    buildingId: string,
    grade: DamageGrade,
    rationale: string,
    source: Assessment["source"],
  ): { ok: true } | { ok: false; reason: string } {
    if (!state.byId.has(buildingId)) {
      return { ok: false, reason: `No building with id "${buildingId}".` };
    }
    const existing = state.assessments.get(buildingId);
    if (existing?.locked && source === "agent") {
      return {
        ok: false,
        reason: `"${buildingId}" is locked by the human assessor as "${existing.grade}". Agent writes cannot overwrite a locked record.`,
      };
    }
    const next = new Map(state.assessments);
    next.set(buildingId, {
      buildingId,
      grade,
      rationale,
      source,
      // A human write locks by default; the agent can never set this flag.
      locked: source === "you" ? true : (existing?.locked ?? false),
      at: Date.now(),
    });
    set({ assessments: next });
    return { ok: true };
  },

  setLocked(buildingId: string, locked: boolean) {
    const existing = state.assessments.get(buildingId);
    if (!existing) return;
    const next = new Map(state.assessments);
    next.set(buildingId, { ...existing, locked, source: "you", at: Date.now() });
    set({ assessments: next });
  },

  addNote(buildingId: string, text: string, source: Note["source"]) {
    const note: Note = {
      id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      buildingId, text, source, at: Date.now(),
    };
    set({ notes: [note, ...state.notes] });
    return note;
  },

  setEventContext: (eventContext: EventContext) => set({ eventContext }),

  proposeTasking(tasking: PendingTasking) {
    set({ pendingTasking: tasking });
  },
  resolveTasking(id: string, status: "dispatched" | "rejected") {
    const pending = state.pendingTasking;
    if (!pending || pending.id !== id) return;
    set({
      pendingTasking: null,
      taskings: [{ ...pending, status }, ...state.taskings],
    });
  },

  reset() {
    set({
      selectedId: null,
      assessments: new Map(),
      notes: [],
      eventContext: null,
      pendingTasking: null,
      taskings: [],
      imagery: "post-event",
    });
  },
};

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(state),
    () => selector(initial),
  );
}

/** Buildings whose centroid falls inside the current viewport. */
export function inViewport(s: State): Building[] {
  const v = s.viewport;
  if (!v) return [];
  return s.buildings.filter(
    (b) => b.lon >= v.west && b.lon <= v.east && b.lat >= v.south && b.lat <= v.north,
  );
}

"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import type {
  Assessment, Building, DamageGrade, EventContext, ImageryLayer,
  Infrastructure, Note, Road, Tasking, Viewport,
} from "./types";
import { DAMAGE_GRADES } from "./types";

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
  imagery: "storm-day",
  imageryAvailable: ["storm-day", "reference"],
  selectedId: null,
  assessments: new Map(),
  notes: [],
  eventContext: null,
  pendingTasking: null,
  taskings: [],
};

const SESSION_KEY = "groundtruth.console.v1";
const SESSION_VERSION = 1;

type PersistedState = {
  version: typeof SESSION_VERSION;
  assessments: Assessment[];
  notes: Note[];
  eventContext: EventContext | null;
  pendingTasking: PendingTasking | null;
  taskings: Tasking[];
  viewport: Viewport | null;
  imagery: ImageryLayer;
  selectedId: string | null;
};

let state: State = initial;
const listeners = new Set<() => void>();
let persistenceReady = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isAuthor(value: unknown): value is Assessment["source"] {
  return value === "you" || value === "agent";
}

function isAssessment(value: unknown): value is Assessment {
  if (!isRecord(value)) return false;
  return (
    isString(value.buildingId) &&
    (DAMAGE_GRADES as readonly unknown[]).includes(value.grade) &&
    isString(value.rationale) &&
    isAuthor(value.source) &&
    typeof value.locked === "boolean" &&
    isFiniteNumber(value.at)
  );
}

function isNote(value: unknown): value is Note {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.buildingId) &&
    isString(value.text) &&
    isAuthor(value.source) &&
    isFiniteNumber(value.at)
  );
}

function isEventContext(value: unknown): value is EventContext {
  if (!isRecord(value)) return false;
  return isString(value.summary) && isString(value.attribution) && isFiniteNumber(value.at);
}

function isViewport(value: unknown): value is Viewport {
  if (!isRecord(value)) return false;
  const fields = [
    value.west, value.south, value.east, value.north,
    value.zoom, value.centerLat, value.centerLon,
  ];
  return (
    fields.every(isFiniteNumber) &&
    (value.west as number) >= -180 &&
    (value.east as number) <= 180 &&
    (value.south as number) >= -90 &&
    (value.north as number) <= 90 &&
    (value.west as number) < (value.east as number) &&
    (value.south as number) < (value.north as number) &&
    (value.zoom as number) >= 0 &&
    (value.zoom as number) <= 24 &&
    (value.centerLat as number) >= -90 &&
    (value.centerLat as number) <= 90 &&
    (value.centerLon as number) >= -180 &&
    (value.centerLon as number) <= 180
  );
}

function isTasking(value: unknown): value is Tasking {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    Array.isArray(value.buildingIds) &&
    value.buildingIds.every(isString) &&
    isString(value.crew) &&
    (value.priority === "Immediate" || value.priority === "Same day" || value.priority === "Routine") &&
    (value.status === "awaiting review" || value.status === "dispatched" || value.status === "rejected") &&
    isFiniteNumber(value.at)
  );
}

function parsePersisted(value: unknown): PersistedState | null {
  if (!isRecord(value) || value.version !== SESSION_VERSION) return null;
  if (
    !Array.isArray(value.assessments) || !value.assessments.every(isAssessment) ||
    !Array.isArray(value.notes) || !value.notes.every(isNote) ||
    !(value.eventContext === null || isEventContext(value.eventContext)) ||
    !(value.pendingTasking === null || (isTasking(value.pendingTasking) && value.pendingTasking.status === "awaiting review")) ||
    !Array.isArray(value.taskings) || !value.taskings.every(isTasking) ||
    !(value.viewport === null || isViewport(value.viewport)) ||
    !(value.imagery === "storm-day" || value.imagery === "reference") ||
    !(value.selectedId === null || isString(value.selectedId))
  ) {
    return null;
  }
  return value as PersistedState;
}

function persist() {
  if (!persistenceReady || typeof window === "undefined") return;
  const saved: PersistedState = {
    version: SESSION_VERSION,
    assessments: [...state.assessments.values()],
    notes: state.notes,
    eventContext: state.eventContext,
    pendingTasking: state.pendingTasking,
    taskings: state.taskings,
    viewport: state.viewport,
    imagery: state.imagery,
    selectedId: state.selectedId,
  };
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved));
  } catch (error) {
    console.warn("session state could not be saved", error);
  }
}

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
  persist();
}

export const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  restoreSession() {
    if (persistenceReady || typeof window === "undefined") return;
    persistenceReady = true;
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const saved = parsePersisted(JSON.parse(raw));
      if (!saved) {
        window.sessionStorage.removeItem(SESSION_KEY);
        return;
      }
      set({
        assessments: new Map(saved.assessments.map((a) => [a.buildingId, a])),
        notes: saved.notes,
        eventContext: saved.eventContext,
        pendingTasking: saved.pendingTasking,
        taskings: saved.taskings,
        viewport: saved.viewport,
        imagery: saved.imagery,
        selectedId: saved.selectedId,
      });
    } catch {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  },

  hydrate(buildings: Building[], infrastructure: Infrastructure[], roads: Road[]) {
    const ids = new Set(buildings.map((b) => b.id));
    const assessments = new Map(
      [...state.assessments].filter(([buildingId]) => ids.has(buildingId)),
    );
    const notes = state.notes.filter((note) => ids.has(note.buildingId));
    const sanitizeTasking = <T extends Tasking | PendingTasking>(tasking: T): T | null => {
      const buildingIds = tasking.buildingIds.filter((id) => ids.has(id));
      return buildingIds.length > 0 ? { ...tasking, buildingIds } : null;
    };
    set({
      loaded: true,
      buildings,
      byId: new Map(buildings.map((b) => [b.id, b])),
      infrastructure,
      roads,
      assessments,
      notes,
      selectedId: state.selectedId && ids.has(state.selectedId) ? state.selectedId : null,
      pendingTasking: state.pendingTasking ? sanitizeTasking(state.pendingTasking) : null,
      taskings: state.taskings.flatMap((tasking) => {
        const valid = sanitizeTasking(tasking);
        return valid ? [valid] : [];
      }),
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
      imagery: "storm-day",
    });
    if (typeof window !== "undefined") window.sessionStorage.removeItem(SESSION_KEY);
  },
};

/**
 * `useSyncExternalStore` compares snapshots by identity, so a selector that
 * allocates (`.filter(...)`, an object literal) would return a fresh reference
 * on every call and spin forever. The snapshot is therefore memoised against
 * the state object it was derived from: `set()` always produces a new state,
 * so the value recomputes exactly when something actually changed.
 *
 * The constraint this imposes: a selector must depend only on store state, not
 * on props or closures that can change while the state object does not.
 */
export function useStore<T>(selector: (s: State) => T): T {
  const cache = useRef<{ from: State; selector: typeof selector; value: T } | null>(null);

  const snapshot = useCallback(() => {
    if (!cache.current || cache.current.from !== state || cache.current.selector !== selector) {
      cache.current = { from: state, selector, value: selector(state) };
    }
    return cache.current.value;
  }, [selector]);

  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

/** Buildings whose centroid falls inside the current viewport. */
export function inViewport(s: State): Building[] {
  const v = s.viewport;
  if (!v) return [];
  return s.buildings.filter(
    (b) => b.lon >= v.west && b.lon <= v.east && b.lat >= v.south && b.lat <= v.north,
  );
}

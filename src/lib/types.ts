export type Building = {
  id: string;
  name: string | null;
  addr: string | null;
  kind: string;
  area_m2: number;
  floors: number | null;
  lat: number;
  lon: number;
  ring: [number, number][];
  elev_m: number | null;
  surge_depth_m: number | null;
  exposure: "Severe" | "High" | "Moderate" | "Low" | "Unknown";
  occupancy_est: number;
  occupancy_inferred: boolean;
};

export type Infrastructure = {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
};

export type Road = {
  id: string;
  name: string | null;
  cls: string;
  bridge: boolean;
  line: [number, number][];
};

/** Natural-language enum. Mirrors the EMS / FEMA rapid-assessment ladder. */
export const DAMAGE_GRADES = [
  "No visible damage",
  "Affected",
  "Minor damage",
  "Major damage",
  "Destroyed",
  "Inaccessible",
] as const;
export type DamageGrade = (typeof DAMAGE_GRADES)[number];

export type Author = "you" | "agent";

export type Assessment = {
  buildingId: string;
  grade: DamageGrade;
  rationale: string;
  /** Who wrote this record. Agent writes never silently overwrite a human one. */
  source: Author;
  /** Human-locked records refuse all agent writes. */
  locked: boolean;
  at: number;
};

export type Note = {
  id: string;
  buildingId: string;
  text: string;
  /** Notes carry their author's identity; the agent never annotates as "you". */
  source: Author;
  at: number;
};

export type EventContext = {
  summary: string;
  /** Where the agent says this came from. Rendered as agent-supplied, not ours. */
  attribution: string;
  at: number;
};

export type ImageryLayer = "storm-day" | "reference";

export type Tasking = {
  id: string;
  buildingIds: string[];
  crew: string;
  priority: "Immediate" | "Same day" | "Routine";
  status: "awaiting review" | "dispatched" | "rejected";
  at: number;
};

export type Viewport = {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
  centerLat: number;
  centerLon: number;
};

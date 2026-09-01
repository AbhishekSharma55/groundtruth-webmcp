import { store } from "@/lib/store";
import type { Building, Infrastructure, Road } from "@/lib/types";

/** A hand-built block: two severe, one high, one already human-locked. */
export function seed() {
  const mk = (
    id: string, kind: string, elev: number, occ: number,
    exposure: Building["exposure"], lat = 26.452, lon = -81.949,
  ): Building => ({
    id, name: null, addr: null, kind, area_m2: 180, floors: 1,
    lat, lon, ring: [[lon, lat], [lon + 1e-4, lat], [lon + 1e-4, lat + 1e-4], [lon, lat]],
    elev_m: elev, surge_depth_m: Math.max(0, 4.5 - elev), exposure,
    occupancy_est: occ, occupancy_inferred: false,
  });

  // Spread across the island so a viewport can meaningfully exclude some of
  // them — packed into one block, no bbox would prove anything about scoping.
  const buildings: Building[] = [
    mk("b1", "Single-family home", 0.9, 3, "Severe", 26.4450, -81.9600),
    mk("b2", "Single-family home", 1.1, 3, "Severe", 26.4480, -81.9550),
    mk("b3", "Hotel / resort", 2.4, 40, "High", 26.4560, -81.9450),
    mk("b4", "Retail", 3.6, 9, "Moderate", 26.4600, -81.9350),
  ];
  const infra: Infrastructure[] = [
    { id: "i1", name: "Beach Shelter", category: "Shelter", lat: 26.4531, lon: -81.9501 },
    { id: "i2", name: "Station 31", category: "Fire station", lat: 26.4541, lon: -81.9511 },
  ];
  const roads: Road[] = [
    { id: "r1", name: "Estero Blvd", cls: "secondary", bridge: false, line: [[-81.95, 26.45], [-81.94, 26.46]] },
  ];

  store.reset();
  store.hydrate(buildings, infra, roads);
  store.setViewport({
    west: -81.96, south: 26.44, east: -81.93, north: 26.47,
    zoom: 16, centerLat: 26.4525, centerLon: -81.9495,
  });
  return { buildings, infra, roads };
}

export function textOf(r: { content: { text: string }[] }) {
  return r.content.map((c) => c.text).join("\n");
}

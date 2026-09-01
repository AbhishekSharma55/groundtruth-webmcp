"use client";

import { useEffect, useRef } from "react";
import {
  Map as MLMap,
  NavigationControl,
  ScaleControl,
  type ExpressionSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { store, useStore } from "@/lib/store";
import { mapBus } from "@/lib/mapBus";
import { IMAGERY } from "@/lib/imagery";
import { DAMAGE_GRADES } from "@/lib/types";

/** Damage grade -> fill colour. Ordered like the grades themselves. */
export const GRADE_COLOR: Record<string, string> = {
  "No visible damage": "#22c55e",
  Affected: "#facc15",
  "Minor damage": "#fb923c",
  "Major damage": "#f97316",
  Destroyed: "#ef4444",
  Inaccessible: "#a855f7",
};

const ISLAND: [number, number, number, number] = [-81.975, 26.42, -81.9, 26.49];

/**
 * `match` on the feature-state grade -> colour. MapLibre types `match` as a
 * fixed-arity tuple, which a spread over DAMAGE_GRADES cannot satisfy, so the
 * assertion lives here once instead of at all three paint properties.
 */
const GRADE_MATCH = [
  "match",
  ["coalesce", ["feature-state", "grade"], ""],
  ...DAMAGE_GRADES.flatMap((g) => [g, GRADE_COLOR[g]]),
  "#ffffff",
] as unknown as ExpressionSpecification;

const HAS_GRADE = ["!=", ["coalesce", ["feature-state", "grade"], ""], ""] as unknown as ExpressionSpecification;

export default function MapCanvas() {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const loaded = useStore((s) => s.loaded);
  const imagery = useStore((s) => s.imagery);
  const selectedId = useStore((s) => s.selectedId);
  const assessments = useStore((s) => s.assessments);

  // ---- create the map once ------------------------------------------------
  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    const map = new MLMap({
      container: holder.current,
      style: {
        version: 8,
        sources: {
          imagery: {
            type: "raster",
            tiles: [IMAGERY["storm-day"].url],
            tileSize: 256,
            maxzoom: 19,
            attribution: IMAGERY["storm-day"].attribution,
          },
          base: {
            type: "raster",
            tiles: [IMAGERY.reference.url],
            tileSize: 256,
            maxzoom: 19,
            attribution: IMAGERY.reference.attribution,
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#05070c" } },
          { id: "base", type: "raster", source: "base", paint: { "raster-opacity": 1 } },
          { id: "imagery", type: "raster", source: "imagery", paint: { "raster-opacity": 1 } },
        ],
      },
      bounds: ISLAND,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
      maxZoom: 19,
      minZoom: 11,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    const publish = () => {
      const b = map.getBounds();
      const c = map.getCenter();
      store.setViewport({
        west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth(),
        zoom: map.getZoom(), centerLat: c.lat, centerLon: c.lng,
      });
    };
    map.on("load", publish);
    map.on("moveend", publish);

    const detach = mapBus.attach({
      fitBounds: (b) =>
        map.fitBounds([b.west, b.south, b.east, b.north], { padding: 40, duration: 500 }),
      flyTo: (lat, lon, zoom) => map.flyTo({ center: [lon, lat], zoom, duration: 500 }),
      getViewport: () => store.get().viewport,
    });

    return () => {
      detach();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- add data layers once both map and data are ready -------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const add = () => {
      if (map.getSource("buildings")) return;
      const s = store.get();

      map.addSource("roads", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: s.roads.map((r) => ({
            type: "Feature" as const,
            properties: { bridge: r.bridge ? 1 : 0, name: r.name ?? "" },
            geometry: { type: "LineString" as const, coordinates: r.line },
          })),
        },
      });
      map.addLayer({
        id: "roads", type: "line", source: "roads",
        paint: {
          "line-color": ["case", ["==", ["get", "bridge"], 1], "#38bdf8", "#94a3b8"],
          "line-width": ["case", ["==", ["get", "bridge"], 1], 3, 1],
          "line-opacity": ["case", ["==", ["get", "bridge"], 1], 0.9, 0.25],
        },
      });

      map.addSource("buildings", {
        type: "geojson",
        promoteId: "id",
        data: {
          type: "FeatureCollection",
          features: s.buildings.map((b) => ({
            type: "Feature" as const,
            id: b.id,
            properties: { id: b.id, exposure: b.exposure },
            geometry: { type: "Polygon" as const, coordinates: [b.ring] },
          })),
        },
      });

      // Fill only appears once a building has been graded, so the assessor can
      // always see the imagery underneath the work that is still to do.
      map.addLayer({
        id: "buildings-fill", type: "fill", source: "buildings",
        paint: {
          "fill-color": GRADE_MATCH,
          "fill-opacity": ["case", HAS_GRADE, 0.5, 0],
        },
      });

      map.addLayer({
        id: "buildings-line", type: "line", source: "buildings",
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false], "#22d3ee",
            HAS_GRADE, GRADE_MATCH,
            "#e2e8f0",
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false], 3,
            ["boolean", ["feature-state", "locked"], false], 2,
            HAS_GRADE, 1.5,
            0.6,
          ],
          "line-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false], 1,
            HAS_GRADE, 0.95,
            0.45,
          ],
        },
      });

      // Agent proposals are drawn dashed. A human lock is solid. The difference
      // is visible on the map, not just in the panel.
      map.addLayer({
        id: "buildings-proposed", type: "line", source: "buildings",
        filter: ["==", ["coalesce", ["feature-state", "source"], ""], "agent"],
        paint: {
          "line-color": "#ffffff",
          "line-width": 1.6,
          "line-dasharray": [2, 2],
          "line-opacity": 0.9,
        },
      });

      map.addSource("infra", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: s.infrastructure.map((i) => ({
            type: "Feature" as const,
            properties: { name: i.name, category: i.category },
            geometry: { type: "Point" as const, coordinates: [i.lon, i.lat] },
          })),
        },
      });
      map.addLayer({
        id: "infra", type: "circle", source: "infra",
        paint: {
          "circle-radius": 4,
          "circle-color": [
            "match", ["get", "category"],
            "Shelter", "#38bdf8", "Fire station", "#f87171", "Clinic", "#4ade80",
            "Power substation", "#fbbf24", "Power infrastructure", "#fbbf24",
            "#cbd5e1",
          ],
          "circle-stroke-color": "#020617",
          "circle-stroke-width": 1.5,
        },
      });

      map.on("click", "buildings-fill", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) store.select(String(id));
      });
      map.on("click", "buildings-line", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) store.select(String(id));
      });
      map.on("mouseenter", "buildings-line", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "buildings-line", () => { map.getCanvas().style.cursor = ""; });
    };

    if (map.isStyleLoaded()) add();
    else map.once("load", add);
  }, [loaded]);

  // ---- imagery switch -----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.getLayer("imagery")) return;
      map.setPaintProperty("imagery", "raster-opacity", imagery === "storm-day" ? 1 : 0);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [imagery]);

  // ---- push assessment + selection into feature-state ---------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const apply = () => {
      if (!map.getSource("buildings")) return;
      for (const [id, a] of assessments) {
        map.setFeatureState(
          { source: "buildings", id },
          { grade: a.grade, source: a.source, locked: a.locked },
        );
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [assessments, loaded]);

  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !map.getSource("buildings")) return;
    if (prevSelected.current) {
      map.setFeatureState({ source: "buildings", id: prevSelected.current }, { selected: false });
    }
    if (selectedId) {
      map.setFeatureState({ source: "buildings", id: selectedId }, { selected: true });
    }
    prevSelected.current = selectedId;
  }, [selectedId, loaded]);

  return <div ref={holder} className="absolute inset-0" />;
}

"use client";

import { useEffect, useRef, useState } from "react";
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

/**
 * Builds `interpolate(zoom) -> case(feature-state)`. A zoom expression is only
 * legal as the outermost expression, so the data-driven `case` has to live in
 * each stop's output rather than wrapping the interpolate.
 */
function outlineByZoom(
  ...args: [[number, number], [number, number], [number, number], (ungraded: number) => unknown[]]
): ExpressionSpecification {
  const [a, b, c, branch] = args;
  return [
    "interpolate", ["linear"], ["zoom"],
    a[0], branch(a[1]),
    b[0], branch(b[1]),
    c[0], branch(c[1]),
  ] as unknown as ExpressionSpecification;
}

export default function MapCanvas() {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  /**
   * Map construction is deferred by a tick (see below), so the effects that add
   * data layers can run before the map exists. They key off this instead of
   * mapRef, which would leave them stranded with no reason to re-run.
   */
  const [mapReady, setMapReady] = useState(false);
  const loaded = useStore((s) => s.loaded);
  const imagery = useStore((s) => s.imagery);
  const selectedId = useStore((s) => s.selectedId);
  const assessments = useStore((s) => s.assessments);

  // ---- create the map once ------------------------------------------------
  useEffect(() => {
    const container = holder.current;
    if (!container || mapRef.current) return;

    // StrictMode mounts, unmounts and remounts inside a single tick. Building a
    // MapLibre map and calling remove() on it within that tick races MapLibre's
    // shared worker pool: the surviving map comes up with a style that never
    // finishes loading, and MapLibre raises no error for it. Deferring
    // construction past that tick means the throwaway mount never builds a map.
    // A timer rather than requestAnimationFrame, because rAF does not fire in a
    // backgrounded tab and the map would then never be created at all.
    let cancelled = false;
    let teardown: (() => void) | undefined;

    const timer = setTimeout(() => {
      if (cancelled) return;

      const restoredViewport = store.get().viewport;

      const map = new MLMap({
        container,
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
        ...(restoredViewport
          ? { center: [restoredViewport.centerLon, restoredViewport.centerLat] as [number, number], zoom: restoredViewport.zoom }
          : { bounds: ISLAND, fitBoundsOptions: { padding: 24 } }),
        attributionControl: { compact: true },
        maxZoom: 19,
        minZoom: 11,
      });
      mapRef.current = map;
      setMapReady(true);

      // Surfaced for the eval harness, and for debugging tile/style failures
      // which MapLibre otherwise swallows into an `error` event.
      (window as unknown as { __groundtruthMap?: MLMap }).__groundtruthMap = map;
      map.on("error", (e) => console.error("[maplibre]", e.error?.message ?? e));

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

      // The rails are fixed-width, so a window resize changes the map box.
      const ro = new ResizeObserver(() => map.resize());
      ro.observe(container);

      teardown = () => {
        ro.disconnect();
        detach();
        map.remove();
        mapRef.current = null;
        setMapReady(false);
      };
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      teardown?.();
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
            "#7dd3fc",
          ],
          // Ungraded outlines have to stay legible against grey rubble without
          // burying the imagery the assessor is reading, so the ungraded case
          // tracks zoom. The style spec only allows a zoom expression as the
          // outermost expression, so the per-feature `case` sits inside the
          // interpolate stops rather than the other way round.
          "line-width": outlineByZoom(
            [13, 0.4], [16, 1], [18, 1.6],
            (ungraded) => [
              "case",
              ["boolean", ["feature-state", "selected"], false], 3,
              ["boolean", ["feature-state", "locked"], false], 2,
              HAS_GRADE, 1.5,
              ungraded,
            ],
          ),
          "line-opacity": outlineByZoom(
            [13, 0.3], [16, 0.6], [18, 0.75],
            (ungraded) => [
              "case",
              ["boolean", ["feature-state", "selected"], false], 1,
              HAS_GRADE, 0.95,
              ungraded,
            ],
          ),
        },
      });

      // Agent proposals are drawn dashed. A human lock is solid. The difference
      // is visible on the map, not just in the panel.
      // `filter` cannot read feature-state — only paint properties can — so the
      // agent/human distinction is driven through opacity rather than a filter.
      map.addLayer({
        id: "buildings-proposed", type: "line", source: "buildings",
        paint: {
          "line-color": "#ffffff",
          "line-width": 1.6,
          "line-dasharray": [2, 2],
          "line-opacity": [
            "case",
            ["==", ["coalesce", ["feature-state", "source"], ""], "agent"], 0.9,
            0,
          ],
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
  }, [loaded, mapReady]);

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
  }, [imagery, mapReady]);

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
  }, [assessments, loaded, mapReady]);

  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !mapReady || !map.getSource("buildings")) return;
    if (prevSelected.current) {
      map.setFeatureState({ source: "buildings", id: prevSelected.current }, { selected: false });
    }
    if (selectedId) {
      map.setFeatureState({ source: "buildings", id: selectedId }, { selected: true });
    }
    prevSelected.current = selectedId;
  }, [selectedId, loaded, mapReady]);

  // maplibre-gl.css sets `.maplibregl-map { position: relative }` and is imported
  // after Tailwind, so `absolute inset-0` here would be overridden and collapse
  // the container to zero height. Size it directly instead.
  return <div ref={holder} className="h-full w-full" />;
}

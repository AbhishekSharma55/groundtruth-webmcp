"use client";

import type { Viewport } from "./types";

/**
 * Imperative channel from tool `execute` to the map instance. Tools run outside
 * React, so navigation cannot go through props.
 */
type MapCommands = {
  fitBounds(b: { west: number; south: number; east: number; north: number }): void;
  flyTo(lat: number, lon: number, zoom?: number): void;
  getViewport(): Viewport | null;
};

let commands: MapCommands | null = null;

export const mapBus = {
  attach(c: MapCommands) {
    commands = c;
    return () => {
      if (commands === c) commands = null;
    };
  },
  get: () => commands,
};

/** Named places a human would actually say out loud, for `set_view`. */
export const PLACES: Record<string, { west: number; south: number; east: number; north: number }> = {
  "estero island": { west: -81.975, south: 26.42, east: -81.9, north: 26.49 },
  "fort myers beach": { west: -81.975, south: 26.42, east: -81.9, north: 26.49 },
  "times square": { west: -81.9535, south: 26.4505, east: -81.9455, north: 26.4565 },
  "north end": { west: -81.96, south: 26.448, east: -81.938, north: 26.475 },
  "south end": { west: -81.928, south: 26.42, east: -81.9, north: 26.44 },
  "mid island": { west: -81.945, south: 26.435, east: -81.92, north: 26.455 },
  "matanzas pass bridge": { west: -81.9585, south: 26.4515, east: -81.9455, north: 26.4625 },
  "big carlos pass": { west: -81.9075, south: 26.4165, east: -81.8955, north: 26.4275 },
  "santini plaza": { west: -81.9285, south: 26.4285, east: -81.9185, north: 26.4365 },
};

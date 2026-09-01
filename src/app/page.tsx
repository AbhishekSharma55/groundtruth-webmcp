"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { store, useStore } from "@/lib/store";
import { IMAGERY } from "@/lib/imagery";
import type { Building, Infrastructure, Road } from "@/lib/types";
import { createTools } from "@/lib/webmcp/tools";
import { useWebMCP } from "@/lib/webmcp/useWebMCP";
import AgentBanner from "@/components/AgentBanner";
import AssessmentPanel from "@/components/AssessmentPanel";
import SummaryRail from "@/components/SummaryRail";
import TaskingDialog from "@/components/TaskingDialog";

const MapCanvas = dynamic(() => import("@/components/MapCanvas"), { ssr: false });

const DATA_TIMEOUT_MS = 12_000;
const RETRY_DELAYS_MS = [0, 500, 1_500] as const;

type DataBundle = {
  buildings: Building[];
  infrastructure: Infrastructure[];
  roads: Road[];
};

type LoadError = { file: string; detail: string };
type Drawer = "overview" | "assessment" | null;

class DataLoadFailure extends Error {
  constructor(
    readonly file: string,
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "DataLoadFailure";
  }
}

function isTransientStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchJson<T>(url: string, key: string, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    const aborted = (error as Error).name === "AbortError";
    throw new DataLoadFailure(
      key,
      aborted ? "did not finish before the timeout" : "could not be reached",
      true,
    );
  }
  if (!response.ok) {
    throw new DataLoadFailure(
      key,
      `returned HTTP ${response.status}`,
      isTransientStatus(response.status),
    );
  }
  try {
    return await response.json() as T;
  } catch {
    throw new DataLoadFailure(key, "returned invalid JSON", false);
  }
}

async function fetchData(signal: AbortSignal): Promise<DataBundle> {
  const [buildings, infrastructure, roads] = await Promise.all([
    fetchJson<{ buildings: Building[] }>("/data/buildings.json", "buildings.json", signal),
    fetchJson<{ infrastructure: Infrastructure[] }>(
      "/data/infrastructure.json",
      "infrastructure.json",
      signal,
    ),
    fetchJson<{ roads: Road[] }>("/data/roads.json", "roads.json", signal),
  ]);
  if (!Array.isArray(buildings.buildings)) {
    throw new DataLoadFailure("buildings.json", "did not contain a buildings list", false);
  }
  if (!Array.isArray(infrastructure.infrastructure)) {
    throw new DataLoadFailure("infrastructure.json", "did not contain an infrastructure list", false);
  }
  if (!Array.isArray(roads.roads)) {
    throw new DataLoadFailure("roads.json", "did not contain a roads list", false);
  }
  return {
    buildings: buildings.buildings,
    infrastructure: infrastructure.infrastructure,
    roads: roads.roads,
  };
}

function waitFor(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export default function Console() {
  const loaded = useStore((s) => s.loaded);
  const viewport = useStore((s) => s.viewport);
  const selectedId = useStore((s) => s.selectedId);
  const hasAssessments = useStore((s) => s.assessments.size > 0);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [drawer, setDrawer] = useState<Drawer>(null);

  // ---- data (bundled, no backend) ----------------------------------------
  useEffect(() => {
    store.restoreSession();
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    let lastFailure: DataLoadFailure | null = null;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DATA_TIMEOUT_MS);

    (async () => {
      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          const delay = RETRY_DELAYS_MS[attempt];
          if (delay) await waitFor(delay, controller.signal);
          const data = await fetchData(controller.signal);
          if (!active) return;
          store.hydrate(data.buildings, data.infrastructure, data.roads);
          window.clearTimeout(timeout);
          return;
        } catch (error) {
          if (error instanceof DataLoadFailure) lastFailure = error;
          if (!active) return;
          if (controller.signal.aborted) {
            if (timedOut) {
              setLoadError({
                file: lastFailure?.file ?? "assessment data",
                detail: `did not finish within ${DATA_TIMEOUT_MS / 1_000} seconds`,
              });
            }
            return;
          }
          const failure = error instanceof DataLoadFailure
            ? error
            : new DataLoadFailure("assessment data", "could not be loaded", true);
          if (!failure.transient || attempt === RETRY_DELAYS_MS.length - 1) {
            window.clearTimeout(timeout);
            setLoadError({ file: failure.file, detail: failure.message });
            return;
          }
        }
      }
    })();

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadAttempt]);

  // A map click or select_feature call must reveal its result in narrow mode.
  useEffect(() => {
    if (selectedId && window.matchMedia("(max-width: 1099px)").matches) {
      const timer = window.setTimeout(() => setDrawer("assessment"));
      return () => window.clearTimeout(timer);
    }
  }, [selectedId]);

  /**
   * `compare_imagery` only exists while the NOAA storm-day flight actually
   * covers what the assessor is looking at. Pan off it and the tool is
   * unregistered — the agent sees a toolchange rather than a tool that lies.
   */
  const bothImagery = useMemo(() => {
    if (!viewport) return false;
    const [w, s, e, n] = IMAGERY["storm-day"].bounds;
    return !(viewport.east < w || viewport.west > e || viewport.north < s || viewport.south > n);
  }, [viewport]);

  const tools = useMemo(
    () => createTools({ bothImagery, hasAssessments }),
    [bothImagery, hasAssessments],
  );
  const { supported, registered } = useWebMCP(tools);

  const retry = () => {
    setLoadError(null);
    setLoadAttempt((attempt) => attempt + 1);
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-slate-950 text-slate-200">
      <div className="absolute inset-0 min-[1100px]:left-[290px] min-[1100px]:right-[290px]">
        {loaded && <MapCanvas />}
      </div>

      {!loaded && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-5 min-[1100px]:left-[290px] min-[1100px]:right-[290px]">
          {loadError ? (
            <div
              role="alert"
              className="w-full max-w-sm rounded-lg border border-red-500/40 bg-slate-950/95 p-4 text-center backdrop-blur"
            >
              <div className="text-[12px] font-medium text-red-300">Data could not be loaded</div>
              <div className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                <span className="text-slate-200">{loadError.file}</span> {loadError.detail}.
              </div>
              <button
                onClick={retry}
                className="mt-3 rounded border border-cyan-500/60 bg-cyan-500/10 px-3 py-1.5 text-[11px] text-cyan-200 transition hover:border-cyan-400"
              >
                Retry data load
              </button>
            </div>
          ) : (
            <div className="text-[12px] text-slate-500">Loading 4,970 building footprints…</div>
          )}
        </div>
      )}

      <aside className="absolute left-0 top-0 z-20 hidden h-full w-[290px] border-r border-slate-800 bg-slate-950/95 backdrop-blur min-[1100px]:block">
        <SummaryRail />
      </aside>

      <aside className="absolute right-0 top-0 z-20 hidden h-full w-[290px] overflow-auto border-l border-slate-800 bg-slate-950/95 backdrop-blur min-[1100px]:block">
        <AssessmentPanel />
      </aside>

      <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 hidden w-[min(680px,calc(100vw-620px))] -translate-x-1/2 min-[1100px]:block">
        <AgentBanner tools={tools} supported={supported} registered={registered} />
      </div>

      <div className="pointer-events-none absolute inset-2 z-30 grid min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-2 min-[1100px]:hidden min-[500px]:inset-3">
        <div className="pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-700/70 bg-slate-950/92 p-1.5 backdrop-blur">
          <div className="min-w-0 flex-1 px-1.5">
            <div className="truncate text-[12px] font-semibold tracking-tight text-slate-100">
              Groundtruth
            </div>
            <div className="hidden truncate text-[10px] text-slate-500 min-[500px]:block">
              Fort Myers Beach · Hurricane Ian
            </div>
          </div>
          <button
            onClick={() => setDrawer((current) => current === "overview" ? null : "overview")}
            aria-expanded={drawer === "overview"}
            className={`rounded border px-2.5 py-1.5 text-[11px] transition ${
              drawer === "overview"
                ? "border-cyan-500/70 bg-cyan-500/10 text-cyan-200"
                : "border-slate-700 text-slate-300 hover:border-slate-500"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setDrawer((current) => current === "assessment" ? null : "assessment")}
            aria-expanded={drawer === "assessment"}
            className={`rounded border px-2.5 py-1.5 text-[11px] transition ${
              drawer === "assessment"
                ? "border-cyan-500/70 bg-cyan-500/10 text-cyan-200"
                : "border-slate-700 text-slate-300 hover:border-slate-500"
            }`}
          >
            Assess{selectedId ? " •" : ""}
          </button>
        </div>

        <div className="min-h-0">
          {drawer && (
            <aside
              aria-label={drawer === "overview" ? "Overview panel" : "Assessment panel"}
              className={`pointer-events-auto relative h-full w-[min(340px,calc(100vw-1rem))] overflow-hidden rounded-lg border border-slate-700/70 bg-slate-950/95 shadow-2xl backdrop-blur min-[500px]:w-[360px] ${
                drawer === "assessment" ? "ml-auto" : ""
              }`}
            >
              <button
                onClick={() => setDrawer(null)}
                aria-label="Close panel"
                className="absolute right-2 top-2 z-10 rounded border border-slate-700 bg-slate-950/90 px-2 py-1 text-[10px] text-slate-400 hover:border-slate-500 hover:text-slate-200"
              >
                Close
              </button>
              {drawer === "overview" ? <SummaryRail /> : <AssessmentPanel />}
            </aside>
          )}
        </div>

        <AgentBanner tools={tools} supported={supported} registered={registered} />
      </div>

      <TaskingDialog />
    </main>
  );
}

"use client";

import { useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { store, useStore } from "@/lib/store";
import { IMAGERY } from "@/lib/imagery";
import { createTools } from "@/lib/webmcp/tools";
import { useWebMCP } from "@/lib/webmcp/useWebMCP";
import AgentBanner from "@/components/AgentBanner";
import AssessmentPanel from "@/components/AssessmentPanel";
import SummaryRail from "@/components/SummaryRail";
import TaskingDialog from "@/components/TaskingDialog";

const MapCanvas = dynamic(() => import("@/components/MapCanvas"), { ssr: false });

export default function Console() {
  const loaded = useStore((s) => s.loaded);
  const viewport = useStore((s) => s.viewport);
  const hasAssessments = useStore((s) => s.assessments.size > 0);

  // ---- data (bundled, no backend) ----------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [b, i, r] = await Promise.all([
          fetch("/data/buildings.json", { signal: controller.signal }).then((x) => x.json()),
          fetch("/data/infrastructure.json", { signal: controller.signal }).then((x) => x.json()),
          fetch("/data/roads.json", { signal: controller.signal }).then((x) => x.json()),
        ]);
        store.hydrate(b.buildings, i.infrastructure, r.roads);
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.error("data load failed", e);
      }
    })();
    return () => controller.abort();
  }, []);

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

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-slate-950 text-slate-200">
      <div className="absolute inset-0">{loaded && <MapCanvas />}</div>

      {!loaded && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-[12px] text-slate-500">
          Loading 4,970 building footprints…
        </div>
      )}

      <aside className="absolute left-0 top-0 z-20 h-full w-[290px] border-r border-slate-800 bg-slate-950/95 backdrop-blur">
        <SummaryRail />
      </aside>

      <aside className="absolute right-0 top-0 z-20 h-full w-[290px] overflow-auto border-l border-slate-800 bg-slate-950/95 backdrop-blur">
        <AssessmentPanel />
      </aside>

      <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 w-[min(680px,calc(100vw-620px))] -translate-x-1/2">
        <AgentBanner tools={tools} supported={supported} registered={registered} />
      </div>

      <TaskingDialog />
    </main>
  );
}

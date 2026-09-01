/**
 * Behavioural evals for the WebMCP tool surface.
 *
 * These assert the properties a judge (or an agent) actually depends on:
 * budgets, co-presence, bounded output, refusal of unsafe writes, atomicity,
 * the human gate, and cancellation. They are not unit tests of internals.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createTools, type ToolAvailability } from "@/lib/webmcp/tools";
import { MAX_RESULT_BYTES } from "@/lib/webmcp/result";
import { DAMAGE_GRADES } from "@/lib/types";
import { store } from "@/lib/store";
import { seed, textOf } from "./fixture";

const ALL: ToolAvailability = { bothImagery: true, hasAssessments: true };
const tools = (a: Partial<ToolAvailability> = {}) => createTools({ ...ALL, ...a });
const get = (name: string, a: Partial<ToolAvailability> = {}) => {
  const t = tools(a).find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

beforeEach(() => seed());

describe("tool surface budgets", () => {
  it("keeps every name and description inside the documented limits", () => {
    for (const t of tools()) {
      expect(t.name.length, `${t.name} name`).toBeLessThanOrEqual(30);
      expect(t.description.length, `${t.name} description`).toBeLessThanOrEqual(500);
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("declares only the two annotations that ship in the browser IDL", () => {
    const allowed = new Set(["readOnlyHint", "untrustedContentHint"]);
    for (const t of tools()) {
      for (const k of Object.keys(t.annotations ?? {})) {
        expect(allowed.has(k), `${t.name} declares ${k}`).toBe(true);
      }
    }
  });

  it("keeps every parameter description inside 150 characters", () => {
    for (const t of tools()) {
      const props = (t.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      for (const [k, v] of Object.entries(props)) {
        if (v?.description) {
          expect(v.description.length, `${t.name}.${k}`).toBeLessThanOrEqual(150);
        }
      }
    }
  });
});

describe("co-presence", () => {
  it("get_view reports the viewport, imagery date and selection", async () => {
    store.select("b3");
    const out = textOf(await get("get_view").execute({}));
    expect(out).toContain("Viewport bbox");
    expect(out).toContain("30 September 2022");
    expect(out).toContain("b3");
    expect(out).toContain("Buildings in frame: 4");
  });

  it("scopes list_in_view to what is actually on screen", async () => {
    store.setViewport({
      west: -81.9495, south: 26.4515, east: -81.93, north: 26.47,
      zoom: 18, centerLat: 26.4525, centerLon: -81.94,
    });
    const out = textOf(await get("list_in_view").execute({}));
    expect(out).not.toContain("b1 ");
    expect(out).toContain("b3");
  });
});

describe("bounded output", () => {
  it("never exceeds the result byte budget", async () => {
    for (const t of tools()) {
      if (t.name === "create_tasking") continue; // blocks on a human, covered below
      const res = await t.execute(minimalInput(t.name));
      for (const c of res.content) expect(c.text.length).toBeLessThanOrEqual(MAX_RESULT_BYTES);
    }
  });

  it("paginates rather than dumping the whole view", async () => {
    const out = textOf(await get("list_in_view").execute({ limit: 2 }));
    expect(out).toContain("next cursor: 2");
  });
});

describe("failures read as failures", () => {
  it("marks an unknown id as an error and names the tool to call first", async () => {
    const res = await get("get_feature").execute({ id: "does-not-exist" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("list_in_view");
  });

  it("rejects a grade that is not one of the natural-language enums", async () => {
    const res = await get("propose_grade").execute({
      id: "b1", grade: "3", rationale: "numeric grade should be refused",
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain(DAMAGE_GRADES[0]);
  });
});

describe("human-protected state", () => {
  it("refuses an agent write against a building the assessor has locked", async () => {
    store.writeAssessment("b1", "Destroyed", "Operator read the imagery.", "you");
    const res = await get("propose_grade").execute({
      id: "b1", grade: "Minor damage", rationale: "agent disagrees",
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("locked");
    expect(store.get().assessments.get("b1")?.grade).toBe("Destroyed");
    expect(store.get().assessments.get("b1")?.source).toBe("you");
  });

  it("lets an agent write to an unlocked building and attributes it to the agent", async () => {
    const res = await get("propose_grade").execute({
      id: "b2", grade: "Major damage", rationale: "Severe exposure, 1.1 m ground.",
    });
    expect(res.isError).toBeUndefined();
    expect(store.get().assessments.get("b2")?.source).toBe("agent");
    expect(store.get().assessments.get("b2")?.locked).toBe(false);
  });

  it("propose_batch is atomic — one locked building blocks the whole sweep", async () => {
    store.writeAssessment("b1", "Destroyed", "Operator call.", "you");
    const res = await get("propose_batch").execute({
      ids: ["b1", "b2", "b3"], grade: "Major damage", rationale: "block sweep",
    });
    expect(res.isError).toBe(true);
    expect(store.get().assessments.has("b2")).toBe(false);
    expect(store.get().assessments.has("b3")).toBe(false);
  });

  it("never lets the agent set the locked flag", async () => {
    await get("propose_grade").execute({ id: "b3", grade: "Affected", rationale: "x" });
    expect(store.get().assessments.get("b3")?.locked).toBe(false);
  });
});

describe("agent identity", () => {
  it("attributes notes to the agent, not the operator", async () => {
    await get("add_note").execute({ id: "b1", text: "Check the seawall on the gulf side." });
    expect(store.get().notes[0].source).toBe("agent");
  });

  it("requires the agent to attribute event context it contributes", async () => {
    const res = await get("set_event_context").execute({
      summary: "Ian made landfall as a category 4.", attribution: "",
    });
    expect(res.isError).toBe(true);
    expect(store.get().eventContext).toBeNull();
  });
});

describe("consequential actions gate on a human", () => {
  it("does not dispatch until a human approves, and reports the approval", async () => {
    const call = get("create_tasking").execute({
      ids: ["b1", "b2"], crew: "USAR team 2", priority: "Immediate",
    });
    await tick();
    const pending = store.get().pendingTasking;
    expect(pending).not.toBeNull();
    expect(store.get().taskings).toHaveLength(0);

    store.resolveTasking(pending!.id, "dispatched");
    const res = await call;
    expect(res.isError).toBeUndefined();
    expect(textOf(res)).toContain("APPROVED");
    expect(store.get().taskings[0].status).toBe("dispatched");
  });

  it("treats rejection as a failure and tells the agent not to retry", async () => {
    const call = get("create_tasking").execute({
      ids: ["b1"], crew: "structural engineer", priority: "Routine",
    });
    await tick();
    store.resolveTasking(store.get().pendingTasking!.id, "rejected");
    const res = await call;
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("REJECTED");
    expect(textOf(res)).toContain("Do not re-send");
  });

  it("cancels the pending dialog when the agent aborts mid-call", async () => {
    const ac = new AbortController();
    const call = get("create_tasking").execute(
      { ids: ["b1"], crew: "USAR team 2", priority: "Immediate" },
      { signal: ac.signal },
    );
    await tick();
    expect(store.get().pendingTasking).not.toBeNull();

    ac.abort();
    const res = await call;
    expect(res.isError).toBe(true);
    expect(store.get().pendingTasking).toBeNull();
  });
});

describe("state-scoped registration", () => {
  it("hides compare_imagery when the storm-day flight does not cover the view", () => {
    const names = tools({ bothImagery: false })
      .filter((t) => t.available !== false)
      .map((t) => t.name);
    expect(names).not.toContain("compare_imagery");
  });

  it("hides export_report until there is something to export", () => {
    const names = tools({ hasAssessments: false })
      .filter((t) => t.available !== false)
      .map((t) => t.name);
    expect(names).not.toContain("export_report");
  });
});

describe("input is never trusted", () => {
  it("re-derives ids against real state instead of echoing them", async () => {
    const res = await get("get_feature").execute({ id: "<script>alert(1)</script>" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).not.toContain("alert(1)");
  });
});

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

function minimalInput(name: string): Record<string, unknown> {
  switch (name) {
    case "get_feature": return { id: "b1" };
    case "select_feature": return { id: "b1" };
    case "set_view": return { place: "Estero Island" };
    case "propose_grade": return { id: "b1", grade: "Affected", rationale: "eval" };
    case "propose_batch": return { ids: ["b1"], grade: "Affected", rationale: "eval" };
    case "add_note": return { id: "b1", text: "eval" };
    case "set_event_context": return { summary: "eval", attribution: "eval" };
    case "compare_imagery": return { layer: "reference" };
    default: return {};
  }
}

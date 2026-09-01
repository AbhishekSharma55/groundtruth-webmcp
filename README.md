# Groundtruth

**You read the imagery. Your agent reads everything else.**

**[Live console →](https://groundtruth-webmcp.vercel.app)** · [Source](https://github.com/AbhishekSharma55/groundtruth-webmcp) · Demo video _(coming)_

An agent-assisted rapid damage assessment console, built on
[WebMCP](https://github.com/webmachinelearning/webmcp). It runs over real NOAA
emergency-response imagery of Fort Myers Beach, Florida, flown two days after
Hurricane Ian made landfall on 28 September 2022.

A human assessor does the thing humans are still better at: reading aerial
imagery and deciding whether a structure is damaged. The agent does the thing no
human can hold in their head: cross-referencing 4,970 building footprints
against ground elevation, modelled surge depth, estimated occupancy, road access
and the nearest shelter — **scoped to whatever is on screen right now.**

---

## Why this needs WebMCP and not a remote MCP server

> The agent's tools are scoped to what is on screen right now.

Ask *"what's the flood exposure here?"* and **here** means the current viewport,
the selected polygon, and the imagery layer and capture date currently loaded. A
remote MCP server has no idea what "here" is. It cannot see that the assessor is
looking at the north end of the island at zoom 17 with the storm-day layer up,
and it cannot move the map to show them what it found.

Every read tool is scoped to the viewport. Every navigation tool changes what the
human sees. That co-presence is the entire argument, and it only works in-page.

---

## What we found out about the shipping API

Most of the interesting engineering here came from testing against the browser
rather than the spec. On **Chrome 151** with `chrome://flags#enable-webmcp-testing`,
`document.modelContext` exposes exactly four members:

```
ModelContext { ontoolchange, executeTool(tool, argsJson), getTools(), registerTool(descriptor) }
```

Three findings that shaped the whole design:

| Finding | Consequence |
|---|---|
| **There is no `unregisterTool`** (and no `provideContext`) | A tool registered on a document cannot be withdrawn. "Unregister to fire `toolchange`" is not implementable. |
| **Registering a name twice rejects with `InvalidStateError: Duplicate tool name`** | Registration must be idempotent across React StrictMode remounts, Fast Refresh and route changes. |
| **An `AbortSignal` on the descriptor is accepted and then ignored** | It does *not* remove the tool. Only `options.signal` inside `execute` is real. |

Two more worth knowing, because the shapes are not obvious:

- `executeTool(tool, args)` takes the **`RegisteredTool` object** from `getTools()`,
  not a name string, and `args` is a **JSON string**, not an object.
- `executeTool` resolves to a **JSON string**, which you must parse.

We got these wrong first. The result was a page that looked perfect — banner
green, 12 tools registered — where **every single tool call returned
`"Cancelled."`**, because the hook re-registered on each effect run and the
browser was left holding tools bound to an already-aborted controller. See
[`src/lib/webmcp/types.ts`](src/lib/webmcp/types.ts) for the annotated IDL and
[`src/lib/webmcp/useWebMCP.ts`](src/lib/webmcp/useWebMCP.ts) for the fix.

### Dynamic registration, inverted

Because tools cannot be withdrawn, state-scoped tools are **held back** rather
than unregistered. `export_report` does not exist until the first assessment is
recorded; the moment one is, it registers and the browser fires a real
`toolchange`. Verified live: 12 tools → grade a building → **13 tools, 2
`toolchange` events**.

When a precondition later goes *false*, the tool cannot disappear, so it returns
a self-correcting error naming the tool to call first — never a silent lie.

---

## Try it

Open the [live console](https://groundtruth-webmcp.vercel.app) in the **ChatGPT
desktop app's in-app browser** (WebMCP is on by default there), or in **Chrome
149+** with `chrome://flags/#enable-webmcp-testing` enabled. The banner at the
bottom of the page names the environment it detected.

Then ask, roughly in this order:

1. **"What am I looking at right now?"** — then pan the map yourself and ask
   again. The answer changes. That is the whole argument.
2. **"Which buildings in view have severe surge exposure and haven't been graded yet?"**
3. **"Take me to the Matanzas Pass Bridge and tell me what's there."** — it moves
   your map.
4. **Click a building yourself and grade it "Destroyed".** Then ask the agent to
   change it to "Minor damage". It is refused, and told why.
5. **"Tell me what you know about how Ian's surge hit this island, and put it on
   the page."** — the agent's own knowledge, badged as the agent's and attributed.
6. **"Write up a situation report from what we've assessed."** — on a fresh load
   this tool does not exist yet. Grade one building and ask again.
7. **"Draft a tasking for the worst-hit buildings in view and send it for my
   review."** — a dialog opens and the agent waits for your click. Try rejecting it.

---

## The tool surface

13 tools. Read tools carry `readOnlyHint` and `untrustedContentHint`; those are
the only two annotations in the shipping IDL, so they are the only two declared.

| Tool | Kind | What it does |
|---|---|---|
| `get_view` | read | Viewport bbox, zoom, imagery layer + capture date, selection, counts. **The co-presence tool.** |
| `list_in_view` | read | Buildings in frame. Bounded, cursor-paginated, summary-first. |
| `get_feature` | read | One building: elevation, surge depth, occupancy, nearest shelter and fire station. |
| `get_assessments` | read | Everything recorded so far, with author and lock state. |
| `set_view` | navigation | Moves the assessor's map to a named place or bbox. |
| `select_feature` | navigation | Highlights a building and opens its panel. |
| `propose_grade` | write | Proposes a damage grade. Refused against a human-locked record. |
| `propose_batch` | write | Atomic sweep — one locked building and **nothing** is written. |
| `add_note` | write | Annotates under the agent's own identity, never the operator's. |
| `set_event_context` | write | The agent's own world knowledge, written onto the page, attributed. |
| `create_tasking` | consequential | **Blocks on a human click.** Never dispatches on its own. |
| `compare_imagery` | state-scoped | Only while the NOAA flight covers the view. |
| `export_report` | state-scoped | Only once something has been assessed. |

### Human-protected state

Every assessment carries `source: "you" | "agent"` and a `locked` flag.

- A human grade **locks by default**. The agent cannot set that flag — ever.
- An agent write against a locked record is **refused**, and the refusal says why.
- `propose_batch` is **atomic**: if any building in the sweep is locked, nothing
  is written and the locked ids are returned.
- The map shows the difference — human calls are solid, agent proposals dashed.

```
Human clicks "Destroyed"          →  locked: true,  source: "you"
Agent calls propose_grade         →  isError: true
                                     "b1099962662 is locked by the human assessor
                                      as \"Destroyed\". Agent writes cannot
                                      overwrite a locked record."
```

---

## Data, and what is estimated

Everything ships in the repo. No database, no API keys, no backend — the console
works offline and will still work when judged three weeks from now.

| Layer | Source | Licence |
|---|---|---|
| Storm-day imagery | NOAA NGS emergency response, flight `20220930d`, 30 Sep 2022 | Public domain |
| Reference imagery | Esri World Imagery | Esri terms |
| 4,970 building footprints | OpenStreetMap | ODbL |
| Ground elevation | USGS 3DEP 10 m, via OpenTopoData | Public domain |
| 64 infrastructure points, 680 roads | OpenStreetMap | ODbL |

**Honesty about the numbers**, because this is a domain where overclaiming is
harmful:

- **Elevation is real.** Median ground height on the island is 1.3 m. Ian's
  still-water surge at Fort Myers Beach was 10–15 ft (NHC TCR AL092022), so
  99.7% of structures sit below the surge band. That is measured, not modelled.
- **Occupancy is an estimate**, derived from footprint area, floor count and
  building type. OSM tags 82% of this island as a bare `building=yes`, so those
  have their use inferred from footprint alone and are flagged
  `occupancy_inferred` in the data and "(inferred)" in the UI.
- **The reference layer is undated.** Esri publishes no acquisition date for
  this tile block, so it is labelled a reference image, *not* a dated
  pre-event capture. We are not going to claim a "before" we cannot prove.
- **Damage grades are the human's**, not the model's. The agent proposes from
  structured evidence; it does not read the imagery.

---

## Evals

```bash
npm run eval
```

21 behavioural evals over the tool surface — not unit tests of internals, but the
properties an agent actually depends on:

- name ≤ 30 chars, description ≤ 500, parameter descriptions ≤ 150
- only the two annotations that ship in the IDL are declared
- viewport scoping: tools see what is on screen and nothing else
- every result inside the 1.5 KB budget, with cursor pagination
- unknown ids fail as failures and name the tool to call first
- numeric grades rejected in favour of natural-language enums
- locked records refuse agent writes; `propose_batch` is atomic
- the agent can never set the `locked` flag
- notes are attributed to the agent, not the operator
- `create_tasking` blocks until a human decides; rejection reads as failure
- an `AbortSignal` mid-call cancels the pending dialog
- state-scoped tools are absent until their precondition holds

One of these caught a real bug: every error message was echoing raw tool input
straight back into the agent's context. Now allowlist-sanitised — a denylist for
injection syntax is a game you lose eventually.

---

## Threat model

- **Tool input is attacker-controlled.** A document, a page, or another tool's
  output can steer what an agent sends. `inputSchema` is documentation, not a
  security boundary. Every id is re-derived against real state; nothing is
  echoed back unsanitised.
- **Tool output is untrusted content.** Read tools declare
  `untrustedContentHint`. Building names and addresses come from OpenStreetMap,
  which anyone can edit.
- **Assessments are advisory, not authority.** Nothing here dispatches a crew,
  files a claim, or condemns a building. `create_tasking` exists precisely so
  that the one consequential action has a human in front of it.
- **The agent has no privileged channel.** It reaches the same store the UI
  does, under the same rules, and the human's lock outranks it.
- **No iframes on the tool-registering page** — tools inside an iframe are not
  discovered. No transient-activation APIs inside `execute`.

---

## Running it

```bash
npm install
npm run dev     # http://localhost:3000
npm run eval    # 21 behavioural evals
npm run build   # fully static
```

To give it an agent, either open it in the **ChatGPT in-app browser**, or use
**Chrome 149+** with `chrome://flags#enable-webmcp-testing` enabled (and
`#devtools-webmcp-support` for the DevTools WebMCP panel). The banner at the
bottom of the page tells you which environment it detected.

**The console is fully usable with no agent attached.** Click any building and
assess it yourself.

---

## Limits

- One area, one event. The data pipeline in `../data-pipeline` regenerates it,
  but the bundled dataset is Estero Island only.
- The reference imagery layer is undated and global; the storm-day layer covers
  only NOAA's flight footprint. `compare_imagery` is gated on that.
- Occupancy is a planning estimate. Do not use it operationally.
- Chrome's WebMCP is behind a flag and the IDL is still moving. The findings
  above are true of Chrome 151 and may not survive.

## Licence

MIT — see [LICENSE](LICENSE).
